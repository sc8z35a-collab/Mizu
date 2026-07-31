@echo off
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py start_server.py
) else (
  python start_server.py
)
pause
