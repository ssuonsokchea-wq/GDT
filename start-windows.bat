@echo off
rem KhmerProof launcher for Windows. Requires Node.js 20+ (https://nodejs.org).
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Download the LTS version from https://nodejs.org and run this file again. & pause & exit /b 1)
if not exist node_modules (echo Installing libraries, first run only... & call npm install || (pause & exit /b 1))
set KHMERPROOF_OPEN=1
node server\server.mjs
pause
