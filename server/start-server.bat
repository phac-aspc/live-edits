@echo off
REM Live Edits Server - Persistent Version for Task Scheduler
REM This version keeps the process running and logs everything

set SERVER_DIR=E:\live-edits\server
set LOG_FILE=%SERVER_DIR%\logs\server.log
set ERROR_LOG=%SERVER_DIR%\logs\errors.log

REM Create logs directory
if not exist "%SERVER_DIR%\logs" mkdir "%SERVER_DIR%\logs"

REM Change to server directory
cd /d "%SERVER_DIR%" || (
    echo [%DATE% %TIME%] ERROR: Could not change to %SERVER_DIR% >> "%ERROR_LOG%"
    exit /b 1
)

REM Log startup
echo [%DATE% %TIME%] ======================================== >> "%LOG_FILE%"
echo [%DATE% %TIME%] Starting Live Edits Server >> "%LOG_FILE%"
echo [%DATE% %TIME%] Working directory: %CD% >> "%LOG_FILE%"

REM Find Node.js - try multiple methods
set NODE_EXE=

REM Method 1: Check common installation paths
if exist "C:\Program Files\nodejs\node.exe" (
    set "NODE_EXE=C:\Program Files\nodejs\node.exe"
    echo [%DATE% %TIME%] Found Node.js at: %NODE_EXE% >> "%LOG_FILE%"
    goto :found_node
)

set "NODE_X86=C:\Program Files (x86)\nodejs\node.exe"
if exist "%NODE_X86%" (
    set "NODE_EXE=%NODE_X86%"
    echo [%DATE% %TIME%] Found Node.js at: %NODE_EXE% >> "%LOG_FILE%"
    goto :found_node
)

REM Method 2: Try to find in PATH
where node.exe >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    for /f "delims=" %%i in ('where node.exe') do (
        set "NODE_EXE=%%i"
        echo [%DATE% %TIME%] Found Node.js in PATH: %%i >> "%LOG_FILE%"
        goto :found_node
    )
)

REM If we get here, Node.js wasn't found
echo [%DATE% %TIME%] ERROR: Node.js not found! >> "%ERROR_LOG%"
echo [%DATE% %TIME%] ERROR: Node.js not found! >> "%LOG_FILE%"
exit /b 1

:found_node
echo [%DATE% %TIME%] Using Node.js: %NODE_EXE% >> "%LOG_FILE%"

REM Verify Node.js works
"%NODE_EXE%" --version >> "%LOG_FILE%" 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [%DATE% %TIME%] ERROR: Node.js version check failed >> "%ERROR_LOG%"
    exit /b 1
)

REM Find npm - usually in same directory as node.exe
set NPM_EXE=
REM Extract directory from node.exe path
for %%F in ("%NODE_EXE%") do set "NODE_DIR=%%~dpF"
if exist "%NODE_DIR%npm.cmd" (
    set "NPM_EXE=%NODE_DIR%npm.cmd"
    echo [%DATE% %TIME%] Found npm at: %NPM_EXE% >> "%LOG_FILE%"
    goto :found_npm
)
if exist "%NODE_DIR%npm.exe" (
    set "NPM_EXE=%NODE_DIR%npm.exe"
    echo [%DATE% %TIME%] Found npm at: %NPM_EXE% >> "%LOG_FILE%"
    goto :found_npm
)
REM Try to find npm in PATH
where npm.cmd >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    for /f "delims=" %%i in ('where npm.cmd') do (
        set "NPM_EXE=%%i"
        echo [%DATE% %TIME%] Found npm in PATH: %%i >> "%LOG_FILE%"
        goto :found_npm
    )
)
REM Fallback to npm.cmd command (hopefully in PATH)
echo [%DATE% %TIME%] WARNING: npm executable not found, will try 'npm.cmd' command >> "%LOG_FILE%"
set "NPM_EXE=npm.cmd"
:found_npm

REM Check prerequisites
if not exist ".env" (
    echo [%DATE% %TIME%] ERROR: .env file not found in %CD% >> "%ERROR_LOG%"
    echo [%DATE% %TIME%] ERROR: .env file not found >> "%LOG_FILE%"
    exit /b 1
)

if not exist "src\index.js" (
    echo [%DATE% %TIME%] ERROR: src\index.js not found >> "%ERROR_LOG%"
    echo [%DATE% %TIME%] ERROR: src\index.js not found >> "%LOG_FILE%"
    exit /b 1
)

REM Check if node_modules exists, if not install dependencies
if not exist "node_modules" (
    echo [%DATE% %TIME%] node_modules not found, installing dependencies... >> "%LOG_FILE%"
    echo [%DATE% %TIME%] Running: "%NPM_EXE%" install >> "%LOG_FILE%"
    call "%NPM_EXE%" install >> "%LOG_FILE%" 2>&1
    if %ERRORLEVEL% NEQ 0 (
        echo [%DATE% %TIME%] ERROR: npm install failed >> "%ERROR_LOG%"
        echo [%DATE% %TIME%] ERROR: npm install failed >> "%LOG_FILE%"
        exit /b 1
    )
    echo [%DATE% %TIME%] Dependencies installed successfully >> "%LOG_FILE%"
) else (
    REM Check if express-rate-limit is installed (new dependency we added)
    if not exist "node_modules\express-rate-limit" (
        echo [%DATE% %TIME%] express-rate-limit not found, installing dependencies... >> "%LOG_FILE%"
        echo [%DATE% %TIME%] Running: "%NPM_EXE%" install >> "%LOG_FILE%"
        call "%NPM_EXE%" install >> "%LOG_FILE%" 2>&1
        if %ERRORLEVEL% NEQ 0 (
            echo [%DATE% %TIME%] ERROR: Dependency update failed >> "%ERROR_LOG%"
            echo [%DATE% %TIME%] ERROR: Dependency update failed >> "%LOG_FILE%"
            exit /b 1
        )
        echo [%DATE% %TIME%] Dependencies updated successfully >> "%LOG_FILE%"
    )
)

REM Initialize database if needed
if not exist "database.db" (
    echo [%DATE% %TIME%] Initializing database... >> "%LOG_FILE%"
    "%NODE_EXE%" src\init-db.js >> "%LOG_FILE%" 2>&1
    if %ERRORLEVEL% NEQ 0 (
        echo [%DATE% %TIME%] ERROR: Database initialization failed >> "%ERROR_LOG%"
        exit /b 1
    )
)

REM Start the server - IMPORTANT: Don't use start /b, run it directly so Task Scheduler keeps it alive
echo [%DATE% %TIME%] Starting server process... >> "%LOG_FILE%"
echo [%DATE% %TIME%] Command: "%NODE_EXE%" src\index.js >> "%LOG_FILE%"
echo [%DATE% %TIME%] Server will run in this window. Do not close it. >> "%LOG_FILE%"

REM Run the server directly (not in background) so Task Scheduler keeps the task running
"%NODE_EXE%" src\index.js >> "%LOG_FILE%" 2>&1

REM If we get here, the server exited
echo [%DATE% %TIME%] ERROR: Server process exited with code %ERRORLEVEL% >> "%ERROR_LOG%"
echo [%DATE% %TIME%] ERROR: Server process exited >> "%LOG_FILE%"
exit /b %ERRORLEVEL%
