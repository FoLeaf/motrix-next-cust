/// Protocol handler registration and query commands.
///
/// Provides three cross-platform Tauri commands for managing URL scheme
/// associations (e.g. `magnet:`, `thunder:`):
///
/// - `is_default_protocol_client` — checks if this app is the current default
/// - `set_default_protocol_client` — registers this app as the default handler
/// - `remove_as_default_protocol_client` — unregisters where the OS supports it
///
/// ## Platform strategy
///
/// | Platform | Query                                    | Register                     | Unregister               |
/// |----------|------------------------------------------|------------------------------|--------------------------|
/// | macOS    | `NSWorkspace.urlForApplication(toOpen:)` | `LSSetDefaultHandler…`       | unsupported              |
/// | Windows  | `win_registry::is_protocol_registered`   | `win_registry::register_…`   | `win_registry::unregister_…` |
/// | Linux    | `tauri-plugin-deep-link::is_registered`  | `deep-link::register`        | `deep-link::unregister`  |
///
/// ## Windows registration (RegisteredApplications pattern)
///
/// Windows 10/11 requires a three-layer registry structure for an app to
/// appear in Settings → Default Apps.  Simply writing to
/// `HKCU\Software\Classes\{scheme}` (the `tauri-plugin-deep-link` approach)
/// is insufficient — the protocol won't appear in Default Apps and may not
/// be honoured by the shell.
///
/// The three layers (all under HKCU, no admin required):
///
/// 1. **ProgID** — `HKCU\Software\Classes\MotrixNext.Url.{scheme}`
///    Defines how to open the protocol: icon, command line.
///
/// 2. **Capabilities** — `HKCU\Software\MotrixNext\Capabilities`
///    Declares which protocols the app supports via `URLAssociations`.
///
/// 3. **RegisteredApplications** — `HKCU\Software\RegisteredApplications`
///    Tells Windows this app exists and points to the Capabilities key.
///
/// After every registry change, `SHChangeNotify(SHCNE_ASSOCCHANGED, …)`
/// is called to flush the shell association cache immediately.
///
/// This is the same pattern used by qBittorrent, Transmission, and other
/// mainstream download managers.
use crate::error::AppError;
use tauri::AppHandle;

// ── macOS native implementation ─────────────────────────────────────

#[cfg(target_os = "macos")]
mod macos {
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSBundle, NSString, NSURL};

    /// Returns the bundle identifier of the app registered as the default
    /// handler for the given URL scheme, or `None` if no handler is set.
    pub fn get_default_handler_bundle_id(protocol: &str) -> Option<String> {
        let workspace = NSWorkspace::sharedWorkspace();
        let url_str = format!("{protocol}://test");
        let ns_url_str = NSString::from_str(&url_str);
        let test_url = NSURL::URLWithString(&ns_url_str)?;
        let handler_url = workspace.URLForApplicationToOpenURL(&test_url)?;
        let handler_bundle = NSBundle::bundleWithURL(&handler_url)?;
        let bundle_id = handler_bundle.bundleIdentifier()?;
        Some(bundle_id.to_string())
    }

    /// Registers this application as the default handler for the given URL
    /// scheme using `LSSetDefaultHandlerForURLScheme`.
    pub fn set_as_default_handler(protocol: &str, bundle_id: &str) -> Result<(), String> {
        use core_foundation::base::TCFType;
        use core_foundation::string::CFString;

        let scheme = CFString::new(protocol);
        let handler = CFString::new(bundle_id);

        let status = unsafe {
            core_foundation::base::OSStatus::from(LSSetDefaultHandlerForURLScheme(
                scheme.as_concrete_TypeRef(),
                handler.as_concrete_TypeRef(),
            ))
        };
        if status == 0 {
            Ok(())
        } else {
            Err(format!("LSSetDefaultHandlerForURLScheme returned {status}"))
        }
    }

    extern "C" {
        fn LSSetDefaultHandlerForURLScheme(
            scheme: core_foundation::string::CFStringRef,
            handler: core_foundation::string::CFStringRef,
        ) -> i32;
    }
}

// ── Windows native registration (RegisteredApplications pattern) ────
//
// Implements the Microsoft-recommended three-layer registry structure
// for protocol handler registration on Windows 10/11.  All writes go
// to HKCU — no administrator privileges required.
//
// References:
// - https://learn.microsoft.com/windows/win32/shell/default-programs
// - qBittorrent source: src/app/application.cpp
//
// The module is split into two parts:
// - Pure helper functions (path construction, constants) — available on
//   all platforms for cross-platform testing.
// - Win32 API implementation — cfg(windows) gated.

pub mod win_registry {
    #[allow(unused_imports)]
    use crate::error::AppError;

    // ── Constants (cross-platform for testing) ──────────────────────

    /// Application name as it appears in Windows Default Apps.
    #[cfg(any(windows, test))]
    pub const APP_NAME: &str = "Motrix Next";

    /// Short description shown in Windows Default Apps tooltip.
    #[cfg(any(windows, test))]
    pub const APP_DESCRIPTION: &str = "A full-featured download manager";

    /// Manufacturer key path prefix under HKCU\Software.
    #[cfg(any(windows, test))]
    pub const CAPABILITIES_PATH: &str = "Software\\MotrixNext\\Capabilities";

    /// The value written to HKCU\Software\RegisteredApplications.
    #[cfg(any(windows, test))]
    pub const REGISTERED_APPS_VALUE: &str = "Software\\MotrixNext\\Capabilities";

    /// Registered application name key in RegisteredApplications.
    #[cfg(any(windows, test))]
    pub const REGISTERED_APP_NAME: &str = "MotrixNext";

    // ── Pure helper functions (cross-platform for testing) ──────────

    /// Returns the ProgID for a given protocol scheme.
    ///
    /// Format: `MotrixNext.Url.{scheme}` — follows Microsoft ProgID
    /// naming convention: `{AppName}.{Type}.{Discriminator}`.
    #[cfg(any(windows, test))]
    pub fn prog_id_for_scheme(scheme: &str) -> String {
        format!("MotrixNext.Url.{scheme}")
    }

    /// Returns the registry path for the ProgID's `shell\open\command`
    /// key under `HKCU\Software\Classes`.
    #[cfg(any(windows, test))]
    pub fn prog_id_command_path(scheme: &str) -> String {
        let prog_id = prog_id_for_scheme(scheme);
        format!("Software\\Classes\\{prog_id}\\shell\\open\\command")
    }

    /// Returns the registry path for the ProgID root key.
    #[cfg(any(windows, test))]
    pub fn prog_id_root_path(scheme: &str) -> String {
        let prog_id = prog_id_for_scheme(scheme);
        format!("Software\\Classes\\{prog_id}")
    }

    /// Returns the registry path for `URLAssociations` under Capabilities.
    #[cfg(any(windows, test))]
    pub fn url_associations_path() -> String {
        format!("{}\\URLAssociations", CAPABILITIES_PATH)
    }

    // ── Win32 API implementation (Windows-only) ─────────────────────

    /// Registers a protocol handler using the three-layer structure.
    ///
    /// 1. Creates ProgID at `HKCU\Software\Classes\MotrixNext.Url.{scheme}`
    /// 2. Adds URLAssociation under `HKCU\Software\MotrixNext\Capabilities`
    /// 3. Ensures `HKCU\Software\RegisteredApplications\MotrixNext` exists
    /// 4. Calls `SHChangeNotify(SHCNE_ASSOCCHANGED, …)` to flush cache
    #[cfg(windows)]
    pub fn register_protocol(scheme: &str) -> Result<(), AppError> {
        let exe =
            std::env::current_exe().map_err(|e| AppError::Protocol(format!("current_exe: {e}")))?;
        let exe_str = exe.to_string_lossy();

        // 1. ProgID
        create_prog_id(scheme, &exe_str)?;

        // 2. Capabilities + URLAssociation
        ensure_capabilities(&exe_str)?;
        add_url_association(scheme)?;

        // 3. RegisteredApplications
        ensure_registered_application()?;

        // 4. Notify shell
        notify_shell_association_changed();

        log::info!("win_registry: registered protocol {scheme}");
        Ok(())
    }

    /// Unregisters a protocol handler.
    ///
    /// 1. Removes the URLAssociation entry
    /// 2. Deletes the ProgID key tree
    /// 3. Calls `SHChangeNotify(SHCNE_ASSOCCHANGED, …)` to flush cache
    ///
    /// Does NOT remove Capabilities or RegisteredApplications — those are
    /// shared across all protocols and should persist.
    #[cfg(windows)]
    pub fn unregister_protocol(scheme: &str) -> Result<(), AppError> {
        // 1. Remove URLAssociation
        remove_url_association(scheme)?;

        // 2. Delete ProgID tree
        delete_prog_id(scheme)?;

        // 3. Notify shell
        notify_shell_association_changed();

        log::info!("win_registry: unregistered protocol {scheme}");
        Ok(())
    }

    /// Checks if a protocol is registered and points to the current exe.
    ///
    /// Reads the ProgID's `shell\open\command` default value and checks
    /// whether it contains the path to the running executable.
    #[cfg(windows)]
    pub fn is_protocol_registered(scheme: &str) -> Result<bool, AppError> {
        let exe =
            std::env::current_exe().map_err(|e| AppError::Protocol(format!("current_exe: {e}")))?;
        let exe_str = exe.to_string_lossy().to_lowercase();

        let cmd_path = prog_id_command_path(scheme);
        match read_reg_default_string(&cmd_path) {
            Ok(value) => Ok(value.to_lowercase().contains(&exe_str)),
            Err(_) => Ok(false), // Key doesn't exist → not registered
        }
    }

    // ── Internal helpers ────────────────────────────────────────────

    /// Creates the ProgID key structure:
    /// ```text
    /// HKCU\Software\Classes\MotrixNext.Url.{scheme}
    ///     (Default) = "URL:{scheme} Protocol"
    ///     URL Protocol = ""
    ///     DefaultIcon\(Default) = "{exe},0"
    ///     shell\open\command\(Default) = "\"{exe}\" \"%1\""
    /// ```
    #[cfg(windows)]
    fn create_prog_id(scheme: &str, exe_path: &str) -> Result<(), AppError> {
        let root = prog_id_root_path(scheme);
        let command = format!("\"{}\" \"%1\"", exe_path);

        // Root key with URL Protocol marker
        let hkey = reg_create_key(&root)?;
        reg_set_string(hkey, "", &format!("URL:{scheme} Protocol"))?;
        reg_set_string(hkey, "URL Protocol", "")?;
        reg_close_key(hkey);

        // DefaultIcon
        let icon_path = format!("{}\\DefaultIcon", root);
        let icon_key = reg_create_key(&icon_path)?;
        reg_set_string(icon_key, "", &format!("{exe_path},0"))?;
        reg_close_key(icon_key);

        // shell\open\command
        let cmd_path = format!("{}\\shell\\open\\command", root);
        let cmd_key = reg_create_key(&cmd_path)?;
        reg_set_string(cmd_key, "", &command)?;
        reg_close_key(cmd_key);

        Ok(())
    }

    /// Deletes the ProgID key tree recursively.
    #[cfg(windows)]
    fn delete_prog_id(scheme: &str) -> Result<(), AppError> {
        let root = prog_id_root_path(scheme);
        reg_delete_tree(&root)
    }

    /// Ensures the Capabilities key exists with ApplicationName and
    /// ApplicationDescription.
    #[cfg(windows)]
    fn ensure_capabilities(exe_path: &str) -> Result<(), AppError> {
        let hkey = reg_create_key(CAPABILITIES_PATH)?;
        reg_set_string(hkey, "ApplicationName", APP_NAME)?;
        reg_set_string(hkey, "ApplicationDescription", APP_DESCRIPTION)?;
        reg_set_string(hkey, "ApplicationIcon", &format!("{exe_path},0"))?;
        reg_close_key(hkey);
        Ok(())
    }

    /// Adds a URLAssociation entry: `{scheme}` = `MotrixNext.Url.{scheme}`.
    #[cfg(windows)]
    fn add_url_association(scheme: &str) -> Result<(), AppError> {
        let path = url_associations_path();
        let hkey = reg_create_key(&path)?;
        let prog_id = prog_id_for_scheme(scheme);
        reg_set_string(hkey, scheme, &prog_id)?;
        reg_close_key(hkey);
        Ok(())
    }

    /// Removes a URLAssociation entry for the given scheme.
    #[cfg(windows)]
    fn remove_url_association(scheme: &str) -> Result<(), AppError> {
        let path = url_associations_path();
        reg_delete_value(&path, scheme)
    }

    /// Ensures `HKCU\Software\RegisteredApplications\MotrixNext` exists
    /// and points to the Capabilities key.
    #[cfg(windows)]
    fn ensure_registered_application() -> Result<(), AppError> {
        let hkey = reg_create_key("Software\\RegisteredApplications")?;
        reg_set_string(hkey, REGISTERED_APP_NAME, REGISTERED_APPS_VALUE)?;
        reg_close_key(hkey);
        Ok(())
    }

    /// Notifies the Windows shell that file/protocol associations have
    /// changed.  Without this call, changes may not be visible in the
    /// Default Apps UI until the user logs off.
    #[cfg(windows)]
    fn notify_shell_association_changed() {
        use windows_sys::Win32::UI::Shell::SHChangeNotify;
        // SHCNE_ASSOCCHANGED = 0x08000000, SHCNF_IDLIST = 0x0000
        unsafe {
            SHChangeNotify(0x0800_0000, 0x0000, std::ptr::null(), std::ptr::null());
        }
    }

    // ── Low-level registry wrappers ─────────────────────────────────

    /// Creates (or opens) a registry key under HKCU.
    #[cfg(windows)]
    fn reg_create_key(path: &str) -> Result<windows_sys::Win32::System::Registry::HKEY, AppError> {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::System::Registry::*;

        let path_wide: Vec<u16> = OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let mut hkey: HKEY = std::ptr::null_mut();
        let status = unsafe { RegCreateKeyW(HKEY_CURRENT_USER, path_wide.as_ptr(), &mut hkey) };
        if status == 0 {
            Ok(hkey)
        } else {
            Err(AppError::Protocol(format!(
                "RegCreateKeyW failed for {path}: error {status}"
            )))
        }
    }

    /// Sets a string value on an open registry key.
    #[cfg(windows)]
    fn reg_set_string(
        hkey: windows_sys::Win32::System::Registry::HKEY,
        name: &str,
        value: &str,
    ) -> Result<(), AppError> {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::System::Registry::*;

        let name_wide: Vec<u16> = OsStr::new(name)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let value_wide: Vec<u16> = OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let status = unsafe {
            RegSetValueExW(
                hkey,
                name_wide.as_ptr(),
                0,
                REG_SZ,
                value_wide.as_ptr() as *const u8,
                (value_wide.len() * 2) as u32,
            )
        };
        if status == 0 {
            Ok(())
        } else {
            Err(AppError::Protocol(format!(
                "RegSetValueExW failed: error {status}"
            )))
        }
    }

    /// Closes an open registry key handle.
    #[cfg(windows)]
    fn reg_close_key(hkey: windows_sys::Win32::System::Registry::HKEY) {
        use windows_sys::Win32::System::Registry::RegCloseKey;
        unsafe {
            RegCloseKey(hkey);
        }
    }

    /// Reads the default (unnamed) string value from a registry key.
    #[cfg(windows)]
    fn read_reg_default_string(path: &str) -> Result<String, AppError> {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::System::Registry::*;

        let path_wide: Vec<u16> = OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let mut hkey: HKEY = std::ptr::null_mut();
        let status = unsafe {
            RegOpenKeyExW(
                HKEY_CURRENT_USER,
                path_wide.as_ptr(),
                0,
                KEY_READ,
                &mut hkey,
            )
        };
        if status != 0 {
            return Err(AppError::Protocol(format!(
                "RegOpenKeyExW failed for {path}: error {status}"
            )));
        }

        // Query value size first
        let mut data_type: u32 = 0;
        let mut data_size: u32 = 0;
        let status = unsafe {
            RegQueryValueExW(
                hkey,
                std::ptr::null(), // default value
                std::ptr::null_mut(),
                &mut data_type,
                std::ptr::null_mut(),
                &mut data_size,
            )
        };
        if status != 0 || data_type != REG_SZ || data_size == 0 {
            unsafe { RegCloseKey(hkey) };
            return Err(AppError::Protocol(format!(
                "RegQueryValueExW size query failed for {path}: error {status}"
            )));
        }

        // Read the value
        let mut buffer: Vec<u8> = vec![0u8; data_size as usize];
        let status = unsafe {
            RegQueryValueExW(
                hkey,
                std::ptr::null(),
                std::ptr::null_mut(),
                &mut data_type,
                buffer.as_mut_ptr(),
                &mut data_size,
            )
        };
        unsafe { RegCloseKey(hkey) };

        if status != 0 {
            return Err(AppError::Protocol(format!(
                "RegQueryValueExW read failed for {path}: error {status}"
            )));
        }

        // Convert UTF-16 buffer to String
        let wide: &[u16] = unsafe {
            std::slice::from_raw_parts(buffer.as_ptr() as *const u16, data_size as usize / 2)
        };
        // Strip trailing null
        let len = wide.iter().position(|&c| c == 0).unwrap_or(wide.len());
        Ok(String::from_utf16_lossy(&wide[..len]))
    }

    /// Deletes a registry key tree recursively from HKCU.
    #[cfg(windows)]
    fn reg_delete_tree(path: &str) -> Result<(), AppError> {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::System::Registry::*;

        let key_wide: Vec<u16> = OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let status = unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, key_wide.as_ptr()) };
        if status == 0 || status == 2
        /* ERROR_FILE_NOT_FOUND */
        {
            Ok(())
        } else {
            Err(AppError::Protocol(format!(
                "RegDeleteTreeW failed for {path}: error {status}"
            )))
        }
    }

    /// Deletes a single named value from a registry key under HKCU.
    #[cfg(windows)]
    fn reg_delete_value(path: &str, name: &str) -> Result<(), AppError> {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::System::Registry::*;

        let path_wide: Vec<u16> = OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let mut hkey: HKEY = std::ptr::null_mut();
        let status = unsafe {
            RegOpenKeyExW(
                HKEY_CURRENT_USER,
                path_wide.as_ptr(),
                0,
                KEY_WRITE,
                &mut hkey,
            )
        };
        if status == 2 {
            // Key doesn't exist — nothing to delete
            return Ok(());
        }
        if status != 0 {
            return Err(AppError::Protocol(format!(
                "RegOpenKeyExW failed for {path}: error {status}"
            )));
        }

        let name_wide: Vec<u16> = OsStr::new(name)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let status = unsafe { RegDeleteValueW(hkey, name_wide.as_ptr()) };
        unsafe { RegCloseKey(hkey) };

        if status == 0 || status == 2 {
            Ok(())
        } else {
            Err(AppError::Protocol(format!(
                "RegDeleteValueW failed for {name} in {path}: error {status}"
            )))
        }
    }
}

// ── Linux desktop-file cleanup ──────────────────────────────────────

#[cfg(target_os = "linux")]
mod linux_desktop {
    use crate::error::AppError;
    use std::{
        fs,
        path::{Path, PathBuf},
        process::Command,
    };
    use tauri::{AppHandle, Manager};

    pub fn remove_scheme_from_handler(app: &AppHandle, protocol: &str) -> Result<(), AppError> {
        let target = handler_file_path(app)?;
        if !target.exists() {
            return Ok(());
        }

        let content = fs::read_to_string(&target).map_err(|e| {
            AppError::Protocol(format!(
                "read handler desktop file {}: {e}",
                target.display()
            ))
        })?;
        let updated = remove_scheme_from_desktop_content(&content, protocol);
        if updated != content {
            fs::write(&target, updated).map_err(|e| {
                AppError::Protocol(format!(
                    "write handler desktop file {}: {e}",
                    target.display()
                ))
            })?;
            refresh_desktop_database(target.parent())?;
        }
        Ok(())
    }

    fn handler_file_path(app: &AppHandle) -> Result<PathBuf, AppError> {
        let bin = tauri::utils::platform::current_exe()
            .map_err(|e| AppError::Protocol(format!("current_exe: {e}")))?;
        let file_name = format!(
            "{}-handler.desktop",
            bin.file_name()
                .ok_or_else(|| AppError::Protocol("current_exe has no file name".into()))?
                .to_string_lossy()
        );
        Ok(app
            .path()
            .data_dir()
            .map_err(|e| AppError::Protocol(format!("data_dir: {e}")))?
            .join("applications")
            .join(file_name))
    }

    fn refresh_desktop_database(target: Option<&Path>) -> Result<(), AppError> {
        let Some(target) = target else {
            return Ok(());
        };
        Command::new("update-desktop-database")
            .arg(target)
            .status()
            .map_err(|e| AppError::Protocol(format!("update-desktop-database: {e}")))?;
        Ok(())
    }

    pub fn remove_scheme_from_desktop_content(content: &str, protocol: &str) -> String {
        let target = format!("x-scheme-handler/{protocol}");
        let mut changed = false;
        let lines: Vec<String> = content
            .lines()
            .map(|line| {
                let Some(mimes) = line.strip_prefix("MimeType=") else {
                    return line.to_string();
                };
                let kept: Vec<&str> = mimes
                    .split(';')
                    .filter(|mime| !mime.is_empty() && *mime != target)
                    .collect();
                changed = true;
                if kept.is_empty() {
                    "MimeType=".to_string()
                } else {
                    format!("MimeType={};", kept.join(";"))
                }
            })
            .collect();
        let mut output = if changed {
            lines.join("\n")
        } else {
            content.to_string()
        };
        if content.ends_with('\n') && !output.ends_with('\n') {
            output.push('\n');
        }
        output
    }
}

// ── Windows elevation module ────────────────────────────────────────
//
// Retained as defence-in-depth for edge cases where HKCU writes fail
// (e.g. restricted group policy environments).  The primary path now
// writes to HKCU directly without elevation.

#[cfg(windows)]
mod elevation {
    use crate::error::AppError;

    /// CLI entry point for the elevated subprocess.
    ///
    /// Checks `std::env::args` for `--elevate-protocol <action> <scheme>`.
    /// Returns `Some(exit_code)` if the flag was found (caller should exit),
    /// or `None` to continue normal Tauri startup.
    ///
    /// This runs BEFORE Tauri initialises — no window, no webview, no plugins.
    pub fn try_run_elevated() -> Option<i32> {
        let args: Vec<String> = std::env::args().collect();
        let idx = args.iter().position(|a| a == "--elevate-protocol")?;
        let action = args.get(idx + 1)?.as_str();
        let scheme = args.get(idx + 2)?;

        log::info!("elevation: action={action} scheme={scheme}");

        let result = match action {
            "register" => super::win_registry::register_protocol(scheme),
            "unregister" => super::win_registry::unregister_protocol(scheme),
            _ => {
                log::error!("elevation: unknown action '{action}'");
                Err(AppError::Protocol(format!("unknown action: {action}")))
            }
        };

        match result {
            Ok(()) => {
                log::info!("elevation: {action} {scheme} succeeded");
                Some(0)
            }
            Err(e) => {
                log::error!("elevation: {action} {scheme} failed: {e}");
                Some(1)
            }
        }
    }

    /// Returns `true` if the error string indicates a Windows access-denied
    /// condition (`ERROR_ACCESS_DENIED` = 5, HRESULT `0x80070005`).
    pub fn is_access_denied(error: &str) -> bool {
        let lower = error.to_lowercase();
        lower.contains("access denied")
            || lower.contains("0x80070005")
            || lower.contains("access is denied")
            || lower.contains("os error 5")
    }

    /// Spawns an elevated copy of the current process to perform a protocol
    /// operation.  Uses `ShellExecuteW` with the `"runas"` verb to trigger
    /// a UAC prompt.
    pub fn spawn_elevated_protocol_op(action: &str, scheme: &str) -> Result<(), AppError> {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;

        let exe =
            std::env::current_exe().map_err(|e| AppError::Protocol(format!("current_exe: {e}")))?;
        let exe_str = exe.to_string_lossy().to_string();
        let params = format!("--elevate-protocol {action} {scheme}");

        let verb: Vec<u16> = OsStr::new("runas")
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let file: Vec<u16> = OsStr::new(&exe_str)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let args: Vec<u16> = OsStr::new(&params)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        log::info!("elevation: spawning elevated subprocess: {exe_str} {params}");

        let result = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                verb.as_ptr(),
                file.as_ptr(),
                args.as_ptr(),
                std::ptr::null(),
                SW_HIDE,
            )
        };

        if (result as isize) > 32 {
            Ok(())
        } else {
            Err(AppError::Protocol(format!(
                "ShellExecuteW failed (code {}): user may have cancelled UAC prompt",
                result as isize
            )))
        }
    }
}

// Re-export the elevation entry point for main.rs.
#[cfg(windows)]
pub use elevation::try_run_elevated;

// ── Cross-platform Tauri commands ───────────────────────────────────

/// Returns `true` when this application is the OS-level default handler
/// for the given URL scheme (e.g. `"magnet"`, `"thunder"`).
#[tauri::command]
pub async fn is_default_protocol_client(
    app: AppHandle,
    protocol: String,
) -> Result<bool, AppError> {
    #[cfg(target_os = "macos")]
    {
        let handler_id = macos::get_default_handler_bundle_id(&protocol);
        let self_id = &app.config().identifier;
        match handler_id {
            Some(handler) => Ok(handler == *self_id),
            None => Ok(false),
        }
    }
    #[cfg(windows)]
    {
        let _ = &app; // suppress unused warning
        win_registry::is_protocol_registered(&protocol)
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        use tauri_plugin_deep_link::DeepLinkExt;
        app.deep_link()
            .is_registered(&protocol)
            .map_err(|e| AppError::Protocol(e.to_string()))
    }
}

/// Registers this application as the OS-level default handler for the
/// given URL scheme.
#[tauri::command]
pub async fn set_default_protocol_client(app: AppHandle, protocol: String) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        let bundle_id = &app.config().identifier;
        macos::set_as_default_handler(&protocol, bundle_id).map_err(AppError::Protocol)?;

        // Verify the registration actually took effect.
        let handler = macos::get_default_handler_bundle_id(&protocol);
        let registered = handler.as_deref() == Some(bundle_id.as_str());
        if registered {
            Ok(())
        } else {
            Err(AppError::Protocol(format!(
                "registration accepted but did not take effect (handler={handler:?}, expected={bundle_id})"
            )))
        }
    }
    #[cfg(windows)]
    {
        let _ = &app;
        match win_registry::register_protocol(&protocol) {
            Ok(()) => Ok(()),
            Err(e) => {
                let msg = e.to_string();
                if elevation::is_access_denied(&msg) {
                    log::warn!(
                        "protocol: register {protocol} access denied, retrying with elevation"
                    );
                    return elevation::spawn_elevated_protocol_op("register", &protocol);
                }
                Err(AppError::Protocol(msg))
            }
        }
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        use tauri_plugin_deep_link::DeepLinkExt;
        app.deep_link()
            .register(&protocol)
            .map_err(|e| AppError::Protocol(e.to_string()))
    }
}

/// Removes this application as the OS-level default handler for the
/// given URL scheme.
#[tauri::command]
pub async fn remove_as_default_protocol_client(
    app: AppHandle,
    protocol: String,
) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        const MANUAL_CHANGE_REQUIRED: &str = "manual_change_required";
        let _ = (&app, &protocol);
        Err(AppError::Protocol(MANUAL_CHANGE_REQUIRED.into()))
    }
    #[cfg(windows)]
    {
        let _ = &app;
        match win_registry::unregister_protocol(&protocol) {
            Ok(()) => Ok(()),
            Err(e) => {
                let msg = e.to_string();
                if elevation::is_access_denied(&msg) {
                    log::warn!(
                        "protocol: unregister {protocol} access denied, retrying with elevation"
                    );
                    return elevation::spawn_elevated_protocol_op("unregister", &protocol);
                }
                Err(AppError::Protocol(msg))
            }
        }
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        use tauri_plugin_deep_link::DeepLinkExt;
        app.deep_link()
            .unregister(&protocol)
            .map_err(|e| AppError::Protocol(e.to_string()))?;
        #[cfg(target_os = "linux")]
        linux_desktop::remove_scheme_from_handler(&app, &protocol)?;
        Ok(())
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── macOS-specific tests ────────────────────────────────────────

    #[cfg(target_os = "macos")]
    mod macos_tests {
        use super::super::macos;

        #[test]
        fn get_default_handler_bundle_id_returns_some_for_https() {
            let result = macos::get_default_handler_bundle_id("https");
            assert!(result.is_some(), "expected a handler for https://");
            let id = result.expect("already checked");
            assert!(
                id.contains('.'),
                "expected reverse-DNS bundle ID, got: {id}"
            );
        }

        #[test]
        fn get_default_handler_bundle_id_returns_none_for_nonsense_scheme() {
            let result = macos::get_default_handler_bundle_id("zzznotarealscheme12345");
            assert!(
                result.is_none(),
                "expected None for unregistered scheme, got: {result:?}"
            );
        }
    }

    // ── Pure logic unit tests (run on ALL platforms) ─────────────────
    //
    // These test the helper functions that compute registry paths and
    // ProgID names.  They do NOT touch the Windows registry.

    #[test]
    fn prog_id_for_magnet_follows_naming_convention() {
        // Microsoft ProgID convention: {AppName}.{Type}.{Discriminator}
        assert_eq!(
            win_registry::prog_id_for_scheme("magnet"),
            "MotrixNext.Url.magnet"
        );
    }

    #[test]
    fn prog_id_for_thunder_follows_naming_convention() {
        assert_eq!(
            win_registry::prog_id_for_scheme("thunder"),
            "MotrixNext.Url.thunder"
        );
    }

    #[test]
    fn prog_id_for_motrixnext_follows_naming_convention() {
        assert_eq!(
            win_registry::prog_id_for_scheme("motrixnext"),
            "MotrixNext.Url.motrixnext"
        );
    }

    #[test]
    fn prog_id_command_path_includes_shell_open_command() {
        let path = win_registry::prog_id_command_path("magnet");
        assert_eq!(
            path,
            "Software\\Classes\\MotrixNext.Url.magnet\\shell\\open\\command"
        );
    }

    #[test]
    fn prog_id_root_path_under_software_classes() {
        let path = win_registry::prog_id_root_path("thunder");
        assert_eq!(path, "Software\\Classes\\MotrixNext.Url.thunder");
    }

    #[test]
    fn url_associations_path_under_capabilities() {
        let path = win_registry::url_associations_path();
        assert_eq!(path, "Software\\MotrixNext\\Capabilities\\URLAssociations");
    }

    #[test]
    fn capabilities_path_is_correct() {
        assert_eq!(
            win_registry::CAPABILITIES_PATH,
            "Software\\MotrixNext\\Capabilities"
        );
    }

    #[test]
    fn registered_apps_value_matches_capabilities_path() {
        // RegisteredApplications value must point to Capabilities path
        assert_eq!(
            win_registry::REGISTERED_APPS_VALUE,
            win_registry::CAPABILITIES_PATH
        );
    }

    #[test]
    fn app_name_is_motrix_next() {
        assert_eq!(win_registry::APP_NAME, "Motrix Next");
    }

    #[test]
    fn app_description_is_download_manager() {
        assert_eq!(
            win_registry::APP_DESCRIPTION,
            "A full-featured download manager"
        );
    }

    #[test]
    fn registered_app_name_is_motrixnext() {
        assert_eq!(win_registry::REGISTERED_APP_NAME, "MotrixNext");
    }

    // ── Cross-platform logic tests ──────────────────────────────────

    #[test]
    fn protocol_error_variant_display() {
        let e = AppError::Protocol("test failure".into());
        assert_eq!(e.to_string(), "Protocol error: test failure");
    }

    #[test]
    fn protocol_error_variant_serializes() {
        let e = AppError::Protocol("reg failed".into());
        let json = serde_json::to_string(&e).expect("serialize");
        assert_eq!(json, r#"{"Protocol":"reg failed"}"#);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_desktop_cleanup_removes_only_disabled_scheme() {
        let input = "[Desktop Entry]\nMimeType=x-scheme-handler/ed2k;x-scheme-handler/magnet;x-scheme-handler/motrixnext;\nExec=\"/usr/bin/motrix-next\" %u\n";

        let output = super::linux_desktop::remove_scheme_from_desktop_content(input, "magnet");

        assert!(output.contains("x-scheme-handler/ed2k"));
        assert!(output.contains("x-scheme-handler/motrixnext"));
        assert!(!output.contains("x-scheme-handler/magnet"));
        assert!(output.ends_with('\n'));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_remove_returns_manual_change_error() {
        let src = production_source();
        let fn_start = src
            .find("pub async fn remove_as_default_protocol_client")
            .expect("remove_as_default_protocol_client must exist");
        let rest = &src[fn_start..];
        let fn_end = rest[10..]
            .find("\npub async fn ")
            .map(|p| p + 10)
            .unwrap_or(rest.len());
        let fn_body = &rest[..fn_end];

        assert!(
            fn_body.contains("MANUAL_CHANGE_REQUIRED"),
            "macOS removal must return a manual-change error instead of succeeding silently"
        );
    }

    // ── Windows structural tests ────────────────────────────────────
    //
    // These tests validate that the code infrastructure for the
    // RegisteredApplications pattern exists and follows the correct
    // structure.  The actual Windows API calls cannot be tested on
    // macOS/Linux, so we verify the code structure via source scanning.
    //
    // IMPORTANT: All source-scanning tests strip the `#[cfg(test)]`
    // section to prevent self-matching against assertion strings.

    /// Returns the production (non-test) portion of protocol.rs source.
    fn production_source() -> &'static str {
        let full = include_str!("protocol.rs");
        full.split("\n#[cfg(test)]").next().unwrap_or(full)
    }

    // ── win_registry module structure ───────────────────────────────

    /// The win_registry module must exist as a Windows-only public module.
    #[test]
    fn win_registry_module_exists_with_cfg_windows() {
        let src = production_source();
        assert!(
            src.contains("#[cfg(windows)]") && src.contains("pub mod win_registry"),
            "protocol.rs must contain a #[cfg(windows)] pub mod win_registry"
        );
    }

    /// register_protocol must be a public function in win_registry.
    #[test]
    fn win_registry_has_register_protocol() {
        let src = production_source();
        let module_start = src
            .find("pub mod win_registry")
            .expect("win_registry module must exist");
        let rest = &src[module_start..];
        assert!(
            rest.contains("pub fn register_protocol"),
            "win_registry must have a public register_protocol function"
        );
    }

    /// unregister_protocol must be a public function in win_registry.
    #[test]
    fn win_registry_has_unregister_protocol() {
        let src = production_source();
        let module_start = src
            .find("pub mod win_registry")
            .expect("win_registry module must exist");
        let rest = &src[module_start..];
        assert!(
            rest.contains("pub fn unregister_protocol"),
            "win_registry must have a public unregister_protocol function"
        );
    }

    /// is_protocol_registered must be a public function in win_registry.
    #[test]
    fn win_registry_has_is_protocol_registered() {
        let src = production_source();
        let module_start = src
            .find("pub mod win_registry")
            .expect("win_registry module must exist");
        let rest = &src[module_start..];
        assert!(
            rest.contains("pub fn is_protocol_registered"),
            "win_registry must have a public is_protocol_registered function"
        );
    }

    // ── Three-layer registry structure validation ───────────────────

    /// register_protocol must create a ProgID under Software\Classes.
    #[test]
    fn register_creates_prog_id() {
        let src = production_source();
        assert!(
            src.contains("Software\\\\Classes\\\\") || src.contains("Software\\Classes\\"),
            "win_registry must write ProgID under Software\\Classes"
        );
        assert!(
            src.contains("MotrixNext.Url."),
            "ProgID must follow MotrixNext.Url.{{scheme}} naming"
        );
    }

    /// register_protocol must set URL Protocol marker on the ProgID.
    #[test]
    fn register_sets_url_protocol_marker() {
        let src = production_source();
        assert!(
            src.contains("\"URL Protocol\""),
            "ProgID must include the URL Protocol marker (empty string value)"
        );
    }

    /// register_protocol must create shell\open\command under the ProgID.
    #[test]
    fn register_creates_shell_open_command() {
        let src = production_source();
        assert!(
            src.contains("shell\\\\open\\\\command") || src.contains("shell\\open\\command"),
            "ProgID must include shell\\open\\command subkey"
        );
    }

    /// register_protocol must set up Capabilities with ApplicationName.
    #[test]
    fn register_creates_capabilities_with_app_name() {
        let src = production_source();
        assert!(
            src.contains("Software\\\\MotrixNext\\\\Capabilities")
                || src.contains("Software\\MotrixNext\\Capabilities"),
            "Must write Capabilities key under Software\\MotrixNext"
        );
        assert!(
            src.contains("ApplicationName"),
            "Capabilities must include ApplicationName"
        );
    }

    /// register_protocol must add URLAssociations under Capabilities.
    #[test]
    fn register_creates_url_associations() {
        let src = production_source();
        assert!(
            src.contains("URLAssociations"),
            "Capabilities must include URLAssociations subkey"
        );
    }

    /// register_protocol must write to RegisteredApplications.
    #[test]
    fn register_writes_registered_applications() {
        let src = production_source();
        assert!(
            src.contains("RegisteredApplications"),
            "Must write to HKCU\\Software\\RegisteredApplications"
        );
    }

    /// register_protocol must call SHChangeNotify after registry changes.
    #[test]
    fn register_calls_sh_change_notify() {
        let src = production_source();
        assert!(
            src.contains("SHChangeNotify"),
            "Must call SHChangeNotify(SHCNE_ASSOCCHANGED) after registration"
        );
    }

    /// unregister_protocol must also call SHChangeNotify.
    #[test]
    fn unregister_calls_sh_change_notify() {
        let src = production_source();
        let fn_start = src
            .find("pub fn unregister_protocol")
            .expect("unregister_protocol must exist");
        let rest = &src[fn_start..];
        assert!(
            rest.contains("notify_shell_association_changed"),
            "unregister_protocol must call notify_shell_association_changed"
        );
    }

    // ── Windows commands use win_registry, NOT deep_link ────────────

    /// set_default_protocol_client Windows branch must use win_registry.
    #[test]
    fn set_protocol_windows_uses_win_registry() {
        let src = production_source();
        let fn_start = src
            .find("pub async fn set_default_protocol_client")
            .expect("set_default_protocol_client must exist");
        let rest = &src[fn_start..];
        let fn_end = rest[10..]
            .find("\npub async fn ")
            .map(|p| p + 10)
            .unwrap_or(rest.len());
        let fn_body = &rest[..fn_end];

        assert!(
            fn_body.contains("win_registry::register_protocol"),
            "Windows branch of set_default_protocol_client must call win_registry::register_protocol"
        );
        assert!(
            !fn_body.contains("deep_link().register"),
            "Windows branch must NOT use tauri-plugin-deep-link register (it only writes Classes/{{scheme}})"
        );
    }

    /// remove_as_default_protocol_client Windows branch must use win_registry.
    #[test]
    fn remove_protocol_windows_uses_win_registry() {
        let src = production_source();
        let fn_start = src
            .find("pub async fn remove_as_default_protocol_client")
            .expect("remove_as_default_protocol_client must exist");
        let rest = &src[fn_start..];
        let fn_end = rest[10..]
            .find("\npub async fn ")
            .map(|p| p + 10)
            .unwrap_or(rest.len());
        let fn_body = &rest[..fn_end];

        assert!(
            fn_body.contains("win_registry::unregister_protocol"),
            "Windows branch of remove_as_default_protocol_client must call win_registry::unregister_protocol"
        );
        assert!(
            !fn_body.contains("deep_link().unregister"),
            "Windows branch must NOT use tauri-plugin-deep-link unregister"
        );
    }

    /// is_default_protocol_client Windows branch must use win_registry.
    #[test]
    fn is_protocol_windows_uses_win_registry() {
        let src = production_source();
        let fn_start = src
            .find("pub async fn is_default_protocol_client")
            .expect("is_default_protocol_client must exist");
        let rest = &src[fn_start..];
        let fn_end = rest[10..]
            .find("\npub async fn ")
            .map(|p| p + 10)
            .unwrap_or(rest.len());
        let fn_body = &rest[..fn_end];

        assert!(
            fn_body.contains("win_registry::is_protocol_registered"),
            "Windows branch of is_default_protocol_client must call win_registry::is_protocol_registered"
        );
        assert!(
            !fn_body.contains("deep_link().is_registered"),
            "Windows branch must NOT use tauri-plugin-deep-link is_registered"
        );
    }

    // ── Elevation infrastructure (retained) ─────────────────────────

    /// The elevation module must still exist for defence-in-depth.
    #[test]
    fn elevation_module_exists_with_cfg_windows() {
        let src = production_source();
        assert!(
            src.contains("#[cfg(windows)]") && src.contains("mod elevation"),
            "protocol.rs must contain a #[cfg(windows)] mod elevation"
        );
    }

    /// try_run_elevated must be a public function for main.rs.
    #[test]
    fn try_run_elevated_function_exists() {
        let src = production_source();
        assert!(
            src.contains("pub fn try_run_elevated"),
            "try_run_elevated must be a public function for main.rs CLI interception"
        );
    }

    /// try_run_elevated must parse "--elevate-protocol" from argv.
    #[test]
    fn try_run_elevated_parses_cli_flag() {
        let src = production_source();
        assert!(
            src.contains("--elevate-protocol"),
            "try_run_elevated must look for --elevate-protocol in CLI arguments"
        );
    }

    /// Elevation must delegate to win_registry (not duplicate registry code).
    #[test]
    fn elevation_delegates_to_win_registry() {
        let src = production_source();
        let module_start = src
            .find("mod elevation")
            .expect("elevation module must exist");
        let rest = &src[module_start..];
        // Find the end of the elevation module (next top-level item)
        let module_end = rest[10..]
            .find("\n// Re-export")
            .or_else(|| rest[10..].find("\npub use"))
            .map(|p| p + 10)
            .unwrap_or(rest.len());
        let module_body = &rest[..module_end];

        assert!(
            module_body.contains("win_registry::register_protocol")
                || module_body.contains("super::win_registry::register_protocol"),
            "elevation must delegate registration to win_registry::register_protocol"
        );
    }

    /// spawn_elevated_protocol_op must exist for UAC elevation fallback.
    #[test]
    fn spawn_elevated_protocol_op_function_exists() {
        let src = production_source();
        assert!(
            src.contains("fn spawn_elevated_protocol_op"),
            "spawn_elevated_protocol_op must exist for ShellExecuteW-based elevation"
        );
    }

    /// The elevation spawn must use ShellExecuteW with the "runas" verb.
    #[test]
    fn spawn_elevated_uses_shell_execute_with_runas() {
        let src = production_source();
        let fn_start = src
            .find("fn spawn_elevated_protocol_op")
            .expect("spawn function must exist");
        let rest = &src[fn_start..];
        let fn_end = rest[10..]
            .find("\nfn ")
            .or_else(|| rest[10..].find("\npub fn "))
            .or_else(|| rest[10..].find("\nmod "))
            .map(|p| p + 10)
            .unwrap_or(rest.len());
        let fn_body = &rest[..fn_end];

        assert!(
            fn_body.contains("ShellExecuteW"),
            "spawn_elevated_protocol_op must call ShellExecuteW"
        );
        assert!(
            fn_body.contains("runas"),
            "spawn_elevated_protocol_op must use the \"runas\" verb"
        );
    }

    /// is_access_denied helper must exist.
    #[test]
    fn is_access_denied_helper_exists() {
        let src = production_source();
        assert!(
            src.contains("fn is_access_denied"),
            "is_access_denied helper must exist"
        );
    }

    /// main.rs must intercept --elevate-protocol before Tauri init.
    #[test]
    fn main_rs_intercepts_elevate_protocol_flag() {
        let main_source = include_str!("../main.rs");
        assert!(
            main_source.contains("try_run_elevated"),
            "main.rs must call try_run_elevated before motrix_next_lib::run()"
        );
    }

    /// main.rs must exit after handling elevated operation.
    #[test]
    fn main_rs_exits_after_elevated_operation() {
        let main_source = include_str!("../main.rs");
        assert!(
            main_source.contains("process::exit"),
            "main.rs must call process::exit after try_run_elevated"
        );
    }

    /// set_default_protocol_client must have elevation fallback on Windows.
    #[test]
    fn set_protocol_has_elevation_fallback() {
        let src = production_source();
        let fn_start = src
            .find("pub async fn set_default_protocol_client")
            .expect("set_default_protocol_client must exist");
        let rest = &src[fn_start..];
        let fn_end = rest[10..]
            .find("\npub async fn ")
            .map(|p| p + 10)
            .unwrap_or(rest.len());
        let fn_body = &rest[..fn_end];

        assert!(
            fn_body.contains("is_access_denied") || fn_body.contains("spawn_elevated_protocol_op"),
            "set_default_protocol_client must have elevation fallback"
        );
    }

    /// remove_as_default_protocol_client must have elevation fallback on Windows.
    #[test]
    fn remove_protocol_has_elevation_fallback() {
        let src = production_source();
        let fn_start = src
            .find("pub async fn remove_as_default_protocol_client")
            .expect("remove_as_default_protocol_client must exist");
        let rest = &src[fn_start..];
        let fn_end = rest[10..]
            .find("\npub async fn ")
            .map(|p| p + 10)
            .unwrap_or(rest.len());
        let fn_body = &rest[..fn_end];

        assert!(
            fn_body.contains("is_access_denied") || fn_body.contains("spawn_elevated_protocol_op"),
            "remove_as_default_protocol_client must have elevation fallback"
        );
    }

    // ── DefaultIcon validation ──────────────────────────────────────

    /// ProgID must include DefaultIcon subkey for shell integration.
    #[test]
    fn prog_id_includes_default_icon() {
        let src = production_source();
        assert!(
            src.contains("DefaultIcon"),
            "ProgID creation must include a DefaultIcon subkey"
        );
    }

    /// ApplicationIcon must be set in Capabilities for Default Apps display.
    #[test]
    fn capabilities_includes_application_icon() {
        let src = production_source();
        assert!(
            src.contains("ApplicationIcon"),
            "Capabilities must include ApplicationIcon"
        );
    }

    /// ApplicationDescription must be set in Capabilities.
    #[test]
    fn capabilities_includes_application_description() {
        let src = production_source();
        assert!(
            src.contains("ApplicationDescription"),
            "Capabilities must include ApplicationDescription"
        );
    }
}
