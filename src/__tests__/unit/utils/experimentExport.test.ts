import { describe, it, expect } from 'vitest';
import {
  generateModelPy,
  generateTrainPy,
  generateRequirements,
  generateVerifyPackagePy,
  generateReadmeMd,
  generateMetricsCsv,
  selectLatestCompletedAttemptForLayers,
  type ExperimentConfig,
} from '@/utils/experimentExport';
import type { Layer3D } from '@/types/layer';
import type { Attempt } from '@/types/experiment';
import { createEmptyExperimentLedger } from '@/utils/experimentProtocol';

function makeLayer(type: Layer3D['type'], params: Record<string, unknown>, order: number): Layer3D {
  return {
    id: `layer-${order}`,
    type,
    params: params as Layer3D['params'],
    order,
    position: [0, 0, 0],
    outputShape: null,
    paramCount: 0,
    validationError: null,
  };
}

const CONFIG: ExperimentConfig = {
  epochs: 3,
  batchSize: 64,
  learningRate: 0.001,
  optimizer: 'sgd',
  momentum: 0.9,
  lrScheduler: 'cosine',
  seed: 42,
  valSplit: 0.1,
  weightDecay: 0,
  dataset: 'mnist',
};

describe('experimentExport', () => {
  it('model.py：包含类定义与全部层', () => {
    const layers = [
      makeLayer('Input', { inChannels: 1, inputHeight: 28, inputWidth: 28 }, 0),
      makeLayer('Conv2D', { inChannels: 1, outChannels: 32, kernelSize: 3 }, 1),
      makeLayer('ReLU', {}, 2),
      makeLayer('MaxPool2D', { poolKernelSize: 2 }, 3),
      makeLayer('Flatten', {}, 4),
      makeLayer('Linear', { inFeatures: 5408, outFeatures: 10 }, 5),
    ];
    const code = generateModelPy(layers, '测试网络');
    expect(code).toContain('class NeuroBricksModel(nn.Module)');
    expect(code).toContain('nn.Conv2d(1, 32, 3');
    expect(code).toContain('nn.Linear(5408, 10)');
    expect(code).toContain('nn.MaxPool2d(2');
    expect(code).toContain('nn.Flatten()');
    expect(code).toContain('测试网络');
  });

  it('train.py：默认超参 = 导出配置，argparse 可覆盖', () => {
    const code = generateTrainPy(CONFIG);
    expect(code).toContain("default=3");               // epochs
    expect(code).toContain("default=64");              // batch
    expect(code).toContain("default=0.001");           // lr
    expect(code).toContain("default='sgd'");           // optimizer
    expect(code).toContain("default=0.9");             // momentum
    expect(code).toContain("default='cosine'");        // scheduler
    expect(code).toContain('default=42');              // seed
    expect(code).toContain('default=0.1');             // valSplit
    expect(code).toContain('argparse');
    expect(code).toContain('from model import NeuroBricksModel');
    expect(code).toContain('manual_seed');             // 可复现
    expect(code).toContain("choices=['mnist']");       // 数据集身份冻结
    expect(code).toContain("run_dir = os.path.join('reruns'");
    expect(code).not.toContain("torch.save(model.state_dict(), 'checkpoints/model_weights.pth')");
  });

  it('train.py：valSplit=0 会失败关闭，绝不回退到官方测试集验证', () => {
    const cfg = { ...CONFIG, valSplit: 0 };
    const code = generateTrainPy(cfg);
    expect(code).toContain("raise ValueError('val-split must be in (0, 0.5]");
    expect(code).toContain('official test set remains sealed');
    expect(code).not.toContain('val_set if val_set is not None else datasets');
    expect(code).toContain('default=0');
  });

  it('requirements.txt：torch/torchvision/numpy', () => {
    const req = generateRequirements();
    expect(req).toContain('torch==2.11.0+cu128');
    expect(req).toContain('torchvision==0.26.0+cu128');
    expect(req).toContain('numpy==1.26.4');
  });

  it('verify_package.py 只核验清单，不导入或执行模型代码', () => {
    const verifier = generateVerifyPackagePy();
    expect(verifier).toContain("manifest.get('exportedArtifacts')");
    expect(verifier).toContain('hashlib.sha256');
    expect(verifier).not.toContain('import torch');
    expect(verifier).not.toContain('from model import');
  });

  it('README.md：结构表/超参表/复现命令齐全', () => {
    const layers = [
      makeLayer('Input', {}, 0),
      makeLayer('Conv2D', { inChannels: 1, outChannels: 32 }, 1),
    ];
    layers[0].outputShape = [1, 28, 28];
    layers[1].outputShape = [32, 26, 26];
    layers[1].paramCount = 320;

    const md = generateReadmeMd('我的网络', layers, 320, CONFIG, []);
    expect(md).toContain('# 我的网络');
    expect(md).toContain('| 1 | Input | [1, 28, 28] | 0 |');
    expect(md).toContain('| 2 | Conv2D | [32, 26, 26] | 320 |');
    expect(md).toContain('pip install -r requirements.txt');
    expect(md).toContain('python train.py');
    expect(md).toContain('| optimizer | sgd (momentum=0.9) |');
    expect(md).toContain('暂无已完成的真实训练记录');
  });

  it('README.md：浏览器演示指标不得冒充真实实验结果', () => {
    const metrics = [
      { epoch: 1, step: 10, loss: 0.2, accuracy: 0.99, timestamp: 1 },
    ];
    const md = generateReadmeMd(
      '演示网络',
      [makeLayer('Input', {}, 0)],
      0,
      CONFIG,
      metrics,
      'simulation',
    );

    expect(md).toContain('浏览器演示数据');
    expect(md).not.toContain('最终准确率 **99.0%**');
    expect(md).toContain('不作为真实训练结果');
  });

  it('metrics.csv：空数据返回 null，有数据返回 CSV（完整元数据原样导出）', () => {
    expect(generateMetricsCsv([])).toBeNull();
    const csv = generateMetricsCsv([
      // 最终证据闭环补丁：正向夹具携带完整元数据，旧断言子串保持不变
      { epoch: 1, step: 10, loss: 2.3, accuracy: 0.1, metricName: 'accuracy', metricValue: 0.1, optimizationDirection: 'maximize', split: 'validation', scope: 'epoch', lossName: 'cross_entropy', timestamp: 1 },
      { epoch: 1, step: 20, loss: 1.5, accuracy: 0.5, metricName: 'accuracy', metricValue: 0.5, optimizationDirection: 'maximize', split: 'validation', scope: 'epoch', lossName: 'cross_entropy', timestamp: 2 },
    ] as never);
    expect(csv).toContain('recordId,epoch,globalStep,split,scope,lossName,lossValue,metricName,metricValue,optimizationDirection,sampleCount,timestamp');
    expect(csv).toContain('"1","10","validation","epoch","cross_entropy","2.3","accuracy","0.1"');
  });

  it('metrics.csv 失败关闭：缺失字段写 metadata_missing，不猜 accuracy/maximize/validation/epoch', () => {
    const csv = generateMetricsCsv([
      { epoch: 1, step: 10, loss: 2.3, accuracy: 0.1, timestamp: 1 },
    ] as never)!;
    // split/scope/lossName/metricName/direction 全部 metadata_missing
    expect(csv).toContain('"metadata_missing","metadata_missing","metadata_missing","2.3","metadata_missing","","metadata_missing"');
    // 不用 accuracy 冒充已知指标，不用 0.1 冒充已知指标值
    expect(csv).not.toContain('"accuracy"');
    expect(csv).not.toContain('"0.1","maximize"');
  });

  it('metrics.csv：NaN/Infinity 指标值不输出为有效数值', () => {
    const csv = generateMetricsCsv([
      { epoch: 1, step: 1, loss: 0.2, accuracy: Number.NaN, metricName: 'accuracy', metricValue: Number.NaN, optimizationDirection: 'maximize', split: 'validation', scope: 'epoch', timestamp: 1 },
      { epoch: 2, step: 2, loss: 0.1, accuracy: Number.POSITIVE_INFINITY, metricName: 'accuracy', metricValue: Number.POSITIVE_INFINITY, optimizationDirection: 'maximize', split: 'validation', scope: 'epoch', timestamp: 2 },
    ] as never)!;
    expect(csv).not.toContain('NaN');
    expect(csv).not.toContain('Infinity');
    // metricName 存在但值非有限 → 值列留空
    expect(csv).toContain('"accuracy","","maximize"');
  });

  it('README：metricName 缺失时不默认按准确率展示，并说明 metadata_missing 含义', () => {
    const md = generateReadmeMd(
      '旧档案网络',
      [makeLayer('Input', {}, 0)],
      0,
      CONFIG,
      [{ epoch: 1, step: 1, loss: 0.2, accuracy: 0.9, timestamp: 1 }],
      'native',
    );
    expect(md).not.toContain('验证集准确率');
    expect(md).toContain('不能生成最终验证指标摘要');
    expect(md).toContain('原始诊断记录见 metrics.csv');
    expect(md).toContain('metadata_missing 表示该条历史指标的口径不完整');
    expect(md).toContain('不能进入严格对比');
  });

  /* ---------- README 最终指标摘要收口补丁 ---------- */

  function strictRecord(overrides: Record<string, unknown> = {}): never {
    return {
      epoch: 1, step: 1, loss: 0.2, accuracy: 0.9, metricName: 'accuracy', metricValue: 0.9,
      optimizationDirection: 'maximize', split: 'validation', scope: 'epoch', timestamp: 1,
      ...overrides,
    } as never;
  }

  function readmeFor(metrics: never[]): string {
    return generateReadmeMd('测试网络', [makeLayer('Input', {}, 0)], 0, CONFIG, metrics, 'native');
  }

  it('最后一条是 train/batch 时：README 选合法验证指标，不用尾项冒充，也不产生验证记录排除警告', () => {
    const md = readmeFor([
      strictRecord({ epoch: 2, metricValue: 0.912, accuracy: 0.912 }),
      strictRecord({ epoch: 3, metricValue: 0.5, accuracy: 0.5, split: 'train', scope: 'batch' }),
    ]);
    expect(md).toContain('最近一个有效 validation/epoch 指标（epoch 2）准确率 **91.2%**');
    expect(md).not.toContain('50.0%');
    // train/batch 不参与严格摘要，也不得被计为“非法验证 epoch”
    expect(md).not.toContain('被排除');
    expect(md).not.toContain('最后一轮验证集');
  });

  it('accuracy=0.912 → 百分比 91.2%', () => {
    expect(readmeFor([strictRecord({ metricValue: 0.912, accuracy: 0.912 })])).toContain('**91.2%**');
  });

  it('mae=0.2 → 原始数值，不显示 20.0%', () => {
    const md = readmeFor([strictRecord({ metricName: 'mae', metricValue: 0.2, accuracy: 0.2, optimizationDirection: 'minimize' })]);
    expect(md).toContain('**0.200000**');
    expect(md).not.toContain('20.0%');
  });

  it('rmse=0.2 → 原始数值，不显示 20.0%', () => {
    const md = readmeFor([strictRecord({ metricName: 'rmse', metricValue: 0.2, accuracy: 0.2, optimizationDirection: 'minimize' })]);
    expect(md).toContain('**0.200000**');
    expect(md).not.toContain('20.0%');
  });

  it('自定义指标 → 原始数值，不猜百分比', () => {
    const md = readmeFor([strictRecord({ metricName: 'my_score', metricValue: 0.3, accuracy: 0.3 })]);
    expect(md).toContain('my_score **0.300000**');
    expect(md).not.toContain('30.0%');
  });

  it('缺 split/scope：不生成“最后一轮验证集”摘要', () => {
    const md = readmeFor([strictRecord({ split: undefined, scope: undefined })]);
    expect(md).not.toContain('最后一轮验证集');
    expect(md).toContain('不能生成最终验证指标摘要');
  });

  it('缺 optimizationDirection：不生成严格摘要', () => {
    const md = readmeFor([strictRecord({ optimizationDirection: undefined })]);
    expect(md).not.toContain('最后一轮验证集');
    expect(md).toContain('不能生成最终验证指标摘要');
  });

  it('多个 validation/epoch metricName：不选择第一项，不生成摘要', () => {
    const md = readmeFor([
      strictRecord({ metricName: 'accuracy', metricValue: 0.9, accuracy: 0.9 }),
      strictRecord({ metricName: 'mae', metricValue: 0.1, accuracy: 0.1, optimizationDirection: 'minimize' }),
    ]);
    expect(md).not.toContain('最后一轮验证集');
    expect(md).not.toContain('**90.0%**');
    expect(md).toContain('不能生成最终验证指标摘要');
  });

  it('全 NaN/Infinity：不生成严格摘要', () => {
    const md = readmeFor([
      strictRecord({ metricValue: Number.NaN, accuracy: Number.NaN }),
      strictRecord({ epoch: 2, metricValue: Number.POSITIVE_INFINITY, accuracy: Number.POSITIVE_INFINITY }),
    ]);
    expect(md).not.toContain('最后一轮验证集');
    expect(md).toContain('不能生成最终验证指标摘要');
    expect(md).not.toContain('NaN');
  });

  it('部分非有限值：摘要用最近合法 epoch 点，并明确被排除记录与最终轮的区别', () => {
    const md = readmeFor([
      strictRecord({ epoch: 1, metricValue: 0.8, accuracy: 0.8 }),
      strictRecord({ epoch: 2, metricValue: Number.NaN, accuracy: Number.NaN }),
      strictRecord({ epoch: 3, metricValue: 0.912, accuracy: 0.912, timestamp: 3 }),
    ]);
    expect(md).toContain('最近一个有效 validation/epoch 指标（epoch 3）准确率 **91.2%**');
    expect(md).not.toContain('最后一轮验证集');
  });

  it('epoch 1 合法、epoch 2 非法：README 展示 epoch 1 并声明不代表最终训练轮', () => {
    const md = readmeFor([
      strictRecord({ epoch: 1, metricValue: 0.9, accuracy: 0.9 }),
      strictRecord({ epoch: 2, metricValue: Number.NaN, accuracy: Number.NaN, timestamp: 2 }),
    ]);
    expect(md).toContain('最近一个有效 validation/epoch 指标（epoch 1）准确率 **90.0%**');
    expect(md).not.toContain('最后一轮验证集');
    // 排除数量、原因与“不一定代表最终训练轮”声明必须同时存在
    expect(md).toContain('另有 1 条 validation/epoch 记录因 metricValue 缺失或数值非有限被排除');
    expect(md).toContain('未进入摘要');
    expect(md).toContain('当前摘要不一定代表最终训练轮指标');
  });

  it('MAE metricValue 缺失、accuracy=0.92：README 不得把 accuracy 当 MAE 输出数值摘要', () => {
    const md = readmeFor([
      strictRecord({ metricName: 'mae', optimizationDirection: 'minimize', metricValue: undefined, accuracy: 0.92 }),
    ]);
    expect(md).not.toContain('0.920000');
    expect(md).not.toContain('最近一个有效');
    expect(md).toContain('不能生成最终验证指标摘要');
  });

  it('全部 metricValue 非有限（accuracy 字段有限）：README 不输出数值摘要', () => {
    const md = readmeFor([
      strictRecord({ metricValue: Number.NaN, accuracy: 0.9 }),
      strictRecord({ epoch: 2, metricValue: Number.POSITIVE_INFINITY, accuracy: 0.95, timestamp: 2 }),
    ]);
    expect(md).not.toContain('90.0%');
    expect(md).not.toContain('95.0%');
    expect(md).toContain('不能生成最终验证指标摘要');
    expect(md).toContain('原始诊断记录见 metrics.csv');
  });

  it('关闭结果卡片后仍可从持久化 Attempt 找回匹配结构的完成指标', () => {
    const layers = [
      makeLayer('Input', { inChannels: 1, inputHeight: 28, inputWidth: 28 }, 0),
      makeLayer('Flatten', {}, 1),
      makeLayer('Linear', { inFeatures: 784, outFeatures: 10 }, 2),
    ];
    const ledger = createEmptyExperimentLedger();
    ledger.attempts = [{
      id: 'attempt-completed', status: 'completed', executionMode: 'native', endedAt: 20,
      config: { ...CONFIG, device: 'cpu', layers: layers.map(layer => ({ type: layer.type, params: layer.params })) },
      metrics: [{ epoch: 1, step: 2, loss: 0.2, accuracy: 0.9, metricName: 'accuracy', metricValue: 0.9, optimizationDirection: 'maximize', split: 'validation', scope: 'epoch', lossName: 'cross_entropy', timestamp: 20 }],
    } as Attempt];

    const selected = selectLatestCompletedAttemptForLayers(ledger, layers, null);
    expect(selected?.id).toBe('attempt-completed');
    expect(generateMetricsCsv(selected?.metrics ?? [])).toContain('"1","2","validation","epoch","cross_entropy","0.2","accuracy","0.9"');
  });

  it('generateTrainPy 产出是合法 Python 语法（用模板结构自检）', () => {
    // 语法自检（无 Python 解释器时的结构检查）：
    // 1. 三引号文档字符串闭合
    const code = generateTrainPy(CONFIG);
    const docstrings = (code.match(/"""/g) || []).length;
    expect(docstrings % 2).toBe(0);
    // 2. 缩进一致性（无 tab 混用）
    expect(code.includes('\t')).toBe(false);
    // 3. 关键结构存在
    expect(code).toMatch(/def .*train|for epoch in/);
  });
});
