@echo off
echo ========================================
echo  NeuroBricks Trainer - PyInstaller Build
echo ========================================

REM ?? Anaconda Python
set PYTHON=C:\Users\64122\anaconda3\python.exe

REM ?? PyInstaller??????
%PYTHON% -m pip install pyinstaller --quiet

REM ??? onedir ??????????? onefile ??
%PYTHON% -m PyInstaller ^
    --noconfirm ^
    --clean ^
    --name nb-trainer ^
    --distpath ../dist ^
    --workpath ../build ^
    --add-data "models.py;." ^
    --add-data "train.py;." ^
    --hidden-import torch ^
    --hidden-import torchvision ^
    --hidden-import torchvision.datasets ^
    --collect-submodules torch.nn ^
    --collect-submodules torchvision ^
    main.py

echo.
echo Build complete! Output: src-tauri/sidecars/dist/nb-trainer/
echo.
pause
