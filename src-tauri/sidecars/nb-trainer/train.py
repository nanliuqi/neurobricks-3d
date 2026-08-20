import sys
import json
import os
import torch
import torch.nn as nn
import torch.optim as optim
import threading
from torchvision import datasets, transforms

class TrainingController:
    """训练控制器，支持暂停/恢复/停止"""
    
    def __init__(self):
        self.is_paused = False
        self.should_stop = False
        self.pause_lock = threading.Lock()
        self.pause_condition = threading.Condition(self.pause_lock)
    
    def pause(self):
        """暂停训练"""
        with self.pause_lock:
            self.is_paused = True
    
    def resume(self):
        """恢复训练"""
        with self.pause_lock:
            self.is_paused = False
            self.pause_condition.notify_all()
    
    def stop(self):
        """停止训练"""
        self.should_stop = True
        self.resume()  # 确保不在暂停状态
    
    def wait_if_paused(self):
        """如果暂停则等待"""
        with self.pause_condition:
            while self.is_paused and not self.should_stop:
                self.pause_condition.wait()

def log_message(msg_type, **kwargs):
    """向 stdout 输出 JSON 行并 flush"""
    msg = {"type": msg_type, **kwargs}
    print(json.dumps(msg), flush=True)

def safe_device(device_name):
    """安全选择设备：如果 CUDA 不兼容则自动降级到 CPU"""
    if device_name == 'cuda' or device_name.startswith('cuda:'):
        if not torch.cuda.is_available():
            log_message("log", level="warning", message="CUDA not available, falling back to CPU")
            return torch.device('cpu')
        try:
            test = torch.zeros(1, device='cuda')
            del test
            return torch.device(device_name)
        except RuntimeError as e:
            log_message("log", level="warning", message=f"CUDA incompatible ({e}), falling back to CPU")
            return torch.device('cpu')
    return torch.device(device_name)

# --- 数据集目录管理 ---

# sidecar 本地 data/ 目录（内置数据集，随程序分发）
# 打包后 __file__ 指向 exe 目录，data/ 可能在工作目录（Rust 设置的 current_dir）
_script_dir = os.path.dirname(os.path.abspath(__file__))
LOCAL_DATA_DIR = os.path.join(_script_dir, 'data')
if not os.path.isdir(LOCAL_DATA_DIR):
    _cwd_data = os.path.join(os.getcwd(), 'data')
    if os.path.isdir(_cwd_data):
        LOCAL_DATA_DIR = _cwd_data
# 用户缓存目录（自动下载的数据集）
CACHE_DATA_DIR = os.path.join(os.path.expanduser('~'), '.neurobricks', 'data')

DATASET_DIRS = {
    'mnist': 'MNIST',
    'cifar10': 'cifar-10-batches-py',
}

def resolve_data_dir(dataset_name):
    """解析数据目录：优先内置，其次缓存"""
    subdir = DATASET_DIRS.get(dataset_name)
    
    if subdir and os.path.exists(os.path.join(LOCAL_DATA_DIR, subdir)):
        log_message("log", level="info", message=f"Using built-in dataset from {LOCAL_DATA_DIR}")
        return LOCAL_DATA_DIR
    
    log_message("log", level="info", message=f"Using cached dataset from {CACHE_DATA_DIR}")
    return CACHE_DATA_DIR

def builtin_dataset(dataset_name, data_dir):
    """下载成功后，自动将数据集复制到 sidecar 本地 data/ 目录（内置化）
    这样下次加载秒开，且打包后随程序一起分发"""
    subdir = DATASET_DIRS.get(dataset_name)
    if not subdir:
        return
    
    src = os.path.join(data_dir, subdir)
    dst = os.path.join(LOCAL_DATA_DIR, subdir)
    
    # 已经内置了就跳过
    if os.path.exists(dst):
        return
    # 源目录不存在就跳过
    if not os.path.exists(src):
        return
    
    try:
        import shutil
        os.makedirs(LOCAL_DATA_DIR, exist_ok=True)
        shutil.copytree(src, dst)
        log_message("log", level="info", message=f"Dataset '{dataset_name}' built-in to {dst}")
    except Exception as e:
        # 内置化失败不影响训练，只是下次还得从缓存读
        log_message("log", level="warning", message=f"Failed to builtin dataset: {e}")

def get_dataset(dataset_name, batch_size, data_dir, config=None):
    """加载数据集，data_dir 为数据目录"""
    log_message("log", level="info", message=f"Loading dataset '{dataset_name}'...")
    
    try:
        if dataset_name == 'mnist':
            os.makedirs(data_dir, exist_ok=True)
            transform = transforms.Compose([
                transforms.ToTensor(),
                transforms.Normalize((0.1307,), (0.3081,))
            ])
            train_dataset = datasets.MNIST(data_dir, train=True, download=True, transform=transform)
            test_dataset = datasets.MNIST(data_dir, train=False, transform=transform)
            # 下载成功后自动内置化（复制到 sidecar/data/）
            builtin_dataset(dataset_name, data_dir)
        elif dataset_name == 'cifar10':
            os.makedirs(data_dir, exist_ok=True)
            transform = transforms.Compose([
                transforms.ToTensor(),
                transforms.Normalize((0.4914, 0.4822, 0.4465), (0.2470, 0.2435, 0.2616))
            ])
            train_dataset = datasets.CIFAR10(data_dir, train=True, download=True, transform=transform)
            test_dataset = datasets.CIFAR10(data_dir, train=False, transform=transform)
            builtin_dataset(dataset_name, data_dir)
        elif dataset_name == 'local_image':
            # 自定义图像文件夹（ImageFolder 格式：子文件夹名=类别名）
            data_path = config.get('dataPath', '') if config else ''
            if not data_path or not os.path.isdir(data_path):
                log_message("error", message=f"本地图像目录不存在: {data_path}")
                return None, None
            
            # 从 config 获取目标尺寸（从 Input 层推导）
            input_shape = config.get('inputShape', None) if config else None
            if input_shape and len(input_shape) >= 3:
                target_channels = input_shape[0]
                target_h = input_shape[1]
                target_w = input_shape[2]
            else:
                target_channels = 3
                target_h = 224
                target_w = 224
            
            # 构建 transform
            if target_channels == 1:
                transform = transforms.Compose([
                    transforms.Resize((target_h, target_w)),
                    transforms.Grayscale(num_output_channels=1),
                    transforms.ToTensor(),
                    transforms.Normalize((0.5,), (0.5,))
                ])
            else:
                transform = transforms.Compose([
                    transforms.Resize((target_h, target_w)),
                    transforms.ToTensor(),
                    transforms.Normalize((0.485, 0.456, 0.406), (0.229, 0.224, 0.225))
                ])
            
            # 使用 ImageFolder 加载
            full_dataset = datasets.ImageFolder(data_path, transform=transform)
            
            # 按 train_ratio 划分训练/验证集
            train_ratio = config.get('trainRatio', 0.8) if config else 0.8
            train_size = int(train_ratio * len(full_dataset))
            test_size = len(full_dataset) - train_size
            train_dataset, test_dataset = torch.utils.data.random_split(
                full_dataset, [train_size, test_size]
            )
            
            log_message("log", level="info", 
                message=f"Local image dataset loaded: {len(full_dataset)} samples, {len(full_dataset.classes)} classes")
        
        elif dataset_name == 'csv':
            # CSV 文件（最后一列为标签，其余为特征）
            import pandas as pd
            data_path = config.get('dataPath', '') if config else ''
            if not data_path or not os.path.isfile(data_path):
                log_message("error", message=f"CSV 文件不存在: {data_path}")
                return None, None
            
            df = pd.read_csv(data_path)
            features = df.iloc[:, :-1].values.astype('float32')
            labels = df.iloc[:, -1].values.astype('int64')
            
            # 归一化特征
            from sklearn.preprocessing import StandardScaler
            scaler = StandardScaler()
            features = scaler.fit_transform(features)
            
            # 构建 TensorDataset
            tensor_features = torch.FloatTensor(features)
            tensor_labels = torch.LongTensor(labels)
            full_dataset = torch.utils.data.TensorDataset(tensor_features, tensor_labels)
            
            train_ratio = config.get('trainRatio', 0.8) if config else 0.8
            train_size = int(train_ratio * len(full_dataset))
            test_size = len(full_dataset) - train_size
            train_dataset, test_dataset = torch.utils.data.random_split(
                full_dataset, [train_size, test_size]
            )
            
            log_message("log", level="info", 
                message=f"CSV dataset loaded: {len(full_dataset)} samples, {features.shape[1]} features")
        
        else:
            log_message("error", message=f"Unsupported dataset: {dataset_name}")
            return None, None
        
        log_message("log", level="info", message=f"Dataset '{dataset_name}' loaded successfully")
    except Exception as e:
        log_message("error", message=f"Failed to load dataset '{dataset_name}': {str(e)}")
        return None, None
    
    # GPU 时启用 pin_memory 加速数据传输
    # num_workers 必须为 0：Windows GUI 应用（无控制台）下 DataLoader 的 spawn 多进程会挂起
    pin_memory = torch.cuda.is_available()
    train_loader = torch.utils.data.DataLoader(
        train_dataset, batch_size=batch_size, shuffle=True,
        num_workers=0, pin_memory=pin_memory, drop_last=False
    )
    test_loader = torch.utils.data.DataLoader(
        test_dataset, batch_size=batch_size, shuffle=False,
        num_workers=0, pin_memory=pin_memory, drop_last=False
    )
    return train_loader, test_loader

def listen_commands(controller):
    """在独立线程中监听 stdin 命令"""
    try:
        while True:
            line = sys.stdin.readline()
            if not line:
                break
            line = line.strip()
            if not line:
                continue
            
            try:
                command = json.loads(line)
                cmd_type = command.get("type")
                
                if cmd_type == "pause":
                    controller.pause()
                    log_message("log", level="info", message="Training paused")
                elif cmd_type == "resume":
                    controller.resume()
                    log_message("log", level="info", message="Training resumed")
                elif cmd_type == "stop":
                    controller.stop()
                    log_message("log", level="info", message="Training stopping...")
                    break
            except json.JSONDecodeError:
                continue
    except Exception as e:
        log_message("log", level="warning", message=f"Command listener error: {str(e)}")

def validate_model(model, input_shape, device):
    """用假数据测试模型是否能跑通，避免训练时才崩溃"""
    try:
        dummy = torch.zeros(1, *input_shape, device=device)
        output = model(dummy)
        log_message("log", level="info", 
            message=f"Model validation OK: input {list(input_shape)} -> output {list(output.shape)}")
        return True
    except RuntimeError as e:
        error_str = str(e)
        # 尝试从错误信息中提取有用的线索
        hint = ""
        if "size mismatch" in error_str.lower() or "mat1 and mat2" in error_str.lower():
            hint = "提示：这通常是因为 Linear 层的 inFeatures 与前一层的输出不匹配。建议：1) 检查 Input 层是否已适配当前数据集；2) 在 Linear 层前确保有 Flatten；3) 手动计算前面卷积/池化层输出的特征数，更新 Linear 的 inFeatures。"
        elif "expected input" in error_str.lower() and "channels" in error_str.lower():
            hint = "提示：卷积层的 inChannels 与前一层的 outChannels 不匹配。请检查相邻 Conv2D 层的通道数是否对应。"
        elif "negative" in error_str.lower() or "zero" in error_str.lower():
            hint = "提示：特征图尺寸缩小到 0 或负数。可能池化层太多或卷积核太大。尝试减少池化层、增大 padding 或减小 kernel size。"
        else:
            hint = "建议检查网络结构：1) Input 层尺寸是否与数据集匹配；2) Linear 前是否有 Flatten；3) 相邻层的通道/特征数是否对应。"

        log_message("error", 
            message=f"模型形状不匹配：{e}\n\n{hint}")
        return False

def train(model_and_shape, config):
    model, input_shape = model_and_shape
    epochs = config.get('epochs', 10)
    learning_rate = config.get('learningRate', 0.001)
    batch_size = config.get('batchSize', 32)
    dataset_name = config.get('dataset', 'mnist')
    device_name = config.get('device', 'cuda')
    
    # 安全选择设备（CUDA 不兼容时自动降级 CPU）
    device = safe_device(device_name)
    model = model.to(device)
    
    log_message("log", level="info", message=f"Training on {device}")
    
    # 验证模型形状（用假数据前向传播）
    if input_shape:
        if not validate_model(model, input_shape, device):
            return  # 验证失败，错误信息已发送
    else:
        log_message("log", level="warning", message="No Input layer shape specified, skipping validation")
    
    # 将 input_shape 注入 config，供 get_dataset 使用
    if input_shape:
        config['inputShape'] = list(input_shape)
    
    # 内置数据集用 resolve_data_dir，自定义数据集从 config 读路径
    if dataset_name in ('mnist', 'cifar10'):
        data_dir = resolve_data_dir(dataset_name)
    else:
        data_dir = config.get('dataPath', '.') or '.'
    
    train_loader, test_loader = get_dataset(dataset_name, batch_size, data_dir, config)
    if train_loader is None:
        return
    
    # 创建训练控制器
    controller = TrainingController()
    
    # 启动命令监听线程
    command_thread = threading.Thread(target=listen_commands, args=(controller,), daemon=True)
    command_thread.start()
    
    criterion = nn.CrossEntropyLoss()
    
    # 优化器选择（支持 SGD/Adam/AdamW）
    optimizer_name = config.get('optimizer', 'adam').lower()
    weight_decay = config.get('weightDecay', 0.0)
    
    if optimizer_name == 'sgd':
        optimizer = optim.SGD(model.parameters(), lr=learning_rate, weight_decay=weight_decay)
    elif optimizer_name == 'adamw':
        optimizer = optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=weight_decay)
    else:  # adam (default)
        optimizer = optim.Adam(model.parameters(), lr=learning_rate, weight_decay=weight_decay)
    
    log_message("log", level="info", message=f"Optimizer: {optimizer_name.upper()}, lr={learning_rate}, weight_decay={weight_decay}")
    
    step = 0
    val_correct = 0
    val_total = 1  # 避免除零
    
    for epoch in range(1, epochs + 1):
        if controller.should_stop:
            log_message("log", level="info", message="Training stopped by user")
            break
        
        controller.wait_if_paused()
        
        if controller.should_stop:
            break
        
        model.train()
        running_loss = 0.0
        correct = 0
        total = 0
        
        for batch_idx, (data, target) in enumerate(train_loader):
            if controller.should_stop:
                break
            
            controller.wait_if_paused()
            
            if controller.should_stop:
                break
            
            data, target = data.to(device, non_blocking=True), target.to(device, non_blocking=True)
            optimizer.zero_grad()
            output = model(data)
            loss = criterion(output, target)
            loss.backward()
            optimizer.step()
            
            running_loss += loss.item()
            _, predicted = output.max(1)
            total += target.size(0)
            correct += predicted.eq(target).sum().item()
            step += 1
            
            if batch_idx % 10 == 0:
                log_message("progress",
                    epoch=epoch,
                    step=step,
                    loss=round(loss.item(), 4),
                    accuracy=round(correct / total, 4)
                )
        
        # Epoch 结束，验证
        model.eval()
        val_correct = 0
        val_total = 0
        val_loss = 0.0
        with torch.no_grad():
            for data, target in test_loader:
                data, target = data.to(device, non_blocking=True), target.to(device, non_blocking=True)
                output = model(data)
                val_loss += criterion(output, target).item()
                _, predicted = output.max(1)
                val_total += target.size(0)
                val_correct += predicted.eq(target).sum().item()
        
        val_accuracy = val_correct / max(val_total, 1)
        log_message("epoch_end",
            epoch=epoch,
            trainLoss=round(running_loss / max(len(train_loader), 1), 4),
            valAccuracy=round(val_accuracy, 4)
        )
    
    # 训练完成
    if not controller.should_stop:
        final_accuracy = val_correct / max(val_total, 1)
        # 注意：done 消息延迟到权重全部保存完成后再发出，
        # 避免前端收到 done 立即生成推理卡片时权重文件尚未写盘

        # 保存模型：优先用户目录（打包后 sidecar 目录可能只读）
        user_weights_dir = os.path.join(os.path.expanduser('~'), '.neurobricks')
        os.makedirs(user_weights_dir, exist_ok=True)

        # 1. state_dict（仅权重）
        weights_path = os.path.join(user_weights_dir, 'model_weights.pth')
        try:
            torch.save(model.state_dict(), weights_path)
        except (PermissionError, OSError):
            # fallback: sidecar 目录
            weights_path = os.path.join(os.path.dirname(__file__), 'model_weights.pth')
            torch.save(model.state_dict(), weights_path)
        log_message("log", level="info", message=f"Model weights saved to {weights_path}")

        # 1b. 按 modelId 另存独立权重（多模型卡片化推理用）
        model_id = config.get('modelId') or config.get('model_id') or ''
        if model_id:
            try:
                models_dir = os.path.join(user_weights_dir, 'models')
                os.makedirs(models_dir, exist_ok=True)
                per_model_path = os.path.join(models_dir, f'{model_id}.pth')
                torch.save(model.state_dict(), per_model_path)
                log_message("log", level="info", message=f"Per-model weights saved to {per_model_path}")
            except (PermissionError, OSError) as e:
                log_message("log", level="warning", message=f"Failed to save per-model weights: {e}")

        # 2. 完整模型（结构+权重）
        full_model_path = os.path.join(user_weights_dir, 'model_full.pt')
        try:
            torch.save(model, full_model_path)
        except (PermissionError, OSError):
            full_model_path = os.path.join(os.path.dirname(__file__), 'model_full.pt')
            torch.save(model, full_model_path)
        log_message("log", level="info", message=f"Full model saved to {full_model_path}")

        # 3. NumPy 权重（不依赖 PyTorch）
        npz_path = os.path.join(user_weights_dir, 'model_weights.npz')
        try:
            import numpy as np
            np_weights = {}
            for name, param in model.state_dict().items():
                np_weights[name] = param.cpu().numpy()
            np.savez(npz_path, **np_weights)
        except Exception as e:
            log_message("log", level="warning", message=f"Failed to save NumPy weights: {e}")
        else:
            log_message("log", level="info", message=f"NumPy weights saved to {npz_path}")

        # 所有权重的保存完成后才发出 done，确保前端生成推理卡片时权重已就绪
        log_message("done", finalAccuracy=round(final_accuracy, 4))
