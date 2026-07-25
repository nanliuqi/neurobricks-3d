@echo off
echo ========================================
echo  NeuroBricks Trainer - PyInstaller Build
echo ========================================

REM 使用干净 venv 环境打包（避免拉入 Anaconda 全量包）
set VENV_DIR=.venv
set PYTHON=%VENV_DIR%\Scripts\python.exe

REM 创建 venv（如果不存在）
if not exist "%PYTHON%" (
    echo Creating clean venv...
    C:\Users\64122\anaconda3\python.exe -m venv %VENV_DIR% --clear
    echo Installing torch + torchvision (CPU-only)...
    %VENV_DIR%\Scripts\pip.exe install torch torchvision --index-url https://download.pytorch.org/whl/cpu
)

REM 安装 PyInstaller（如果没有）
echo Checking PyInstaller...
%VENV_DIR%\Scripts\pip.exe install pyinstaller --quiet

REM 打包为 onedir 模式（启动更快，体积比 onefile 小）
echo Building nb-trainer...
%PYTHON% -m PyInstaller ^
    --noconfirm ^
    --clean ^
    --name nb-trainer ^
    --distpath ../dist ^
    --workpath ../build ^
    --add-data "models.py;." ^
    --add-data "train.py;." ^
    --add-data "predict.py;." ^
    --hidden-import torch ^
    --hidden-import torchvision ^
    --hidden-import torchvision.datasets ^
    --hidden-import PIL ^
    --collect-submodules torch.nn ^
    --collect-submodules torchvision ^
    main.py

echo.
if exist "..\dist\nb-trainer\nb-trainer.exe" (
    echo Build complete! Output: src-tauri/sidecars/dist/nb-trainer/nb-trainer.exe
) else (
    echo Build FAILED! Check errors above.
)
echo.
pause
