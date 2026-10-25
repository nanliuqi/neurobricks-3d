import sys
import json
import os
import hashlib
import platform
import math
import time
import torch
import torch.nn as nn
import torch.optim as optim
import threading
from torchvision import datasets, transforms
from protocol import TrainerError, log_message, renew_heartbeat

LOCAL_IMAGE_PARENT_GROUP_FIELD = '__image_parent_directory__'

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
        import time
        with self.pause_condition:
            while self.is_paused and not self.should_stop:
                # 暂停期间每 5s 发心跳：看门狗不把暂停误判为挂起
                renew_heartbeat()
                log_message("heartbeat", paused=True)
                self.pause_condition.wait(timeout=5.0)

def build_optimizer(model, learning_rate, optimizer_name='adam', weight_decay=0.0, momentum=0.9):
    """构建优化器：adam / adamw / sgd(+momentum)
    独立成函数便于单元测试与配置回显"""
    optimizer_name = (optimizer_name or 'adam').lower()
    if optimizer_name == 'sgd':
        return optim.SGD(model.parameters(), lr=learning_rate, momentum=momentum, weight_decay=weight_decay)
    elif optimizer_name == 'adamw':
        return optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=weight_decay)
    else:  # adam (default)
        return optim.Adam(model.parameters(), lr=learning_rate, weight_decay=weight_decay)

def build_scheduler(optimizer, scheduler_name='none', epochs=10):
    """构建学习率调度器：none / multistep / cosine
    - multistep: 在 epochs//3 与 epochs*2//3 处 lr×0.1
    - cosine: T_max=epochs 余弦退火
    返回 None 表示不用调度器"""
    scheduler_name = (scheduler_name or 'none').lower()
    if scheduler_name == 'multistep':
        milestones = sorted({max(1, epochs // 3), max(2, epochs * 2 // 3)})
        # milestones 必须严格递增且 < epochs 才有意义；epochs<=2 时退化为 none
        milestones = [m for m in milestones if m < epochs]
        if not milestones:
            return None
        return optim.lr_scheduler.MultiStepLR(optimizer, milestones=milestones, gamma=0.1)
    elif scheduler_name == 'cosine':
        if epochs < 2:
            return None
        return optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)
    return None

def safe_device(device_name):
    """选择已见证的执行设备；绝不静默改变 Attempt 的设备语义。"""
    if device_name == 'cuda' or device_name.startswith('cuda:'):
        if not torch.cuda.is_available():
            raise RuntimeError('CUDA was selected but is no longer available; refresh runtime detection and choose CPU')
        device = torch.device(device_name)
        try:
            test = torch.zeros(1, device=device)
            del test
            return device
        except RuntimeError as error:
            raise RuntimeError(f'CUDA device cannot execute this Attempt: {error}') from error
    if device_name != 'cpu':
        raise ValueError(f'Unsupported training device: {device_name}')
    return torch.device('cpu')


def runtime_capabilities():
    """返回训练器自身的真实能力；硬件枚举不能替代这一步。"""
    issues = []
    image_available = True
    csv_available = True

    try:
        # CPU is the mandatory fallback on machines without a compatible GPU.
        cpu_probe = torch.zeros(1, device='cpu')
        del cpu_probe
        import numpy as _numpy  # noqa: F401
        import torchvision as _torchvision  # noqa: F401
    except Exception as error:
        image_available = False
        issues.append(f'image classification dependencies unavailable: {type(error).__name__}: {error}')

    try:
        import pandas as _pandas
        # Import success alone is insufficient for frozen builds: exercise the
        # exact DataFrame -> float32 NumPy bridge used by CSV regression.
        _pandas.DataFrame({'feature': [1.0]}).to_numpy(dtype='float32')
    except Exception as error:
        csv_available = False
        issues.append(f'CSV regression dependency unavailable: {type(error).__name__}: {error}')

    cuda_available = False
    cuda_device_name = None
    if torch.cuda.is_available():
        try:
            probe = torch.zeros(1, device='cuda')
            del probe
            cuda_available = True
            cuda_device_name = torch.cuda.get_device_name(0)
        except Exception as error:
            issues.append(f'CUDA runtime unavailable: {type(error).__name__}: {error}')
    elif torch.version.cuda:
        issues.append('CUDA build present but no compatible NVIDIA driver/device is available')
    else:
        issues.append('bundled PyTorch is CPU-only')

    return {
        'available': image_available,
        'pythonVersion': platform.python_version(),
        'torchVersion': str(torch.__version__),
        'cudaBuildVersion': str(torch.version.cuda) if torch.version.cuda else None,
        'cudaAvailable': cuda_available,
        'cudaDeviceName': cuda_device_name,
        'imageClassificationAvailable': image_available,
        'csvRegressionAvailable': csv_available,
        'issues': issues,
    }

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

def _random_indices(total, seed):
    generator = torch.Generator().manual_seed(seed if seed is not None else 0)
    return torch.randperm(total, generator=generator).tolist()


def _partition_indices(total, test_ratio, val_ratio, seed, strategy='random', groups=None, times=None):
    if total < 3:
        raise ValueError('数据集至少需要 3 个样本才能建立 train/validation/test 契约')
    if strategy == 'group':
        if groups is None:
            raise ValueError('group 切分缺少 groupField 数据')
        unique_groups = list(dict.fromkeys(str(value) for value in groups))
        if len(unique_groups) < 3:
            raise ValueError('group 切分至少需要 3 个不同分组')
        order = _random_indices(len(unique_groups), seed)
        shuffled_groups = [unique_groups[index] for index in order]
        test_group_count = max(1, int(round(len(shuffled_groups) * test_ratio)))
        remaining_groups = shuffled_groups[:-test_group_count]
        test_groups = set(shuffled_groups[-test_group_count:])
        val_group_count = max(1, int(round(len(remaining_groups) * val_ratio))) if val_ratio > 0 else 0
        val_groups = set(remaining_groups[-val_group_count:]) if val_group_count else set()
        train_groups = set(remaining_groups[:-val_group_count] if val_group_count else remaining_groups)
        train = [i for i, value in enumerate(groups) if str(value) in train_groups]
        val = [i for i, value in enumerate(groups) if str(value) in val_groups]
        test = [i for i, value in enumerate(groups) if str(value) in test_groups]
    elif strategy == 'temporal':
        if times is None:
            raise ValueError('temporal 切分缺少 timeField 数据')
        ordered = sorted(range(total), key=lambda index: times[index])
        test_count = max(1, int(round(total * test_ratio)))
        remaining = ordered[:-test_count]
        test = ordered[-test_count:]
        val_count = max(1, int(round(len(remaining) * val_ratio))) if val_ratio > 0 else 0
        train = remaining[:-val_count] if val_count else remaining
        val = remaining[-val_count:] if val_count else []
    else:
        ordered = _random_indices(total, seed)
        test_count = max(1, int(round(total * test_ratio)))
        remaining = ordered[:-test_count]
        test = ordered[-test_count:]
        val_count = max(1, int(round(len(remaining) * val_ratio))) if val_ratio > 0 else 0
        train = remaining[:-val_count] if val_count else remaining
        val = remaining[-val_count:] if val_count else []
    if not train or not test or (val_ratio > 0 and not val):
        raise ValueError('当前切分配置产生了空集合，请调整比例或补充数据')
    return train, val, test


def _partition_stratified(labels, test_ratio, val_ratio, seed):
    """Deterministic three-way split that preserves every observed class."""
    by_class = {}
    for index, label in enumerate(labels):
        by_class.setdefault(int(label), []).append(index)
    required_per_class = 1 + (1 if test_ratio > 0 else 0) + (1 if val_ratio > 0 else 0)
    insufficient = [
        f'{label}={len(indices)}'
        for label, indices in sorted(by_class.items())
        if len(indices) < required_per_class
    ]
    if insufficient:
        raise TrainerError(
            'STRATIFIED_SPLIT_IMPOSSIBLE',
            f'分层切分要求每类至少 {required_per_class} 个样本；当前 ' + '、'.join(insufficient),
            {'requiredPerClass': required_per_class, 'classCounts': {str(k): len(v) for k, v in by_class.items()}},
        )

    partitions = {'train': [], 'validation': [], 'test': []}
    base_seed = seed if isinstance(seed, int) else 0
    for class_offset, (_label, indices) in enumerate(sorted(by_class.items())):
        order = _random_indices(len(indices), base_seed + class_offset * 1009)
        shuffled = [indices[position] for position in order]
        test_count = max(1, int(round(len(shuffled) * test_ratio))) if test_ratio > 0 else 0
        test_count = min(test_count, len(shuffled) - (2 if val_ratio > 0 else 1)) if test_count else 0
        remaining = shuffled[:-test_count] if test_count else shuffled
        validation_count = max(1, int(round(len(remaining) * val_ratio))) if val_ratio > 0 else 0
        validation_count = min(validation_count, len(remaining) - 1)
        partitions['test'].extend(shuffled[-test_count:] if test_count else [])
        partitions['validation'].extend(remaining[-validation_count:] if validation_count else [])
        partitions['train'].extend(remaining[:-validation_count] if validation_count else remaining)

    for offset, name in enumerate(('train', 'validation', 'test')):
        values = partitions[name]
        order = _random_indices(len(values), base_seed + 50_000 + offset) if values else []
        partitions[name] = [values[position] for position in order]
    return partitions['train'], partitions['validation'], partitions['test']


def _local_image_parent_groups(samples, data_path):
    """从 ImageFolder 的 class/group/.../file 结构提取跨类别共享的 group 身份。"""
    groups = []
    missing = []
    for path, _label in samples:
        relative = os.path.normpath(os.path.relpath(path, data_path))
        parts = relative.split(os.sep)
        if len(parts) < 3:
            missing.append(relative.replace('\\', '/'))
            continue
        groups.append(parts[1])
    if missing:
        preview = '、'.join(missing[:3])
        suffix = ' 等' if len(missing) > 3 else ''
        raise ValueError(
            f'group 切分要求每张图片位于“类别/分组/文件”结构中；'
            f'有 {len(missing)} 张缺少分组目录：{preview}{suffix}'
        )
    return groups


def _partition_grouped_classification(groups, labels, test_ratio, val_ratio, seed):
    """按完整 group 分配，并保证 train/validation/test 都包含每个类别。

    先为每个集合选择覆盖全类别的最小组集合，再按目标样本比例分配剩余组。
    group 粒度较粗时实际比例允许偏离请求比例，但绝不拆组或产出缺类别的评估集。
    """
    group_to_indices = {}
    group_to_labels = {}
    for index, (group, label) in enumerate(zip(groups, labels)):
        key = str(group)
        group_to_indices.setdefault(key, []).append(index)
        group_to_labels.setdefault(key, set()).add(int(label))

    all_labels = set(int(label) for label in labels)
    split_names = ['test']
    if val_ratio > 0:
        split_names.append('validation')
    split_names.append('train')
    required_group_count = len(split_names)
    groups_per_label = {
        label: sum(1 for values in group_to_labels.values() if label in values)
        for label in all_labels
    }
    insufficient = [
        f'{label}={count}组'
        for label, count in sorted(groups_per_label.items())
        if count < required_group_count
    ]
    if insufficient:
        raise ValueError(
            f'group 切分无法形成包含全部类别的 {required_group_count} 路隔离集合：'
            f'每类至少需要 {required_group_count} 个独立组，当前 ' + '、'.join(insufficient)
        )

    total = len(groups)
    test_target = total * test_ratio
    validation_target = (total - test_target) * val_ratio if val_ratio > 0 else 0
    targets = {
        'test': test_target,
        'validation': validation_target,
        'train': total - test_target - validation_target,
    }
    unique_groups = list(group_to_indices)

    # 改变 seed 只改变并列候选的稳定次序；最多尝试 128 个确定性次序来避开贪心死角。
    base_seed = seed if isinstance(seed, int) else 0
    for trial in range(128):
        shuffled = [unique_groups[index] for index in _random_indices(len(unique_groups), base_seed + trial)]
        rank = {group: index for index, group in enumerate(shuffled)}
        unassigned = set(unique_groups)
        assigned = {name: [] for name in split_names}
        feasible = True

        for split_index, split_name in enumerate(split_names):
            missing_labels = set(all_labels)
            future_split_count = len(split_names) - split_index - 1
            while missing_labels:
                candidates = []
                for group in unassigned:
                    covered = missing_labels.intersection(group_to_labels[group])
                    if not covered:
                        continue
                    remaining = unassigned.difference({group})
                    preserves_future = all(
                        sum(1 for other in remaining if label in group_to_labels[other]) >= future_split_count
                        for label in all_labels
                    )
                    if not preserves_future:
                        continue
                    current_size = sum(len(group_to_indices[value]) for value in assigned[split_name])
                    after_size = current_size + len(group_to_indices[group])
                    candidates.append((
                        -len(covered),
                        abs(targets[split_name] - after_size),
                        rank[group],
                        group,
                    ))
                if not candidates:
                    feasible = False
                    break
                chosen = min(candidates)[-1]
                assigned[split_name].append(chosen)
                unassigned.remove(chosen)
                missing_labels.difference_update(group_to_labels[chosen])
            if not feasible:
                break

        if not feasible:
            continue

        for group in sorted(unassigned, key=lambda value: rank[value]):
            def deficit(split_name):
                current = sum(len(group_to_indices[value]) for value in assigned[split_name])
                target = max(targets[split_name], 1.0)
                return (targets[split_name] - current) / target
            destination = max(split_names, key=lambda name: (deficit(name), -split_names.index(name)))
            assigned[destination].append(group)

        partitions = {
            name: sorted(index for group in assigned[name] for index in group_to_indices[group])
            for name in split_names
        }
        return partitions['train'], partitions.get('validation', []), partitions['test']

    raise ValueError('group 结构无法在保持组隔离的同时让训练/验证/测试都覆盖全部类别；请检查 group 与类别是否混杂')


def _hash_file(path):
    hasher = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            hasher.update(chunk)
    return hasher.hexdigest()


def _collect_image_files(directory, extensions):
    files = []
    for current_root, directories, filenames in os.walk(directory, followlinks=False):
        symlink_directories = [name for name in directories if os.path.islink(os.path.join(current_root, name))]
        if symlink_directories:
            raise ValueError(f'数据目录不允许符号链接: {os.path.join(current_root, symlink_directories[0])}')
        directories.sort()
        for filename in sorted(filenames):
            path = os.path.join(current_root, filename)
            if os.path.islink(path):
                raise ValueError(f'数据目录不允许符号链接: {path}')
            if os.path.isfile(path) and os.path.splitext(filename)[1].lower() in extensions:
                files.append(path)
    return files


def _runtime_dataset_content_hash(dataset_name, config):
    expected = config.get('datasetContentHash')
    if dataset_name in ('mnist', 'cifar10'):
        return expected or f'builtin:{dataset_name}:torchvision-v1'
    data_path = config.get('dataPath', '')
    if dataset_name == 'csv':
        with open(data_path, 'rb') as handle:
            actual = f"sha256:{hashlib.sha256(handle.read()).hexdigest()}"
    elif dataset_name == 'local_image':
        extensions = {'.jpg', '.jpeg', '.png', '.bmp', '.webp', '.gif'}
        root = os.path.abspath(data_path)
        root_entries = list(os.scandir(root))
        symlinks = [entry.path for entry in root_entries if entry.is_symlink()]
        if symlinks:
            raise ValueError(f'数据目录不允许符号链接: {symlinks[0]}')
        class_dirs = [entry.path for entry in root_entries if entry.is_dir(follow_symlinks=False)]
        files = []
        for directory in class_dirs:
            files.extend(_collect_image_files(directory, extensions))
        if not files:
            files = [
                entry.path for entry in root_entries
                if entry.is_file(follow_symlinks=False) and os.path.splitext(entry.name)[1].lower() in extensions
            ]
        hasher = hashlib.sha256()
        hasher.update(b'neurobricks-dataset-files-v1\0')
        for path in sorted(files, key=lambda item: os.path.relpath(item, root).replace('\\', '/')):
            relative = os.path.relpath(path, root).replace('\\', '/').encode('utf-8')
            hasher.update(len(relative).to_bytes(8, 'little'))
            hasher.update(relative)
            size = os.path.getsize(path)
            hasher.update(size.to_bytes(8, 'little'))
            with open(path, 'rb') as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b''):
                    hasher.update(chunk)
        actual = f"sha256:{hasher.hexdigest()}"
    else:
        return expected
    if expected and actual != expected:
        raise ValueError('数据集内容自导入后已变化；请重新导入以建立新数据集身份')
    return actual


def _cross_split_duplicate_check(sample_hashes, split_members):
    placements = {}
    for split_name, indices in split_members.items():
        for index in indices:
            placements.setdefault(sample_hashes[index], set()).add(split_name)
    conflicts = [digest for digest, splits in placements.items() if len(splits) > 1]
    if conflicts:
        raise ValueError(f'检测到 {len(conflicts)} 组字节级重复样本跨越不同集合，已阻止训练')
    return {
        'check': 'cross_split_exact_duplicate',
        'status': 'passed',
        'details': f'checked {len(sample_hashes)} samples; no cross-split exact duplicate',
    }


def _raw_vision_sample_hashes(dataset):
    """对 torchvision 原始像素逐样本取哈希；transform 后浮点字节不作为数据身份。"""
    raw = getattr(dataset, 'data', None)
    if raw is None:
        raise ValueError('内置数据集缺少可验证的原始像素')
    hashes = []
    for sample in raw:
        array = sample.detach().cpu().numpy() if torch.is_tensor(sample) else sample
        hashes.append(hashlib.sha256(array.tobytes()).hexdigest())
    return hashes


def _split_fingerprint(config, strategy, split_members):
    payload = {
        'algorithm': 'neurobricks-split-v1',
        'datasetContentHash': config.get('datasetContentHash'),
        'strategy': strategy,
        'seed': config.get('seed', 42),
        'groupField': config.get('groupField'),
        'timeField': config.get('timeField'),
        'targetField': config.get('targetField'),
        'featureFields': config.get('featureFields'),
        'members': {name: sorted(values) for name, values in split_members.items()},
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _test_set_fingerprint(config, test_members):
    """测试集身份只由数据身份与实际成员决定，供解封时重新见证。"""
    payload = {
        'algorithm': 'neurobricks-test-set-v1',
        'datasetContentHash': config.get('datasetContentHash'),
        'members': sorted(test_members),
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _preprocessing_fingerprint(parameters):
    encoded = json.dumps(parameters, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _numeric_csv_values(df, columns, role):
    """Parse selected CSV columns and preserve actionable locations for bad cells."""
    import numpy as np
    import pandas as pd

    locations = []
    total_errors = 0
    converted_columns = []
    for column in columns:
        converted = pd.to_numeric(df[column], errors='coerce')
        converted_columns.append(converted)
        for row_position, (raw_value, numeric_value) in enumerate(zip(df[column].tolist(), converted.tolist())):
            if numeric_value is not None and not pd.isna(numeric_value) and math.isfinite(float(numeric_value)):
                continue
            total_errors += 1
            raw_text = '' if raw_value is None else str(raw_value)
            if raw_value is None or pd.isna(raw_value) or not raw_text.strip():
                reason = 'missing_value'
            else:
                try:
                    reason = 'non_finite' if not math.isfinite(float(raw_text)) else 'non_numeric'
                except (TypeError, ValueError, OverflowError):
                    reason = 'non_numeric'
            if len(locations) < 20:
                locations.append({
                    'row': row_position + 2,
                    'column': str(column),
                    'rawValue': raw_text[:200],
                    'reason': reason,
                    'role': role,
                })

    if locations:
        raise TrainerError(
            'CSV_INVALID_CELL',
            f'CSV {role}包含缺失、文本或 NaN/Infinity，首个问题位于第 {locations[0]["row"]} 行“{locations[0]["column"]}”列',
            {'totalErrors': total_errors, 'locations': locations},
        )
    values = np.column_stack([column.to_numpy(dtype='float64') for column in converted_columns])
    if not np.isfinite(values).all():
        raise TrainerError('CSV_INVALID_CELL', f'CSV {role}包含不可表示的数值')
    return values


def _require_finite_tensor(value, stage, error_code='NUMERICAL_FAILURE'):
    if not torch.is_tensor(value) or not torch.isfinite(value).all().item():
        raise TrainerError(error_code, f'{stage} 出现 NaN/Infinity，已终止本次 Attempt 且不会写入可信产物', {'stage': stage})


def _atomic_torch_save(value, path):
    temporary_path = f'{path}.tmp-{os.getpid()}'
    try:
        torch.save(value, temporary_path)
        os.replace(temporary_path, path)
    finally:
        if os.path.exists(temporary_path):
            os.remove(temporary_path)


def _atomic_copy(source, destination):
    import shutil
    temporary_path = f'{destination}.tmp-{os.getpid()}'
    try:
        shutil.copyfile(source, temporary_path)
        os.replace(temporary_path, destination)
    finally:
        if os.path.exists(temporary_path):
            os.remove(temporary_path)


def _artifact_manifest_entry(path, role):
    return {
        'path': path,
        'role': role,
        'sizeBytes': os.path.getsize(path),
        'sha256': f'sha256:{_hash_file(path)}',
    }


def _label_counts(labels):
    counts = {}
    for label in labels:
        key = str(int(label))
        counts[key] = counts.get(key, 0) + 1
    return counts


def _make_loaders(train_dataset, val_dataset, test_dataset, batch_size):
    pin_memory = torch.cuda.is_available()
    common = dict(batch_size=batch_size, num_workers=0, pin_memory=pin_memory, drop_last=False)
    train_loader = torch.utils.data.DataLoader(train_dataset, shuffle=True, **common)
    val_loader = torch.utils.data.DataLoader(val_dataset, shuffle=False, **common) if val_dataset is not None else None
    test_loader = torch.utils.data.DataLoader(test_dataset, shuffle=False, **common)
    return train_loader, val_loader, test_loader


def get_dataset(dataset_name, batch_size, data_dir, config=None):
    """返回 train/validation/test loader 与由实际成员计算的切分 provenance。"""
    config = config or {}
    log_message("log", level="info", message=f"Loading dataset '{dataset_name}'...")
    seed = config.get('seed', 42)
    val_ratio = config.get('valSplit', 0.2)
    strategy = config.get('splitStrategy', 'random')
    # 内置数据集的测试集由 TorchVision 官方预定义，配置不得把执行语义伪装成随机切分。
    if dataset_name in ('mnist', 'cifar10'):
        strategy = 'predefined'
    machine_checks = []
    class_count = None

    try:
        if dataset_name in ('mnist', 'cifar10'):
            class_count = 10
            os.makedirs(data_dir, exist_ok=True)
            if dataset_name == 'mnist':
                transform = transforms.Compose([
                    transforms.ToTensor(), transforms.Normalize((0.1307,), (0.3081,))
                ])
                full_train = datasets.MNIST(data_dir, train=True, download=True, transform=transform)
                test_dataset = datasets.MNIST(data_dir, train=False, transform=transform)
                preprocessing_parameters = {
                    'algorithm': 'vision-fixed-v1', 'resize': None,
                    'colorMode': 'grayscale', 'channels': 1, 'interpolation': 'bilinear',
                    'grayscaleChannels': 1, 'normalizationMean': [0.1307], 'normalizationStd': [0.3081],
                }
            else:
                transform = transforms.Compose([
                    transforms.ToTensor(),
                    transforms.Normalize((0.4914, 0.4822, 0.4465), (0.2470, 0.2435, 0.2616))
                ])
                full_train = datasets.CIFAR10(data_dir, train=True, download=True, transform=transform)
                test_dataset = datasets.CIFAR10(data_dir, train=False, transform=transform)
                preprocessing_parameters = {
                    'algorithm': 'vision-fixed-v1', 'resize': None, 'grayscaleChannels': None,
                    'colorMode': 'rgb', 'channels': 3, 'interpolation': 'bilinear',
                    'normalizationMean': [0.4914, 0.4822, 0.4465],
                    'normalizationStd': [0.2470, 0.2435, 0.2616],
                }
            builtin_dataset(dataset_name, data_dir)
            builtin_train_targets = full_train.targets
            train_indices, val_indices, _unused = _partition_stratified(
                builtin_train_targets.tolist() if hasattr(builtin_train_targets, 'tolist') else builtin_train_targets,
                0.0, val_ratio, seed,
            )
            test_indices = list(range(len(test_dataset)))
            train_dataset = torch.utils.data.Subset(full_train, train_indices)
            val_dataset = torch.utils.data.Subset(full_train, val_indices) if val_indices else None
            split_members = {
                'train': [f'train:{index}' for index in train_indices],
                'validation': [f'train:{index}' for index in val_indices],
                'test': [f'test:{index}' for index in test_indices],
            }
            builtin_targets = test_dataset.targets
            test_label_counts = _label_counts(
                builtin_targets.tolist() if hasattr(builtin_targets, 'tolist') else builtin_targets
            )
            train_hashes = _raw_vision_sample_hashes(full_train)
            test_hashes = _raw_vision_sample_hashes(test_dataset)
            machine_checks.append(_cross_split_duplicate_check(
                train_hashes + test_hashes,
                {
                    'train': train_indices,
                    'validation': val_indices,
                    'test': [len(train_hashes) + index for index in test_indices],
                },
            ))
        elif dataset_name == 'local_image':
            data_path = config.get('dataPath', '')
            if not data_path or not os.path.isdir(data_path):
                raise ValueError(f'本地图像目录不存在: {data_path}')
            if strategy not in ('random', 'group'):
                raise ValueError('本地图像仅支持 random/group 切分；temporal 需要带真实时间字段的 CSV 数据集')
            input_shape = config.get('inputShape')
            target_channels, target_h, target_w = (input_shape[:3] if input_shape and len(input_shape) >= 3 else (3, 224, 224))
            transform_steps = [transforms.Resize((target_h, target_w))]
            if target_channels == 1:
                transform_steps.extend([transforms.Grayscale(num_output_channels=1), transforms.ToTensor(), transforms.Normalize((0.5,), (0.5,))])
            else:
                transform_steps.extend([transforms.ToTensor(), transforms.Normalize((0.485, 0.456, 0.406), (0.229, 0.224, 0.225))])
            preprocessing_parameters = {
                'algorithm': 'vision-resize-normalize-v1',
                'resize': [int(target_h), int(target_w)],
                'colorMode': 'grayscale' if target_channels == 1 else 'rgb',
                'channels': int(target_channels),
                'interpolation': 'bilinear',
                'grayscaleChannels': 1 if target_channels == 1 else None,
                'normalizationMean': [0.5] if target_channels == 1 else [0.485, 0.456, 0.406],
                'normalizationStd': [0.5] if target_channels == 1 else [0.229, 0.224, 0.225],
            }
            full_dataset = datasets.ImageFolder(data_path, transform=transforms.Compose(transform_steps))
            class_count = len(full_dataset.classes)
            train_ratio = config.get('trainRatio', 0.8)
            if strategy == 'group':
                group_field = config.get('groupField')
                if group_field != LOCAL_IMAGE_PARENT_GROUP_FIELD:
                    raise ValueError('本地图像 group 切分字段无效，请重新导入数据集并选择“类别内第一级子目录”')
                image_groups = _local_image_parent_groups(full_dataset.samples, data_path)
                train_indices, val_indices, test_indices = _partition_grouped_classification(
                    image_groups, full_dataset.targets, 1.0 - train_ratio, val_ratio, seed,
                )
                machine_checks.append({
                    'check': 'group_disjoint',
                    'status': 'passed',
                    'details': (
                        f'groupField={group_field}; groups={len(set(image_groups))}; '
                        f'actualSamples=train:{len(train_indices)},validation:{len(val_indices)},test:{len(test_indices)}'
                    ),
                })
            else:
                train_indices, val_indices, test_indices = _partition_stratified(
                    full_dataset.targets, 1.0 - train_ratio, val_ratio, seed,
                )
            train_dataset = torch.utils.data.Subset(full_dataset, train_indices)
            val_dataset = torch.utils.data.Subset(full_dataset, val_indices) if val_indices else None
            test_dataset = torch.utils.data.Subset(full_dataset, test_indices)
            sample_hashes = [_hash_file(path) for path, _label in full_dataset.samples]
            machine_checks.append(_cross_split_duplicate_check(sample_hashes, {
                'train': train_indices, 'validation': val_indices, 'test': test_indices,
            }))
            relative = lambda index: os.path.relpath(full_dataset.samples[index][0], data_path).replace('\\', '/')
            split_members = {
                'train': [relative(index) for index in train_indices],
                'validation': [relative(index) for index in val_indices],
                'test': [relative(index) for index in test_indices],
            }
            test_label_counts = _label_counts(full_dataset.targets[index] for index in test_indices)
            log_message("log", level="info", message=f"Local image dataset loaded: {len(full_dataset)} samples, {len(full_dataset.classes)} classes")
        elif dataset_name == 'csv':
            import pandas as pd
            import numpy as np
            data_path = config.get('dataPath', '')
            if not data_path or not os.path.isfile(data_path):
                raise ValueError(f'CSV 文件不存在: {data_path}')
            try:
                df = pd.read_csv(data_path, encoding='utf-8-sig')
            except UnicodeDecodeError:
                df = pd.read_csv(data_path, encoding='gb18030')
            if len(df.columns) < 2:
                raise ValueError('CSV 至少需要一个特征列和一个目标列')
            group_field = config.get('groupField')
            time_field = config.get('timeField')
            target_field = config.get('targetField')
            feature_columns = config.get('featureFields')
            if not isinstance(target_field, str) or not target_field.strip():
                raise TrainerError('CSV_CONTRACT_REQUIRED', 'CSV 训练必须显式指定 targetField，不能按列位置猜测目标')
            if not isinstance(feature_columns, list) or not feature_columns or any(
                not isinstance(column, str) or not column.strip() for column in feature_columns
            ):
                raise TrainerError('CSV_CONTRACT_REQUIRED', 'CSV 训练必须显式指定非空 featureFields')
            if len(feature_columns) != len(set(feature_columns)):
                raise TrainerError('CSV_CONTRACT_INVALID', 'featureFields 不允许包含重复列')
            unknown_fields = [field for field in [target_field, *feature_columns] if field not in df.columns]
            if unknown_fields:
                raise TrainerError('CSV_CONTRACT_INVALID', 'CSV 数据契约引用了不存在的列', {'unknownFields': unknown_fields})
            if strategy == 'group' and (not group_field or group_field not in df.columns):
                raise ValueError('group 切分选择的 groupField 不存在')
            if strategy == 'temporal' and (not time_field or time_field not in df.columns):
                raise ValueError('temporal 切分选择的 timeField 不存在')
            if group_field == target_field or time_field == target_field:
                raise ValueError('目标列不能同时作为 group/time 切分字段')
            metadata_fields = {field for field in (group_field, time_field) if field}
            overlap = [column for column in feature_columns if column == target_field or column in metadata_fields]
            if overlap:
                raise TrainerError('CSV_CONTRACT_INVALID', '目标列或切分元数据不能同时作为训练特征', {'overlapFields': overlap})
            features64 = _numeric_csv_values(df, feature_columns, '特征')
            labels64 = _numeric_csv_values(df, [target_field], '目标').reshape(-1)
            float32_limit = np.finfo(np.float32).max
            if np.max(np.abs(features64)) > float32_limit or np.max(np.abs(labels64)) > float32_limit:
                raise TrainerError(
                    'CSV_VALUE_OUT_OF_RANGE',
                    'CSV 数值超出 float32 可表示范围，请先缩放数据',
                    {'float32Max': float(float32_limit)},
                )
            train_ratio = config.get('trainRatio', 0.8)
            temporal_values = None
            if time_field:
                parsed_time = pd.to_datetime(df[time_field], errors='coerce', utc=True)
                if parsed_time.notna().all():
                    temporal_values = [int(value.value) for value in parsed_time]
                else:
                    numeric_time = pd.to_numeric(df[time_field], errors='coerce')
                    if not numeric_time.notna().all():
                        raise ValueError('timeField 包含无法按时间或数值排序的值')
                    temporal_values = numeric_time.tolist()
            train_indices, val_indices, test_indices = _partition_indices(
                len(df), 1.0 - train_ratio, val_ratio, seed, strategy,
                groups=df[group_field].tolist() if group_field else None,
                times=temporal_values,
            )
            train_features64 = features64[train_indices]
            mean64 = np.mean(train_features64, axis=0, dtype=np.float64)
            std64 = np.std(train_features64, axis=0, dtype=np.float64)
            std64 = np.where(std64 < 1e-12, 1.0, std64)
            standardized64 = (features64 - mean64) / std64
            if not np.isfinite(standardized64).all():
                raise TrainerError('NUMERICAL_FAILURE', 'CSV 标准化产生 NaN/Infinity，已终止训练', {'stage': 'preprocessing'})
            standardized = standardized64.astype('float32')
            labels = labels64.astype('float32')
            if not np.isfinite(standardized).all() or not np.isfinite(labels).all():
                raise TrainerError('CSV_VALUE_OUT_OF_RANGE', 'CSV 转换为训练精度后产生 NaN/Infinity，请先缩放数据')
            preprocessing_parameters = {
                'algorithm': 'standard-scaler-fit-train-only-v1',
                'featureColumns': [str(column) for column in feature_columns],
                'targetField': target_field,
                'mean': [float(value) for value in mean64.tolist()],
                'std': [float(value) for value in std64.tolist()],
            }
            full_dataset = torch.utils.data.TensorDataset(torch.from_numpy(standardized), torch.from_numpy(labels))
            train_dataset = torch.utils.data.Subset(full_dataset, train_indices)
            val_dataset = torch.utils.data.Subset(full_dataset, val_indices) if val_indices else None
            test_dataset = torch.utils.data.Subset(full_dataset, test_indices)
            row_hashes = [hashlib.sha256(
                json.dumps(row, ensure_ascii=False, sort_keys=True, default=str, separators=(',', ':')).encode('utf-8')
            ).hexdigest() for row in df.to_dict(orient='records')]
            machine_checks.append(_cross_split_duplicate_check(row_hashes, {
                'train': train_indices, 'validation': val_indices, 'test': test_indices,
            }))
            if strategy == 'group':
                machine_checks.append({'check': 'group_disjoint', 'status': 'passed', 'details': f'groupField={group_field}'})
            if strategy == 'temporal':
                machine_checks.append({'check': 'temporal_order', 'status': 'passed', 'details': f'timeField={time_field}'})
            split_members = {
                'train': [f'row:{index}' for index in train_indices],
                'validation': [f'row:{index}' for index in val_indices],
                'test': [f'row:{index}' for index in test_indices],
            }
            test_label_counts = None
            test_targets = labels64[test_indices]
            test_summary_values = [
                float(np.mean(test_targets, dtype=np.float64)),
                float(np.var(test_targets, dtype=np.float64)),
                float(np.min(test_targets)),
                float(np.max(test_targets)),
            ]
            if not all(math.isfinite(value) for value in test_summary_values):
                raise TrainerError('NUMERICAL_FAILURE', '封存测试目标统计量溢出，请先缩放目标列', {'stage': 'test_target_summary'})
            test_target_summary = {
                'count': int(len(test_targets)),
                'mean': test_summary_values[0],
                'variance': test_summary_values[1],
                'min': test_summary_values[2],
                'max': test_summary_values[3],
            }
            log_message("log", level="info", message=f"CSV dataset loaded: {len(full_dataset)} samples, {len(feature_columns)} features")
        else:
            raise TrainerError('DATASET_UNSUPPORTED', f'不支持的数据集：{dataset_name}', {'dataset': dataset_name})

        if dataset_name != 'csv':
            test_target_summary = None

        split_hash = _split_fingerprint(config, strategy, split_members)
        test_set_hash = _test_set_fingerprint(config, split_members['test'])
        preprocessing_hash = _preprocessing_fingerprint(preprocessing_parameters)
        train_loader, val_loader, test_loader = _make_loaders(
            train_dataset, val_dataset, test_dataset, batch_size,
        )
        log_message("log", level="info", message=f"Dataset split ready: train={len(train_dataset)}, val={len(val_dataset) if val_dataset is not None else 0}, test={len(test_dataset)}")
        return train_loader, val_loader, test_loader, {
            'splitHash': split_hash,
            'testSetHash': test_set_hash,
            'testSampleCount': len(test_dataset),
            'splitSampleCounts': {
                'train': len(train_dataset),
                'validation': len(val_dataset) if val_dataset is not None else 0,
                'test': len(test_dataset),
            },
            'testLabelCounts': test_label_counts,
            'testTargetSummary': test_target_summary,
            'preprocessingHash': preprocessing_hash,
            'preprocessingParameters': preprocessing_parameters,
            'strategy': strategy,
            'machineChecks': machine_checks,
            'classCount': class_count,
        }
    except TrainerError:
        raise
    except Exception as error:
        raise TrainerError(
            'DATASET_LOAD_FAILED',
            f"加载数据集“{dataset_name}”失败：{error}",
            {'dataset': dataset_name, 'causeType': type(error).__name__},
        ) from error

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

        raise TrainerError(
            'MODEL_SHAPE_INVALID',
            f"模型形状不匹配：{e}\n\n{hint}",
            {'inputShape': list(input_shape), 'runtimeMessage': error_str},
        ) from e

def train(model_and_shape, config):
    model, input_shape = model_and_shape
    model_id = config.get('modelId') or config.get('model_id') or ''
    attempt_id = config.get('attemptId') or ''
    if model_id and (
        not isinstance(model_id, str)
        or len(model_id.encode('utf-8')) > 128
        or not all(ch.isascii() and (ch.isalnum() or ch in '-_') for ch in model_id)
    ):
        raise ValueError('modelId contains unsafe filename characters')
    if (
        not isinstance(attempt_id, str)
        or not attempt_id
        or len(attempt_id.encode('utf-8')) > 128
        or not all(ch.isascii() and (ch.isalnum() or ch in '-_') for ch in attempt_id)
    ):
        raise TrainerError('ATTEMPT_ID_INVALID', '受控训练缺少安全的 attemptId，无法隔离产物')

    epochs = config.get('epochs', 10)
    learning_rate = config.get('learningRate', 0.001)
    batch_size = config.get('batchSize', 32)
    dataset_name = config.get('dataset', 'mnist')
    device_name = config.get('device', 'cuda')
    
    # --- 可复现性：全局随机种子（torch/cuda/numpy/random 四处全部固定）---
    # 缺失时默认 42；显式传 null 视为不固定（保持旧行为的可选出口）
    seed = config.get('seed', 42)
    if seed is not None:
        import random as _random
        import numpy as _np
        _random.seed(seed)
        _np.random.seed(seed)
        torch.manual_seed(seed)
        torch.cuda.manual_seed_all(seed)
        log_message("log", level="info", message=f"Random seed fixed: {seed}")

    # --- 学习率调度器：none / multistep / cosine ---
    scheduler_name = config.get('lrScheduler', 'none').lower()

    # 验证集与封存测试集职责正交；0 会诱使训练窥视测试集，因此协议层直接拒绝。
    val_split = config.get('valSplit', 0.2)
    if not isinstance(val_split, (int, float)) or not (0.0 < val_split <= 0.5):
        raise ValueError('valSplit 必须位于 (0, 0.5]；封存测试集不能充当验证集')

    # 安全选择设备（CUDA 不兼容时自动降级 CPU）
    device = safe_device(device_name)
    model = model.to(device)
    
    log_message("log", level="info", message=f"Training on {device}")
    
    # 验证模型形状（用假数据前向传播）
    if input_shape:
        validate_model(model, input_shape, device)
    else:
        log_message("log", level="warning", message="No Input layer shape specified, skipping validation")
    
    # 将 input_shape 注入 config，供 get_dataset 使用
    if input_shape:
        config['inputShape'] = list(input_shape)

    # 导入到开跑之间文件可能被编辑；受控管线必须重新见证实际字节，不能沿用陈旧指纹。
    runtime_dataset_content_hash = _runtime_dataset_content_hash(dataset_name, config)
    
    # 内置数据集用 resolve_data_dir，自定义数据集从 config 读路径
    if dataset_name in ('mnist', 'cifar10'):
        data_dir = resolve_data_dir(dataset_name)
    else:
        data_dir = config.get('dataPath', '.') or '.'
    
    train_loader, val_loader, test_loader, split_provenance = get_dataset(
        dataset_name, batch_size, data_dir, config
    )
    # 创建训练控制器
    controller = TrainingController()
    
    # 启动命令监听线程
    command_thread = threading.Thread(target=listen_commands, args=(controller,), daemon=True)
    command_thread.start()
    
    is_regression = dataset_name == 'csv'
    criterion = nn.MSELoss() if is_regression else nn.CrossEntropyLoss()
    
    # 优化器选择（支持 SGD/Adam/AdamW；SGD 可选 momentum）
    optimizer_name = config.get('optimizer', 'adam').lower()
    weight_decay = config.get('weightDecay', 0.0)
    momentum = config.get('momentum', 0.9)  # 仅 SGD 使用
    
    optimizer = build_optimizer(model, learning_rate, optimizer_name, weight_decay, momentum)
    log_message("log", level="info", message=f"Optimizer: {optimizer_name.upper()}{f' (momentum={momentum})' if optimizer_name == 'sgd' and momentum else ''}, lr={learning_rate}, weight_decay={weight_decay}")
    
    # 学习率调度器（每个 epoch 结束后 step）
    scheduler = build_scheduler(optimizer, scheduler_name, epochs)
    if scheduler is not None:
        log_message("log", level="info", message=f"LR scheduler: {scheduler_name}")
    
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
        running_absolute_error = 0.0
        
        for batch_idx, (data, target) in enumerate(train_loader):
            if controller.should_stop:
                break
            
            controller.wait_if_paused()
            
            if controller.should_stop:
                break
            
            data, target = data.to(device, non_blocking=True), target.to(device, non_blocking=True)
            _require_finite_tensor(data, 'training_input')
            _require_finite_tensor(target, 'training_target')
            optimizer.zero_grad()
            output = model(data)
            _require_finite_tensor(output, 'model_output')
            if is_regression:
                output = output.reshape(-1)
                target = target.float().reshape(-1)
            loss = criterion(output, target)
            _require_finite_tensor(loss, 'training_loss')
            loss.backward()
            for parameter_name, parameter in model.named_parameters():
                if parameter.grad is not None and not torch.isfinite(parameter.grad).all().item():
                    raise TrainerError(
                        'NUMERICAL_FAILURE',
                        f'梯度“{parameter_name}”出现 NaN/Infinity，已终止本次 Attempt',
                        {'stage': 'gradient', 'parameter': parameter_name},
                    )
            optimizer.step()
            for parameter_name, parameter in model.named_parameters():
                if not torch.isfinite(parameter).all().item():
                    raise TrainerError(
                        'NUMERICAL_FAILURE',
                        f'参数“{parameter_name}”更新后出现 NaN/Infinity，已终止本次 Attempt',
                        {'stage': 'optimizer_step', 'parameter': parameter_name},
                    )
            
            running_loss += loss.item()
            total += target.size(0)
            if is_regression:
                running_absolute_error += torch.abs(output.detach() - target).sum().item()
            else:
                _, predicted = output.max(1)
                correct += predicted.eq(target).sum().item()
            step += 1
            
            if batch_idx % 10 == 0:
                metric_value = running_absolute_error / max(total, 1) if is_regression else correct / max(total, 1)
                progress_payload = dict(
                    epoch=epoch,
                    step=step,
                    globalStep=step,
                    recordId=f'{attempt_id}:train:{epoch}:{step}',
                    split='train',
                    scope='batch',
                    loss=round(loss.item(), 4),
                    lossName='mse' if is_regression else 'cross_entropy',
                    lossValue=round(loss.item(), 4),
                    metricName='mae' if is_regression else 'accuracy',
                    metricValue=round(metric_value, 4),
                    optimizationDirection='minimize' if is_regression else 'maximize',
                    sampleCount=total,
                    timestamp=int(time.time() * 1000),
                )
                if not is_regression:
                    progress_payload['accuracy'] = round(metric_value, 4)
                log_message("progress", **progress_payload)
        
        # Epoch 结束只看开发验证集；封存测试集只允许 eval-only 解封。
        eval_loader = val_loader
        if eval_loader is None:
            raise ValueError('受控训练必须划分验证集；测试集只能通过冻结主张的 eval-only 流程解封')
        model.eval()
        val_correct = 0
        val_total = 0
        val_loss_sum = 0.0
        val_absolute_error = 0.0
        with torch.no_grad():
            for eval_batch_idx, (data, target) in enumerate(eval_loader):
                if eval_batch_idx % 10 == 0:
                    # 验证阶段可能很长，但每批推进会续租；若某一批永久卡死，租约到期后
                    # 后台心跳停止，Rust 看门狗仍能最终终止进程。
                    renew_heartbeat()
                data, target = data.to(device, non_blocking=True), target.to(device, non_blocking=True)
                _require_finite_tensor(data, 'validation_input')
                _require_finite_tensor(target, 'validation_target')
                output = model(data)
                _require_finite_tensor(output, 'validation_output')
                if is_regression:
                    output = output.reshape(-1)
                    target = target.float().reshape(-1)
                validation_loss = criterion(output, target)
                _require_finite_tensor(validation_loss, 'validation_loss')
                val_loss_sum += validation_loss.item()
                val_total += target.size(0)
                if is_regression:
                    val_absolute_error += torch.abs(output - target).sum().item()
                else:
                    _, predicted = output.max(1)
                    val_correct += predicted.eq(target).sum().item()
        
        val_accuracy = val_absolute_error / max(val_total, 1) if is_regression else val_correct / max(val_total, 1)
        val_loss_avg = val_loss_sum / max(len(eval_loader), 1)
        if not math.isfinite(val_accuracy) or not math.isfinite(val_loss_avg):
            raise TrainerError('NUMERICAL_FAILURE', '验证指标出现 NaN/Infinity，已终止本次 Attempt', {'stage': 'validation_metric'})
        validation_payload = dict(
            epoch=epoch,
            step=step,
            globalStep=step,
            recordId=f'{attempt_id}:validation:{epoch}:{step}',
            split='validation',
            scope='epoch',
            trainLoss=round(running_loss / max(len(train_loader), 1), 4),
            valLoss=round(val_loss_avg, 4),
            lossName='mse' if is_regression else 'cross_entropy',
            lossValue=round(val_loss_avg, 4),
            valMetricName='mae' if is_regression else 'accuracy',
            valMetric=round(val_accuracy, 4),
            metricName='mae' if is_regression else 'accuracy',
            metricValue=round(val_accuracy, 4),
            optimizationDirection='minimize' if is_regression else 'maximize',
            sampleCount=val_total,
            timestamp=int(time.time() * 1000),
        )
        if not is_regression:
            validation_payload['valAccuracy'] = round(val_accuracy, 4)
        log_message("epoch_end", **validation_payload)

        # 学习率调度：epoch 结束后 step（在验证之后，下个 epoch 生效）
        if scheduler is not None:
            scheduler.step()
            current_lr = scheduler.get_last_lr()[0]
            log_message("log", level="info", message=f"Epoch {epoch} done, lr -> {current_lr:.6f}")
    
    # 训练完成
    if not controller.should_stop:
        final_accuracy = val_absolute_error / max(val_total, 1) if is_regression else val_correct / max(val_total, 1)
        if not math.isfinite(final_accuracy):
            raise TrainerError('NUMERICAL_FAILURE', '最终指标出现 NaN/Infinity，已终止本次 Attempt', {'stage': 'final_metric'})
        for parameter_name, parameter in model.named_parameters():
            if not torch.isfinite(parameter).all().item():
                raise TrainerError('NUMERICAL_FAILURE', f'最终参数“{parameter_name}”包含 NaN/Infinity，拒绝写入产物')
        # 注意：done 消息延迟到权重全部保存完成后再发出，
        # 避免前端收到 done 立即生成推理卡片时权重文件尚未写盘

        # 保存模型：优先用户目录（打包后 sidecar 目录可能只读）
        user_weights_dir = os.path.join(os.path.expanduser('~'), '.neurobricks')
        attempt_dir = os.path.join(user_weights_dir, 'attempts', attempt_id)
        try:
            os.makedirs(attempt_dir, exist_ok=False)
        except FileExistsError as error:
            raise TrainerError(
                'ARTIFACT_ID_COLLISION',
                f'Attempt {attempt_id} 的产物目录已存在，拒绝覆盖历史证据',
                {'attemptId': attempt_id},
            ) from error

        # 1. state_dict（仅权重）
        weights_path = os.path.join(attempt_dir, 'model_weights.pth')
        # 只使用唯一、可预测的用户目录。若写入失败则让训练进入 error；回退到 sidecar
        # 会让导出器优先捡到用户目录中的旧文件，造成“成功导出上一模型”的数据污染。
        _atomic_torch_save(model.state_dict(), weights_path)
        weights_saved = True
        log_message("log", level="info", message=f"Model weights saved to {weights_path}")

        # 1b. 按 modelId 另存独立权重（多模型卡片化推理用）
        per_model_saved = False
        per_model_path = None
        if model_id:
            try:
                models_dir = os.path.join(user_weights_dir, 'models')
                os.makedirs(models_dir, exist_ok=True)
                per_model_path = os.path.join(models_dir, f'{model_id}.pth')
                # Inference alias must be byte-identical to the Attempt state_dict;
                # serializing twice can produce different container bytes and break identity checks.
                _atomic_copy(weights_path, per_model_path)
                per_model_saved = True
                log_message("log", level="info", message=f"Per-model weights saved to {per_model_path}")
            except (PermissionError, OSError) as e:
                log_message("log", level="warning", message=f"Failed to save per-model weights: {e}")

        # 2. 完整模型（结构+权重）
        full_model_path = os.path.join(attempt_dir, 'model_full.pt')
        _atomic_torch_save(model, full_model_path)
        full_model_saved = True
        log_message("log", level="info", message=f"Full model saved to {full_model_path}")

        # 3. NumPy 权重（不依赖 PyTorch）
        npz_path = os.path.join(attempt_dir, 'model_weights.npz')
        numpy_saved = False
        temporary_npz_path = f'{npz_path}.tmp-{os.getpid()}'
        try:
            import numpy as np
            np_weights = {}
            for name, param in model.state_dict().items():
                np_weights[name] = param.cpu().numpy()
            with open(temporary_npz_path, 'wb') as temporary_npz:
                np.savez(temporary_npz, **np_weights)
            os.replace(temporary_npz_path, npz_path)
        except Exception as e:
            log_message("log", level="warning", message=f"Failed to save NumPy weights: {e}")
        else:
            numpy_saved = True
            log_message("log", level="info", message=f"NumPy weights saved to {npz_path}")
        finally:
            if os.path.exists(temporary_npz_path):
                os.remove(temporary_npz_path)

        # 权重身份必须来自实际落盘字节；不能用配置或文件名代替内容哈希。
        identity_path = weights_path
        weights_hasher = hashlib.sha256()
        with open(identity_path, 'rb') as weights_file:
            for chunk in iter(lambda: weights_file.read(1024 * 1024), b''):
                weights_hasher.update(chunk)
        model_weights_hash = f"sha256:{weights_hasher.hexdigest()}"

        # 所有权重的保存完成后才发出 done，确保前端生成推理卡片时权重已就绪
        # config 回显：全部实际生效配置（含默认值），供结果卡片与复现使用
        effective_config = {
            'epochs': epochs,
            'batchSize': batch_size,
            'learningRate': learning_rate,
            'optimizer': (config.get('optimizer', 'adam') or 'adam').lower(),
            'weightDecay': config.get('weightDecay', 0.0),
            'momentum': config.get('momentum', 0.9),
            'lrScheduler': scheduler_name,
            'seed': seed,
            'valSplit': val_split,
            'dataset': dataset_name,
            'device': str(device),
            'targetField': config.get('targetField'),
            'featureFields': config.get('featureFields'),
        }
        done_payload = dict(
            finalMetricName='mae' if is_regression else 'accuracy',
            finalMetric=round(final_accuracy, 4),
            metricName='mae' if is_regression else 'accuracy',
            metricValue=round(final_accuracy, 4),
            optimizationDirection='minimize' if is_regression else 'maximize',
            config=effective_config,
            artifacts={
                "weights": weights_saved,
                "fullModel": full_model_saved,
                "numpy": numpy_saved,
                "perModel": per_model_saved,
            },
            artifactManifest=[
                _artifact_manifest_entry(weights_path, 'state_dict'),
                _artifact_manifest_entry(full_model_path, 'full_model'),
                *([_artifact_manifest_entry(npz_path, 'numpy_weights')] if numpy_saved else []),
                *([_artifact_manifest_entry(per_model_path, 'inference_state_dict')] if per_model_saved and per_model_path else []),
            ],
            provenance={
                "attemptId": config.get("attemptId"),
                "modelWeightsHash": model_weights_hash,
                "datasetContentHash": runtime_dataset_content_hash,
                "environment": {
                    "applicationVersion": "0.1.0",
                    "torchVersion": str(torch.__version__),
                    "pythonVersion": platform.python_version(),
                    "device": str(device),
                    "cudaVersion": str(torch.version.cuda) if torch.version.cuda else None,
                },
                "splitPolicyHash": config.get("splitPolicyHash"),
                "splitAssignmentHash": split_provenance.get("splitHash") if split_provenance else None,
                "splitHash": split_provenance.get("splitHash") if split_provenance else None,
                "testSetHash": split_provenance.get("testSetHash") if split_provenance else None,
                "testSampleCount": split_provenance.get("testSampleCount") if split_provenance else None,
                "splitSampleCounts": split_provenance.get("splitSampleCounts") if split_provenance else None,
                "testLabelCounts": split_provenance.get("testLabelCounts") if split_provenance else None,
                "testTargetSummary": split_provenance.get("testTargetSummary") if split_provenance else None,
                "preprocessingPolicyHash": config.get("preprocessingPolicyHash"),
                "fittedPreprocessingHash": split_provenance.get("preprocessingHash") if split_provenance else None,
                "preprocessingHash": split_provenance.get("preprocessingHash") if split_provenance else None,
                "preprocessingParameters": split_provenance.get("preprocessingParameters") if split_provenance else None,
                "machineChecks": split_provenance.get("machineChecks", []) if split_provenance else [],
            },
        )
        if not is_regression:
            done_payload['finalAccuracy'] = round(final_accuracy, 4)
        log_message("done", **done_payload)


def evaluate_claim(model_and_shape, config):
    """只读封存测试集并返回原始预测；统计裁决由冻结后的前端纯函数完成。"""
    model, input_shape = model_and_shape
    claim = config.get('evaluationClaim')
    if not isinstance(claim, dict):
        raise ValueError('evaluate_claim requires evaluationClaim')
    required_claim_fields = ('claimId', 'frozenHash', 'modelWeightsHash', 'testSetHash', 'taskType')
    if any(not isinstance(claim.get(field), str) or not claim[field] for field in required_claim_fields):
        raise ValueError('evaluationClaim is incomplete')

    model_id = config.get('modelId') or ''
    if (
        not isinstance(model_id, str)
        or not model_id
        or len(model_id.encode('utf-8')) > 128
        or not all(ch.isascii() and (ch.isalnum() or ch in '-_') for ch in model_id)
    ):
        raise ValueError('modelId contains unsafe filename characters')

    dataset_name = config.get('dataset', 'mnist')
    expected_task_type = 'tabular_regression' if dataset_name == 'csv' else 'image_classification'
    if claim['taskType'] != expected_task_type:
        raise ValueError('frozen claim task type does not match dataset')
    if expected_task_type == 'image_classification' and (
        not isinstance(claim.get('classCount'), int) or claim['classCount'] < 2
    ):
        raise ValueError('frozen classification claim lacks classCount')
    if input_shape:
        config['inputShape'] = list(input_shape)

    runtime_dataset_content_hash = _runtime_dataset_content_hash(dataset_name, config)
    data_dir = resolve_data_dir(dataset_name) if dataset_name in ('mnist', 'cifar10') else (config.get('dataPath', '.') or '.')
    _train_loader, _val_loader, test_loader, split_provenance = get_dataset(
        dataset_name, config.get('batchSize', 32), data_dir, config
    )
    if test_loader is None or split_provenance is None:
        raise ValueError('failed to reconstruct sealed test set')
    if config.get('splitHash') and split_provenance.get('splitHash') != config.get('splitHash'):
        raise ValueError('split identity changed after training; claim evaluation refused')
    if config.get('preprocessingHash') and split_provenance.get('preprocessingHash') != config.get('preprocessingHash'):
        raise ValueError('preprocessing identity changed after training; claim evaluation refused')
    if expected_task_type == 'image_classification' and split_provenance.get('classCount') != claim.get('classCount'):
        raise ValueError('class universe changed after claim freeze')
    if split_provenance.get('testSetHash') != claim['testSetHash']:
        raise ValueError('sealed test set identity does not match frozen claim')

    model_path = os.path.join(os.path.expanduser('~'), '.neurobricks', 'models', f'{model_id}.pth')
    if not os.path.isfile(model_path):
        raise ValueError('attempt model weights are missing')
    actual_weights_hash = f"sha256:{_hash_file(model_path)}"
    if actual_weights_hash != claim['modelWeightsHash']:
        raise ValueError('model weights changed after claim freeze')

    try:
        state_dict = torch.load(model_path, map_location='cpu', weights_only=True)
    except TypeError:
        state_dict = torch.load(model_path, map_location='cpu')
    model.load_state_dict(state_dict)
    device = safe_device(config.get('device', 'cuda'))
    model = model.to(device)
    if input_shape and not validate_model(model, input_shape, device):
        raise ValueError('saved model no longer matches frozen architecture')

    targets = []
    predictions = []
    model.eval()
    with torch.no_grad():
        for batch_index, (data, target) in enumerate(test_loader):
            if batch_index % 10 == 0:
                renew_heartbeat()
            data = data.to(device, non_blocking=True)
            output = model(data)
            if expected_task_type == 'tabular_regression':
                predictions.extend(float(value) for value in output.reshape(-1).detach().cpu().tolist())
                targets.extend(float(value) for value in target.reshape(-1).tolist())
            else:
                predicted = output.argmax(dim=1)
                predictions.extend(int(value) for value in predicted.detach().cpu().tolist())
                targets.extend(int(value) for value in target.reshape(-1).tolist())

    log_message(
        'claim_result',
        claimId=claim['claimId'],
        frozenHash=claim['frozenHash'],
        taskType=claim['taskType'],
        modelWeightsHash=actual_weights_hash,
        datasetContentHash=runtime_dataset_content_hash,
        testSetHash=split_provenance['testSetHash'],
        preprocessingHash=split_provenance['preprocessingHash'],
        classCount=split_provenance.get('classCount'),
        targets=targets,
        predictions=predictions,
    )
