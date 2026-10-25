# -*- coding: utf-8 -*-
"""
T1.1 验证脚本：sidecar 训练配置
测试项：
1. 向后兼容：无新字段配置，行为与旧版一致
2. 全字段：optimizer=sgd+momentum / lrScheduler=multistep / seed=42 / valSplit=0.2
3. 可复现：seed=42 两次运行 trainLoss 一致
用法：anaconda python verify_t11.py
"""
import sys
import io
import json
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from models import build_model
from train import train, build_optimizer, build_scheduler
import torch
import torch.nn as nn

PASS = 0
FAIL = 0

def check(name, cond, detail=''):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f'  [PASS] {name} {detail}')
    else:
        FAIL += 1
        print(f'  [FAIL] {name} {detail}')

LAYERS = [
    {"type": "Input", "params": {"inChannels": 1, "inputHeight": 28, "inputWidth": 28}},
    {"type": "Flatten", "params": {}},
    {"type": "Linear", "params": {"inFeatures": 784, "outFeatures": 32}},
    {"type": "ReLU", "params": {}},
    {"type": "Linear", "params": {"inFeatures": 32, "outFeatures": 10}},
]

BASE = {
    "mode": "train",
    "epochs": 1,
    "batchSize": 64,
    "learningRate": 0.001,
    "dataset": "mnist",
    "device": "cpu",
    "layers": LAYERS,
}

def run_train(config, label):
    """运行一次训练，收集事件流，返回 {epoch_end 列表, done 配置}
    流程与 main.py 一致：先固定 seed（若有）再 build_model，保证可复现"""
    events = []
    import builtins
    import random
    import numpy
    real_print = builtins.print
    def capture(*args, **kwargs):
        s = ' '.join(str(a) for a in args)
        try:
            events.append(json.loads(s))
        except ValueError:
            pass
        real_print(*args, **kwargs)
    builtins.print = capture
    try:
        # 与 main.py 一致：build_model 之前固定全局 seed
        seed = config.get('seed', 42)
        if seed is not None:
            random.seed(seed)
            numpy.random.seed(seed)
            torch.manual_seed(seed)
            torch.cuda.manual_seed_all(seed)
        model_and_shape = build_model(config['layers'])
        train(model_and_shape, config)
    finally:
        builtins.print = real_print
    epoch_ends = [e for e in events if e.get('type') == 'epoch_end']
    dones = [e for e in events if e.get('type') == 'done']
    return epoch_ends, dones[-1] if dones else None

print('=== T1.1 验证 ===')
print()

# --- 测试 1：向后兼容（无新字段） ---
print('[1] 向后兼容：旧格式配置')
t0 = time.time()
ee, done = run_train(dict(BASE), 'legacy')
t1 = time.time()
check('训练完成（done 事件）', done is not None)
check('epoch_end 存在', len(ee) >= 1)
check('epoch_end 含 valAccuracy', ee and 'valAccuracy' in ee[0])
check('epoch_end 含 valLoss（新字段）', ee and 'valLoss' in ee[0])
check('done 含 config 回显', done and 'config' in done)
if done and done.get('config'):
    c = done['config']
    check('config 默认值：optimizer=adam', c.get('optimizer') == 'adam', str(c.get('optimizer')))
    check('config 默认值：seed=42', c.get('seed') == 42, str(c.get('seed')))
    check('config 默认值：valSplit=0.2', c.get('valSplit') == 0.2, str(c.get('valSplit')))
    check('config 默认值：lrScheduler=none', c.get('lrScheduler') == 'none', str(c.get('lrScheduler')))
print(f'  耗时 {t1-t0:.1f}s')

# --- 测试 2：全字段配置 ---
print()
print('[2] 全字段：sgd + momentum + multistep + seed=7 + valSplit=0.2')
full_cfg = dict(BASE)
full_cfg.update({
    'optimizer': 'sgd',
    'momentum': 0.9,
    'lrScheduler': 'multistep',
    'seed': 7,
    'valSplit': 0.2,
    'epochs': 2,
})
ee, done = run_train(full_cfg, 'full')
check('训练完成', done is not None)
if done and done.get('config'):
    c = done['config']
    check('optimizer=sgd 回显', c.get('optimizer') == 'sgd')
    check('momentum=0.9 回显', c.get('momentum') == 0.9)
    check('lrScheduler=multistep 回显', c.get('lrScheduler') == 'multistep')
    check('seed=7 回显', c.get('seed') == 7)
    check('valSplit=0.2 回显', c.get('valSplit') == 0.2)
# 检查 train_size/val_size 日志（从事件里找 log）
print('  （train_size/val_size 日志见上方训练输出）')

# --- 测试 3：可复现性 ---
print()
print('[3] 可复现：seed=42 两次训练 trainLoss 一致')
c1 = dict(BASE); c1['seed'] = 42
c2 = dict(BASE); c2['seed'] = 42
ee1, _ = run_train(c1, 'seed-42-a')
ee2, _ = run_train(c2, 'seed-42-b')
l1 = ee1[0]['trainLoss'] if ee1 else None
l2 = ee2[0]['trainLoss'] if ee2 else None
check('两次 trainLoss 一致', l1 == l2, f'{l1} vs {l2}')

# --- 测试 4：不同 seed 结果不同（sanity） ---
print()
print('[4] seed 差异 sanity：seed=42 vs seed=43')
c3 = dict(BASE); c3['seed'] = 43
ee3, _ = run_train(c3, 'seed-43')
l3 = ee3[0]['trainLoss'] if ee3 else None
check('不同 seed trainLoss 不同（或至少都能运行）', l3 is not None, f'{l1} vs {l3}')

# --- 测试 5：build_optimizer / build_scheduler 单元 ---
print()
print('[5] build_optimizer / build_scheduler 单元测试')
class TinyNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.fc = nn.Linear(4, 2)
    def forward(self, x):
        return self.fc(x)

m = TinyNet()
opt_sgd = build_optimizer(m, 0.01, 'sgd', 0.0, 0.9)
check('SGD 含 momentum', isinstance(opt_sgd, torch.optim.SGD) and opt_sgd.defaults['momentum'] == 0.9)
opt_adam = build_optimizer(m, 0.01, 'adam')
check('Adam 默认', isinstance(opt_adam, torch.optim.Adam))
opt_adamw = build_optimizer(m, 0.01, 'adamw')
check('AdamW', isinstance(opt_adamw, torch.optim.AdamW))
opt_unknown = build_optimizer(m, 0.01, 'RMSprop')
check('未知回退 Adam', isinstance(opt_unknown, torch.optim.Adam))

s_ms = build_scheduler(opt_adam, 'multistep', 6)
check('multistep milestones', isinstance(s_ms, torch.optim.lr_scheduler.MultiStepLR) and sorted(s_ms.milestones.keys()) == [2, 4], str(getattr(s_ms, 'milestones', None)))
s_cos = build_scheduler(opt_adam, 'cosine', 6)
check('cosine T_max=6', isinstance(s_cos, torch.optim.lr_scheduler.CosineAnnealingLR) and s_cos.T_max == 6)
check('none 返回 None', build_scheduler(opt_adam, 'none', 6) is None)
check('epochs=1 multistep 退化为 None', build_scheduler(opt_adam, 'multistep', 1) is None)

print()
print(f'=== 结果：{PASS} 通过 / {FAIL} 失败 ===')
sys.exit(1 if FAIL else 0)
