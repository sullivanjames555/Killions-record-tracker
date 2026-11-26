@echo off
title Build Killion's Record Shelf installer
cd /d "%~dp0"
where node >NUL 2>NUL || (
  echo Node.js is not installed on this computer.
  echo Get the LTS version from https://nodejs.org , install it, then run this file again.
  pause
  exit /b 1
)
echo Step 1 of 3: downloading the building blocks (first time takes a few minutes)...
call npm install || goto :err
echo Step 2 of 3: running the self-tests...
call npm test || goto :err
echo Step 3 of 3: building the installer...
call npm run dist || goto :err
echo.
echo Done! The installer is in the "dist" folder: "Killions-Record-Shelf-Setup-1.0.0.exe"
start "" "%~dp0dist"
pause
exit /b 0
:err
echo.
echo Something went wrong. Scroll up to see the error message.
pause
exit /b 1
