import { create } from 'zustand';
import type { LayerType, LayerParams } from '@/types/layer';

/**
 * 推理卡片
 * 每张卡片对应一次训练产出的可用模型，含重建模型所需的层配置与独立权重路径
 */
export interface PredictCard {
  /** 模型唯一标识（= 训练时的 modelId，权重位于 ~/.neurobricks/models/<id>.pth） */
  id: string;
  /** 卡片显示名称（模型类型 + 数据集等，便于区分） */
  name: string;
  /** 模型类型标签（如 CNN / MLP） */
  modelType: string;
  /** 训练时的网络层配置快照（推理时据此重建模型） */
  layers: Array<{ type: LayerType; params: LayerParams }>;
  /** 训练时的输入形状 [C, H, W] */
  inputShape: number[];
  /** 任务类型；旧版本卡片缺失时按图像分类读取。 */
  taskType?: 'image_classification' | 'tabular_regression';
  /** 最终训练指标名称；旧版本卡片缺失时为 accuracy。 */
  finalMetricName?: 'accuracy' | 'mae';
  /** 最终指标值。字段名为兼容 v0.1 已有本地卡片而保留。 */
  finalAccuracy: number;
  /** CSV 回归训练时确定的特征顺序。 */
  featureColumns?: string[];
  /** 仅用训练集拟合出的标准化参数。 */
  preprocessing?: {
    algorithm: 'standard-scaler-fit-train-only-v1';
    mean: number[];
    std: number[];
  };
  /** 图像训练 Attempt 冻结的 resize/颜色/归一化协议；旧卡片可能缺失且不得推理。 */
  imagePreprocessing?: {
    algorithm: 'vision-fixed-v1' | 'vision-resize-normalize-v1';
    resize: number[] | null;
    colorMode: 'grayscale' | 'rgb';
    channels: number;
    interpolation: 'bilinear';
    normalizationMean: number[];
    normalizationStd: number[];
  };
  /** 数据集名称 */
  dataset: string;
  /** 训练轮数 */
  epochs: number;
  /** 训练完成时间戳（毫秒） */
  timestamp: number;
}

interface PredictCardsState {
  cards: PredictCard[];
  addCard: (card: PredictCard) => void;
  removeCard: (id: string) => void;
  renameCard: (id: string, name: string) => void;
  clearCards: () => void;
}

const STORAGE_KEY = 'neurobricks_predict_cards';
/** 最多保留的卡片数量（避免无限堆积） */
const MAX_CARDS = 20;

function isSafeModelId(id: unknown): id is string {
  return typeof id === 'string'
    && id.length > 0
    && id.length <= 128
    && /^[A-Za-z0-9_-]+$/.test(id);
}

function isValidCard(value: unknown): value is PredictCard {
  if (!value || typeof value !== 'object') return false;
  const card = value as Partial<PredictCard>;
  const taskType = card.taskType ?? 'image_classification';
  const baseValid = isSafeModelId(card.id)
    && typeof card.name === 'string'
    && typeof card.modelType === 'string'
    && Array.isArray(card.layers)
    && card.layers.length > 0
    && card.layers.length <= 512
    && card.layers.every(layer => layer !== null
      && typeof layer === 'object'
      && typeof layer.type === 'string'
      && layer.params !== null
      && typeof layer.params === 'object')
    && Array.isArray(card.inputShape)
    && card.inputShape.length === 3
    && card.inputShape.every(dim => Number.isInteger(dim) && dim > 0 && dim <= 16_384)
    && typeof card.finalAccuracy === 'number'
    && Number.isFinite(card.finalAccuracy)
    && card.finalAccuracy >= 0
    && (taskType === 'tabular_regression' || card.finalAccuracy <= 1)
    && typeof card.dataset === 'string'
    && typeof card.epochs === 'number'
    && Number.isInteger(card.epochs)
    && card.epochs > 0
    && typeof card.timestamp === 'number'
    && Number.isFinite(card.timestamp);
  if (!baseValid) return false;
  if (taskType === 'image_classification') {
    if (!(card.finalMetricName === undefined || card.finalMetricName === 'accuracy')) return false;
    const image = card.imagePreprocessing;
    if (image === undefined) return true; // legacy card remains visible but prediction is blocked
    return (image.algorithm === 'vision-fixed-v1' || image.algorithm === 'vision-resize-normalize-v1')
      && (image.resize === null || (Array.isArray(image.resize) && image.resize.length === 2 && image.resize.every(Number.isInteger)))
      && (image.colorMode === 'grayscale' || image.colorMode === 'rgb')
      && Number.isInteger(image.channels) && image.channels > 0
      && image.interpolation === 'bilinear'
      && Array.isArray(image.normalizationMean) && image.normalizationMean.every(Number.isFinite)
      && Array.isArray(image.normalizationStd) && image.normalizationStd.every(value => Number.isFinite(value) && value > 0)
      && image.normalizationMean.length === image.channels
      && image.normalizationStd.length === image.channels;
  }
  if (taskType !== 'tabular_regression' || card.finalMetricName !== 'mae') return false;
  if (!Array.isArray(card.featureColumns) || card.featureColumns.length === 0) return false;
  if (!card.featureColumns.every(column => typeof column === 'string' && column.trim().length > 0)) return false;
  const preprocessing = card.preprocessing;
  return preprocessing?.algorithm === 'standard-scaler-fit-train-only-v1'
    && Array.isArray(preprocessing.mean)
    && Array.isArray(preprocessing.std)
    && preprocessing.mean.length === card.featureColumns.length
    && preprocessing.std.length === card.featureColumns.length
    && preprocessing.mean.every(Number.isFinite)
    && preprocessing.std.every(value => Number.isFinite(value) && value > 0)
    && card.inputShape!.reduce((product, dimension) => product * dimension, 1) === card.featureColumns.length;
}

/** 从 localStorage 读取卡片（容错：损坏数据返回空数组） */
function loadCards(): PredictCard[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 仅保留结构完整的卡片
    return parsed.filter(isValidCard).slice(0, MAX_CARDS);
  } catch {
    return [];
  }
}

/** 写入 localStorage（静默失败，如隐私模式/容量不足） */
function persist(cards: PredictCard[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
  } catch {
    // 忽略持久化失败（内存态仍然可用）
  }
}

export const usePredictCardsStore = create<PredictCardsState>()((set, get) => ({
  cards: loadCards(),

  // 新增卡片（置于最前），超出上限则丢弃最旧
  addCard: (card) => {
    if (!isValidCard(card)) return;
    const next = [card, ...get().cards].slice(0, MAX_CARDS);
    persist(next);
    set({ cards: next });
  },

  // 删除指定卡片
  removeCard: (id) => {
    const next = get().cards.filter((c) => c.id !== id);
    persist(next);
    set({ cards: next });
  },

  // 重命名指定卡片（空名称忽略，保留原名）
  renameCard: (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const next = get().cards.map((c) => (c.id === id ? { ...c, name: trimmed } : c));
    persist(next);
    set({ cards: next });
  },

  // 清空全部卡片
  clearCards: () => {
    persist([]);
    set({ cards: [] });
  },
}));

/**
 * 根据层配置推断模型类型标签（用于卡片命名）
 * 含卷积/池化 → CNN；仅全连接 → MLP；其余 → Model
 */
export function inferModelType(layers: Array<{ type: LayerType }>): string {
  const hasConv = layers.some(
    (l) => l.type === 'Conv2D' || l.type === 'MaxPool2D' || l.type === 'AvgPool2D'
  );
  if (hasConv) return 'CNN';
  const hasLinear = layers.some((l) => l.type === 'Linear');
  if (hasLinear) return 'MLP';
  return 'Model';
}
