@echo off
cd /d "%~dp0"

:: ── Arrancar el servidor web (puerto 4000) si no está corriendo ───────────────
curl -s -o nul http://localhost:4000 2>nul
if %errorlevel% == 0 (
    goto studio
)
start /min "News Video Server" cmd /k node web-server.mjs
timeout /t 4 /nobreak >nul
:: Primera vez: abrir configuración
start http://localhost:4000/settings
goto studio

:studio
:: ── Arrancar Remotion Studio (puerto 4001) si no está corriendo ───────────────
curl -s -o nul http://localhost:4001 2>nul
if %errorlevel% == 0 (
    goto done
)
start /min "Remotion Studio" cmd /k npx remotion studio src/index.ts --port 4001

:done
:: Si el servidor ya estaba corriendo, abrir la app directamente
curl -s -o nul http://localhost:4000/settings 2>nul
if %errorlevel% == 0 (
    start http://localhost:4000
)
