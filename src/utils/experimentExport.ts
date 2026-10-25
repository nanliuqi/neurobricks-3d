import type { Layer3D } from '@/types/layer';
import type { TrainMetric } from '@/types/training';
import type { Attempt, ExperimentLedgerV1 } from '@/types/experiment';
import { stableProtocolJson } from '@/utils/experimentProtocol';
import {
  extractStrictSeriesFromMetrics,
  formatStrictMetricValue,
  strictMetricDescriptorFromMetrics,
} from '@/utils/metricSeries';

/**
 * 实验包导出：生成可直接独立运行的 PyTorch 实验工程
 *
 * 包结构：
 * - model.py    模型定义（由 codeGenerator 的层定义复刻，含结构摘要注释）
 * - train.py    独立训练脚本（argparse 可覆盖超参，默认值 = 用户当前配置）
 * - requirements.txt
 * - README.md   实验记录（结构表/超参/结果/复现命令）
 * - results/metrics.csv（若有训练数据）
 */

/** 用户训练配置快照（来自 QuickTrain localStorage / TrainConfig） */
export interface ExperimentConfig {
  epochs: number;
  batchSize: number;
  learningRate: number;
  optimizer: string;
  momentum: number;
  lrScheduler: string;
  seed: number;
  valSplit: number;
  weightDecay: number;
  dataset: string;
}

export interface ExperimentExportTrustContext {
  attemptId: string | null;
  executionTrust: 'trusted' | 'interrupted' | 'unverified';
  conclusionTrust: 'not_evaluated' | 'exploratory' | 'iid_only' | 'gold';
  modelWeightsHash: string | null;
  auditPersistence: 'unavailable' | 'healthy' | 'degraded';
  /** 可选统计（模块 06 跨界补丁）：结论等级只归属具体 Claim，不得笼统描述整个模型。 */
  claimCount?: number;
  claimAnomalyCount?: number;
  claimPersistenceBlockedCount?: number;
}

/**
 * 从持久化的四层档案中选择与当前结构一致的最近一次真实完成 Attempt。
 * 结果卡片关闭只清理临时 UI 状态，不得抹掉已经落入 Attempt 的指标和产物权限。
 */
export function selectLatestCompletedAttemptForLayers(
  ledger: ExperimentLedgerV1,
  layers: Layer3D[],
  preferredAttemptId?: string | null,
): Attempt | null {
  const currentArchitecture = stableProtocolJson(
    layers.map(layer => ({ type: layer.type, params: layer.params })),
  );
  const candidates = ledger.attempts.filter(attempt => (
    attempt.status === 'completed'
    && attempt.executionMode === 'native'
    && stableProtocolJson(attempt.config.layers.map(layer => ({ type: layer.type, params: layer.params }))) === currentArchitecture
  ));
  const preferred = preferredAttemptId
    ? candidates.find(attempt => attempt.id === preferredAttemptId)
    : null;
  if (preferred) return preferred;
  return [...candidates].sort((left, right) => (
    (right.endedAt ?? right.startedAt ?? 0) - (left.endedAt ?? left.startedAt ?? 0)
  ))[0] ?? null;
}

/** 生成 model.py —— 与 codeGenerator.generatePyTorchCode 结构一致，但类名/注释面向独立使用 */
export function generateModelPy(layers: Layer3D[], networkName: string): string {
  const sorted = [...layers].sort((a, b) => a.order - b.order);
  const lines: string[] = [];
  const forwardLines: string[] = ['x'];

  for (let i = 0; i < sorted.length; i++) {
    const layer = sorted[i];
    const params = layer.params || {};
    const name = `self.layer_${i}`;

    switch (layer.type) {
      case 'Input': {
        const ic = params.inChannels ?? 1;
        const ih = params.inputHeight ?? 28;
        const iw = params.inputWidth ?? 28;
        lines.push(`        # Input: shape [${ic}, ${ih}, ${iw}]`);
        forwardLines.push(`x  # Input: [${ic}, ${ih}, ${iw}]`);
        break;
      }
      case 'Conv2D': {
        const ic = params.inChannels ?? 1;
        const oc = params.outChannels ?? 32;
        const k = params.kernelSize ?? 3;
        const s = params.stride ?? 1;
        const p = params.padding ?? 0;
        lines.push(`        ${name} = nn.Conv2d(${ic}, ${oc}, ${k}, stride=${s}, padding=${p})`);
        forwardLines.push(`${name}(x)`);
        break;
      }
      case 'MaxPool2D': {
        const k = params.poolKernelSize ?? 2;
        const s = params.poolStride ?? k;
        lines.push(`        ${name} = nn.MaxPool2d(${k}, stride=${s})`);
        forwardLines.push(`${name}(x)`);
        break;
      }
      case 'AvgPool2D': {
        const k = params.poolKernelSize ?? 2;
        const s = params.poolStride ?? k;
        lines.push(`        ${name} = nn.AvgPool2d(${k}, stride=${s})`);
        forwardLines.push(`${name}(x)`);
        break;
      }
      case 'Linear': {
        const iF = params.inFeatures ?? 128;
        const oF = params.outFeatures ?? 10;
        lines.push(`        ${name} = nn.Linear(${iF}, ${oF})`);
        forwardLines.push(`${name}(x)`);
        break;
      }
      case 'ReLU':
        lines.push(`        ${name} = nn.ReLU()`);
        forwardLines.push(`${name}(x)`);
        break;
      case 'Sigmoid':
        lines.push(`        ${name} = nn.Sigmoid()`);
        forwardLines.push(`${name}(x)`);
        break;
      case 'Tanh':
        lines.push(`        ${name} = nn.Tanh()`);
        forwardLines.push(`${name}(x)`);
        break;
      case 'BatchNorm2d': {
        const nf = params.numFeatures ?? 32;
        lines.push(`        ${name} = nn.BatchNorm2d(${nf})`);
        forwardLines.push(`${name}(x)`);
        break;
      }
      case 'LayerNorm': {
        const ns = params.normalizedShape ?? 32;
        lines.push(`        ${name} = nn.LayerNorm(${ns})`);
        forwardLines.push(`${name}(x)`);
        break;
      }
      case 'Dropout': {
        const p = params.dropRate ?? 0.5;
        lines.push(`        ${name} = nn.Dropout(${p})`);
        forwardLines.push(`${name}(x)`);
        break;
      }
      case 'Flatten':
        lines.push(`        ${name} = nn.Flatten()`);
        forwardLines.push(`${name}(x)`);
        break;
      default:
        break;
    }
  }

  return `"""模型定义：${networkName}

由 NeuroBricks 3D 导出。层结构摘要见 README.md。
"""
import torch.nn as nn


class NeuroBricksModel(nn.Module):
    def __init__(self):
        super(NeuroBricksModel, self).__init__()
${lines.join('\n')}

    def forward(self, x):
${forwardLines.map(l => `        x = ${l}`).join('\n')}
        return x
`;
}

/** 生成 train.py —— 独立可运行，超参默认值 = 用户当前配置，argparse 可覆盖 */
export function generateTrainPy(config: ExperimentConfig): string {
  return `"""训练脚本：由 NeuroBricks 3D 导出

独立运行（无需 NeuroBricks）：
    python train.py                    # 使用导出时的超参
    python train.py --epochs 10        # 命令行覆盖任意超参

依赖：pip install -r requirements.txt
"""
import argparse
import csv
import json
import os
import random
import time

import numpy as np
import torch
import torch.nn as nn
from model import NeuroBricksModel
from torchvision import datasets, transforms

# ---------- 超参（默认值 = 导出时 NeuroBricks 中的配置） ----------

p = argparse.ArgumentParser(description='NeuroBricks 导出训练脚本')
p.add_argument('--epochs', type=int, default=${config.epochs})
p.add_argument('--batch-size', type=int, default=${config.batchSize})
p.add_argument('--lr', type=float, default=${config.learningRate})
p.add_argument('--optimizer', type=str, default='${config.optimizer}', choices=['adam', 'adamw', 'sgd'])
p.add_argument('--momentum', type=float, default=${config.momentum})
p.add_argument('--lr-scheduler', type=str, default='${config.lrScheduler}', choices=['none', 'multistep', 'cosine'])
p.add_argument('--seed', type=int, default=${config.seed})
p.add_argument('--val-split', type=float, default=${config.valSplit})
p.add_argument('--weight-decay', type=float, default=${config.weightDecay})
p.add_argument('--dataset', type=str, default='${config.dataset}', choices=['${config.dataset}'])
p.add_argument('--device', type=str, default='cuda' if torch.cuda.is_available() else 'cpu')
p.add_argument('--data-dir', type=str, default='./data')
args = p.parse_args()
if not (0 < args.val_split <= 0.5):
    raise ValueError('val-split must be in (0, 0.5]; the test set is reserved for frozen eval-only claims')

# ---------- 可复现性 ----------

random.seed(args.seed)
np.random.seed(args.seed)
torch.manual_seed(args.seed)
torch.cuda.manual_seed_all(args.seed)
torch.backends.cudnn.benchmark = False
torch.backends.cudnn.deterministic = True
torch.use_deterministic_algorithms(True)

device = torch.device(args.device)
print(f'Training on {device}')

# ---------- 数据 ----------

if args.dataset == 'mnist':
    transform = transforms.Compose([
        transforms.ToTensor(),
        transforms.Normalize((0.1307,), (0.3081,)),
    ])
    full = datasets.MNIST(args.data_dir, train=True, download=True, transform=transform)
    in_channels, height, width = 1, 28, 28
else:
    transform = transforms.Compose([
        transforms.ToTensor(),
        transforms.Normalize((0.4914, 0.4822, 0.4465), (0.2470, 0.2435, 0.2616)),
    ])
    full = datasets.CIFAR10(args.data_dir, train=True, download=True, transform=transform)
    in_channels, height, width = 3, 32, 32

n_val = int(round(len(full) * args.val_split))
n_train = len(full) - n_val
g = torch.Generator().manual_seed(args.seed)
indices = torch.randperm(len(full), generator=g).tolist()
train_set = torch.utils.data.Subset(full, indices[:n_train])
val_set = torch.utils.data.Subset(full, indices[n_train:])
print(f'train_size={n_train} val_size={n_val}; official test set remains sealed')

train_loader = torch.utils.data.DataLoader(train_set, batch_size=args.batch_size, shuffle=True, num_workers=0)
val_loader = torch.utils.data.DataLoader(val_set, batch_size=args.batch_size, shuffle=False, num_workers=0)

# ---------- 模型 / 优化器 ----------

model = NeuroBricksModel().to(device)
criterion = nn.CrossEntropyLoss()

if args.optimizer == 'sgd':
    optimizer = torch.optim.SGD(model.parameters(), lr=args.lr, momentum=args.momentum, weight_decay=args.weight_decay)
elif args.optimizer == 'adamw':
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
else:
    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)

if args.lr_scheduler == 'multistep':
    milestones = sorted({max(1, args.epochs // 3), max(2, args.epochs * 2 // 3)})
    milestones = [m for m in milestones if m < args.epochs]
    scheduler = torch.optim.lr_scheduler.MultiStepLR(optimizer, milestones=milestones, gamma=0.1) if milestones else None
elif args.lr_scheduler == 'cosine':
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs) if args.epochs > 1 else None
else:
    scheduler = None

# ---------- 训练循环 ----------

history = []
global_step = 0
for epoch in range(1, args.epochs + 1):
    model.train()
    running_loss, correct, total = 0.0, 0, 0
    for batch_index, (data, target) in enumerate(train_loader):
        data, target = data.to(device), target.to(device)
        optimizer.zero_grad()
        output = model(data)
        loss = criterion(output, target)
        loss.backward()
        optimizer.step()
        running_loss += loss.item()
        _, pred = output.max(1)
        total += target.size(0)
        correct += pred.eq(target).sum().item()
        global_step += 1
        if batch_index % 10 == 0:
            history.append({
                'recordId': f'external:train:{epoch}:{global_step}', 'epoch': epoch,
                'globalStep': global_step, 'split': 'train', 'scope': 'batch',
                'lossName': 'cross_entropy', 'lossValue': round(loss.item(), 6),
                'metricName': 'accuracy', 'metricValue': round(correct / max(total, 1), 6),
                'optimizationDirection': 'maximize', 'sampleCount': total,
                'timestamp': int(time.time() * 1000),
            })

    model.eval()
    val_loss, val_correct, val_total = 0.0, 0, 0
    with torch.no_grad():
        for data, target in val_loader:
            data, target = data.to(device), target.to(device)
            output = model(data)
            val_loss += criterion(output, target).item()
            _, pred = output.max(1)
            val_total += target.size(0)
            val_correct += pred.eq(target).sum().item()

    train_loss = running_loss / max(len(train_loader), 1)
    val_acc = val_correct / max(val_total, 1)
    history.append({
        'recordId': f'external:validation:{epoch}:{global_step}', 'epoch': epoch,
        'globalStep': global_step, 'split': 'validation', 'scope': 'epoch',
        'lossName': 'cross_entropy', 'lossValue': round(val_loss / max(len(val_loader), 1), 6),
        'metricName': 'accuracy', 'metricValue': round(val_acc, 6),
        'optimizationDirection': 'maximize', 'sampleCount': val_total,
        'timestamp': int(time.time() * 1000),
    })
    print(f'Epoch {epoch}/{args.epochs}  train_loss={train_loss:.4f}  val_acc={val_acc:.4f}')

    if scheduler is not None:
        scheduler.step()

# ---------- 保存 ----------

run_stamp = time.strftime('%Y%m%d-%H%M%S')
run_dir = os.path.join('reruns', f'{run_stamp}-{os.getpid()}')
checkpoint_dir = os.path.join(run_dir, 'checkpoints')
result_dir = os.path.join(run_dir, 'results')
os.makedirs(checkpoint_dir, exist_ok=False)
os.makedirs(result_dir, exist_ok=False)
weights_path = os.path.join(checkpoint_dir, 'model_weights.pth')
history_path = os.path.join(result_dir, 'history.json')
metrics_path = os.path.join(result_dir, 'metrics.csv')
torch.save(model.state_dict(), weights_path)
with open(history_path, 'w', encoding='utf-8') as f:
    json.dump(history, f, ensure_ascii=False, indent=2)
metric_fields = ['recordId', 'epoch', 'globalStep', 'split', 'scope', 'lossName', 'lossValue',
                 'metricName', 'metricValue', 'optimizationDirection', 'sampleCount', 'timestamp']
with open(metrics_path, 'w', encoding='utf-8', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=metric_fields)
    writer.writeheader()
    writer.writerows(history)
print(f'Done (external/unverified rerun): {run_dir}')
`;
}

/** 生成 requirements.txt（与 sidecar 运行环境对齐的最低要求） */
export function generateRequirements(): string {
  return `--extra-index-url https://download.pytorch.org/whl/cu128
torch==2.11.0+cu128
torchvision==0.26.0+cu128
numpy==1.26.4
`;
}

/** 离线核验包内实际导出文件；manifest 自身因循环依赖不列入哈希清单。 */
export function generateVerifyPackagePy(): string {
  return `"""Verify NeuroBricks exportedArtifacts without executing model code."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parent
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
artifacts = manifest.get('exportedArtifacts')
if not isinstance(artifacts, list) or not artifacts:
    raise SystemExit('FAIL: manifest has no exportedArtifacts')

for item in artifacts:
    relative = item.get('path')
    if not isinstance(relative, str) or not relative or Path(relative).is_absolute() or '..' in Path(relative).parts:
        raise SystemExit(f'FAIL: unsafe artifact path: {relative!r}')
    path = (root / relative).resolve()
    if root not in path.parents:
        raise SystemExit(f'FAIL: artifact escapes package: {relative}')
    if not path.is_file():
        raise SystemExit(f'FAIL: missing artifact: {relative}')
    payload = path.read_bytes()
    actual = 'sha256:' + hashlib.sha256(payload).hexdigest()
    if len(payload) != item.get('sizeBytes') or actual != item.get('sha256'):
        raise SystemExit(f'FAIL: identity mismatch: {relative}')
print(f'PASS: verified {len(artifacts)} exported artifacts')
`;
}

/** 生成 README.md —— 实验记录（结构表 / 超参 / 结果 / 复现命令） */
export function generateReadmeMd(
  networkName: string,
  layers: Layer3D[],
  totalParams: number,
  config: ExperimentConfig,
  metrics: TrainMetric[],
  resultMode: 'native' | 'simulation' | 'none' = metrics.length > 0 ? 'native' : 'none',
  trust?: ExperimentExportTrustContext,
): string {
  const now = new Date();
  const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const sorted = [...layers].sort((a, b) => a.order - b.order);
  const tableRows = sorted
    .map((l, i) => {
      const shape = l.outputShape ? `[${l.outputShape.join(', ')}]` : '-';
      return `| ${i + 1} | ${l.type} | ${shape} | ${l.paramCount.toLocaleString()} |`;
    })
    .join('\n');

  const hasResult = resultMode === 'native' && metrics.length > 0;
  /* README 最终指标摘要只消费严格指标单一来源（README 摘要收口补丁）：
   * - 不读数组最后一项冒充最终验证指标；
   * - 描述符/序列任一不可用（缺 split/scope/metricName/方向、多指标、全非有限）
   *   → 不生成“最后一轮验证集”摘要，显示规定文案；
   * - 单位不猜测：只有 accuracy 按百分比展示，其余原始数值。 */
  const strictDescriptor = hasResult ? strictMetricDescriptorFromMetrics(metrics) : null;
  const strictFinalSeries = strictDescriptor && strictDescriptor.available
    ? extractStrictSeriesFromMetrics(metrics, strictDescriptor.descriptor.metricName)
    : null;
  const strictFinalPoint = strictFinalSeries && strictFinalSeries.ok
    ? strictFinalSeries.points[strictFinalSeries.points.length - 1]
    : null;
  const readmeMetricLabel = (name: string): string => (
    name === 'accuracy' ? '准确率' : name === 'mae' ? ' MAE' : ` ${name}`
  );
  const resultText = resultMode === 'simulation'
    ? '当前仅有浏览器演示数据；模拟曲线不作为真实训练结果写入实验包。'
    : !hasResult
      ? '导出时暂无已完成的真实训练记录。'
      : strictDescriptor?.available && strictFinalSeries?.ok && strictFinalPoint
        /* epoch 诚实语义（最终指标语义补丁）：展示所采用的真实 epoch 编号，
         * 不无条件称“最后一轮”；存在被排除的严格候选记录时明确说明
         * 摘要不一定代表最终训练轮指标；train/batch 记录不在排除计数内。 */
        ? `导出时最近一次真实训练：最近一个有效 validation/epoch 指标（epoch ${strictFinalPoint.epoch}）${readmeMetricLabel(strictDescriptor.descriptor.metricName)} **${formatStrictMetricValue(strictDescriptor.descriptor.metricName, strictFinalPoint.value)}**（完整曲线见 results/metrics.csv）${strictFinalSeries.excludedCount > 0 ? `。另有 ${strictFinalSeries.excludedCount} 条 validation/epoch 记录因 metricValue 缺失或数值非有限被排除，未进入摘要；当前摘要不一定代表最终训练轮指标` : ''}`
        : '当前训练记录缺少唯一、完整且有限的 validation/epoch 指标，不能生成最终验证指标摘要；原始诊断记录见 metrics.csv。';
  const claimStatsText = trust && typeof trust.claimCount === 'number' && trust.claimCount > 0
    ? `评估主张 ${trust.claimCount} 条（记录异常 ${trust.claimAnomalyCount ?? 0} 条，因档案持久化无法背书 ${trust.claimPersistenceBlockedCount ?? 0} 条）；结论信任等级只归属具体 Claim，不代表整个模型。`
    : '';
  const metricsSemanticsNote = 'metrics.csv 中的 metadata_missing 表示该条历史指标的口径不完整（split/scope/指标名/优化方向缺失或数值非有限）；这类记录不能进入严格对比，也不得被解释为 accuracy/maximize。';
  const trustText = trust
    ? `执行可信：**${trust.executionTrust}**；结论可信（最高有效等级）：**${trust.conclusionTrust}**；只追加审计：**${trust.auditPersistence}**。${claimStatsText}${trust.conclusionTrust === 'not_evaluated' ? '当前结果是探索性证据，泛化能力尚未由冻结主张独立验证。' : ''}`
    : '该包缺少可信实验协议上下文，按外部/未验证结果处理。';

  const configLines = [
    `| epochs | ${config.epochs} |`,
    `| batch size | ${config.batchSize} |`,
    `| learning rate | ${config.learningRate} |`,
    `| optimizer | ${config.optimizer}${config.optimizer === 'sgd' ? ` (momentum=${config.momentum})` : ''} |`,
    `| weight decay | ${config.weightDecay} |`,
    `| LR scheduler | ${config.lrScheduler} |`,
    `| random seed | ${config.seed} |`,
    `| val split | ${Math.round(config.valSplit * 100)}%（官方测试集保持封存） |`,
    `| dataset | ${config.dataset} |`,
  ].join('\n');

  return `# ${networkName} — 实验包

> 由 NeuroBricks 3D 导出于 ${ts}

## 快速开始

\`\`\`bash
pip install -r requirements.txt
python train.py
\`\`\`

数据集（${config.dataset}）首次运行自动下载到 \`./data\`。任意超参可命令行覆盖，如 \`python train.py --epochs 10 --lr 0.01\`。

## 网络结构（${sorted.length} 层，共 ${totalParams.toLocaleString()} 参数）

| # | 层类型 | 输出形状 | 参数量 |
|---|--------|----------|--------|
${tableRows}

## 超参数

| 参数 | 值 |
|------|-----|
${configLines}

## 训练结果
${resultText}

${metricsSemanticsNote}

${trustText}

## 文件说明

- \`model.py\` — 模型定义（NeuroBricksModel）
- \`train.py\` — 训练脚本（默认超参 = 上表，可 argparse 覆盖）
- \`requirements.txt\` — Python 依赖
- \`verify_package.py\` — 不执行模型代码，仅核验实际导出文件的大小与 SHA-256
- \`results/metrics.csv\` — 导出时已完成的真实训练指标（若有）
- 受控运行原始产物：\`artifacts/\` + \`preprocessing.json\`（来源与哈希见 manifest.json）
- 外部重跑产物：\`reruns/<时间-进程>/\`；不会覆盖受控原始结果，且始终按 external/unverified 解释

---
由 [NeuroBricks 3D](https://github.com/nanliuqi/neurobricks-3d) 生成
`;
}

/**
 * 生成 metrics.csv（若有训练数据）。
 * 统一失败关闭（最终证据闭环补丁）：与 Study 报告 comparison.csv 同一缺失语义——
 * 缺失 split/scope/lossName/metricName/direction 时写 metadata_missing；
 * metricName 缺失时 metricValue 留空（不用 accuracy 冒充已知指标）；
 * 非有限 metricValue 不输出为有效数值；绝不按指标名猜 lossName/direction。
 * 列顺序与表头保持不变（向后兼容）；历史默认语义废除属于明确的口径升级，
 * 由 metadata_missing 状态显式表达而非静默重定义。
 */
export function generateMetricsCsv(metrics: TrainMetric[]): string | null {
  if (metrics.length === 0) return null;
  const header = 'recordId,epoch,globalStep,split,scope,lossName,lossValue,metricName,metricValue,optimizationDirection,sampleCount,timestamp';
  const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const rows = metrics.map(m => {
    const hasName = typeof m.metricName === 'string' && m.metricName.length > 0;
    const hasDirection = m.optimizationDirection === 'maximize' || m.optimizationDirection === 'minimize';
    const value = m.metricValue ?? m.accuracy;
    return [
      m.recordId ?? '', m.epoch, m.globalStep ?? m.step,
      m.split ?? 'metadata_missing',
      m.scope ?? 'metadata_missing',
      m.lossName ?? 'metadata_missing',
      m.lossValue ?? m.loss,
      hasName ? m.metricName : 'metadata_missing',
      hasName && Number.isFinite(value) ? value : '',
      hasDirection ? m.optimizationDirection : 'metadata_missing',
      m.sampleCount ?? '', m.timestamp,
    ].map(cell).join(',');
  });
  return [header, ...rows].join('\n');
}
