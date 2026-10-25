import type { ReactNode } from 'react';
import QuickStartGuide from './help/QuickStartGuide';
import TeachingExerciseGuide from './help/TeachingExerciseGuide';
import { HELP_RESULT_READING_TOPIC_IDS, resultReadingTopics } from '@/content/resultInterpretation';
import { LAYER_META_LIST, type LayerType } from '@/types/layer';
import type { RightPanelId } from '@/types/workspace';

interface HelpPanelProps {
  className?: string;
  /**
   * 可选：复用 MainLayout 现有的 expandPanel。
   * 未传入时引导仍完整可读，只是不渲染导航按钮（向后兼容旧调用方）。
   */
  onNavigatePanel?: (panelId: RightPanelId) => void;
}

const SHORTCUTS = [
  { key: 'Backspace', desc: '删除选中积木（Delete 未绑定）' },
  { key: 'Escape', desc: '取消选择' },
  { key: '↑ / ↓', desc: '上下导航层（切换选中）' },
  { key: 'Shift + ↑ / ↓', desc: '上移/下移选中积木（换位）' },
  { key: 'F12', desc: '开发者工具（仅 dev 模式）' },
];

const FAQ = [
  { q: '连接线变红怎么办？', a: '表示相邻层的张量形状不匹配。选中积木调整参数（如通道数、核大小），直到连接线变为蓝色。' },
  {
    q: '训练时没有 GPU 怎么办？',
    a: '以「设备」面板所选设备为准：只有选中 NVIDIA 独立显卡且运行时探测到 CUDA 可用时才用 GPU，否则按 CPU 运行。若启动训练时所选 CUDA 设备已不可用，训练会直接拒绝启动并要求重新选择，不会静默改用 CPU。',
  },
  { q: '如何导出训练好的模型？', a: '训练完成后，切换到"导出"面板，选择导出格式和路径即可保存模型权重文件。' },
  { q: '支持自定义数据集吗？', a: '支持本地图像类别文件夹和 CSV；Excel 导入仍在开发中，当前不会作为可训练数据集接收。' },
];

/**
 * 层的基础名称与说明一律取自 LAYER_META_LIST（单一来源），此处只补充
 * "这一层最容易被误解成什么"，因此允许只覆盖部分层类型。
 */
const LAYER_CAVEATS: Partial<Record<LayerType, string>> = {
  Linear: '全连接层不只用于分类，回归等连续值输出同样可以使用它。',
  Sigmoid: '输出落在 0～1 只是取值范围，并不自动等于可靠概率；未经校准不要当置信度解读。',
  BatchNorm2d: '归一化不保证必然更快或更好，批量很小或批间分布不稳时甚至可能变差。',
  LayerNorm: '归一化不保证必然更快或更好，是否有利要用自己的验证集对比。',
  Dropout: 'Dropout 有助于降低过拟合风险，不能保证不过拟合；是否有利仍要结合验证集和具体任务判断。',
  Flatten: 'Flatten 只展开单个样本内部的维度，不会合并批次维度。',
};

/**
 * 结果解读文案不在本面板维护副本：条目、顺序与措辞一律取自
 * resultInterpretation 的静态分组，训练曲线的「如何读图」也消费同一来源。
 */

/**
 * 帮助面板
 * 显示使用说明、快捷键、层类型说明、结果解读和常见问题
 */
export default function HelpPanel({ className, onNavigatePanel }: HelpPanelProps) {
  const readingGuide = resultReadingTopics(HELP_RESULT_READING_TOPIC_IDS);
  return (
    <div className={className} style={{ padding: '12px', color: '#e2e8f0', fontSize: '12px', lineHeight: '1.6' }}>
      {/* 快速开始：路线只由 QuickStartGuide 维护一份，此处不再重复旧步骤文案 */}
      <SectionTitle>🚀 快速开始</SectionTitle>
      <QuickStartGuide onNavigatePanel={onNavigatePanel} />

      {/* 动手练习：只增加练习说明与既有面板跳转，不复制路线、层说明或结果解读规则 */}
      <SectionTitle>🎯 动手练习</SectionTitle>
      <TeachingExerciseGuide onNavigatePanel={onNavigatePanel} />

      {/* 键盘快捷键 */}
      <SectionTitle>⌨️ 键盘快捷键</SectionTitle>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px' }}>
        <tbody>
          {SHORTCUTS.map(s => (
            <tr key={s.key} style={{ borderBottom: '1px solid #1e3a5f' }}>
              <td style={{ padding: '4px 6px', color: '#60a5fa', fontFamily: 'monospace', fontSize: '11px', whiteSpace: 'nowrap' }}>
                {s.key}
              </td>
              <td style={{ padding: '4px 6px', color: '#94a3b8' }}>
                {s.desc}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 层类型说明：逐层取自共享元信息，避免第二份文案 */}
      <SectionTitle>🧱 层类型说明</SectionTitle>
      <div style={{ marginBottom: '16px' }}>
        {LAYER_META_LIST.map(meta => {
          const caveat = LAYER_CAVEATS[meta.type];
          return (
            <div key={meta.type} data-testid={`help-layer-${meta.type}`} style={{ padding: '2px 0' }}>
              <div style={{ display: 'flex', gap: '6px' }}>
                <span style={{ color: '#60a5fa', fontFamily: 'monospace', fontSize: '11px', minWidth: '90px', flexShrink: 0 }}>
                  {meta.type}
                </span>
                <span style={{ color: '#94a3b8' }}>{meta.description}</span>
              </div>
              {caveat && (
                <div style={{ color: '#fbbf24', fontSize: '11px', paddingLeft: '96px' }}>注意：{caveat}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* 结果解读 */}
      <SectionTitle>📖 结果怎么读</SectionTitle>
      <div style={{ marginBottom: '16px' }}>
        {readingGuide.map(item => (
          <div key={item.id} style={{ marginBottom: '8px' }}>
            <div style={{ color: '#e2e8f0', fontWeight: 600, marginBottom: '2px' }}>{item.title}</div>
            <div style={{ color: '#94a3b8', paddingLeft: '8px' }}>{item.text}</div>
          </div>
        ))}
      </div>

      {/* 常见问题 */}
      <SectionTitle>❓ 常见问题</SectionTitle>
      <div>
        {FAQ.map((item, i) => (
          <div key={i} style={{ marginBottom: '10px' }}>
            <div style={{ color: '#e2e8f0', fontWeight: 600, marginBottom: '2px' }}>Q: {item.q}</div>
            <div style={{ color: '#94a3b8', paddingLeft: '8px' }}>A: {item.a}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 区块标题 */
function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div style={{ color: '#60a5fa', fontSize: '12px', fontWeight: 700, marginBottom: '8px', borderBottom: '1px solid #1e3a5f', paddingBottom: '4px' }}>
      {children}
    </div>
  );
}
