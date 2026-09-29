@echo off
chcp 65001 >nul
rem Avi-Bro: скачать последнюю версию игры и запустить сервер для игры вдвоём (Windows).
rem Нужен Python 3. Если его нет, скрипт предложит установить.
setlocal
set "DIR=%USERPROFILE%\avi-bro-server"
set PORT=8080
set "ZIP=https://github.com/Assinross/Avi-Bro/archive/refs/heads/main.zip"
echo === Avi-Bro: скачиваю последнюю версию игры... ===
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop'; $t=Join-Path $env:TEMP 'avibro.zip'; $x=Join-Path $env:TEMP 'avibro-x';" ^
  "Invoke-WebRequest -UseBasicParsing '%ZIP%' -OutFile $t; if (Test-Path $x) { Remove-Item $x -Recurse -Force };" ^
  "Expand-Archive $t $x -Force; $top=Get-ChildItem $x | Select-Object -First 1;" ^
  "New-Item -ItemType Directory -Force '%DIR%' | Out-Null; Copy-Item (Join-Path $top.FullName '*') '%DIR%' -Recurse -Force; Write-Host '  обновлено'" ^
  || echo Не удалось скачать обновление — запускаю версию, что уже есть.
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
rem ярлык на рабочем столе (один раз)
if not exist "%USERPROFILE%\Desktop\Avi-Bro server.lnk" powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Avi-Bro server.lnk'); $s.TargetPath='%DIR%\start-server.bat'; $s.WorkingDirectory='%DIR%'; $s.Save()" 2>nul
rem открыть порт в брандмауэре (сработает, если запущено от администратора)
netsh advfirewall firewall add rule name="Avi-Bro %PORT%" dir=in action=allow protocol=TCP localport=%PORT% >nul 2>nul
cd /d "%DIR%"
start "" "http://localhost:%PORT%"
%PY% server.py %PORT%
pause
