@echo off
echo ========================================
echo NeuroBricks 3D Python 依赖安装工具
echo ========================================
echo.

REM 检查 Python 是否安装
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Python，请先安装 Python 3.8+
    pause
    exit /b 1
)

echo [1/2] 升级 pip...
python -m pip install --upgrade pip

echo.
echo [2/2] 安装 PyTorch (CUDA 12.8) 和依赖...
cd /d "%~dp0"
C:\Users\64122\anaconda3\python.exe -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
if errorlevel 1 (
    echo [警告] CUDA 12.8 版本安装失败，尝试 CPU 版本...
    C:\Users\64122\anaconda3\python.exe -m pip install torch torchvision
)
C:\Users\64122\anaconda3\python.exe -m pip install numpy

if errorlevel 1 (
    echo.
    echo [错误] 依赖安装失败
    pause
    exit /b 1
)

echo.
echo ========================================
echo 安装完成！
echo ========================================
echo.
echo 验证安装...
python -c "import torch; print(f'PyTorch version: {torch.__version__}'); print(f'CUDA available: {torch.cuda.is_available()}')"

pause
