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
  /** 最终准确率 */
  finalAccuracy: number;
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

/** 从 localStorage 读取卡片（容错：损坏数据返回空数组） */
function loadCards(): PredictCard[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 仅保留结构完整的卡片
    return parsed.filter(
      (c: PredictCard) =>
        c && typeof c.id === 'string' && Array.isArray(c.layers) && Array.isArray(c.inputShape)
    );
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
