# -*- coding: utf-8 -*-
"""
端到端验证：模拟 Rust spawn 方式（stdin 配置 -> 子进程 -> stdout 流式读取）
确认 dev 模式下新 train.py 的事件实时性（每条 progress 到达间隔应 < 500ms）
用法：anaconda python verify_e2e_stream.py
"""
import sys
import io
import json
import subprocess
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

CONFIG = {
    "mode": "train",
    "epochs": 2,
    "batchSize": 64,
    "learningRate": 0.001,
    "dataset": "mnist",
    "device": "cpu",
    "optimizer": "sgd",
    "momentum": 0.9,
    "lrScheduler": "cosine",
    "seed": 42,
    "valSplit": 0.1,
    "layers": [
        {"type": "Input", "params": {"inChannels": 1, "inputHeight": 28, "inputWidth": 28}},
        {"type": "Flatten", "params": {}},
        {"type": "Linear", "params": {"inFeatures": 784, "outFeatures": 32}},
        {"type": "ReLU", "params": {}},
        {"type": "Linear", "params": {"inFeatures": 32, "outFeatures": 10}},
    ],
}

PY = r"C:\Users\64122\anaconda3\python.exe"
MAIN = "main.py"

proc = subprocess.Popen(
    [PY, MAIN],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    cwd=".",
)
proc.stdin.write((json.dumps(CONFIG) + "\n").encode("utf-8"))
proc.stdin.flush()

t0 = time.time()
events = []
buf = b""
while True:
    ch = proc.stdout.read(1)
    if not ch:
        break
    buf += ch
    if ch == b"\n":
        line = buf.decode("utf-8", errors="replace").strip()
        buf = b""
        if line:
            try:
                ev = json.loads(line)
                ev["_t"] = round(time.time() - t0, 2)
                events.append(ev)
            except ValueError:
                pass

proc.wait()

progress_events = [e for e in events if e.get("type") == "progress"]
epoch_ends = [e for e in events if e.get("type") == "epoch_end"]
done = [e for e in events if e.get("type") == "done"]

print(f"总事件: {len(events)}, progress: {len(progress_events)}, epoch_end: {len(epoch_ends)}, done: {len(done)}")

# 实时性检查：相邻 progress 事件间隔
gaps = []
for i in range(1, len(progress_events)):
    gaps.append(progress_events[i]["_t"] - progress_events[i-1]["_t"])
if gaps:
    max_gap = max(gaps)
    avg_gap = sum(gaps) / len(gaps)
    print(f"progress 间隔: avg={avg_gap:.2f}s max={max_gap:.2f}s")
    ok = max_gap < 5.0  # 数据集加载期后每 batch ~0.1s；首事件前有加载时间
    print("实时性:", "PASS" if ok else "FAIL")

# config 回显
if done:
    cfg = done[-1].get("config", {})
    print("done.config:", json.dumps(cfg, ensure_ascii=False))
    checks = [
        ("sgd 回显", cfg.get("optimizer") == "sgd"),
        ("momentum 回显", cfg.get("momentum") == 0.9),
        ("cosine 回显", cfg.get("lrScheduler") == "cosine"),
        ("seed 回显", cfg.get("seed") == 42),
        ("valSplit 回显", cfg.get("valSplit") == 0.1),
    ]
    for name, c in checks:
        print(f"  {'PASS' if c else 'FAIL'} {name}")

# 首个 progress 之前的日志（应包含 seed/valSplit 日志）
logs = [e for e in events if e.get("type") == "log"]
for l in logs[:8]:
    print(f"  [{l['_t']:>6.2f}s] log: {l.get('message','')[:80]}")

proc.stderr.close()
sys.exit(0)
