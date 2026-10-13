@echo off
echo [WRAPPER] Loading production environment from .env.worker.local...
for /f "usebackq tokens=1,* eol=# delims==" %%A in (".env.worker.local") do (
    set "%%A=%%B"
)
echo [WRAPPER] Starting worker...
call "C:\Program Files\nodejs\npm.cmd" run worker
