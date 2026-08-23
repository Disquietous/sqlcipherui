"""SQLCipherUI backend launcher — entry point for PyInstaller bundles.

Starts the uvicorn server. When launched by Tauri, the port is passed
via the SQLCIPHERUI_API_PORT environment variable.
"""

import os
import socket
import sys
from pathlib import Path

import platformdirs
import uvicorn


def _setup_logging():
    if not getattr(sys, "frozen", False):
        return
    log_dir = Path(platformdirs.user_data_path("SQLCipherUI")) / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = open(log_dir / "sqlcipherui.log", "a", encoding="utf-8")
    sys.stdout = log_file
    sys.stderr = log_file


def _find_free_port(preferred: int = 8001) -> int:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", preferred))
            return preferred
    except OSError:
        pass
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _set_ssl_certs():
    if not getattr(sys, "frozen", False):
        return
    try:
        import certifi
        os.environ.setdefault("SSL_CERT_FILE", certifi.where())
    except ImportError:
        for path in ("/etc/ssl/cert.pem", "/etc/ssl/certs/ca-certificates.crt"):
            if os.path.isfile(path):
                os.environ.setdefault("SSL_CERT_FILE", path)
                break


def main():
    _setup_logging()
    _set_ssl_certs()

    env_port = os.environ.get("SQLCIPHERUI_API_PORT")
    port = int(env_port) if env_port else _find_free_port()

    config = uvicorn.Config(
        "sqlcipherui_api.main:app",
        host="127.0.0.1",
        port=port,
        loop="asyncio",
    )
    server = uvicorn.Server(config)
    server.run()


if __name__ == "__main__":
    main()
