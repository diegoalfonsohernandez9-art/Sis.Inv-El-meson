@echo off
rem Respaldo diario de El Meson (lo corre el Programador de tareas de Windows). Tambien se puede correr con doble clic.
cd /d "%~dp0"
if not exist respaldos mkdir respaldos
"C:\Program Files\nodejs\node.exe" --disable-warning=ExperimentalWarning respaldar.js >> respaldos\respaldos.log 2>&1
