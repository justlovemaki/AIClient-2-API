# Docker部署指南

本指南将帮助您使用Docker部署GeminiCli2API服务。

## 构建Docker镜像

在项目根目录下执行以下命令来构建Docker镜像：

```bash
docker build -t gemini-cli2api .
```

## 运行容器

### 基本运行

```bash
docker run -d -p 3000:3000 --name gemini-cli2api gemini-cli2api
```

### 通过ARGS环境变量配置服务

服务支持通过`ARGS`环境变量来配置，例如：

```bash
docker run -d \
  -p 3000:3000 \
  -e ARGS="--api-key 123456 --host 0.0.0.0" \
  --name gemini-cli2api \
  gemini-cli2api
```

### 使用Base64编码的凭据

项目包含两个脚本用于自动处理Base64编码的凭据：
- `run-docker.bat` (Windows)
- `run-docker.sh` (Linux/Unix)

这些脚本会自动生成包含凭据的`ARGS`环境变量：

```bash
# Windows
run-docker.bat

# Linux/Unix (首次使用需要授予权限)
chmod +x run-docker.sh
./run-docker.sh
```

### 挂载配置文件和日志目录

```bash
# 挂载配置文件
docker run -d \
  -p 3000:3000 \
  -v /path/to/your/config.json:/app/config.json \
  --name gemini-cli2api \
  gemini-cli2api

# 挂载日志目录
docker run -d \
  -p 3000:3000 \
  -v /path/to/your/logs:/app/logs \
  --name gemini-cli2api \
  gemini-cli2api
```

## 访问服务

容器启动后，您可以通过以下URL访问服务：

```
http://localhost:3000
```

## 可用端点

- `POST /v1/chat/completions` - OpenAI兼容聊天完成端点
- `GET /v1/models` - OpenAI兼容模型列表端点
- `POST /v1beta/models/{model}:generateContent` - Gemini兼容内容生成端点
- `GET /v1beta/models` - Gemini兼容模型列表端点
- `GET /health` - 健康检查端点

## 故障排除

如果容器无法启动，请检查以下内容：

1. 确保端口3000未被其他进程占用
2. 检查环境变量配置是否正确
3. 查看容器日志以获取更多信息：

```bash
docker logs gemini-cli2api