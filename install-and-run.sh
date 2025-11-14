#!/bin/bash

# Set English environment
export LC_ALL=en_US.UTF-8
export LANG=en_US.UTF-8

echo "========================================"
echo "  AI Client 2 API Quick Install Script"
echo "========================================"
echo

# Check if Node.js is installed
echo "[Check] Checking if Node.js is installed..."
node --version > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "❌ Error: Node.js not detected, please install Node.js first"
    echo "📥 Download: https://nodejs.org/"
    echo "💡 Recommended: Install LTS version"
    exit 1
fi

# Get Node.js version
NODE_VERSION=$(node --version 2>/dev/null)
echo "✅ Node.js is installed, version: $NODE_VERSION"

# Check if npm is available
echo "[Check] Checking if npm is available..."
npm --version > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "❌ Error: npm is not available, please reinstall Node.js"
    exit 1
fi

# Check if package.json exists
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json file not found"
    echo "Please make sure to run this script in the project root directory"
    exit 1
fi

echo "✅ Found package.json file"

# Check if node_modules directory exists
if [ ! -d "node_modules" ]; then
    echo "[Install] node_modules directory does not exist, installing dependencies..."
    echo "This may take a few minutes, please be patient..."
    echo "Running: npm install..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ Dependency installation failed"
        echo "Please check network connection or run 'npm install' manually"
        exit 1
    fi
    echo "✅ Dependencies installed successfully"
else
    echo "✅ node_modules directory already exists"
fi

# Check if package-lock.json exists
if [ ! -f "package-lock.json" ]; then
    echo "[Update] package-lock.json does not exist, updating dependencies..."
    echo "Running: npm install..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ Dependency update failed"
        echo "Please check network connection or run 'npm install' manually"
        exit 1
    fi
    echo "✅ Dependencies updated successfully"
else
    echo "✅ package-lock.json file exists"
fi

# Check if src directory and api-server.js exist
if [ ! -f "src/api-server.js" ]; then
    echo "❌ Error: src/api-server.js file not found"
    exit 1
fi

echo "✅ Project file check completed"

# Start application
echo
echo "========================================"
echo "  Starting AI Client 2 API Server..."
echo "========================================"
echo
echo "🌐 Server will start on http://localhost:3000"
echo "📖 Visit http://localhost:3000 to view management interface"
echo "⏹️  Press Ctrl+C to stop server"
echo

# 启动服务器
node src/api-server.js

# If startup fails
if [ $? -ne 0 ]; then
    echo
    echo "❌ Server error"
    echo "Please check error messages and try again"
    exit 1
fi