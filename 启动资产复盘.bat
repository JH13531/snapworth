@echo off
chcp 65001 >nul
setlocal

rem 切换到脚本所在目录，全部使用相对路径，项目文件夹可随意移动改名
cd /d "%~dp0"

echo ============================================
echo   Snapworth 资产复盘 - 开发服务器
echo   当前目录: %CD%
echo ============================================
echo.

where node >nul 2>&1
if errorlevel 1 goto :nonode

if exist "node_modules\" goto :have_deps
echo [1/3] 首次运行，正在安装依赖，可能需要几分钟...
call npm install
if errorlevel 1 goto :installfail
:have_deps

netstat -ano | findstr /c:":5174 " | findstr LISTENING >nul 2>&1
if not errorlevel 1 goto :busy

echo [2/3] 3 秒后自动打开浏览器 http://localhost:5174
ping -n 4 127.0.0.1 >nul
start "" http://localhost:5174
echo [3/3] 停止服务请直接关闭本窗口
echo.
call npm run dev
goto :end

:busy
echo [提示] 端口 5174 已有实例在运行，直接打开浏览器访问即可。
echo        如需重启，先关闭那个窗口再双击本文件。
start "" http://localhost:5174
goto :end

:nonode
echo [错误] 未找到 Node.js，请先到 https://nodejs.org/ 安装。
goto :end

:installfail
echo [错误] 依赖安装失败，请截图上方报错信息排查。

:end
echo.
pause
