@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Instale o Node.js 24 ou superior antes de iniciar o painel.
  pause
  exit /b 1
)
node server.mjs
pause
