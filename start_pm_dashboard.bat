@echo off
setlocal

cd /d "%~dp0"

echo Starting PM Operations Dashboard...

if not exist "node_modules" (
  echo Installing dependencies...
  call npm.cmd install
  if errorlevel 1 goto :fail
)

echo Importing sample data...
call node scripts\import-sample.js
if errorlevel 1 goto :fail

echo Launching server at http://localhost:3000 ...
call node src\server.js
if errorlevel 1 goto :fail

goto :eof

:fail
echo.
echo Startup failed.
exit /b 1
