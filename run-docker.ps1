# run-docker-with-credentials.ps1
# 生成指定的Docker运行命令，使用环境变量构建路径

Write-Host "正在生成指定的Docker运行命令..." -ForegroundColor Green

# 设置配置文件路径，使用环境变量
$AWS_SSO_CACHE_PATH = Join-Path $env:USERPROFILE ".aws\sso\cache"
$GEMINI_CONFIG_PATH = Join-Path $env:USERPROFILE ".gemini\oauth_creds.json"
$CONFIG_JSON_PATH = Join-Path $PSScriptRoot "config.json"
$CONFIG_EXAMPLE_PATH = Join-Path $PSScriptRoot "config.json.example"

# 设置数据目录映射路径
$DATA_DIR_PATH = "/home/2api_data"

# 自动修补config.json
Write-Host ""
Write-Host "检查配置文件..." -ForegroundColor Green

if (-not (Test-Path $CONFIG_EXAMPLE_PATH)) {
    Write-Host "错误：未找到 config.json.example 文件！" -ForegroundColor Red
    Read-Host "按Enter键退出"
    exit 1
}

try {
    $exampleConfig = Get-Content $CONFIG_EXAMPLE_PATH -Raw | ConvertFrom-Json
    
    if (Test-Path $CONFIG_JSON_PATH) {
        Write-Host "发现现有配置文件，正在合并新字段..." -ForegroundColor Cyan
        $currentConfig = Get-Content $CONFIG_JSON_PATH -Raw | ConvertFrom-Json
        
        # 合并配置：example中的新字段添加到current中，保留current中已有的值
        $exampleConfig.PSObject.Properties | ForEach-Object {
            $key = $_.Name
            if (-not ($currentConfig.PSObject.Properties.Name -contains $key)) {
                Write-Host "  添加新字段: $key" -ForegroundColor Yellow
                $currentConfig | Add-Member -NotePropertyName $key -NotePropertyValue $_.Value -Force
            }
        }
        
        # 保存合并后的配置
        $currentConfig | ConvertTo-Json -Depth 10 | Set-Content $CONFIG_JSON_PATH -Encoding UTF8
        Write-Host "配置文件已更新" -ForegroundColor Green
    } else {
        Write-Host "未找到 config.json，从 config.json.example 创建..." -ForegroundColor Yellow
        Copy-Item $CONFIG_EXAMPLE_PATH $CONFIG_JSON_PATH
        Write-Host "已创建 config.json，请根据需要修改配置" -ForegroundColor Green
    }
} catch {
    Write-Host "配置文件处理失败: $_" -ForegroundColor Red
    Read-Host "按Enter键退出"
    exit 1
}

# 检查AWS SSO缓存目录是否存在
if (Test-Path $AWS_SSO_CACHE_PATH) {
    Write-Host "发现AWS SSO缓存目录: $AWS_SSO_CACHE_PATH" -ForegroundColor Cyan
} else {
    Write-Host "未找到AWS SSO缓存目录: $AWS_SSO_CACHE_PATH" -ForegroundColor Yellow
    Write-Host "注意：AWS SSO缓存目录不存在，Docker容器可能无法访问AWS凭证" -ForegroundColor Yellow
}

# 检查Gemini配置文件是否存在
if (Test-Path $GEMINI_CONFIG_PATH) {
    Write-Host "发现Gemini配置文件: $GEMINI_CONFIG_PATH" -ForegroundColor Cyan
} else {
    Write-Host "未找到Gemini配置文件: $GEMINI_CONFIG_PATH" -ForegroundColor Yellow
    Write-Host "注意：Gemini配置文件不存在，Docker容器可能无法访问Gemini API" -ForegroundColor Yellow
}

# 检查并清理旧容器
Write-Host ""
Write-Host "检查是否存在旧容器..." -ForegroundColor Green
$containerExists = docker ps -a -q -f name=aiclient2api 2>$null
if ($containerExists) {
    Write-Host "发现已存在的容器 'aiclient2api'，正在停止并删除..." -ForegroundColor Yellow
    docker stop aiclient2api 2>$null | Out-Null
    docker rm aiclient2api 2>$null | Out-Null
    Write-Host "旧容器已清理" -ForegroundColor Green
} else {
    Write-Host "未发现旧容器" -ForegroundColor Cyan
}

# 检查Docker镜像是否存在
Write-Host ""
Write-Host "检查Docker镜像..." -ForegroundColor Green
$imageExists = docker images -q aiclient2api 2>$null
if (-not $imageExists) {
    Write-Host "未找到Docker镜像 'aiclient2api'，开始构建..." -ForegroundColor Yellow
    Write-Host "执行: docker build -t aiclient2api ." -ForegroundColor Cyan
    docker build -t aiclient2api .
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Docker镜像构建失败！" -ForegroundColor Red
        Read-Host "按Enter键退出"
        exit 1
    }
    Write-Host "Docker镜像构建成功！" -ForegroundColor Green
} else {
    Write-Host "发现Docker镜像 'aiclient2api'" -ForegroundColor Cyan
}

# 构建Docker运行命令
# 注意：挂载config.json后，容器会优先使用配置文件中的设置
# 命令行参数（ARGS）会覆盖config.json中的对应配置
# 确保数据目录存在
if (-not (Test-Path $DATA_DIR_PATH)) {
    Write-Host "创建数据目录: $DATA_DIR_PATH" -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $DATA_DIR_PATH -Force | Out-Null
}

$volumeMounts = @(
    "-v `"${AWS_SSO_CACHE_PATH}:/root/.aws/sso/cache`""
    "-v `"${GEMINI_CONFIG_PATH}:/root/.gemini/oauth_creds.json`""
    "-v `"${DATA_DIR_PATH}:/home/2api_data`""
)

# 如果config.json存在，挂载到容器中
if (Test-Path $CONFIG_JSON_PATH) {
    $volumeMounts += "-v `"${CONFIG_JSON_PATH}:/app/config.json`""
    Write-Host "将挂载config.json到容器（可读写）" -ForegroundColor Cyan
}

Write-Host "将挂载数据目录: $DATA_DIR_PATH -> /home/2api_data" -ForegroundColor Cyan

$DOCKER_CMD = @(
    "docker run -d"
    "--restart=always"
    "--privileged=true"
    "-p 3000:3000"
    $volumeMounts -join " "
    "--name aiclient2api"
    "aiclient2api"
) -join " "

# 显示将要执行的命令
Write-Host ""
Write-Host "生成的Docker命令:" -ForegroundColor Green
Write-Host $DOCKER_CMD -ForegroundColor White
Write-Host ""

# 将命令保存到文件中
$DOCKER_CMD | Out-File -FilePath "docker-run-command.txt" -Encoding UTF8
Write-Host "命令已保存到 docker-run-command.txt 文件中，您可以从该文件复制完整的命令。" -ForegroundColor Green

# 询问用户是否要执行该命令
Write-Host ""
$EXECUTE_CMD = Read-Host "是否要立即执行该Docker命令？(y/n)"
if ($EXECUTE_CMD -eq "y" -or $EXECUTE_CMD -eq "Y") {
    Write-Host "正在执行Docker命令..." -ForegroundColor Green
    try {
        Invoke-Expression $DOCKER_CMD
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Docker容器已成功启动！" -ForegroundColor Green
            Write-Host "您可以通过 http://localhost:3000 访问API服务" -ForegroundColor Cyan
        } else {
            Write-Host "Docker命令执行失败，请检查错误信息" -ForegroundColor Red
        }
    } catch {
        Write-Host "Docker命令执行失败: $_" -ForegroundColor Red
    }
} else {
    Write-Host "命令未执行，您可以手动从docker-run-command.txt文件复制并执行命令" -ForegroundColor Yellow
}

Write-Host "脚本执行完成" -ForegroundColor Green
Read-Host "按Enter键退出"
