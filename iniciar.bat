@echo off
title Atencion de Pacientes
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  No se encontro Node.js. Instalelo desde https://nodejs.org
  echo.
  pause
  exit /b
)
start "" http://localhost:3020
node server.js
pause

