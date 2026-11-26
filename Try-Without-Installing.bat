@echo off
title My Record Shelf (test run)
cd /d "%~dp0"
where node >NUL 2>NUL || (echo Node.js is not installed. Get the LTS version from https://nodejs.org & pause & exit /b 1)
if not exist node_modules call npm install
call npm start
