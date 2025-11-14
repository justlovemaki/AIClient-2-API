@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ========================================
echo   AI Client 2 API Quick Install Script
echo ========================================
echo.

:: Check if Node.js is installed
echo [Check] Checking if Node.js is installed...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Error: Node.js not detected, please install Node.js first
    echo 📥 Download: https://nodejs.org/
    echo 💡 Recommended: Install LTS version
    pause
    exit /b 1
)

:: Get Node.js version
for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo ✅ Node.js is installed, version: !NODE_VERSION!

:: Check if package.json exists
if not exist "package.json" (
    echo ❌ Error: package.json file not found
    echo Please make sure to run this script in the project root directory
    pause
    exit /b 1
)

echo ✅ Found package.json file

:: Check if node_modules directory exists
if not exist "node_modules" (
    echo [Install] node_modules directory does not exist, installing dependencies...
    echo This may take a few minutes, please be patient...
    echo Running: npm install...
    :: Use npm install with timeout mechanism
    npm install --timeout=300000
    if !errorlevel! neq 0 (
        echo ❌ Dependency installation failed
        echo Please check network connection or manually run 'npm install'
        pause
        exit /b 1
    )
    echo ✅ Dependencies installed successfully
) else (
    echo ✅ node_modules directory already exists
)

:: Check if package-lock.json exists
if not exist "package-lock.json" (
    echo [Update] package-lock.json does not exist, updating dependencies...
    echo Running: npm install...
    :: Use npm install with timeout mechanism
    npm install --timeout=300000
    if !errorlevel! neq 0 (
        echo ❌ Dependency update failed
        echo Please check network connection or manually run 'npm install'
        pause
        exit /b 1
    )
    echo ✅ Dependencies updated successfully
) else (
    echo ✅ package-lock.json file exists
)

:: Check if src directory and api-server.js exist
if not exist "src\api-server.js" (
    echo ❌ Error: src\api-server.js file not found
    pause
    exit /b 1
)

echo ✅ Project file check completed

:: Start application
echo.
echo ========================================
echo   Starting AI Client 2 API Server...
echo ========================================
echo.
echo 🌐 Server will start on http://localhost:3000
echo 📖 Visit http://localhost:3000 to view management interface
echo ⏹️  Press Ctrl+C to stop server
echo.

:: 启动服务器
node src\api-server.js

:: If startup fails
if !errorlevel! neq 0 (
    echo.
    echo ❌ Server error
    pause
    exit /b 1
)

pause