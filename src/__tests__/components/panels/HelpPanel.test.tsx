/**
 * HelpPanel 教学文案契约测试（S1）：
 * - 基础层名称与说明必须逐条来自 LAYER_META_LIST，面板内不得再维护第二份；
 * - 概念校正与结果解读文案必须真的渲染出来，而不是只存在于源码常量；
 * - 结果解读文案迁入共享来源后，面板必须真的消费该来源：条目与顺序不变，
 *   不留第二份本地副本，也不把训练图专属新主题混进本面板（R1）；
 *   其中裁决主题的可信等级那一句经授权澄清过（裁决与等级分开管理），
 *   本文件如实按「澄清后的表述」断言，不声称四条以外的文案逐字未变；
 * - 快捷键、快速开始与常见问题等既有正确帮助内容不得丢失。
 * 断言对象是实际渲染文本，不是快照，也不是源码字符串搜索。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import HelpPanel from '@/components/panels/HelpPanel';
import { HELP_RESULT_READING_TOPIC_IDS, RESULT_READING_TOPICS } from '@/content/resultInterpretation';
import { LAYER_META_LIST, type LayerType } from '@/types/layer';
import { RIGHT_PANEL_IDS } from '@/types/workspace';
import {
  CONCLUSION_TRUST_RANK,
  isAuthoritativeVerdict,
  isKnownConclusionTrust,
} from '@/utils/claimProtocol';
import { verdictForInterval } from '@/utils/statistics';

/** 必须出现在帮助面板中的教学限制与解读要点。 */
const REQUIRED_TEACHING_TEXTS = [
  // 概念校正：不给过度承诺
  '全连接层不只用于分类',
  '并不自动等于可靠概率',
  '归一化不保证必然更快或更好',
  '不能保证不过拟合',
  '不会合并批次维度',
  // 结果解读
  'Loss 下降不等于泛化改善',
  '执行可信不等于模型优秀',
  '金标属于一条评估主张',
  'PASS / FAIL / INCONCLUSIVE',
  '经典模型是结构预设',
  // 设备行为：与实际"拒绝启动而非静默降级"一致
  '不会静默改用 CPU',
] as const;

/** 既有帮助内容不得丢失的锚点文本（S2：快速开始改为新手引导，锚点随之更新为等价内容）。 */
const PRESERVED_TEXTS = [
  'Backspace',
  '删除选中积木',
  'Shift + ↑ / ↓',
  '右侧「数据集」面板',
  'MNIST（或 CIFAR-10）',
  '手动设置 Epochs 与 Batch',
  '「视角自由 / 视角已锁定」只控制旋转、平移和缩放，不锁定积木编辑',
  '直到连接线变为蓝色',
  'Excel 导入仍在开发中',
] as const;

/** S2 引导路线中真实存在的右侧面板 ID（与 workspace.ts 对齐，不接受虚构入口）。 */
const GUIDE_NAVIGABLE_PANEL_IDS = ['dataset', 'param', 'trainMonitor', 'predict', 'study', 'export'] as const;

function layerRow(container: HTMLElement, type: LayerType): Element | null {
  return container.querySelector(`[data-testid="help-layer-${type}"]`);
}

/**
 * 快捷键表是面板内唯一的 table：用它限定断言范围，
 * 免得给生产代码加测试专用属性，也不会误把其他区块的文字算进按键列。
 */
function shortcutRows(): { key: string; desc: string }[] {
  const { container } = render(<HelpPanel />);
  const table = container.querySelector('table');
  if (!table) throw new Error('帮助面板必须渲染快捷键表');
  return Array.from(table.querySelectorAll('tbody tr')).map(row => {
    const cells = row.querySelectorAll('td');
    return {
      key: (cells[0]?.textContent ?? '').trim(),
      desc: (cells[1]?.textContent ?? '').trim(),
    };
  });
}

describe('HelpPanel 层清单消费共享元信息', () => {
  it('渲染的层条目数量与 LAYER_META_LIST 完全一致', () => {
    const { container } = render(<HelpPanel />);
    const rows = container.querySelectorAll('[data-testid^="help-layer-"]');
    expect(rows).toHaveLength(LAYER_META_LIST.length);
  });

  it('每种层类型各出现一次，不重复也不遗漏', () => {
    const { container } = render(<HelpPanel />);
    for (const meta of LAYER_META_LIST) {
      expect(layerRow(container, meta.type)).not.toBeNull();
      expect(container.querySelectorAll(`[data-testid="help-layer-${meta.type}"]`)).toHaveLength(1);
    }
    const declaredTypes = new Set(LAYER_META_LIST.map(meta => meta.type));
    expect(declaredTypes.size).toBe(LAYER_META_LIST.length);
  });

  it('每条说明文本等于共享元信息中的 description', () => {
    const { container } = render(<HelpPanel />);
    for (const meta of LAYER_META_LIST) {
      const row = layerRow(container, meta.type);
      expect(row?.textContent).toContain(meta.type);
      expect(row?.textContent).toContain(meta.description);
    }
  });

  it('修改共享 description 后帮助面板同步变化（证明没有本地副本）', () => {
    const target = LAYER_META_LIST.find(meta => meta.type === 'Conv2D');
    if (!target) throw new Error('LAYER_META_LIST 必须包含 Conv2D 元信息');
    const original = target.description;

    target.description = 'SHARED_SOURCE_PROBE';
    try {
      const { container } = render(<HelpPanel />);
      const row = layerRow(container, 'Conv2D');
      expect(row?.textContent).toContain('SHARED_SOURCE_PROBE');
      // 若面板仍保留本地第二份说明，旧文案会继续出现，这里必须失败
      expect(row?.textContent).not.toContain(original);
    } finally {
      target.description = original;
    }

    const { container } = render(<HelpPanel />);
    expect(layerRow(container, 'Conv2D')?.textContent).toContain(original);
  });
});

describe('HelpPanel 教学要点与既有内容', () => {
  it('关键教学限制与结果解读全部实际渲染', () => {
    const { container } = render(<HelpPanel />);
    const text = container.textContent ?? '';
    for (const required of REQUIRED_TEACHING_TEXTS) {
      expect(text, `帮助面板缺少教学要点：${required}`).toContain(required);
    }
  });

  it('快捷键、快速开始与常见问题等原有帮助内容保留', () => {
    const { container } = render(<HelpPanel />);
    const text = container.textContent ?? '';
    for (const preserved of PRESERVED_TEXTS) {
      expect(text, `帮助面板丢失原有内容：${preserved}`).toContain(preserved);
    }
  });

  it('删除说明落在快捷键表内，且只承诺 Backspace', () => {
    const rows = shortcutRows();
    const deleteRow = rows.find(row => row.desc.includes('删除选中积木'));
    expect(deleteRow?.key).toBe('Backspace');
    const { container } = render(<HelpPanel />);
    expect(container.textContent ?? '').not.toContain('Delete / Backspace');
  });

  it('快捷键表既不新增未绑定的按键，也不丢条目', () => {
    expect(shortcutRows().map(row => row.key)).toEqual([
      'Backspace', 'Escape', '↑ / ↓', 'Shift + ↑ / ↓', 'F12',
    ]);
    // Delete 只能以“未绑定”的说明出现，不能作为按键承诺
    expect(shortcutRows().every(row => !row.key.includes('Delete'))).toBe(true);
    expect(shortcutRows().find(row => row.key === 'Backspace')?.desc).toContain('Delete 未绑定');
  });

  it('透传 className 且不写死外层宽度', () => {
    const { container } = render(<HelpPanel className="help-panel-custom" />);
    const root = container.firstElementChild;
    expect(root?.className).toContain('help-panel-custom');
    expect(root?.getAttribute('style') ?? '').not.toMatch(/(?:^|;)\s*(?:min-|max-)?width\s*:/i);
  });

  it('开发阶段使用验证集，封存测试集只用于冻结后的既定评估', () => {
    render(<HelpPanel />);
    const section = screen.getByText('Loss 下降不等于泛化改善').parentElement;
    expect(section).toHaveTextContent('开发阶段使用验证集比较方案');
    expect(section).toHaveTextContent('封存测试集只在主张冻结后按既定协议评估');
    expect(section).toHaveTextContent('不用于反复调参或选模');
    expect(section).not.toHaveTextContent('两边一起变好才算改善');
  });

  it.each([
    ['gte', 0.95, 0.96, 0.99, 'pass', '区间下界 ≥ 验收线为 PASS'],
    ['gte', 0.95, 0.8, 0.94, 'fail', '上界 < 验收线为 FAIL'],
    ['gte', 0.95, 0.94, 0.97, 'inconclusive', '区间无法确定是否达标'],
    ['gte', 0.95, 0.95, 0.99, 'pass', '区间下界 ≥ 验收线为 PASS'],
    ['gte', 0.95, 0.8, 0.95, 'inconclusive', '区间无法确定是否达标'],
    ['lte', 0.2, 0.1, 0.19, 'pass', '区间上界 ≤ 验收线为 PASS'],
    ['lte', 0.2, 0.21, 0.3, 'fail', '下界 > 验收线为 FAIL'],
    ['lte', 0.2, 0.19, 0.21, 'inconclusive', '区间无法确定是否达标'],
    ['lte', 0.2, 0.1, 0.2, 'pass', '区间上界 ≤ 验收线为 PASS'],
    ['lte', 0.2, 0.2, 0.3, 'inconclusive', '区间无法确定是否达标'],
  ] as const)(
    '裁决说明与 %s 主张的协议一致（阈值 %s，下界 %s，上界 %s → %s）',
    (operator, threshold, lower, upper, expected, requiredText) => {
      // 调用现有协议纯函数核对示例，不在展示层另建裁决算法。
      expect(verdictForInterval(operator, threshold, lower, upper)).toBe(expected);
      render(<HelpPanel />);
      const section = screen.getByText('PASS / FAIL / INCONCLUSIVE').parentElement;
      expect(section).toHaveTextContent(requiredText);
      expect(section).toHaveTextContent(operator === 'gte' ? '对 ≥ 主张（如召回率）' : '对 ≤ 主张（如 MAE）');
    },
  );

  it('不将 INCONCLUSIVE 等同于样本不足；裁决结果与可信等级分开管理', () => {
    render(<HelpPanel />);
    const section = screen.getByText('PASS / FAIL / INCONCLUSIVE').parentElement;
    expect(section).toHaveTextContent('有效样本量未满足冻结规格');
    expect(section).toHaveTextContent('不自动等于样本量不足、执行失败或模型差');
    // 经授权澄清：等级既不由裁决自动授予，也不因 INCONCLUSIVE 自动取消，一律由协议投影决定。
    expect(section).toHaveTextContent('裁决结果本身不自动授予或取消可信等级');
    expect(section).toHaveTextContent('PASS、FAIL、INCONCLUSIVE 都可能是获得金标的那条裁决');
    expect(section).toHaveTextContent('也可能因档案不满足协议而不获背书');
    expect(section).toHaveTextContent('具体等级一律以既有可信协议投影为准');
    expect(section).not.toHaveTextContent('流程可信但样本不足');
    // 旧句把「裁决」讲成「不授予等级」，与协议相反；澄清后不得以绝对化措辞复活。
    expect(section).not.toHaveTextContent('也不授予可信等级');
    expect(section).not.toHaveTextContent(/不授予任何等级|永远不会获得金标|与可信等级无关|自动获得金标/);
  });

  it('协议中裁决枚举与等级枚举互不相交：面板不得把裁决值当成等级（只读核对，不改协议）', () => {
    for (const verdict of ['pass', 'fail', 'inconclusive']) {
      expect(isAuthoritativeVerdict(verdict)).toBe(true);
      expect(isKnownConclusionTrust(verdict)).toBe(false);
    }
    for (const trust of Object.keys(CONCLUSION_TRUST_RANK)) {
      expect(isKnownConclusionTrust(trust)).toBe(true);
      expect(isAuthoritativeVerdict(trust)).toBe(false);
    }
  });

  it('Dropout 仅描述可能的帮助，不保证它一定降低过拟合风险', () => {
    const { container } = render(<HelpPanel />);
    expect(layerRow(container, 'Dropout')).toHaveTextContent('有助于降低过拟合风险');
    expect(layerRow(container, 'Dropout')).not.toHaveTextContent('只降低过拟合风险');
  });
});

describe('HelpPanel 新手引导接线', () => {
  it('快速开始只有一份路线：旧步骤文案不残留，引导内 MNIST 说明不重复', () => {
    const { container } = render(<HelpPanel />);
    const text = container.textContent ?? '';
    expect(text).not.toContain('点击左侧层组件卡片，积木会按网络顺序自动加入 3D 场景');
    expect(text).not.toContain('点击底部「开始训练」按钮启动训练');
    const guide = container.querySelector('[data-testid="quick-start-guide"]');
    if (!guide) throw new Error('快速开始路线必须仍然挂载');
    // 唯一性只在路线内部检查：练习 A 的前置条件会再提一次同一个数据集入口，
    // 那是对既有入口的引用，不是第二条路线。
    expect((guide.textContent ?? '').split('MNIST')).toHaveLength(2);
    expect(container.querySelectorAll('[data-testid="quick-start-guide"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="guide-step-1"]')).toHaveLength(1);
  });

  it('把 onNavigatePanel 透传给引导，按钮点击带正确面板 ID', () => {
    const onNavigatePanel = vi.fn();
    render(<HelpPanel onNavigatePanel={onNavigatePanel} />);
    for (const panelId of GUIDE_NAVIGABLE_PANEL_IDS) {
      expect(RIGHT_PANEL_IDS).toContain(panelId);
      fireEvent.click(screen.getByTestId(`guide-nav-${panelId}`));
    }
    expect(onNavigatePanel).toHaveBeenCalledTimes(GUIDE_NAVIGABLE_PANEL_IDS.length);
    GUIDE_NAVIGABLE_PANEL_IDS.forEach((panelId, index) => {
      expect(onNavigatePanel).toHaveBeenNthCalledWith(index + 1, panelId);
    });
  });

  it('未传回调仍可用（向后兼容）：步骤可读且没有导航按钮', () => {
    const { container } = render(<HelpPanel />);
    expect(container.querySelectorAll('[data-testid^="guide-nav-"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid^="guide-step-"]')).toHaveLength(7);
  });

  it('引导的路线不会替换其他区块：层清单与常见问题仍在引导之后', () => {
    const { container } = render(<HelpPanel onNavigatePanel={() => {}} />);
    expect(container.querySelectorAll('[data-testid^="help-layer-"]')).toHaveLength(LAYER_META_LIST.length);
    expect(container.textContent).toContain('支持自定义数据集吗？');
  });
});

/** N6：动手练习只新增一个区块并复用同一个导航回调，不改动面板既有语义。 */
describe('HelpPanel 动手练习接线', () => {
  const EXERCISE_PANEL_IDS = [
    'dataset',
    'param',
    'study',
    'trainMonitor',
    'export',
  ] as const;

  function positionOf(container: HTMLElement, selector: string): number {
    const root = container.querySelector('[data-testid="teaching-exercises"]');
    if (!root) throw new Error('练习区必须渲染');
    const target = container.querySelector(selector);
    if (!target) throw new Error(`缺少对照元素：${selector}`);
    // 用文档位置比较真实顺序，不靠文案搜索猜区块次序
    return root.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1;
  }

  it('练习区只挂载一次，且排在快速开始之后、快捷键与层清单之前', () => {
    const { container } = render(<HelpPanel onNavigatePanel={() => {}} />);
    expect(container.querySelectorAll('[data-testid="teaching-exercises"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid^="exercise-body-"]')).toHaveLength(3);
    expect(positionOf(container, '[data-testid="quick-start-guide"]')).toBeLessThan(0);
    expect(positionOf(container, 'table')).toBeGreaterThan(0);
    expect(positionOf(container, '[data-testid="help-layer-Conv2D"]')).toBeGreaterThan(0);
  });

  it('onNavigatePanel 同时透传给练习区，按钮回调收到真实面板 ID', () => {
    const onNavigatePanel = vi.fn();
    const { container } = render(<HelpPanel onNavigatePanel={onNavigatePanel} />);
    const exerciseButtons = Array.from(
      container.querySelectorAll<HTMLElement>('[data-testid^="exercise-nav-"]'),
    );
    expect(exerciseButtons.length).toBeGreaterThan(0);
    for (const button of exerciseButtons) {
      fireEvent.click(button);
    }
    expect(onNavigatePanel).toHaveBeenCalledTimes(exerciseButtons.length);
    const calledIds = onNavigatePanel.mock.calls.map(call => call[0] as string).sort();
    expect(calledIds).toEqual([...EXERCISE_PANEL_IDS, 'study'].sort());
    for (const id of calledIds) {
      expect(RIGHT_PANEL_IDS).toContain(id);
    }
  });

  it('练习区不复制新手路线，也不吃掉既有的结果解读与常见问题', () => {
    const { container } = render(<HelpPanel />);
    const exerciseText = container.querySelector('[data-testid="teaching-exercises"]')?.textContent ?? '';
    expect(container.querySelectorAll('[data-testid^="guide-step-"]')).toHaveLength(7);
    expect(exerciseText).not.toContain('第 1 步：');
    const panelText = container.textContent ?? '';
    for (const preserved of ['执行可信不等于模型优秀', '支持自定义数据集吗？', 'Shift + ↑ / ↓']) {
      expect(panelText, `帮助面板丢失原有内容：${preserved}`).toContain(preserved);
    }
  });

  it('未传回调时练习区仍完整可读，且不渲染练习导航按钮', () => {
    const { container } = render(<HelpPanel />);
    expect(container.querySelectorAll('[data-testid^="exercise-nav-"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid^="exercise-body-"]')).toHaveLength(3);
    expect(container.querySelector('[data-testid="teaching-exercises"]')?.textContent).toContain('练习 C');
  });
});

/**
 * R1：结果解读文案迁到共享来源后，帮助面板必须真的消费它，
 * 而不是在面板里再留一份副本；迁移也不得改写条目、顺序或引入训练图新主题。
 */
describe('HelpPanel 结果解读共享来源', () => {
  const LEGACY_IDS = [
    'loss_not_generalization',
    'trust_not_quality',
    'gold_label_one_claim',
    'verdict_three_way',
    'preset_is_structure_only',
  ] as const;

  it('共享分组仍是历史五项，帮助面板逐项渲染其标题与正文', () => {
    expect([...HELP_RESULT_READING_TOPIC_IDS]).toEqual([...LEGACY_IDS]);
    const { container } = render(<HelpPanel />);
    const text = container.textContent ?? '';
    for (const id of LEGACY_IDS) {
      expect(text).toContain(RESULT_READING_TOPICS[id].title);
      expect(text).toContain(RESULT_READING_TOPICS[id].text);
    }
  });

  it('改写共享标题或正文后面板同步变化（证明面板内没有第二份副本）', () => {
    const titleBefore = RESULT_READING_TOPICS.gold_label_one_claim.title;
    const textBefore = RESULT_READING_TOPICS.trust_not_quality.text;
    RESULT_READING_TOPICS.gold_label_one_claim.title = 'SHARED_TITLE_PROBE';
    RESULT_READING_TOPICS.trust_not_quality.text = 'SHARED_TEXT_PROBE';
    try {
      const { container } = render(<HelpPanel />);
      const text = container.textContent ?? '';
      expect(text).toContain('SHARED_TITLE_PROBE');
      expect(text).not.toContain(titleBefore);
      expect(text).toContain('SHARED_TEXT_PROBE');
      expect(text).not.toContain(textBefore);
    } finally {
      RESULT_READING_TOPICS.gold_label_one_claim.title = titleBefore;
      RESULT_READING_TOPICS.trust_not_quality.text = textBefore;
    }
    const { container } = render(<HelpPanel />);
    expect(container.textContent).toContain(titleBefore);
    expect(container.textContent).toContain(textBefore);
  });

  it('五项在文档中的先后顺序与共享分组一致', () => {
    render(<HelpPanel />);
    const wrappers = LEGACY_IDS.map(id => screen.getByText(RESULT_READING_TOPICS[id].title).parentElement);
    for (let index = 1; index < wrappers.length; index += 1) {
      const previous = wrappers[index - 1];
      const current = wrappers[index];
      expect(previous).not.toBeNull();
      expect(current).not.toBeNull();
      expect(previous!.compareDocumentPosition(current!) & Node.DOCUMENT_POSITION_FOLLOWING)
        .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
  });

  it('训练图专属新主题不混进帮助面板，折叠入口也不在此挂载', () => {
    const { container } = render(<HelpPanel />);
    const text = container.textContent ?? '';
    for (const id of ['chart_record_scope', 'chart_single_point', 'chart_value_unit'] as const) {
      expect(text, `帮助面板不应出现训练图专属主题：${id}`).not.toContain(RESULT_READING_TOPICS[id].title);
    }
    expect(container.querySelectorAll('[data-testid^="result-reading-topic-"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid="result-reading-guide"]')).toHaveLength(0);
  });

  it('迁移后既有区间判据仍逐字保留，可信等级句按授权澄清，结果解读区位置不变', () => {
    const { container } = render(<HelpPanel />);
    const text = container.textContent ?? '';
    expect(text).toContain('区间下界 ≥ 验收线为 PASS');
    expect(text).toContain('不能在看过结果后修改验收线把不确定改成通过');
    // 澄清补丁只替换了可信等级那半句：旧表述不得残留，新表述必须真的渲染出来。
    expect(text).not.toContain('也不授予可信等级');
    expect(text).toContain('裁决结果本身不自动授予或取消可信等级');
    // 区块次序不变：层清单 → 结果怎么读 → 常见问题
    const readingTitle = screen.getByText('📖 结果怎么读');
    const faqTitle = screen.getByText('❓ 常见问题');
    const layerTitle = screen.getByText('🧱 层类型说明');
    expect(container.contains(readingTitle)).toBe(true);
    expect(layerTitle.compareDocumentPosition(readingTitle) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(readingTitle.compareDocumentPosition(faqTitle) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    // 裁决条目本体仍在结果解读区内（不是被移到别处渲染）
    const section = screen.getByText(RESULT_READING_TOPICS.verdict_three_way.title).parentElement;
    expect(section).not.toBeNull();
    expect(readingTitle.compareDocumentPosition(section!) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
