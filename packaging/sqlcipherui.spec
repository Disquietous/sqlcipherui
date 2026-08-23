# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for SQLCipherUI."""

import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs

SPEC_DIR = Path(SPECPATH)
PROJECT_ROOT = SPEC_DIR.parent

# ── Collect native extensions before Analysis ────────────────────────
_binaries = (
    collect_dynamic_libs('sqlcipher3')
    + collect_dynamic_libs('pydantic_core')
    + collect_dynamic_libs('greenlet')
    + collect_dynamic_libs('markupsafe')
    + (collect_dynamic_libs('uvloop') if sys.platform == 'darwin' else [])
)

# ── Collect data files before Analysis ───────────────────────────────
_extra_datas = collect_data_files('certifi')

# ── Analysis ─────────────────────────────────────────────────────────
a = Analysis(
    [str(SPEC_DIR / 'launcher.py')],
    pathex=[
        str(PROJECT_ROOT / 'packages' / 'api' / 'src'),
        str(PROJECT_ROOT / 'packages' / 'core' / 'src'),
    ],
    binaries=_binaries,
    datas=[
        # Pre-built frontend
        (str(PROJECT_ROOT / 'packages' / 'web' / 'dist'), 'web_dist'),
        # App icon
        *([(str(SPEC_DIR / 'assets' / 'icon.png'), '.')] if (SPEC_DIR / 'assets' / 'icon.png').exists() else []),
    ] + _extra_datas,
    hiddenimports=[
        # --- uvicorn internals ---
        'uvicorn.logging',
        'uvicorn.loops.auto',
        'uvicorn.loops.asyncio',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.http.h11_impl',
        'uvicorn.protocols.http.httptools_impl',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.protocols.websockets.wsproto_impl',
        'uvicorn.protocols.websockets.websockets_impl',
        'uvicorn.lifespan.on',
        'uvicorn.lifespan.off',

        # --- FastAPI / Starlette ---
        'fastapi',
        'starlette',
        'multipart',

        # --- SQLCipher ---
        'sqlcipher3',
        'sqlcipher3.dbapi2',

        # --- Async ---
        'greenlet',

        # --- Pydantic ---
        'pydantic',
        'pydantic_core',
        'pydantic_settings',

        # --- SSL/TLS ---
        'certifi',

        # --- WebSockets ---
        'websockets',
        'websockets.legacy',
        'websockets.legacy.server',
        'wsproto',

        # --- HTTP ---
        'h11',
        'anyio',
        'sniffio',

        # --- Platform ---
        'platformdirs',

        # --- SQLCipherUI application modules ---
        'sqlcipherui_api',
        'sqlcipherui_api.main',
        'sqlcipherui_api.config',
        'sqlcipherui_api.dependencies',
        'sqlcipherui_core',
        'sqlcipherui_core.models',
        'sqlcipherui_core.services',
        'sqlcipherui_core.services.app_db',
        'sqlcipherui_core.services.connection_manager',
        'sqlcipherui_core.services.data_service',
        'sqlcipherui_core.services.db_manager',
        'sqlcipherui_core.services.pipeline_executor',
        'sqlcipherui_core.services.pipeline_service',
        'sqlcipherui_core.services.pipeline_templates',
        'sqlcipherui_core.services.query_service',
        'sqlcipherui_core.services.schema_service',

        # --- All API routers ---
        'sqlcipherui_api.routers.app_data',
        'sqlcipherui_api.routers.cipher',
        'sqlcipherui_api.routers.data',
        'sqlcipherui_api.routers.database',
        'sqlcipherui_api.routers.dataflow',
        'sqlcipherui_api.routers.maintenance',
        'sqlcipherui_api.routers.query',
        'sqlcipherui_api.routers.schema',
    ],
    excludes=[
        # --- Dev/test tools ---
        'pytest',
        'pytest_asyncio',
        'pytest_cov',
        'mypy',
        'ruff',
        'coverage',
        # --- Build tools ---
        'build',
        'hatchling',
        # --- IPython/Jupyter ---
        'IPython',
        'jupyter',
        'notebook',
        # --- GUI toolkits we don't use ---
        'tkinter',
        '_tkinter',
    ],
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='SQLCipherUI-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    icon=str(SPEC_DIR / 'assets' / 'icon.icns') if sys.platform == 'darwin'
         else str(SPEC_DIR / 'assets' / 'icon.ico'),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name='SQLCipherUI-backend',
)
