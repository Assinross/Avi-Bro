@echo off
chcp 65001 >nul
rem Avi-Bro: скачать последнюю версию игры и запустить сервер для игры вдвоём (Windows).
rem Нужен Python 3. Если его нет, скрипт предложит установить.
rem Работаем из копии во временной папке: обновление может заменить сам этот файл.
if not "%~1"=="--run" ( copy /y "%~f0" "%TEMP%\avibro-start.bat" >nul & "%TEMP%\avibro-start.bat" --run & exit /b )
setlocal
set "DIR=%USERPROFILE%\avi-bro-server"
set PORT=8080
set "ZIP=https://github.com/Assinross/Avi-Bro/archive/refs/heads/main.zip"
set "AVIBRO_ZIP=%ZIP%"
set "PY="
py -3 --version >nul 2>nul && set "PY=py -3"
if not defined PY python --version >nul 2>nul && set "PY=python"
if not defined PY (
  echo Python 3 не найден. Устанавливаю через winget...
  winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements
  echo.
  echo Python установлен. Запустите этот файл ещё раз.
  pause
  exit /b
)
rem уже запущен? второй сервер не нужен — просто открываем игру
%PY% -c "import urllib.request,sys; sys.exit(0 if b'avibro' in urllib.request.urlopen('http://127.0.0.1:%PORT%/info', timeout=2).read() else 1)" >nul 2>nul
if not errorlevel 1 (
  echo Сервер Avi-Bro уже запущен — открываю игру.
  start "" "http://localhost:%PORT%"
  timeout /t 3 >nul
  exit /b
)
echo === Avi-Bro: проверяю обновление игры... ===
if exist "%DIR%\server.py" (
  %PY% "%DIR%\server.py" --update
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference='Stop'; $t=Join-Path $env:TEMP 'avibro.zip'; $x=Join-Path $env:TEMP 'avibro-x';" ^
    "try { Invoke-WebRequest -UseBasicParsing '%ZIP%' -OutFile $t; if (Test-Path $x) { Remove-Item $x -Recurse -Force };" ^
    "Expand-Archive $t $x -Force; $top=Get-ChildItem $x | Select-Object -First 1;" ^
    "New-Item -ItemType Directory -Force '%DIR%' | Out-Null; Copy-Item (Join-Path $top.FullName '*') '%DIR%' -Recurse -Force; Write-Host '  игра скачана' }" ^
    "finally { Remove-Item $t, $x -Recurse -Force -ErrorAction SilentlyContinue }" ^
    || echo Не удалось скачать игру. Проверьте интернет.
)
if not exist "%DIR%\server.py" ( pause & exit /b )
rem ярлык в меню «Пуск» (один раз); со стола убираем, если остался от старой версии
if exist "%USERPROFILE%\Desktop\Avi-Bro server.lnk" del "%USERPROFILE%\Desktop\Avi-Bro server.lnk" >nul 2>nul
if not exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Avi-Bro server.lnk" powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Programs')+'\Avi-Bro server.lnk'); $s.TargetPath='%DIR%\start-server.bat'; $s.WorkingDirectory='%DIR%'; $s.Save()" 2>nul
rem открыть порт в брандмауэре один раз (сработает, если запущено от администратора)
netsh advfirewall firewall show rule name="Avi-Bro %PORT%" >nul 2>nul || netsh advfirewall firewall add rule name="Avi-Bro %PORT%" dir=in action=allow protocol=TCP localport=%PORT% >nul 2>nul
cd /d "%DIR%"
start "" "http://localhost:%PORT%"
echo Остановить сервер: кнопка «Остановить сервер» в игре или просто закройте это окно.
%PY% server.py %PORT%
pause
