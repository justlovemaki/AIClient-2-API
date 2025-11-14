#!/bin/bash
# run-docker-with-credentials.sh
# 生成指定的Docker运行命令，使用HOME环境变量构建路径

echo "Generating Docker run command..."

# Set config file paths using HOME environment variable
AWS_SSO_CACHE_PATH="$HOME/.aws/sso/cache"
GEMINI_CONFIG_PATH="$HOME/.gemini/oauth_creds.json"

# Check if AWS SSO cache directory exists
if [ -d "$AWS_SSO_CACHE_PATH" ]; then
    echo "Found AWS SSO cache directory: $AWS_SSO_CACHE_PATH"
else
    echo "AWS SSO cache directory not found: $AWS_SSO_CACHE_PATH"
    echo "Note: AWS SSO cache directory does not exist, Docker container may not access AWS credentials"
fi

# Check if Gemini config file exists
if [ -f "$GEMINI_CONFIG_PATH" ]; then
    echo "Found Gemini config file: $GEMINI_CONFIG_PATH"
else
    echo "Gemini config file not found: $GEMINI_CONFIG_PATH"
    echo "Note: Gemini config file does not exist, Docker container may not access Gemini API"
fi

# 构建Docker运行命令，使用HOME环境变量构建的路径
DOCKER_CMD="docker run -d \\
  -u "$(id -u):$(id -g)" \\
  --restart=always \\
  --privileged=true \\
  -p 3000:3000 \\
   -e ARGS=\"--api-key 123456 --host 0.0.0.0\" \\
  -v $AWS_SSO_CACHE_PATH:/root/.aws/sso/cache \\
  -v $GEMINI_CONFIG_PATH:/root/.gemini/oauth_creds.json \\
  --name aiclient2api \\
  aiclient2api"

# Display command to be executed
echo
echo "Generated Docker command:"
echo "$DOCKER_CMD"
echo

# Save command to file
echo "$DOCKER_CMD" > docker-run-command.txt
echo "Command saved to docker-run-command.txt file, you can copy the complete command from this file."

# Ask user if they want to execute the command
echo
read -p "Do you want to execute this Docker command now? (y/n): " EXECUTE_CMD
if [ "$EXECUTE_CMD" = "y" ] || [ "$EXECUTE_CMD" = "Y" ]; then
    echo "Executing Docker command..."
    eval "$DOCKER_CMD"
    if [ $? -eq 0 ]; then
        echo "Docker container started successfully!"
        echo "You can access the API service at http://localhost:3000"
    else
        echo "Docker command execution failed, please check error messages"
    fi
else
    echo "Command not executed, you can manually copy and execute the command from docker-run-command.txt file"
fi

echo "Script execution completed"