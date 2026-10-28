@echo off
cd /d "%~dp0"
where py >nul 2>nul && ( py update-posts.py & goto :end )
where python >nul 2>nul && ( python update-posts.py & goto :end )
echo Python was not found. Install it from https://www.python.org/downloads/ ^(tick "Add to PATH"^), then run this again.
:end
echo.
pause
