/**
 * 右侧工作区面板的公共类型与元数据。
 * 面板 ID 集中定义，避免字符串 ID 散落在组件中；
 * 业务面板的挂载/渲染仍由 MainLayout 按既有条件渲染语义处理。
 */

export const RIGHT_PANEL_IDS = [
  'param',
  'dataset',
  'study',
  'export',
  'gpu',
  'trainMonitor',
  'cloud',
  'predict',
  'code',
  'help',
] as const;

export type RightPanelId = (typeof RIGHT_PANEL_IDS)[number];

export interface RightPanelMeta {
  id: RightPanelId;
  /** 短标题：用于面板标题栏与 aria-label。 */
  label: string;
  /** 中文完整说明：用于悬停提示。 */
  tooltip: string;
}

/** 右侧面板清单（空间顺序即活动栏呈现顺序），与既有下拉选项一一对应。 */
export const RIGHT_PANELS: readonly RightPanelMeta[] = [
  { id: 'param', label: '参数', tooltip: '参数：查看并修改选中积木层的参数' },
  { id: 'dataset', label: '数据集', tooltip: '数据集：选择内置数据集或导入自定义数据' },
  { id: 'study', label: '课题', tooltip: '课题：管理研究课题、实验与评估主张' },
  { id: 'export', label: '导出', tooltip: '导出：导出代码、权重与实验包' },
  { id: 'gpu', label: '设备', tooltip: '设备：检测本机 GPU 与 CPU 资源' },
  { id: 'trainMonitor', label: '训练监控', tooltip: '训练监控：查看训练进度、日志与曲线' },
  { id: 'cloud', label: '云端训练', tooltip: '云端训练：提交与监控远程训练任务' },
  { id: 'predict', label: '推理', tooltip: '推理：使用训练好的模型卡片预测图片' },
  { id: 'code', label: '代码', tooltip: '代码：实时查看当前网络的 PyTorch 代码' },
  { id: 'help', label: '帮助', tooltip: '帮助：使用说明与常见问题' },
];

/** 未知/损坏持久化值时的回退面板（真实存在的默认面板）。 */
export const DEFAULT_RIGHT_PANEL_ID: RightPanelId = 'param';

/** 类型守卫：判断任意值是否为合法面板 ID。 */
export function isRightPanelId(value: unknown): value is RightPanelId {
  return typeof value === 'string' && (RIGHT_PANEL_IDS as readonly string[]).includes(value);
}

/** 按 ID 取面板元数据；非法 ID 返回默认面板元数据，绝不返回 undefined。 */
export function getRightPanelMeta(id: RightPanelId): RightPanelMeta {
  const found = RIGHT_PANELS.find(panel => panel.id === id);
  if (found) return found;
  // DEFAULT_RIGHT_PANEL_ID 必然存在于 RIGHT_PANELS；再回退首项，兼顾数组被意外改空的情况。
  const fallback = RIGHT_PANELS.find(panel => panel.id === DEFAULT_RIGHT_PANEL_ID);
  return fallback ?? RIGHT_PANELS[0];
}
