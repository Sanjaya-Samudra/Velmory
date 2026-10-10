@echo off
cd /d "%~dp0"
if not exist node_modules\vite\bin\vite.js (
  echo Install Node.js, then run npm install in this folder.
  pause
  exit /b 1
)
start "" "http://127.0.0.1:5173/"
node node_modules\vite\bin\vite.js --host 127.0.0.1 --port 5173 --strictPort
pause
