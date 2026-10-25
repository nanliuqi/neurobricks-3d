# -*- coding: utf-8 -*-
"""
T1.3 修复后的执行级验证：
从 experimentExport.ts 提取当前模板（与源码同步），在临时目录真实跑通 train.py
（结构用最小网络，epochs=1，跳过 argparse 直接验证保存路径）。
重点：results/history.json 必须成功写入。
"""
import sys
import io
import os
import re
import subprocess
import tempfile

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

with open(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'src', 'utils', 'experimentExport.ts'), encoding='utf-8') as f:
    ts_content = f.read()

# 提取 generateTrainPy 的模板字符串（反引号之间）
start = ts_content.find('export function generateTrainPy')
tick1 = ts_content.find('`', start)
tick2 = ts_content.find('`;', tick1)
template = ts_content[tick1+1:tick2]
# 应用与 TS 相同的插值（用与 verify_t13 相同的测试配置）
config = {
    'epochs': 1, 'batchSize': 64, 'learningRate': 0.001, 'optimizer': 'sgd',
    'momentum': 0.9, 'lrScheduler': 'none', 'seed': 42, 'valSplit': 0.2,
    'weightDecay': 0, 'dataset': 'mnist',
}
code = template.replace('${config.epochs}', str(config['epochs']))
code = code.replace('${config.batchSize}', str(config['batchSize']))
code = code.replace('${config.learningRate}', str(config['learningRate']))
code = code.replace('${config.optimizer}', config['optimizer'])
code = code.replace('${config.momentum}', str(config['momentum']))
code = code.replace('${config.lrScheduler}', config['lrScheduler'])
code = code.replace('${config.seed}', str(config['seed']))
code = code.replace('${config.valSplit}', str(config['valSplit']))
code = code.replace('${config.weightDecay}', str(config['weightDecay']))
code = code.replace('${config.dataset}', config['dataset'])
# 处理条件表达式（模板里有 JS 表达式，直接替换为 Python 已知的等价结果）
code = code.replace("${config.dataset === 'cifar10' ? 'CIFAR10' : 'MNIST'}", 'MNIST')

# 关键断言：makedirs 在 open 之前
save_section = code[code.find('# ---------- 保存'):]
makedirs_pos = save_section.find("os.makedirs('results', exist_ok=True)")
open_pos = save_section.find("open('results/history.json'")
print('顺序检查: makedirs 在 open 之前:', 'PASS' if 0 <= makedirs_pos < open_pos else 'FAIL')

PY = r"C:\Users\64122\anaconda3\python.exe"

with tempfile.TemporaryDirectory() as td:
    train_path = os.path.join(td, 'train.py')
    model_path = os.path.join(td, 'model.py')
    with open(train_path, 'w', encoding='utf-8') as f:
        f.write(code)
    with open(model_path, 'w', encoding='utf-8') as f:
        f.write('''import torch.nn as nn

class NeuroBricksModel(nn.Module):
    def __init__(self):
        super(NeuroBricksModel, self).__init__()
        self.layer_1 = nn.Flatten()
        self.layer_2 = nn.Linear(784, 10)

    def forward(self, x):
        x = self.layer_1(x)
        x = self.layer_2(x)
        return x
''')

    # 真实执行（cwd=临时目录，MNIST 会下载到临时 data/ —— 用主缓存链接避免重新下载）
    # 复用已有的 MNIST 数据：把 sidecar 的 data 目录 symlink/复制过来太重，
    # MNIST 下载 ~10MB 可接受；但更快的方式：设 data-dir 指向已有数据
    sidecar_data = os.path.join(os.path.dirname(__file__), 'data')
    r = subprocess.run(
        [PY, train_path, '--epochs', '1', '--data-dir', sidecar_data],
        capture_output=True, text=True, cwd=td, timeout=600,
    )

    print('执行退出码:', r.returncode)
    if r.returncode != 0:
        print('STDERR 尾部:', r.stderr[-600:])
        sys.exit(1)

    # 验证产出物
    ckpt = os.path.join(td, 'checkpoints', 'model_weights.pth')
    hist = os.path.join(td, 'results', 'history.json')
    print('checkpoints/model_weights.pth:', 'PASS' if os.path.isfile(ckpt) else 'FAIL')
    print('results/history.json:', 'PASS' if os.path.isfile(hist) else 'FAIL')

    if os.path.isfile(hist):
        import json
        with open(hist, encoding='utf-8') as f:
            h = json.load(f)
        print('history.json 内容合法:', 'PASS' if isinstance(h, list) and len(h) == 1 and 'val_acc' in h[0] else 'FAIL')

    # stdout 应包含 Done
    print('Done 输出:', 'PASS' if 'Done:' in r.stdout else 'FAIL')

    ok = all([
        makedirs_pos >= 0 and makedirs_pos < open_pos,
        os.path.isfile(ckpt),
        os.path.isfile(hist),
        'Done:' in r.stdout,
    ])
    print()
    print('=== 总体:', 'ALL PASS' if ok else 'FAILED', '===')
    sys.exit(0 if ok else 1)
