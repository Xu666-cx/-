@echo off
setlocal
set "interviewNode=node"
where node >nul 2>nul
if errorlevel 1 (
  if exist "%USERPROFILE%\nodejs\node.exe" (
    set "interviewNode=%USERPROFILE%\nodejs\node.exe"
  ) else (
    echo Node.js is required to start the local preview.
    pause
    exit /b 1
  )
)
"%interviewNode%" "%~dp0preview-server.cjs"
pause
