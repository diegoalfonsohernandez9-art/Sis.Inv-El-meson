@echo off
rem Enciende El Mesón en esta computadora y lo abre en el navegador. Cierra esta ventana para apagarlo.
title El Meson - servidor (no cierres esta ventana)
cd /d "%~dp0"
rem MODO DESARROLLO: se entra sin PIN (solo en esta computadora). Borra esta linea para volver a pedir PIN.
set SIN_PIN=1
start "" /b cmd /c "timeout /t 2 >nul && start http://127.0.0.1:3000/"
node --watch server.js
pause
