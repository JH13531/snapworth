@echo off
chcp 65001 >nul
setlocal

rem 切换到脚本所在目录，全部使用相对路径，项目文件夹可随意移动改名
cd /d "%~dp0"

echo ============================================
echo   Snapworth 资产复盘
echo   当前目录: %CD%
echo ============================================
echo.

if exist "dist\index.html" goto :have_dist
echo [错误] 未找到 dist 构建产物。
echo        请下载包含 dist 目录的完整发行包，
echo        或由开发者先运行 npm run build 生成。
goto :end
:have_dist

netstat -ano | findstr /c:":5174 " | findstr LISTENING >nul 2>&1
if not errorlevel 1 goto :busy

rem 优先用 Python 自带的静态服务器（无需安装任何东西），其次用 npx serve
set "SERVER_CMD="
where py >nul 2>&1
if not errorlevel 1 set "SERVER_CMD=py -3 -m http.server 5174 --bind 127.0.0.1 --directory dist"
if not defined SERVER_CMD (
  where python >nul 2>&1
  if not errorlevel 1 set "SERVER_CMD=python -m http.server 5174 --bind 127.0.0.1 --directory dist"
)
if not defined SERVER_CMD (
  where npx >nul 2>&1
  if not errorlevel 1 set "SERVER_CMD=npx --yes serve -s dist -l 5174"
)
if not defined SERVER_CMD goto :noruntime

echo [1/2] 正在启动本地服务（在独立窗口中运行）...
start "Snapworth 资产复盘服务" /min cmd /c %SERVER_CMD%
ping -n 4 127.0.0.1 >nul
echo [2/2] 正在打开浏览器 http://localhost:5174
start "" http://localhost:5174
echo.
echo 服务已在最小化窗口「Snapworth 资产复盘服务」中运行，
echo 关闭那个窗口即停止服务。本窗口可直接关闭。
goto :end

:busy
echo [提示] 端口 5174 已有实例在运行，直接打开浏览器访问即可。
echo        如需重启，先关闭那个窗口再双击本文件。
start "" http://localhost:5174
goto :end

:noruntime
echo [错误] 需要 Python 或 Node.js 其中之一来启动本地服务。
echo        请安装 Python: https://www.python.org/ 或 Node.js: https://nodejs.org/

:end
echo.
pause
