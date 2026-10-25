# -*- coding: utf-8 -*-
"""
诊断脚本：直接调用 sidecar 训练入口，捕获 stdout JSON 事件流。
目的：验证 Python 端 progress/epoch_end 事件是否在训练过程中实时输出。
用法：anaconda python diagnose_stream.py（工作目录 nb-trainer/）
"""
import sys
import json
import io
import threading
import time

# UTF-8 输出（PowerShell GBK 环境保护）
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

from models import build_model
from train import train

# 最小 MLP：MNIST 上 CPU 也够快
LAYERS = [
    {"type": "Input", "params": {"inChannels": 1, "inputHeight": 28, "inputWidth": 28}},
    {"type": "Flatten", "params": {}},
    {"type": "Linear", "params": {"inFeatures": 784, "outFeatures": 64}},
    {"type": "ReLU", "params": {}},
    {"type": "Linear", "params": {"inFeatures": 64, "outFeatures": 10}},
]

CONFIG = {
    "mode": "train",
    "epochs": 1,
    "batchSize": 64,
    "learningRate": 0.001,
    "dataset": "mnist",
    "device": "cpu",
    "layers": LAYERS,
}

# 拦截 print 输出：train.py 的 log_message 用 print(..., flush=True)
# 我们劫持 builtins.print，把 JSON 行打上时间戳写到真实 stdout
import builtins
_real_print = builtins.print
_t0 = time.time()

def timestamped_print(*args, **kwargs):
    s = ' '.join(str(a) for a in args)
    try:
        obj = json.loads(s)
        t = obj.get('type', '?')
        elapsed = round(time.time() - _t0, 2)
        _real_print(f"[{elapsed:>8.2f}s] event={t:<10} {json.dumps({k: v for k, v in obj.items() if k != 'type'}, ensure_ascii=False)[:160]}", flush=True)
    except (ValueError, TypeError):
        _real_print(f"[{round(time.time() - _t0, 2):>8.2f}s] raw: {s[:160]}", flush=True)

builtins.print = timestamped_print

# 训练控制器命令不走 stdin（本诊断不需要暂停/停止），train() 的监听线程读不到东西会立即 EOF 退出，无害
model_and_shape = build_model(CONFIG['layers'])
train(model_and_shape, CONFIG)

builtins.print = _real_print
print("DIAG-DONE", flush=True)
