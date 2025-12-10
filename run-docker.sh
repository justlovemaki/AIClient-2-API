#!/bin/bash
# run-docker.sh
# 本地构建、打包并运行 Docker 容器

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# 日志函数
log_info() { echo -e "${GREEN}$1${NC}"; }
log_warn() { echo -e "${YELLOW}$1${NC}"; }
log_error() { echo -e "${RED}$1${NC}"; }
log_cyan() { echo -e "${CYAN}$1${NC}"; }

error_exit() {
    log_error "错误: $1"
    exit 1
}

# 获取脚本目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || error_exit "无法切换到脚本目录"

log_info "正在准备 Docker 环境..."
echo ""

# ========== 前置检查 ==========
log_info "检查前置条件..."

if ! command -v docker &> /dev/null; then
    error_exit "未找到 Docker，请先安装 Docker"
fi

if ! docker info &> /dev/null; then
    error_exit "Docker 未运行，请启动 Docker 服务"
fi

log_cyan "Docker 环境正常"
echo ""

# ========== 配置文件处理 ==========
log_info "检查配置文件..."

DATA_DIR_PATH="/home/2api_data"
CONFIG_JSON_PATH="$DATA_DIR_PATH/config.json"
CONFIG_EXAMPLE_PATH="$SCRIPT_DIR/config.json.example"

# 确保数据目录存在
if [ ! -d "$DATA_DIR_PATH" ]; then
    log_warn "正在创建数据目录: $DATA_DIR_PATH"
    mkdir -p "$DATA_DIR_PATH" || error_exit "创建数据目录失败"
fi

if [ ! -f "$CONFIG_EXAMPLE_PATH" ]; then
    error_exit "未找到 config.json.example 文件！"
fi

if command -v jq &> /dev/null; then
    HAS_JQ=true
else
    HAS_JQ=false
    log_warn "未安装 jq，使用简单配置处理"
fi

if [ -f "$CONFIG_JSON_PATH" ]; then
    log_cyan "发现现有配置文件"
    if [ "$HAS_JQ" = true ]; then
        log_cyan "正在合并新字段..."
        MERGED=$(jq -s '.[0] * .[1] | .[1] * .' "$CONFIG_EXAMPLE_PATH" "$CONFIG_JSON_PATH" 2>/dev/null) || {
            log_warn "配置合并失败，保留现有配置"
            MERGED=""
        }
        if [ -n "$MERGED" ]; then
            echo "$MERGED" > "$CONFIG_JSON_PATH"
            log_info "配置文件已更新"
        fi
    else
        log_cyan "保留现有配置文件"
    fi
else
    log_warn "未找到 config.json，从 config.json.example 创建..."
    cp "$CONFIG_EXAMPLE_PATH" "$CONFIG_JSON_PATH" || error_exit "无法创建配置文件"
    log_info "已创建 config.json，请根据需要修改配置"
fi
echo ""

# ========== 凭证路径 ==========
AWS_SSO_CACHE_PATH="$HOME/.aws/sso/cache"
GEMINI_CONFIG_PATH="$HOME/.gemini/oauth_creds.json"
CONFIGS_DIR_PATH="$DATA_DIR_PATH/configs"
LOGS_DIR_PATH="$DATA_DIR_PATH/logs"

if [ -d "$AWS_SSO_CACHE_PATH" ]; then
    log_cyan "发现 AWS SSO 缓存: $AWS_SSO_CACHE_PATH"
    AWS_MOUNT="-v $AWS_SSO_CACHE_PATH:/root/.aws/sso/cache"
else
    log_warn "未找到 AWS SSO 缓存: $AWS_SSO_CACHE_PATH"
    log_warn "注意: Docker 容器可能无法访问 AWS 凭证"
    AWS_MOUNT=""
fi

if [ -f "$GEMINI_CONFIG_PATH" ]; then
    log_cyan "发现 Gemini 配置: $GEMINI_CONFIG_PATH"
    GEMINI_MOUNT="-v $GEMINI_CONFIG_PATH:/root/.gemini/oauth_creds.json"
else
    log_warn "未找到 Gemini 配置: $GEMINI_CONFIG_PATH"
    log_warn "注意: Docker 容器可能无法访问 Gemini API"
    GEMINI_MOUNT=""
fi

# 数据目录已在上面创建
log_cyan "发现数据目录: $DATA_DIR_PATH"

# 确保 configs 目录存在
if [ ! -d "$CONFIGS_DIR_PATH" ]; then
    log_warn "正在创建 configs 目录: $CONFIGS_DIR_PATH"
    mkdir -p "$CONFIGS_DIR_PATH" || log_warn "创建 configs 目录失败"
fi

if [ -d "$CONFIGS_DIR_PATH" ]; then
    log_cyan "发现 configs 目录: $CONFIGS_DIR_PATH"
    CONFIGS_MOUNT="-v $CONFIGS_DIR_PATH:/app/configs"
else
    log_warn "未找到 configs 目录: $CONFIGS_DIR_PATH"
    CONFIGS_MOUNT=""
fi

# 确保 logs 目录存在
if [ ! -d "$LOGS_DIR_PATH" ]; then
    log_warn "正在创建 logs 目录: $LOGS_DIR_PATH"
    mkdir -p "$LOGS_DIR_PATH" || log_warn "创建 logs 目录失败"
fi

if [ -d "$LOGS_DIR_PATH" ]; then
    log_cyan "发现 logs 目录: $LOGS_DIR_PATH"
    LOGS_MOUNT="-v $LOGS_DIR_PATH:/app/logs"
else
    log_warn "未找到 logs 目录: $LOGS_DIR_PATH"
    LOGS_MOUNT=""
fi

# provider_pools.json 文件路径
PROVIDER_POOLS_PATH="$DATA_DIR_PATH/provider_pools.json"
if [ ! -f "$PROVIDER_POOLS_PATH" ]; then
    log_warn "正在创建 provider_pools.json: $PROVIDER_POOLS_PATH"
    echo "{}" > "$PROVIDER_POOLS_PATH" || log_warn "创建 provider_pools.json 失败"
fi

if [ -f "$PROVIDER_POOLS_PATH" ]; then
    log_cyan "发现 provider_pools.json: $PROVIDER_POOLS_PATH"
    PROVIDER_POOLS_MOUNT="-v $PROVIDER_POOLS_PATH:/app/provider_pools.json"
else
    log_warn "未找到 provider_pools.json: $PROVIDER_POOLS_PATH"
    PROVIDER_POOLS_MOUNT=""
fi
echo ""

# ========== 清理旧容器 ==========
log_info "检查是否存在旧容器..."

CONTAINER_ID=$(docker ps -a -q -f name=aiclient2api 2>/dev/null)
if [ -n "$CONTAINER_ID" ]; then
    log_warn "发现已存在的容器 'aiclient2api'，正在停止并删除..."
    docker stop aiclient2api 2>/dev/null || true
    docker rm aiclient2api 2>/dev/null || true
    log_info "旧容器已清理"
else
    log_cyan "未发现旧容器"
fi
echo ""

# ========== 构建 Docker 镜像 ==========
log_info "检查 Docker 镜像..."

FORCE_BUILD=false
if docker images -q aiclient2api 2>/dev/null | grep -q .; then
    log_cyan "发现已存在的 Docker 镜像 'aiclient2api'"
    read -p "是否强制重新构建镜像？(y/n, 默认 n): " REBUILD_CHOICE
    if [ "$REBUILD_CHOICE" = "y" ] || [ "$REBUILD_CHOICE" = "Y" ]; then
        FORCE_BUILD=true
        log_warn "将删除旧镜像并重新构建..."
        docker rmi aiclient2api 2>/dev/null || log_warn "删除旧镜像失败，继续执行..."
    fi
else
    FORCE_BUILD=true
fi

if [ "$FORCE_BUILD" = true ]; then
    log_info "开始本地构建 Docker 镜像..."
    log_cyan "执行: docker build -t aiclient2api ."
    echo ""
    
    if ! docker build -t aiclient2api . ; then
        error_exit "Docker 镜像构建失败！请检查 Dockerfile 和源代码"
    fi
    
    log_info "Docker 镜像构建成功！"
fi
echo ""

# ========== 构建运行命令 ==========
log_info "准备 Docker 运行命令..."

VOLUME_MOUNTS=""
[ -n "$AWS_MOUNT" ] && VOLUME_MOUNTS="$VOLUME_MOUNTS $AWS_MOUNT"
[ -n "$GEMINI_MOUNT" ] && VOLUME_MOUNTS="$VOLUME_MOUNTS $GEMINI_MOUNT"
[ -n "$CONFIGS_MOUNT" ] && VOLUME_MOUNTS="$VOLUME_MOUNTS $CONFIGS_MOUNT"
[ -n "$LOGS_MOUNT" ] && VOLUME_MOUNTS="$VOLUME_MOUNTS $LOGS_MOUNT"
[ -n "$PROVIDER_POOLS_MOUNT" ] && VOLUME_MOUNTS="$VOLUME_MOUNTS $PROVIDER_POOLS_MOUNT"

if [ -f "$CONFIG_JSON_PATH" ]; then
    VOLUME_MOUNTS="$VOLUME_MOUNTS -v $CONFIG_JSON_PATH:/app/config.json"
    log_cyan "将挂载 config.json: $CONFIG_JSON_PATH -> /app/config.json"
fi

if [ -n "$CONFIGS_MOUNT" ]; then
    log_cyan "将挂载 configs: $CONFIGS_DIR_PATH -> /app/configs"
fi

if [ -n "$LOGS_MOUNT" ]; then
    log_cyan "将挂载 logs: $LOGS_DIR_PATH -> /app/logs"
fi

if [ -n "$PROVIDER_POOLS_MOUNT" ]; then
    log_cyan "将挂载 provider_pools.json: $PROVIDER_POOLS_PATH -> /app/provider_pools.json"
fi

DOCKER_CMD="docker run -d \
  --restart=always \
  --privileged=true \
  -p 3000:3000 \
  $VOLUME_MOUNTS \
  --name aiclient2api \
  aiclient2api"

echo ""
log_info "生成的 Docker 命令:"
echo "$DOCKER_CMD"
echo ""

echo "$DOCKER_CMD" > docker-run-command.txt
log_info "命令已保存到 docker-run-command.txt"
echo ""

# ========== 运行容器 ==========
read -p "是否立即执行 Docker 命令？(y/n, 默认 y): " EXECUTE_CMD
EXECUTE_CMD=${EXECUTE_CMD:-y}

if [ "$EXECUTE_CMD" = "y" ] || [ "$EXECUTE_CMD" = "Y" ]; then
    log_info "正在启动 Docker 容器..."
    
    if eval "$DOCKER_CMD"; then
        echo ""
        log_info "Docker 容器启动成功！"
        log_cyan "访问 API 服务: http://localhost:3000"
        echo ""
        
        log_info "容器状态:"
        docker ps -f name=aiclient2api --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
        
        sleep 3
        if docker ps -q -f name=aiclient2api -f status=running | grep -q .; then
            log_info "容器运行正常"
        else
            log_warn "容器可能启动失败，正在检查日志:"
            docker logs aiclient2api 2>&1 | tail -20
        fi
    else
        error_exit "Docker 容器启动失败！"
    fi
else
    log_warn "命令未执行，您可以从 docker-run-command.txt 复制命令手动执行"
fi

echo ""
log_info "脚本执行完成"
