interface HelpPanelProps {
  className?: string;
}

const SHORTCUTS = [
  { key: 'Delete / Backspace', desc: '删除选中积木' },
  { key: 'Escape', desc: '取消选择' },
  { key: '↑ / ↓', desc: '上下导航层（切换选中）' },
  { key: 'Shift + ↑ / ↓', desc: '上移/下移选中积木（换位）' },
  { key: 'F12', desc: '开发者工具（仅 dev 模式）' },
];

const LAYER_TYPES = [
  { type: 'Input', desc: '输入层，定义数据形状' },
  { type: 'Conv2D', desc: '卷积层，提取图像特征' },
  { type: 'MaxPool2D', desc: '最大池化，降低空间维度' },
  { type: 'AvgPool2D', desc: '平均池化，平滑降维' },
  { type: 'Linear', desc: '全连接层，用于分类输出' },
  { type: 'ReLU', desc: '激活函数，引入非线性' },
  { type: 'Sigmoid', desc: 'S 型激活，输出 0~1' },
  { type: 'Tanh', desc: '双曲正切激活，输出 -1~1' },
  { type: 'BatchNorm2d', desc: '批归一化，加速训练收敛' },
  { type: 'LayerNorm', desc: '层归一化，稳定训练' },
  { type: 'Dropout', desc: '随机失活，防止过拟合' },
  { type: 'Flatten', desc: '展平多维张量为一维' },
];

const FAQ = [
  { q: '连接线变红怎么办？', a: '表示相邻层的张量形状不匹配。选中积木调整参数（如通道数、核大小），直到连接线变为蓝色。' },
  { q: '训练时没有 GPU 怎么办？', a: '程序会自动回退到 CPU 训练，速度较慢但功能完整。可在"设备"面板查看当前检测到的设备。' },
  { q: '如何导出训练好的模型？', a: '训练完成后，切换到"导出"面板，选择导出格式和路径即可保存模型权重文件。' },
  { q: '支持自定义数据集吗？', a: '支持。在"数据集"面板点击导入按钮，可加载本地图像文件夹、CSV 或 Excel 文件。' },
];

/**
 * 帮助面板
 * 显示使用说明、快捷键、层类型说明和常见问题
 */
export default function HelpPanel({ className }: HelpPanelProps) {
  return (
    <div className={className} style={{ padding: '12px', color: '#e2e8f0', fontSize: '12px', lineHeight: '1.6' }}>
      {/* 快速开始 */}
      <SectionTitle>🚀 快速开始</SectionTitle>
      <ol style={{ margin: '0 0 16px 0', paddingLeft: '18px', color: '#94a3b8' }}>
        <li>在「数据集」面板选择 MNIST 或 CIFAR-10</li>
        <li>从左侧层库拖拽积木到 3D 场景搭建网络</li>
        <li>点击底部「开始训练」按钮启动训练</li>
      </ol>

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

      {/* 层类型说明 */}
      <SectionTitle>🧱 层类型说明</SectionTitle>
      <div style={{ marginBottom: '16px' }}>
        {LAYER_TYPES.map(l => (
          <div key={l.type} style={{ display: 'flex', gap: '6px', padding: '2px 0' }}>
            <span style={{ color: '#60a5fa', fontFamily: 'monospace', fontSize: '11px', minWidth: '90px', flexShrink: 0 }}>
              {l.type}
            </span>
            <span style={{ color: '#94a3b8' }}>{l.desc}</span>
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
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: '#60a5fa', fontSize: '12px', fontWeight: 700, marginBottom: '8px', borderBottom: '1px solid #1e3a5f', paddingBottom: '4px' }}>
      {children}
    </div>
  );
}
