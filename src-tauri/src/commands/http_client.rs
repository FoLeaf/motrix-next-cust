use reqwest::ClientBuilder;

pub(crate) fn apply_explicit_proxy(
    builder: ClientBuilder,
    proxy: &Option<String>,
    scope: &str,
) -> ClientBuilder {
    match proxy
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(server) => match reqwest::Proxy::all(server) {
            Ok(proxy) => builder.proxy(proxy),
            Err(e) => {
                log::warn!("{scope}: invalid proxy config: {e}");
                builder.no_proxy()
            }
        },
        None => builder.no_proxy(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    fn spawn_one_shot_http_server() -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind local server");
        let addr = listener.local_addr().expect("local addr");
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept request");
            let mut buf = [0_u8; 1024];
            let _ = stream.read(&mut buf);
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok")
                .expect("write response");
        });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn direct_client_ignores_environment_proxy() {
        let url = spawn_one_shot_http_server();
        std::env::set_var("HTTP_PROXY", "http://127.0.0.1:9");
        std::env::set_var("http_proxy", "http://127.0.0.1:9");

        let client = apply_explicit_proxy(reqwest::Client::builder(), &None, "test")
            .build()
            .expect("client");
        let response = client.get(url).send().await.expect("direct response");

        std::env::remove_var("HTTP_PROXY");
        std::env::remove_var("http_proxy");
        assert!(response.status().is_success());
    }
}
