@echo off
title CTRL-DECK
cd /d "%~dp0"

echo ============================================
echo   CTRL-DECK wird gestartet...
echo ============================================
echo.

if not exist "server\node_modules" (
    echo [Setup] Installiere Abhaengigkeiten - das dauert beim ersten Mal etwas...
    call npm run install:all
    echo.
)

echo [Start] Server + Oberflaeche werden hochgefahren.
echo [Info]  Browser oeffnet gleich automatisch: http://localhost:5180
echo [Info]  Zum Beenden dieses Fenster schliessen oder Strg+C druecken.
echo.

start "" http://localhost:5180
call npm run dev
