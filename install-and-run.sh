#!/bin/bash

# 设置中文环境
export LC_ALL=zh_CN.UTF-8
export LANG=zh_CN.UTF-8

echo "========================================"
echo "  AI Client 2 API 快速安装启动脚本"
echo "========================================"
echo

# 处理参数
FORCE_PULL=0

for arg in "$@"; do
    if [ "$arg" == "--pull" ]; then
        FORCE_PULL=1
    fi
done

# 检查Git并尝试pull
if [ $FORCE_PULL -eq 1 ]; then
    echo "[更新] 正在从远程仓库拉取最新代码..."
    if command -v git > /dev/null 2>&1; then
        git pull
        if [ $? -ne 0 ]; then
            echo "[警告] Git pull 失败，请检查网络或手动处理冲突。"
        else
            echo "[成功] 代码已更新。"
        fi
    else
        echo "[警告] 未检测到 Git，跳过代码拉取。"
    fi
fi

# 检查Node.js是否已安装
echo "[检查] 正在检查Node.js是否已安装..."
node --version > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "[错误] 未检测到Node.js，请先安装Node.js"
    echo "下载地址：https://nodejs.org/"
    echo "提示：推荐安装LTS版本"
    exit 1
fi

# 获取Node.js版本
NODE_VERSION=$(node --version 2>/dev/null)
echo "[成功] Node.js已安装，版本: $NODE_VERSION"

# 检查npm是否可用
echo "[检查] 正在检查npm是否可用..."
npm --version > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "[错误] npm不可用，请重新安装Node.js"
    exit 1
fi

# 检查package.json是否存在
if [ ! -f "package.json" ]; then
    echo "[错误] 未找到package.json文件"
    echo "请确保在项目根目录下运行此脚本"
    exit 1
fi

echo "[成功] 找到package.json文件"

echo "[安装] 正在安装/更新依赖..."
echo "这可能需要几分钟时间，请耐心等待..."
echo "正在执行: npm install..."
npm install
if [ $? -ne 0 ]; then
    echo "[错误] 依赖安装失败"
    echo "请检查网络连接或运行 'npm install' 手动安装"
    exit 1
fi
echo "[成功] 依赖安装/更新完成"

# 检查src目录和master.js是否存在
if [ ! -f "src/core/master.js" ]; then
    echo "[错误] 未找到src/core/master.js文件"
    exit 1
fi

echo "[成功] 项目文件检查完成"

# 启动应用程序
echo
echo "========================================"
echo "  启动AI Client 2 API服务器..."
echo "========================================"
echo
echo "服务器将在 http://localhost:3000 启动"
echo "访问 http://localhost:3000 查看管理界面"
echo "按 Ctrl+C 停止服务器"
echo

# 启动服务器
node src/core/master.js