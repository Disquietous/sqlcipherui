@echo off
setlocal enabledelayedexpansion
REM
REM Build SQLCipherUI Windows distribution:
REM   frontend -> PyInstaller backend -> Tauri installer
REM

set PROJECT_ROOT=%~dp0..\..
set PACKAGING_DIR=%PROJECT_ROOT%\packaging
set TAURI_DIR=%PROJECT_ROOT%\src-tauri
set VENV=%PROJECT_ROOT%\venv

REM Read version from tauri.conf.json
for /f "tokens=2 delims=:" %%a in ('findstr /C:"\"version\"" "%TAURI_DIR%\tauri.conf.json"') do (
    for /f "tokens=1 delims=," %%b in ("%%a") do (
        set VERSION=%%~b
    )
)
set VERSION=%VERSION: =%
echo Building SQLCipherUI v%VERSION% for Windows...

if "%CI%"=="true" (
    call "%VENV%\Scripts\activate.bat"
) else (
    if not exist "%VENV%\Scripts\activate.bat" (
        echo Creating Python virtual environment...
        python -m venv "%VENV%"
        call "%VENV%\Scripts\activate.bat"
        pip install --upgrade pip
        pip install -e "%PROJECT_ROOT%\packages\core" -e "%PROJECT_ROOT%\packages\api"
    ) else (
        call "%VENV%\Scripts\activate.bat"
    )

    python -m PyInstaller --version >nul 2>&1
    if errorlevel 1 (
        echo Installing PyInstaller...
        pip install "pyinstaller>=6.12.0"
    )

    where node >nul 2>&1
    if errorlevel 1 (
        echo ERROR: Node.js is not installed.
        echo Download from: https://nodejs.org/
        exit /b 1
    )

    where cargo >nul 2>&1
    if errorlevel 1 (
        echo Installing Rust toolchain...
        curl --proto =https --tlsv1.2 -sSf https://win.rustup.rs/x86_64 -o rustup-init.exe
        rustup-init.exe -y
        del rustup-init.exe
        set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
    )

    cargo tauri --version >nul 2>&1
    if errorlevel 1 (
        echo Installing Tauri CLI...
        cargo install tauri-cli
    )
)

REM ── Step 1: Build frontend ──────────────────────────────────────────
echo [1/4] Building frontend...
cd /d %PROJECT_ROOT%
if not "%CI%"=="true" (
    call npm --prefix packages\web install --silent
)
call npm --prefix packages\web run build

REM ── Step 2: Build Python backend with PyInstaller ───────────────────
echo [2/4] Building Python backend (PyInstaller)...
cd /d %PACKAGING_DIR%
python -m PyInstaller sqlcipherui.spec ^
    --clean ^
    --noconfirm ^
    --distpath "%PACKAGING_DIR%\dist" ^
    --workpath "%PACKAGING_DIR%\build"

if not exist "%PACKAGING_DIR%\dist\SQLCipherUI-backend\SQLCipherUI-backend.exe" (
    echo ERROR: Backend build failed.
    exit /b 1
)

REM ── Step 3: Stage backend for Tauri ─────────────────────────────────
echo [3/4] Staging backend for Tauri...
if exist "%TAURI_DIR%\binaries\SQLCipherUI-backend" rmdir /s /q "%TAURI_DIR%\binaries\SQLCipherUI-backend"
mkdir "%TAURI_DIR%\binaries"
xcopy /E /I /Q "%PACKAGING_DIR%\dist\SQLCipherUI-backend" "%TAURI_DIR%\binaries\SQLCipherUI-backend\"

REM ── Step 4: Build Tauri app ─────────────────────────────────────────
echo [4/4] Building Tauri app...
cd /d %PROJECT_ROOT%
cargo tauri build

echo.
echo === Copying installers to releases\ ===

set RELEASES_DIR=%PROJECT_ROOT%\releases
if not exist "%RELEASES_DIR%" mkdir "%RELEASES_DIR%"

for %%f in ("%TAURI_DIR%\target\release\bundle\msi\*.msi") do (
    copy /Y "%%f" "%RELEASES_DIR%\"
    echo MSI: %RELEASES_DIR%\%%~nxf
)
for %%f in ("%TAURI_DIR%\target\release\bundle\nsis\*.exe") do (
    copy /Y "%%f" "%RELEASES_DIR%\"
    echo EXE: %RELEASES_DIR%\%%~nxf
)

echo.
echo === Build complete ===
echo Installers are in: %RELEASES_DIR%
