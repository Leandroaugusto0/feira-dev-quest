@echo off
chcp 65001 >nul
title Dev Quest (tunel)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar-tunel.ps1"
pause
