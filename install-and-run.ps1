# install-and-run.ps1
$OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  AI Client 2 API 快速安装启动脚本" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 处理参数
$forcePull = $args -contains "--pull"

# 检查 Git 并拉取
if ($forcePull) {
    Write-Host "[更新] 正在从远程仓库拉取最新代码..."
    if (Get-Command git -ErrorAction SilentlyContinue) {
        git pull
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Git pull 失败，请检查网络或手动处理冲突。"
        } else {
            Write-Host "[成功] 代码已更新。" -ForegroundColor Green
        }
    } else {
        Write-Warning "未检测到 Git，跳过代码拉取。"
    }
}

# 检查 Node.js
Write-Host "[检查] 正在检查Node.js是否已安装..."
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[错误] 未检测到Node.js，请先安装Node.js (https://nodejs.org/)" -ForegroundColor Red
    Pause
    exit 1
}

$nodeVersion = node --version
Write-Host "[成功] Node.js已安装，版本: $nodeVersion" -ForegroundColor Green

# 检查 package.json
if (-not (Test-Path "package.json")) {
    Write-Host "[错误] 未找到package.json文件，请确保在项目根目录下运行此脚本" -ForegroundColor Red
    Pause
    exit 1
}

# 确定包管理器
$pkgManager = if (Get-Command pnpm -ErrorAction SilentlyContinue) { "pnpm" } else { "npm" }
Write-Host "[安装] 正在使用 $pkgManager 安装/更新依赖..." -ForegroundColor Cyan

& $pkgManager install
if ($LASTEXITCODE -ne 0) {
    Write-Host "[错误] 依赖安装失败，请检查网络连接。" -ForegroundColor Red
    Pause
    exit 1
}

# 检查主文件
if (-not (Test-Path "src\core\master.js")) {
    Write-Host "[错误] 未找到 src\core\master.js 文件" -ForegroundColor Red
    Pause
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  启动 AIClient2API 服务器..." -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "服务器将在 http://localhost:3000 启动"
Write-Host "按 Ctrl+C 停止服务器"
Write-Host ""

node src\core\master.js
