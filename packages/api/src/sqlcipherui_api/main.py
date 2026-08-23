"""FastAPI application entry point."""

from __future__ import annotations

import logging
import logging.handlers
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from sqlcipherui_api.config import Settings
from sqlcipherui_api.dependencies import cleanup_dependencies, get_settings
from sqlcipherui_api.routers import app_data, cipher, data, database, dataflow, maintenance, query, schema

# Set up file logging to logs/api.log
_log_dir = Path(__file__).resolve().parent.parent.parent.parent.parent / "logs"
_log_dir.mkdir(exist_ok=True)
_log_file = _log_dir / "api.log"

_file_handler = logging.handlers.RotatingFileHandler(
    _log_file, maxBytes=5_000_000, backupCount=3,
)
_file_handler.setFormatter(logging.Formatter(
    "%(asctime)s %(levelname)-8s %(name)s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
))

logging.root.setLevel(logging.DEBUG)
logging.root.addHandler(_file_handler)

# Also keep console output
_console = logging.StreamHandler()
_console.setLevel(logging.INFO)
_console.setFormatter(logging.Formatter("%(levelname)-8s %(name)s  %(message)s"))
logging.root.addHandler(_console)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logger.info(f"SQLCipherUI API starting on {settings.api_host}:{settings.api_port}")
    yield
    await cleanup_dependencies()
    logger.info("Application shutdown complete")


def create_app(settings: Settings | None = None) -> FastAPI:
    if settings is None:
        settings = get_settings()

    app = FastAPI(
        title="SQLCipherUI API",
        description="Backend API for SQLCipherUI - SQLite/SQLCipher database management",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=settings.cors_allow_credentials,
        allow_methods=settings.cors_allow_methods,
        allow_headers=settings.cors_allow_headers,
    )

    @app.get("/health", tags=["health"])
    async def health_check():
        return {"status": "healthy", "version": "0.1.0"}

    app.include_router(database.router, prefix="/api/db", tags=["database"])
    app.include_router(schema.router, prefix="/api/schema", tags=["schema"])
    app.include_router(query.router, prefix="/api/query", tags=["query"])
    app.include_router(data.router, prefix="/api/data", tags=["data"])
    app.include_router(cipher.router, prefix="/api/cipher", tags=["cipher"])
    app.include_router(maintenance.router, prefix="/api/maintenance", tags=["maintenance"])
    app.include_router(app_data.router, prefix="/api/app", tags=["app"])
    app.include_router(dataflow.router, prefix="/api/dataflow", tags=["dataflow"])

    # Serve pre-built frontend if available
    import sys
    if getattr(sys, "frozen", False):
        web_dist = Path(sys._MEIPASS) / "web_dist"
    else:
        web_dist = Path(__file__).resolve().parent.parent.parent.parent / "web" / "dist"
    if web_dist.is_dir():
        from fastapi.responses import FileResponse

        @app.get("/{full_path:path}", include_in_schema=False)
        async def serve_spa(full_path: str):
            file_path = web_dist / full_path
            if file_path.is_file():
                return FileResponse(file_path)
            return FileResponse(web_dist / "index.html")

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "sqlcipherui_api.main:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=settings.api_reload,
    )
