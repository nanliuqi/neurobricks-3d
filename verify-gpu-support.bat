@echo off
echo ========================================
echo  PyTorch GPU Support Verification
echo ========================================

C:\Users\64122\anaconda3\python.exe -c "import torch; print('PyTorch Version:', torch.__version__); print('CUDA Version:', torch.version.cuda); print('CUDA Available:', torch.cuda.is_available()); if torch.cuda.is_available(): print('GPU Device:', torch.cuda.get_device_name(0)); print('Compute Capability:', torch.cuda.get_device_capability(0)); print('Architecture List:', torch.cuda.get_arch_list()); print('Supports sm_120 (RTX 50):', 'sm_120' in torch.cuda.get_arch_list()) else: print('No GPU detected')"

echo.
pause
