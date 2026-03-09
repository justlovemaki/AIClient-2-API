# ── Stage 1: 编译 Go TLS sidecar ──
FROM golang:1.22-alpine AS sidecar-builder

RUN apk add --no-cache git

WORKDIR /build
COPY tls-sidecar/go.mod tls-sidecar/go.sum* ./
RUN go mod download || true

COPY tls-sidecar/ ./
RUN go mod tidy && CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o tls-sidecar .

# ── Stage 2: Node.js 应用 ──
# 使用官方Node.js运行时作为基础镜像
# 选择20-alpine版本以满足undici包的要求（需要Node.js >=20.18.1）
FROM node:20-alpine

# 设置标签
LABEL maintainer="AIClient2API Team"
LABEL description="Docker image for AIClient2API server"

# 安装必要的系统工具（tar 用于更新功能，git 用于版本检查，procps 用于系统监控）
RUN apk add --no-cache tar git procps

# 设置工作目录
WORKDIR /app

# 复制package.json和package-lock.json（如果存在）
COPY package*.json ./

# 安装依赖
# 使用--production标志只安装生产依赖，减小镜像大小
# 使用--omit=dev来排除开发依赖
RUN npm install

# 复制源代码
COPY . .

# 从 sidecar 构建阶段复制二进制
# 放在 COPY . . 之后是为了确保不会被本地的空目录或旧二进制文件覆盖
COPY --from=sidecar-builder /build/tls-sidecar /app/tls-sidecar/tls-sidecar
RUN chmod +x /app/tls-sidecar/tls-sidecar

USER root

# 创建目录用于存储日志和系统提示文件
RUN mkdir -p /app/logs

# 暴露端口
EXPOSE 3000 8085 8086 19876-19880

# 添加健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node healthcheck.js || exit 1

# 设置启动命令
# 使用默认配置启动服务器，支持通过环境变量配置
# 通过环境变量传递参数，例如：docker run -e ARGS="--api-key mykey --port 8080" ...
CMD ["sh", "-c", "node src/core/master.js $ARGS"]
