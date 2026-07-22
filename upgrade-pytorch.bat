@echo off
echo ========================================
echo  PyTorch GPU Support Upgrade
echo ========================================

echo Upgrading PyTorch to support RTX 50 series (Blackwell, sm_120)...
echo.

C:\Users\64122\anaconda3\python.exe -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128 --upgrade

echo.
echo Verification:
C:\Users\64122\anaconda3\python.exe -c "import torch; print('PyTorch:', torch.__version__); print('CUDA:', torch.version.cuda); print('Arch list:', torch.cuda.get_arch_list())"

echo.
pause
