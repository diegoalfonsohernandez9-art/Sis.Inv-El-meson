@echo off
rem Corre los procesos de Java (existencias, reabastecimiento, recetas, merma). El sistema debe estar encendido.
title El Meson - procesos en Java
cd /d "%~dp0"
set "JAVA=java"
for /d %%J in ("%ProgramFiles%\Eclipse Adoptium\jdk-21*") do set "JAVA=%%J\bin\java.exe"
chcp 65001 >nul
"%JAVA%" -Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8 Procesos.java %*
if not errorlevel 1 start "" "reportes"
pause
