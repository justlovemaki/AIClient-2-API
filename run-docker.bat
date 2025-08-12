@echo off
:: run-docker-with-credentials.bat
:: 生成指定的Docker运行命令，使用USERPROFILE环境变量构建路径

setlocal enabledelayedexpansion

echo 正在生成指定的Docker运行命令...

:: 设置配置文件路径，使用USERPROFILE环境变量
set "AWS_SSO_CACHE_PATH=%USERPROFILE%\.aws\sso\cache"
set "GEMINI_CONFIG_PATH=%USERPROFILE%\.gemini\oauth_creds.json"

:: 检查AWS SSO缓存目录是否存在
if exist "%AWS_SSO_CACHE_PATH%" (
    echo 发现AWS SSO缓存目录: %AWS_SSO_CACHE_PATH%
) else (
    echo 未找到AWS SSO缓存目录: %AWS_SSO_CACHE_PATH%
    echo 注意：AWS SSO缓存目录不存在，Docker容器可能无法访问AWS凭证
)

:: 检查Gemini配置文件是否存在
if exist "%GEMINI_CONFIG_PATH%" (
    echo 发现Gemini配置文件: %GEMINI_CONFIG_PATH%
) else (
    echo 未找到Gemini配置文件: %GEMINI_CONFIG_PATH%
    echo 注意：Gemini配置文件不存在，Docker容器可能无法访问Gemini API
)

:: 构建Docker运行命令，使用USERPROFILE环境变量构建的路径
set "DOCKER_CMD=docker run -d ^"
set "DOCKER_CMD=!DOCKER_CMD! -u "$(id -u):$(id -g)" ^"
set "DOCKER_CMD=!DOCKER_CMD! --restart=always ^"
set "DOCKER_CMD=!DOCKER_CMD! --privileged=true ^"
set "DOCKER_CMD=!DOCKER_CMD! -p 3000:3000 ^"
set "DOCKER_CMD=!DOCKER_CMD! -e ARGS="--api-key 123456 --host 0.0.0.0" ^"
set "DOCKER_CMD=!DOCKER_CMD! -v "%AWS_SSO_CACHE_PATH%:/root/.aws/sso/cache" ^"
set "DOCKER_CMD=!DOCKER_CMD! -v "%GEMINI_CONFIG_PATH%:/root/.gemini/oauth_creds.json" ^"
set "DOCKER_CMD=!DOCKER_CMD! --name aiclient2api ^"
set "DOCKER_CMD=!DOCKER_CMD! aiclient2api"

:: 显示将要执行的命令
echo.
echo 生成的Docker命令:
echo !DOCKER_CMD!
echo.

:: 将命令保存到文件中
echo !DOCKER_CMD! > docker-run-command.txt
echo 命令已保存到 docker-run-command.txt 文件中，您可以从该文件复制完整的命令。

:: 询问用户是否要执行该命令
echo.
set /p EXECUTE_CMD="是否要立即执行该Docker命令？(y/n): "
if /i "!EXECUTE_CMD!"=="y" (
    echo 正在执行Docker命令...
    !DOCKER_CMD!
    if !errorlevel! equ 0 (
        echo Docker容器已成功启动！
        echo 您可以通过 http://localhost:3000 访问API服务
    ) else (
        echo Docker命令执行失败，请检查错误信息
    )
) else (
    echo 命令未执行，您可以手动从docker-run-command.txt文件复制并执行命令
)

echo 脚本执行完成
pause