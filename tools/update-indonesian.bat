@echo off
cd /d "%~dp0"
where py >nul 2>nul && ( py build-indonesian.py all & goto :end )
where python >nul 2>nul && ( python build-indonesian.py all & goto :end )
echo Python was not found. Install it from https://www.python.org/downloads/ ^(tick "Add to PATH"^), then run this again.
:end
echo.
pause
