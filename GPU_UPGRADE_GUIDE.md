# PyTorch GPU 全消费级显卡支持升级指南

## 目标

支持所有 NVIDIA 消费级 GPU，包括最新的 RTX 50 系列（Blackwell 架构，sm_120）。

## 支持的 GPU 系列

- GTX 10 系列（Pascal, sm_60/61）
- GTX 16 系列（Turing, sm_75）
- RTX 20 系列（Turing, sm_75）
- RTX 30 系列（Ampere, sm_86）
- RTX 40 系列（Ada Lovelace, sm_89）
- **RTX 50 系列（Blackwell, sm_120）** ⭐ 新增

## 快速升级

### 方法 1：使用自动化脚本（推荐）

`powershell
.\\upgrade-pytorch.bat
` 

### 方法 2：手动执行

`powershell
C:\\Users\\64122\\anaconda3\\python.exe -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128 --upgrade
` 

## 验证安装

`powershell
.\\verify-gpu-support.bat
` 

期望输出：
` 
PyTorch Version: 2.7.x+cu128
CUDA Version: 12.8
CUDA Available: True
GPU Device: NVIDIA GeForce RTX 5070 Laptop GPU
Compute Capability: (12, 0)
Architecture List: ['sm_50', 'sm_60', ..., 'sm_120']
Supports sm_120 (RTX 50): True
` 

## 回滚方案

如果遇到问题，可以回滚到之前的版本：

`powershell
C:\\Users\\64122\\anaconda3\\python.exe -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu126 --force-reinstall
` 

## 技术细节

- **CUDA 版本**：12.8（支持 Blackwell 的最低版本）
- **PyTorch 版本**：2.7.0+（首个稳定支持 sm_120 的版本）
- **向后兼容**：新版本包含所有旧架构的 PTX/CUBIN，不影响老 GPU 使用
- **自动降级**：train.py 中的 safe_device() 会自动检测并降级到 CPU

## 常见问题

### Q: 我没有 NVIDIA GPU，需要升级吗？
A: 不需要。当前版本已支持 CPU 训练，升级仅对 NVIDIA GPU 用户有益。

### Q: 升级后 GTX 10 系列还能用吗？
A: 可以。新版本向后兼容所有从 sm_50 到 sm_120 的架构。

### Q: AMD 或 Intel 集显用户受影响吗？
A: 不受影响。safe_device() 会自动检测到 CUDA 不可用并使用 CPU。
