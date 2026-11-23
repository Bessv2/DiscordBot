@echo off
rem Double-click to run the bot on Windows without Docker (docs\WITHOUT-DOCKER.md).
rem The first run installs and sets everything up and asks for your bot token.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get the LTS version from https://nodejs.org, then double-click this file again. & pause & exit /b 1)
node scripts\local.cjs start
echo.
echo The bot has stopped. Close this window, or press a key.
pause >nul
