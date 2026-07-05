; NSIS installer hooks for Motrix Next Opt.
;
; This opt build is intentionally isolated from upstream Motrix Next.  Do not
; migrate or delete MotrixNext registry/install keys here; users may keep both
; applications installed side by side.

!macro NSIS_HOOK_PREINSTALL
  ; Defense-in-depth: stop a bundled sidecar before file copy.  The sidecar
  ; executable name is inherited from the upstream aria2 engine package.
  nsExec::Exec 'taskkill /F /IM motrix-next-engine.exe'
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Flush Windows icon cache so updated icons appear immediately.
  nsExec::ExecToLog 'ie4uinit.exe -show'
!macroend
