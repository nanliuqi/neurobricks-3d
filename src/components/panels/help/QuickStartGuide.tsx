import { useState } from 'react';
import Button from '../../ui/Button';
import { getRightPanelMeta, type RightPanelId } from '@/types/workspace';

export interface QuickStartGuideProps {
  /**
   * 复用模块 02 工作区唯一面板导航回调（由 MainLayout 注入现有 expandPanel）。
   * 缺省时步骤文字仍完整可读，只是不渲染无法使用的导航按钮。
   */
  onNavigatePanel?: (panelId: RightPanelId) => void;
}

interface GuideStep {
  /** 位置：界面上真实存在的区域 */
  where: string;
  /** 操作：由用户手动完成的动作 */
  action: string;
  /** 预期表现：完成后应看到什么 */
  expect: string;
  /**
   * 该步骤可跳转的真实右侧面板 ID。
   * 左侧模型库与底部训练栏没有面板 ID，对应步骤只提供文字说明，不虚构入口。
   */
  panelIds?: readonly RightPanelId[];
}

const GUIDE_STEPS: readonly GuideStep[] = [
  {
    where: '右侧「数据集」面板 → 「内置数据集」下拉',
    action: '选 MNIST（或 CIFAR-10）。引导不会替你切换数据集。',
    expect: '底部训练栏显示所选数据集名称；这只完成数据集选择，结构、运行时与课题契约等检查仍需分别通过。',
    panelIds: ['dataset'],
  },
  {
    where: '左侧「层组件库」→「经典模型」小节（默认收起，先点标题展开）',
    action: '展开后点击 LeNet-5 卡片上的「+ 添加」，本路线不需要拖动卡片或场景积木。如已有结构，先自行保存，并通过现有确认流程清空场景后再添加。',
    expect: '预设的层追加到已有积木栈顶部，不会清空或替换现有结构；输入形状、卷积通道数与全连接特征数按当前数据集自动适配。',
  },
  {
    where: '中间 3D 场景与右侧「参数」面板',
    action: '先按原有方式点选要核对的积木，右侧「参数」面板才会显示它的参数；逐层核对通道数、核大小与输出类别数。',
    expect: '连接线蓝色表示相邻张量能衔接，红色表示不匹配，需要调整参数直到变蓝。未选中积木时该面板显示整体统计。',
    panelIds: ['param'],
  },
  {
    where: '底部训练栏',
    action: '手动设置 Epochs 与 Batch；需要优化器、学习率、随机种子等更多参数时点「⚙ 高级」；最后点「🚀 开始训练」。',
    expect: '训练前检查仍有阻断时训练不会启动，检查面板展开并定位首个阻断项；启动成功后底部切换为进度视图。'
      + '耗时取决于设备与数据量，不承诺五分钟内一定完成。',
  },
  {
    where: '右侧「训练监控」面板',
    action: '训练开始后打开，查看进度、日志与曲线。',
    expect: '训练进行时显示当前过程指标；完成或中断后可查看当前课题已留档的曲线，没有可归属记录时才显示空态。',
    panelIds: ['trainMonitor'],
  },
  {
    where: '右侧「推理」面板',
    action: '训练完成、生成模型卡片后，选中模型再预测图片。',
    expect: '还没有可用模型时面板显示「暂无可用模型」；引导不会替你启动训练或选择模型。',
    panelIds: ['predict'],
  },
  {
    where: '右侧「课题」与「导出」面板',
    action: '在「课题」查看当前课题的实验、候选与评估主张；在「导出」选择导出内容。',
    expect: '课题与当前配置不一致时沿用面板原有的不匹配提示与处理入口，引导不做切换；'
      + '还没有可导出的训练产物时，导出面板按原有规则禁用相应导出项。',
    panelIds: ['study', 'export'],
  },
];

const GUIDE_NOTES: readonly string[] = [
  '导航按钮会切换到目标面板内容，不会主动收起右栏；窗口过窄时仍沿用自动收起规则。返回引导请再点活动栏的「帮助」。',
  '场景左上角的「视角自由 / 视角已锁定」只控制旋转、平移和缩放，不锁定积木编辑。',
  '这只是演示顺序，不构成任何结论：结构、数据、训练与评估结果都要按面板提示自行确认。',
  '本引导不记录进度或完成状态，折叠与否只保留在当前视图。',
];

/**
 * 新手操作引导：只提供文字说明与右侧面板跳转。
 * 组件不读写任何业务 store，也不发起加层、训练、候选、主张或导出动作。
 */
export default function QuickStartGuide({ onNavigatePanel }: QuickStartGuideProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <section
      data-testid="quick-start-guide"
      aria-label="新手操作引导"
      style={{ marginBottom: '16px' }}
    >
      <Button
        variant="ghost"
        size="small"
        data-testid="quick-start-guide-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}
      >
        {`${expanded ? '▼' : '▶'} 新手操作引导`}
      </Button>

      {expanded && (
        <>
          <p style={{ margin: '8px 0', color: '#94a3b8', lineHeight: '1.5', overflowWrap: 'anywhere' }}>
            下面 7 步只教你怎么点：本模块只增加操作说明和导航，不会自动配置工程。
          </p>
          <ol style={{ margin: 0, paddingLeft: '18px', display: 'grid', gap: '10px' }}>
            {GUIDE_STEPS.map((step, index) => (
              <li
                key={`guide-step-${index + 1}`}
                data-testid={`guide-step-${index + 1}`}
                style={{
                  paddingLeft: '8px',
                  borderLeft: '3px solid #1e3a5f',
                  color: '#94a3b8',
                  overflowWrap: 'anywhere',
                }}
              >
                <div style={{ color: '#e2e8f0', fontWeight: 600, marginBottom: '2px' }}>
                  第 {index + 1} 步：{step.where}
                </div>
                <div>操作：{step.action}</div>
                <div style={{ color: '#bfdbfe' }}>预期：{step.expect}</div>
                {onNavigatePanel && step.panelIds && step.panelIds.length > 0 && (
                  <div className="help-guide__actions" style={{ marginTop: '6px' }}>
                    {step.panelIds.map(panelId => (
                      <Button
                        key={panelId}
                        size="small"
                        variant="secondary"
                        className="help-guide__nav"
                        data-testid={`guide-nav-${panelId}`}
                        onClick={() => onNavigatePanel(panelId)}
                      >
                        打开「{getRightPanelMeta(panelId).label}」面板
                      </Button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
          <ul style={{ margin: '10px 0 0 0', paddingLeft: '18px', color: '#64748b', lineHeight: '1.6' }}>
            {GUIDE_NOTES.map(note => (
              <li key={note} style={{ overflowWrap: 'anywhere' }}>
                {note}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
