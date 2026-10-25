/**
 * 从前端源码提取 CLASSIC_MODELS 层定义 → models_config.json
 *
 * 为什么这样做：
 * - 模型模板直接 import 自 src/types/classicModels.ts（esbuild 打包 TS），绝不手抄
 * - CIFAR-10 系模型（模板输入 3×224×224）通过前端同一个 adaptLayersToInputShape
 *   适配到 CIFAR 原生 3×32×32 —— 与用户在应用内"选模型+选数据集"时的适配逻辑完全一致，
 *   保证预训练权重与应用内推理时的模型结构严格匹配
 * - U-Net 无内置分割数据集，标注 excluded，由后续批次处理
 *
 * 用法：node scripts/extract_models_config.mjs
 * 产物：src-tauri/sidecars/nb-trainer/models_config.json
 */
import { build } from 'esbuild';
import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = path.join(ROOT, 'scripts', '_classic_models_entry.ts');
const BUNDLE = path.join(ROOT, 'scripts', '_classic_models_bundle.mjs');
const OUT = path.join(ROOT, 'src-tauri', 'sidecars', 'nb-trainer', 'models_config.json');

// 1. 生成临时入口：同时导出模型模板与前端适配函数
const entrySource = `
export { CLASSIC_MODELS } from '../src/types/classicModels';
export { adaptLayersToInputShape } from '../src/utils/shapeInference';
`;
writeFileSync(ENTRY, entrySource, 'utf-8');

// 2. esbuild 打包（解析 '@' 别名指向 src/）
await build({
  entryPoints: [ENTRY],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: BUNDLE,
  alias: { '@': path.join(ROOT, 'src') },
  logLevel: 'silent',
});

const mod = await import(pathToFileURL(BUNDLE).href);
const { CLASSIC_MODELS, adaptLayersToInputShape } = mod;

// 3. 每个模型的目标数据集与输入形状：
//    - MNIST 系保持模板原生 1×28×28
//    - VGG-16 / ResNet-18：适配到 CIFAR 原生 3×32×32（池化链在 32 下有效，与应用内适配行为一致）
//    - AlexNet / GoogLeNet：池化链对 32×32 输入架构不兼容（空间维会被池化到 0，
//      应用内选这两个模型+CIFAR 同样会报形状错误），故保持模板原生 3×224×224，
//      训练时将 CIFAR 图像 resize 到 224；对 224 的适配同时修正 GoogLeNet 模板
//      Linear(8192) 与推导值 86528 的不一致
const TARGETS = {
  lenet5:    { dataset: 'mnist',   inputShape: [1, 28, 28] },
  simplecnn: { dataset: 'mnist',   inputShape: [1, 28, 28] },
  mlp:       { dataset: 'mnist',   inputShape: [1, 28, 28] },
  alexnet:   { dataset: 'cifar10', inputShape: [3, 224, 224] },
  vgg16:     { dataset: 'cifar10', inputShape: [3, 32, 32] },
  resnet18:  { dataset: 'cifar10', inputShape: [3, 32, 32] },
  googlenet: { dataset: 'cifar10', inputShape: [3, 224, 224] },
  unet:      { dataset: null,      inputShape: null },
};

const configs = CLASSIC_MODELS.map((model) => {
  const target = TARGETS[model.id];
  if (!target) {
    throw new Error(`未定义的模型目标: ${model.id}（请在 TARGETS 中补充）`);
  }
  if (!target.dataset) {
    return {
      id: model.id,
      name: model.name,
      dataset: null,
      inputShape: null,
      excluded: '无内置分割数据集，U-Net 需要分割任务数据，由后续批次处理',
      layers: model.layers.map((l) => ({ type: l.type, params: l.params ?? {} })),
    };
  }
  // 用前端同一函数适配（深拷贝，不改原模板）
  const adapted = adaptLayersToInputShape(model.layers, target.inputShape);
  return {
    id: model.id,
    name: model.name,
    dataset: target.dataset,
    inputShape: target.inputShape,
    layers: adapted.map((l) => ({ type: l.type, params: l.params ?? {} })),
  };
});

writeFileSync(OUT, JSON.stringify(configs, null, 2), 'utf-8');

// 4. 摘要输出（纯 ASCII 安全格式，避免 GBK 控制台乱码影响判读）
for (const c of configs) {
  if (c.excluded) {
    console.log(`[excluded] ${c.id} (${c.name}): ${c.excluded}`);
  } else {
    const firstLinear = c.layers.find((l) => l.type === 'Linear');
    console.log(
      `[ok] ${c.id} (${c.name}): dataset=${c.dataset} input=[${c.inputShape}] layers=${c.layers.length}` +
      (firstLinear ? ` firstLinear.inFeatures=${firstLinear.params.inFeatures}` : '')
    );
  }
}
console.log(`\nmodels_config.json written: ${OUT}`);
