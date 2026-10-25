@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-sidecar.ps1" %*
exit /b %ERRORLEVEL%
