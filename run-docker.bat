@echo off
:: run-docker-with-credentials.bat
:: 生成指定的Docker运行命令，使用USERPROFILE环境变量构建路径

setlocal enabledelayedexpansion

echo Generating Docker run command...

:: Set config file paths using USERPROFILE environment variable
set "AWS_SSO_CACHE_PATH=%USERPROFILE%\.aws\sso\cache"
set "GEMINI_CONFIG_PATH=%USERPROFILE%\.gemini\oauth_creds.json"

:: Check if AWS SSO cache directory exists
if exist "%AWS_SSO_CACHE_PATH%" (
    echo Found AWS SSO cache directory: %AWS_SSO_CACHE_PATH%
) else (
    echo AWS SSO cache directory not found: %AWS_SSO_CACHE_PATH%
    echo Note: AWS SSO cache directory does not exist, Docker container may not access AWS credentials
)

:: Check if Gemini config file exists
if exist "%GEMINI_CONFIG_PATH%" (
    echo Found Gemini config file: %GEMINI_CONFIG_PATH%
) else (
    echo Gemini config file not found: %GEMINI_CONFIG_PATH%
    echo Note: Gemini config file does not exist, Docker container may not access Gemini API
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

:: Display command to be executed
echo.
echo Generated Docker command:
echo !DOCKER_CMD!
echo.

:: Save command to file
echo !DOCKER_CMD! > docker-run-command.txt
echo Command saved to docker-run-command.txt file, you can copy the complete command from this file.

:: Ask user if they want to execute the command
echo.
set /p EXECUTE_CMD="Do you want to execute this Docker command now? (y/n): "
if /i "!EXECUTE_CMD!"=="y" (
    echo Executing Docker command...
    !DOCKER_CMD!
    if !errorlevel! equ 0 (
        echo Docker container started successfully!
        echo You can access the API service at http://localhost:3000
    ) else (
        echo Docker command execution failed, please check error messages
    )
) else (
    echo Command not executed, you can manually copy and execute the command from docker-run-command.txt file
)

echo Script execution completed
pause