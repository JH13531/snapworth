#!/usr/bin/env bash

# 切换到脚本所在目录，全部使用相对路径，项目文件夹可随意移动改名
cd "$(dirname "$0")"

echo "============================================"
echo "  Snapworth 资产复盘"
echo "  当前目录: $(pwd)"
echo "============================================"
echo

if [ ! -f "dist/index.html" ]; then
  echo "[错误] 未找到 dist 构建产物。"
  echo "       请下载包含 dist 目录的完整发行包，"
  echo "       或由开发者先运行 npm run build 生成。"
  echo
  read -r -p "按回车键退出..."
  exit 1
fi

open_browser() {
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://localhost:5174" >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then
    open "http://localhost:5174"
  fi
}

# 检测 5174 端口是否已被占用
if (command -v ss >/dev/null 2>&1 && ss -tln | grep -q ':5174 ') \
  || (command -v lsof >/dev/null 2>&1 && lsof -i :5174 -sTCP:LISTEN >/dev/null 2>&1); then
  echo "[提示] 端口 5174 已有实例在运行，直接打开浏览器访问即可。"
  echo "       如需重启，先停止那个进程再运行本脚本。"
  open_browser
  exit 0
fi

echo "启动后自动打开浏览器 http://localhost:5174"
echo "停止服务请按 Ctrl+C 或直接关闭本窗口"
echo
( sleep 2; open_browser ) &

# 优先用 Python 自带的静态服务器（无需安装任何东西），其次用 npx serve
if command -v python3 >/dev/null 2>&1; then
  exec python3 -m http.server 5174 --bind 127.0.0.1 --directory dist
elif command -v python >/dev/null 2>&1; then
  exec python -m http.server 5174 --bind 127.0.0.1 --directory dist
elif command -v npx >/dev/null 2>&1; then
  exec npx --yes serve -s dist -l 5174
else
  echo "[错误] 需要 Python3 或 Node.js 其中之一来启动本地服务。"
  echo "       Linux 一般自带 Python3；也可安装 Node.js: https://nodejs.org/"
  echo
  read -r -p "按回车键退出..."
  exit 1
fi
