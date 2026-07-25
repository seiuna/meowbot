#!/bin/bash
# StegoJar 编译和运行脚本 (AES-256 加密版)

set -e

echo "=== 编译 StegoJar (AES-256) ==="
javac StegoJar.java
echo "[OK] 编译完成"
echo ""

if [ $# -eq 0 ]; then
    java StegoJar
    exit 0
fi

java StegoJar "$@"
