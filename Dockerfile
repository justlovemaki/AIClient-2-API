# 使用官方 Node.js 运行时作为基础镜像
# 选择 Debian (bookworm-slim) 以便安装 Chromium + Xvfb + noVNC 等 GUI 依赖
FROM node:20-bookworm-slim

# 设置标签
LABEL maintainer="AIClient2API Team"
LABEL description="Docker image for AIClient2API server"

# 安装系统依赖：
# - tar/git: 更新/版本检查
# - chromium: 本地浏览器
# - xvfb/openbox/x11vnc/novnc: 在容器内运行可交互 GUI 浏览器，并通过 noVNC 暴露到 Web
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    tar \
    git \
    chromium \
    xvfb \
    openbox \
    x11vnc \
    novnc \
    python3-websockify \
    fonts-dejavu-core \
    fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

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

USER root

# 创建目录用于存储日志和系统提示文件
RUN mkdir -p /app/logs \
  && chmod +x /app/docker/entrypoint.sh

# 暴露端口
# - 5900: VNC (optional; noVNC uses it internally)
# - 6080: noVNC Web UI
EXPOSE 3000 8085 8086 19876-19880 5900 6080

# 添加健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node healthcheck.js || exit 1

# 设置启动命令
# 通过环境变量控制是否启动 GUI 浏览器栈：
# - BROWSER_GUI_ENABLED=1
# - VNC_PASSWORD=...
CMD ["./docker/entrypoint.sh"]
