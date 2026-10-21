@echo off
cd /d "%~dp0"
where py >nul 2>&1
if %errorlevel% equ 0 (
  py -3 server.py
) else (
  python server.py
)
if errorlevel 1 (
  echo.
  echo Pastikan Python 3.10 atau lebih baru terpasang. Jika port dipakai, jalankan: python server.py --port 8766
  pause
)
