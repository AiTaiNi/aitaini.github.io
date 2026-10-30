@echo off
rem Serves the whole site (this folder) at http://localhost:8000
cd /d "%~dp0"
python -m http.server
