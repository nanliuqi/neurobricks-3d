# NeuroBricks 3D — 神经网络三维构建工坊

在 3D 空间中拖拽积木搭建神经网络的桌面应用。通过直观的三维交互，将网络层以积木形式逐层堆叠，实时校验张量形状，一键启动 PyTorch 本地训练。

[截图：3D 搭建界面]

## 功能特性

- **3D 积木拖拽搭建** — 12 种层类型（Conv2D、Linear、ReLU、BatchNorm 等），8 个经典模型预设（LeNet-5、MLP 等）
- **实时形状校验** — 层间张量形状自动推导，不匹配时红色高亮 + 错误提示
- **内置数据集训练** — MNIST / CIFAR-10 开箱即用，支持自定义数据集导入
- **PyTorch 本地训练** — Python sidecar 进程，支持 CUDA GPU 加速
- **训练可视化** — Loss/Accuracy 实时曲线、训练日志、历史记录对比
- **训练动画反馈** — 数据流粒子动画 + epoch 完成积木闪光
- **模型导出** — 导出 PyTorch 模型权重文件
- **GPU 检测** — 自动检测 CUDA 设备，显示显存与算力信息
- **键盘快捷键** — Delete 删除层、Esc 取消选择、↑↓ 导航层
- **云端训练**（开发中）— SSH 连接远程服务器训练

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 框架 | Tauri v1 | 轻量桌面壳，Rust 后端 |
| 前端 | React 18 + TypeScript | UI 与状态管理 |
| 3D 渲染 | React Three Fiber + Three.js | 三维场景与积木渲染 |
| 状态管理 | Zustand | 轻量响应式 store |
| 构建工具 | Vite | 前端开发与构建 |
| 后端 | Rust | 进程管理、文件系统、事件桥接 |
| 训练引擎 | Python + PyTorch | sidecar 进程，CUDA 12.8 |
| 打包 | PyInstaller | Python sidecar 独立 exe |

## 安装

### 用户安装

从 Release 页面下载安装包：

- **NSIS 安装包**：`NeuroBricks 3D_x.x.x_x64-setup.exe`
- **MSI 安装包**：`NeuroBricks 3D_x.x.x_x64_en-US.msi`

安装后如需训练功能，将 Python sidecar 压缩包解压到安装目录的 `sidecars/nb-trainer/` 下。

### 开发环境

前置要求：

- Node.js 18+
- Rust toolchain（rustup）
- Python 3.10+（训练功能开发时需要）

```bash
# 克隆仓库
git clone https://github.com/your-username/neurobricks-3d.git
cd neurobricks-3d

# 安装前端依赖
npm install

# 启动开发模式（前端 + Tauri）
npm run tauri dev
```

## 使用指南

1. **添加层** — 从左侧层库拖拽积木到 3D 场景，或点击经典模型预设一键生成
2. **调整参数** — 选中积木，在右侧参数面板修改卷积核、通道数等参数
3. **检查形状** — 观察积木间的连接线，红色表示形状不匹配，需调整参数
4. **选择数据集** — 在数据集面板选择 MNIST 或 CIFAR-10
5. **开始训练** — 点击底部"开始训练"按钮，在训练监控面板查看实时曲线

[截图：训练监控面板]

## 项目结构

```
neurobricks-3d/
├── src/                    # 前端源码
│   ├── components/         # React 组件
│   │   ├── scene3d/        # 3D 场景（积木、粒子、连接线）
│   │   ├── panels/         # 侧边面板（参数、数据集、导出）
│   │   ├── training/       # 训练相关（监控、进度、快速训练）
│   │   └── layout/         # 布局（标题栏、主框架）
│   ├── stores/             # Zustand 状态管理
│   ├── types/              # TypeScript 类型定义
│   └── utils/              # 工具函数（形状推导、代码生成）
├── src-tauri/              # Tauri 后端
│   ├── src/commands/       # Rust 命令（训练、GPU、数据集）
│   └── sidecars/nb-trainer/# Python 训练 sidecar
├── dist/                   # 前端构建产物
└── package.json
```

## 开发计划

### v0.1.0（当前）

- [x] 3D 积木搭建与形状校验
- [x] 内置数据集 + PyTorch 本地训练
- [x] 训练可视化（曲线、日志、历史）
- [x] 模型导出
- [x] PyInstaller sidecar 打包
- [x] Windows 安装包（NSIS / MSI）

### 后续路线图

- [ ] 云端训练（SSH 远程服务器）
- [ ] 更多层类型（LSTM、Transformer、Embedding）
- [ ] 训练超参搜索
- [ ] 模型推理演示（输入图像 → 预测结果）
- [ ] macOS / Linux 支持

## License

[MIT](LICENSE)
