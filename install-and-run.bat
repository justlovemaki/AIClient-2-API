@echo off
setlocal
cd /d "%~dp0"

:: Check for powershell
where powershell >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] PowerShell not found. Please run 'node src/core/master.js' manually.
    pause
    exit /b 1
)

:: Launch PowerShell script
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-and-run.ps1" %*

endlocal
