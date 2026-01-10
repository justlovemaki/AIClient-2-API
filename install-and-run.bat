@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: 处理参数
set FORCE_PULL=0

for %%a in (%*) do (
    if "%%a"=="--pull" set FORCE_PULL=1
)

echo ========================================
echo   AI Client 2 API 快速安装启动脚本
echo ========================================
echo.

:: 检查Git并尝试pull
if !FORCE_PULL! equ 1 (
    echo [更新] 正在从远程仓库拉取最新代码...
    git --version >nul 2>&1
    if !errorlevel! equ 0 (
        git pull
        if !errorlevel! neq 0 (
            echo [警告] Git pull 失败，请检查网络或手动处理冲突。
        ) else (
            echo [成功] 代码已更新。
        )
    ) else (
        echo [警告] 未检测到 Git，跳过代码拉取。
    )
)

:: 检查Node.js是否已安装
echo [检查] 正在检查Node.js是否已安装...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到Node.js，请先安装Node.js
    echo 下载地址：https://nodejs.org/
    echo 提示：推荐安装LTS版本
    pause
    exit /b 1
)

:: 获取Node.js版本
for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo [成功] Node.js已安装，版本: !NODE_VERSION!

:: 检查package.json是否存在
if not exist "package.json" (
    echo [错误] 未找到package.json文件
    echo 请确保在项目根目录下运行此脚本
    pause
    exit /b 1
)

echo [成功] 找到package.json文件

echo [安装] 正在安装/更新依赖...
echo 这可能需要几分钟时间，请耐心等待...
echo 正在执行: npm install...
:: 使用npm install并设置超时机制
call npm install --timeout=300000
if !errorlevel! neq 0 (
    echo [错误] 依赖安装失败
    echo 请检查网络连接或手动运行 'npm install'
    pause
    exit /b 1
)
echo [成功] 依赖安装/更新完成

:: 检查src目录和master.js是否存在
if not exist "src\core\master.js" (
    echo [错误] 未找到src\core\master.js文件
    pause
    exit /b 1
)

echo [成功] 项目文件检查完成

:: 启动应用程序
echo.
echo ========================================
echo   启动AI Client 2 API服务器...
echo ========================================
echo.
echo 服务器将在 http://localhost:3000 启动
echo 访问 http://localhost:3000 查看管理界面
echo 按 Ctrl+C 停止服务器
echo.

:: 启动服务器
node src\core\master.js