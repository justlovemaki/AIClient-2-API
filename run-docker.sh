#!/bin/bash
# run-docker-with-credentials.sh
# 生成指定的Docker运行命令，使用HOME环境变量构建路径

echo "正在生成指定的Docker运行命令..."

# 设置配置文件路径，使用HOME环境变量
AWS_SSO_CACHE_PATH="$HOME/.aws/sso/cache"
GEMINI_CONFIG_PATH="$HOME/.gemini/oauth_creds.json"

# 检查AWS SSO缓存目录是否存在
if [ -d "$AWS_SSO_CACHE_PATH" ]; then
    echo "发现AWS SSO缓存目录: $AWS_SSO_CACHE_PATH"
else
    echo "未找到AWS SSO缓存目录: $AWS_SSO_CACHE_PATH"
    echo "注意：AWS SSO缓存目录不存在，Docker容器可能无法访问AWS凭证"
fi

# 检查Gemini配置文件是否存在
if [ -f "$GEMINI_CONFIG_PATH" ]; then
    echo "发现Gemini配置文件: $GEMINI_CONFIG_PATH"
else
    echo "未找到Gemini配置文件: $GEMINI_CONFIG_PATH"
    echo "注意：Gemini配置文件不存在，Docker容器可能无法访问Gemini API"
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

# 显示将要执行的命令
echo
echo "生成的Docker命令:"
echo "$DOCKER_CMD"
echo

# 将命令保存到文件中
echo "$DOCKER_CMD" > docker-run-command.txt
echo "命令已保存到 docker-run-command.txt 文件中，您可以从该文件复制完整的命令。"

# 询问用户是否要执行该命令
echo
read -p "是否要立即执行该Docker命令？(y/n): " EXECUTE_CMD
if [ "$EXECUTE_CMD" = "y" ] || [ "$EXECUTE_CMD" = "Y" ]; then
    echo "正在执行Docker命令..."
    eval "$DOCKER_CMD"
    if [ $? -eq 0 ]; then
        echo "Docker容器已成功启动！"
        echo "您可以通过 http://localhost:3000 访问API服务"
    else
        echo "Docker命令执行失败，请检查错误信息"
    fi
else
    echo "命令未执行，您可以手动从docker-run-command.txt文件复制并执行命令"
fi

echo "脚本执行完成"