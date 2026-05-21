@echo off
setlocal
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" amd64_arm64 || exit /b 1
cd /d "%~dp0\.."
call npm run tauri -- build --target aarch64-pc-windows-msvc
