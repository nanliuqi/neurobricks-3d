# -*- coding: utf-8 -*-
"""
生成预训练 ONNX 权重包（含中间层输出）

流程：
  1. 读取 models_config.json（由 scripts/extract_models_config.mjs 从前端
     CLASSIC_MODELS 提取并经前端同一 adaptLayersToInputShape 适配，绝不手抄）
  2. 逐模型训练（复用 models.py 的 build_model，简化训练循环，seed=42）
     - MNIST 系（lenet5/simplecnn/mlp）：目标 ≥97%，最多 5 epochs
     - CIFAR-10 系：目标 ≥85%，最多 30 epochs，Adam + cosine 调度；
       单模型超 30 分钟未达标 → 降级目标 80% 继续（不死磕）
     - U-Net：无内置分割数据集，manifest 标注 excluded
  3. ONNX 导出：WithIntermediateOutputs 包装器把每个中间层输出暴露为额外输出，
     动态 batch，opset 17
  4. onnxruntime 动态量化（per-channel, int8）
  5. 输出 weights_pack/<model_id>.onnx + manifest.json
  6. 末尾自检段：onnxruntime 逐模型加载 + 随机张量前向 + 输出数校验

用法：python generate_weights.py
"""
import json
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.optim import Adam
from torch.optim.lr_scheduler import CosineAnnealingLR
from torch.utils.data import DataLoader
from torchvision import datasets, transforms

import models  # 复用 build_model，不改动业务代码

SEED = 42
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
OUT_DIR = BASE_DIR / "weights_pack"
CONFIG_PATH = BASE_DIR / "models_config.json"

# 每个数据集的训练计划
TRAIN_PLAN = {
    # MNIST 系：3~5 epochs 目标 ≥97%
    "mnist": dict(epochs=5, batch=128, lr=1e-3, target=0.97,
                  scheduler=None, max_minutes=15, degraded_target=None),
    # CIFAR-10 系：15~30 epochs 目标 ≥85%，cosine + adam；超时降级 ≥80%
    "cifar10": dict(epochs=30, batch=64, lr=1e-3, target=0.85,
                    scheduler="cosine", max_minutes=30, degraded_target=0.80),
}

# 个别模型学习率覆盖：224×224 无 BN 深池化链在 lr=1e-3 下实测死平台
# （连续 9 epochs 停在随机猜测 10%），提高到 3e-3
LR_OVERRIDE = {"alexnet": 3e-3, "googlenet": 3e-3}

# --force 参数：忽略已有达标结果，全部重新训练
FORCE = "--force" in sys.argv


def log(msg: str):
    print(msg, flush=True)


def set_seed(seed: int):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


def load_dataset(dataset: str, input_shape, train: bool):
    """加载数据集；input_shape=[C,H,W]，非原生尺寸时 Resize（AlexNet/GoogLeNet@224）"""
    c, h, w = input_shape
    if dataset == "mnist":
        tf = transforms.Compose([
            transforms.Resize((h, w)),
            transforms.ToTensor(),
            transforms.Normalize((0.1307,), (0.3081,)),
        ])
        return datasets.MNIST(root=str(DATA_DIR), train=train, download=True, transform=tf)
    elif dataset == "cifar10":
        tf = transforms.Compose([
            transforms.Resize((h, w)),
            transforms.ToTensor(),
            transforms.Normalize((0.4914, 0.4822, 0.4465), (0.2470, 0.2435, 0.2616)),
        ])
        return datasets.CIFAR10(root=str(DATA_DIR), train=train, download=True, transform=tf)
    raise ValueError(f"unsupported dataset: {dataset}")


def evaluate(model, loader, device):
    model.eval()
    correct, total, loss_sum = 0, 0, 0.0
    crit = nn.CrossEntropyLoss()
    with torch.no_grad():
        for x, y in loader:
            x, y = x.to(device), y.to(device)
            out = model(x)
            loss_sum += crit(out, y).item() * y.size(0)
            correct += (out.argmax(1) == y).sum().item()
            total += y.size(0)
    return correct / max(total, 1), loss_sum / max(total, 1)


def train_one(cfg: dict, device) -> dict:
    """训练单个模型，返回训练摘要"""
    plan = TRAIN_PLAN[cfg["dataset"]]
    lr = LR_OVERRIDE.get(cfg["id"], plan["lr"])
    set_seed(SEED)

    model, _ = models.build_model(cfg["layers"])
    model = model.to(device)

    train_set = load_dataset(cfg["dataset"], cfg["inputShape"], train=True)
    test_set = load_dataset(cfg["dataset"], cfg["inputShape"], train=False)
    train_loader = DataLoader(train_set, batch_size=plan["batch"], shuffle=True, num_workers=0)
    test_loader = DataLoader(test_set, batch_size=plan["batch"], shuffle=False, num_workers=0)

    optimizer = Adam(model.parameters(), lr=lr)
    log(f"  [{cfg['id']}] lr={lr}")
    scheduler = None
    if plan["scheduler"] == "cosine":
        scheduler = CosineAnnealingLR(optimizer, T_max=plan["epochs"])
    crit = nn.CrossEntropyLoss()

    target = plan["target"]
    degraded = False
    deadline = time.time() + plan["max_minutes"] * 60
    best_acc, best_epoch = 0.0, 0
    history = []  # (epoch, train_loss, val_acc)
    start = time.time()

    for epoch in range(1, plan["epochs"] + 1):
        model.train()
        loss_sum, total = 0.0, 0
        for x, y in train_loader:
            x, y = x.to(device), y.to(device)
            optimizer.zero_grad()
            out = model(x)
            loss = crit(out, y)
            loss.backward()
            optimizer.step()
            loss_sum += loss.item() * y.size(0)
            total += y.size(0)
        if scheduler is not None:
            scheduler.step()
        train_loss = loss_sum / max(total, 1)
        val_acc, val_loss = evaluate(model, test_loader, device)
        elapsed = time.time() - start
        history.append((epoch, train_loss, val_acc))
        log(f"  [{cfg['id']}] epoch {epoch}/{plan['epochs']} "
            f"train_loss={train_loss:.4f} val_loss={val_loss:.4f} "
            f"val_acc={val_acc * 100:.2f}% elapsed={elapsed:.0f}s")

        if val_acc > best_acc:
            best_acc, best_epoch = val_acc, epoch

        # 超时降级：超过时间预算仍未达标 → 降低标准继续（不死磕）
        if (not degraded and plan["degraded_target"] is not None
                and time.time() > deadline and val_acc < target):
            degraded = True
            target = plan["degraded_target"]
            log(f"  [{cfg['id']}] 超过 {plan['max_minutes']} 分钟未达 "
                f"{plan['target'] * 100:.0f}%，降级目标至 {target * 100:.0f}% 继续")

        if val_acc >= target:
            log(f"  [{cfg['id']}] 达标 val_acc={val_acc * 100:.2f}% ≥ {target * 100:.0f}%，提前结束")
            break

    return dict(
        model=model,
        best_acc=best_acc,
        best_epoch=best_epoch,
        final_acc=history[-1][2],
        epochs_trained=len(history),
        first_epoch=history[0],
        last_epoch=history[-1],
        seconds=time.time() - start,
        degraded=degraded,
        target=target,
    )


class WithIntermediateOutputs(nn.Module):
    """包装 Sequential：forward 逐层前向并收集每层输出，
    返回 (最终输出, 中间层1, 中间层2, ...)，全部暴露为 ONNX 输出"""

    def __init__(self, sequential: nn.Sequential):
        super().__init__()
        # 接管 Sequential 的各层（同一批对象，重新挂载父级）
        self.layers = nn.ModuleList(list(sequential.children()))

    def forward(self, x):
        outs = []
        for layer in self.layers:
            x = layer(x)
            outs.append(x)
        return (outs[-1], *outs[:-1])


def intermediate_output_names(sequential: nn.Sequential):
    """中间层输出命名模式：feat_<两位序号>_<模块类名>。
    注意：最后一层的输出即最终输出（固定名 output），不算中间层，
    故只命名前 n-1 层。总输出数 = 1(最终) + (n-1)(中间) = n。"""
    names = []
    children = list(sequential.children())
    for i, layer in enumerate(children[:-1]):
        names.append(f"feat_{i:02d}_{type(layer).__name__}")
    return names


def export_onnx(model, input_shape, onnx_fp32_path: Path, output_names):
    """导出 ONNX（动态 batch，opset 17）。优先 TorchScript 导出器（dynamo=False），
    新版 torch 不兼容时逐级回退。"""
    wrapped = WithIntermediateOutputs(model).eval().cpu()
    dummy = torch.randn(1, *input_shape)
    dyn = {"input": {0: "batch"}}
    for n in output_names:
        dyn[n] = {0: "batch"}

    try:
        torch.onnx.export(
            wrapped, (dummy,), str(onnx_fp32_path),
            input_names=["input"], output_names=output_names,
            dynamic_axes=dyn, opset_version=17, dynamo=False,
        )
    except TypeError:
        # 某些版本移除了 dynamo 参数：不指定（按版本默认行为）
        torch.onnx.export(
            wrapped, (dummy,), str(onnx_fp32_path),
            input_names=["input"], output_names=output_names,
            dynamic_axes=dyn, opset_version=17,
        )


def quantize_model(fp32_path: Path, out_path: Path):
    """动态量化（per-channel, int8）。
    注意：onnxruntime 量化内部的 shape inference 临时文件在中文路径下会失败，
    故先复制到 ASCII 临时目录量化，再拷回目标位置。"""
    import shutil
    import tempfile
    from onnxruntime.quantization import quantize_dynamic, QuantType
    with tempfile.TemporaryDirectory(prefix="nb_quant_") as tmp:
        tmp_dir = Path(tmp)
        tmp_in = tmp_dir / fp32_path.name
        tmp_out = tmp_dir / out_path.name
        shutil.copy2(fp32_path, tmp_in)
        quantize_dynamic(str(tmp_in), str(tmp_out),
                         per_channel=True, weight_type=QuantType.QInt8)
        shutil.copy2(tmp_out, out_path)


def self_check(manifest):
    """自检：逐模型 onnxruntime 加载 + 随机张量前向 + 输出数校验。
    加载同样在 ASCII 临时目录进行（规避中文路径问题）。"""
    import shutil
    import tempfile
    import onnxruntime as ort
    log("\n===== 自检段 =====")
    multi_output_found = False
    for m in manifest:
        if m.get("excluded"):
            continue
        p = OUT_DIR / f"{m['modelId']}.onnx"
        with tempfile.TemporaryDirectory(prefix="nb_check_") as tmp:
            tmp_model = Path(tmp) / p.name
            shutil.copy2(p, tmp_model)
            sess = ort.InferenceSession(str(tmp_model), providers=["CPUExecutionProvider"])
            ins, outs = sess.get_inputs(), sess.get_outputs()
            assert ins[0].name == "input", f"{m['modelId']}: 输入名异常 {ins[0].name}"
            shape = [1 if (d is None or isinstance(d, str)) else d for d in ins[0].shape]
            x = np.random.randn(*shape).astype(np.float32)
            res = sess.run(None, {ins[0].name: x})
        expected_outs = len(m["intermediateOutputNames"]) + 1
        assert len(res) == expected_outs, \
            f"{m['modelId']}: 输出数 {len(res)} != 期望 {expected_outs}"
        if len(res) > 1:
            multi_output_found = True
        log(f"  [selfcheck] {m['modelId']}: outputs={len(res)} "
            f"final_shape={list(res[0].shape)} OK")
    assert multi_output_found, "中间层输出验证失败：没有任何模型输出数 > 1"
    log("  [selfcheck] 中间层输出验证通过（存在输出数 > 1 的模型）")
    log("===== 自检全部通过 =====")


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    log(f"device: {device}" + (f" ({torch.cuda.get_device_name(0)})" if device.type == "cuda" else ""))

    configs = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    manifest = []
    summaries = []
    manifest_path = OUT_DIR / "manifest.json"

    # 已有 manifest（用于增量重跑：跳过已达标模型，只重训未达标/缺失的）
    existing_entries = {}
    if manifest_path.exists():
        try:
            existing_entries = {
                m["modelId"]: m
                for m in json.loads(manifest_path.read_text(encoding="utf-8"))
                if isinstance(m, dict) and m.get("modelId")
            }
        except Exception:
            existing_entries = {}

    def flush_manifest():
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    def can_skip(cfg):
        """已有达标结果且 onnx 存在 → 可跳过（--force 时不跳）"""
        if FORCE or cfg.get("excluded"):
            return False
        entry = existing_entries.get(cfg["id"])
        if not entry or entry.get("excluded") or not entry.get("accuracy"):
            return False
        plan = TRAIN_PLAN[cfg["dataset"]]
        ok = entry["accuracy"] >= plan["target"] and (OUT_DIR / f"{cfg['id']}.onnx").exists()
        return ok

    for cfg in configs:
        if cfg.get("excluded"):
            log(f"\n=== {cfg['id']} ({cfg['name']}): 跳过 — {cfg['excluded']}")
            manifest.append(dict(
                modelId=cfg["id"], name=cfg["name"], dataset=None,
                accuracy=None, finalAccuracy=None, inputShape=None,
                intermediateOutputNames=[], epochs=0, fileSize=0,
                exportedAt=None, excluded=cfg["excluded"],
            ))
            flush_manifest()
            continue

        if can_skip(cfg):
            entry = existing_entries[cfg["id"]]
            manifest.append(entry)
            log(f"\n=== {cfg['id']} ({cfg['name']}): 已有达标结果 "
                f"acc={entry['accuracy']}，跳过（--force 可强制重训）")
            continue

        log(f"\n=== 训练 {cfg['id']} ({cfg['name']}) dataset={cfg['dataset']} "
            f"input={cfg['inputShape']} layers={len(cfg['layers'])}")
        result = train_one(cfg, device)

        # ONNX 导出（含中间层输出）
        out_names = intermediate_output_names(result["model"])
        all_names = ["output"] + out_names
        fp32_path = OUT_DIR / f"{cfg['id']}_fp32.onnx"
        final_path = OUT_DIR / f"{cfg['id']}.onnx"
        log(f"  [{cfg['id']}] 导出 ONNX（{len(all_names)} 个输出）...")
        export_onnx(result["model"], cfg["inputShape"], fp32_path, all_names)
        quantize_model(fp32_path, final_path)
        fp32_path.unlink()  # 只保留量化版

        size = final_path.stat().st_size
        if size > 25 * 1024 * 1024:
            log(f"  [{cfg['id']}] ⚠ 量化后 {size / 1024 / 1024:.1f}MB 超过 25MB（继续，按约束报告）")

        manifest.append(dict(
            modelId=cfg["id"], name=cfg["name"], dataset=cfg["dataset"],
            accuracy=round(result["best_acc"], 4),
            finalAccuracy=round(result["final_acc"], 4),
            inputShape=cfg["inputShape"],
            intermediateOutputNames=out_names,
            epochs=result["epochs_trained"],
            bestEpoch=result["best_epoch"],
            targetAccuracy=result["target"],
            degraded=result["degraded"],
            fileSize=size,
            trainingSeconds=round(result["seconds"]),
            exportedAt=datetime.now(timezone.utc).isoformat(),
        ))
        summaries.append((cfg["id"], result))
        flush_manifest()  # 增量写入：中途崩溃不丢失已完成部分
        log(f"  [{cfg['id']}] 完成：best_acc={result['best_acc'] * 100:.2f}% "
            f"(epoch {result['best_epoch']}) size={size / 1024 / 1024:.1f}MB "
            f"耗时 {result['seconds']:.0f}s")

    log(f"\nmanifest written: {manifest_path}")

    # 汇总报告（验证标准 6：首/末 epoch loss+acc 摘要）
    log("\n===== 训练摘要 =====")
    for mid, r in summaries:
        e1, l1, a1 = r["first_epoch"]
        en, ln, an = r["last_epoch"]
        log(f"  {mid}: first(epoch{e1}) loss={l1:.4f} acc={a1 * 100:.2f}% | "
            f"last(epoch{en}) loss={ln:.4f} acc={an * 100:.2f}% | "
            f"best={r['best_acc'] * 100:.2f}% degraded={r['degraded']}")
    total = sum(m["fileSize"] for m in manifest if not m.get("excluded"))
    log("\n===== 包体报告 =====")
    for m in manifest:
        if m.get("excluded"):
            log(f"  {m['modelId']}: excluded")
        else:
            log(f"  {m['modelId']}: {m['fileSize'] / 1024 / 1024:.1f}MB")
    log(f"  总计: {total / 1024 / 1024:.1f}MB ({len([m for m in manifest if not m.get('excluded')])} 个 onnx)")

    self_check(manifest)


if __name__ == "__main__":
    main()
