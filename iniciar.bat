@echo off
chcp 65001 >nul
title Dev Quest
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias, so na primeira vez...
  call npm install
)
start "" http://localhost:8787
node server.js
pause
