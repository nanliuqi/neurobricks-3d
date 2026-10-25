/**
 * N6 动手练习契约测试：
 * - 三个练习完整显示，学习目标/前置条件/操作/观察/限制/恢复六个小节一个都不能缺；
 * - 导航只允许真实存在的 RightPanelId，名称取自共享 getRightPanelMeta（不得有第二份名称表）；
 * - 缺回调时说明仍完整可读，不渲染无法使用的按钮；
 * - 折叠、展开、重复导航都不写业务 store、不写 localStorage、不调后端；
 * - 所有入口是原生 button，一次激活只产生一次效果，折叠状态与 aria-expanded 一致；
 * - 不出现「保证精度 / 固定耗时 / 自动完成实验 / 严格可比即显著提升」这类错误承诺，
 *   也不复制「结果怎么读」里的裁决规则；
 * - 练习 C 关于导出的说法与 ExportPanel 真实行为一致：承认写实验包文件并追加导出审计事件，
 *   不允许「导出是只读投递 / 不改变运行档案」这类绝对化措辞；本组件自己仍不得追加任何事件；
 * - 总折叠按钮标题只有「图标 + 动手练习」的短形式，长免责声明归正文，不塞进按钮；
 * - 样式只落在组件自己的类名上，窄面板靠换行、不写死宽度。
 * 断言对象是实际渲染结果与 store 状态；只有样式作用域一条读源码文件。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TeachingExerciseGuide from '@/components/panels/help/TeachingExerciseGuide';
import {
  RIGHT_PANEL_IDS,
  RIGHT_PANELS,
  getRightPanelMeta,
  isRightPanelId,
  type RightPanelId,
} from '@/types/workspace';
import { useDatasetStore } from '@/stores/useDatasetStore';
import { useExperimentStore } from '@/stores/useExperimentStore';
import { useGPUStore } from '@/stores/useGPUStore';
import { useLayerStore } from '@/stores/useLayerStore';
import { useTrainingStore } from '@/stores/useTrainingStore';

const EXERCISE_IDS = ['locate-shape-error', 'compare-training-runs', 'export-honest-record'] as const;

/** 每个练习声明的真实面板入口（左侧模型库与底部训练栏没有面板 ID，不在此出现）。 */
const EXERCISE_PANEL_IDS: Record<(typeof EXERCISE_IDS)[number], readonly RightPanelId[]> = {
  'locate-shape-error': ['dataset', 'param'],
  'compare-training-runs': ['study', 'trainMonitor'],
  'export-honest-record': ['export', 'study'],
};

const ALL_NAV_IDS: RightPanelId[] = EXERCISE_IDS.flatMap(id => EXERCISE_PANEL_IDS[id]);

const FIELD_LABELS = [
  '学习目标',
  '前置条件',
  '具体操作',
  '看哪里、看什么',
  '结果不能说明什么',
  '如何恢复原配置',
] as const;

const BUSINESS_STORES = [
  useLayerStore,
  useDatasetStore,
  useTrainingStore,
  useExperimentStore,
  useGPUStore,
] as const;

function businessStateSnapshot() {
  return BUSINESS_STORES.map(store => structuredClone(Object.fromEntries(
    Object.entries(store.getState()).filter(([, value]) => typeof value !== 'function'),
  )));
}

function localStorageSnapshot(): Record<string, string> {
  const entries: Record<string, string> = {};
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (key !== null) entries[key] = window.localStorage.getItem(key) ?? '';
  }
  return entries;
}

/** 只取练习区文本，避免把既有帮助内容的措辞算进本组件的承诺检查。 */
function sectionText(container: HTMLElement): string {
  const root = container.querySelector('[data-testid="teaching-exercises"]');
  if (!root) throw new Error('练习区必须渲染');
  return root.textContent ?? '';
}

function navTestIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-testid^="exercise-nav-"]'))
    .map(el => el.getAttribute('data-testid') ?? '');
}

/** 在两种 Tauri 注入形态与 fetch 上放探针：练习组件若尝试调用后端就会被记录。 */
function installBackendProbes() {
  const invoke = vi.fn(() => {
    throw new Error('动手练习不得调用 Tauri 后端');
  });
  const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation(() => {
    throw new Error('动手练习不得发起网络请求');
  });
  // setup.ts 把 __TAURI_INTERNALS__ 定义成 writable 但非 configurable，只能用赋值注入探针
  const target = window as unknown as Record<string, unknown>;
  target.__TAURI_INTERNALS__ = { invoke };
  target.__TAURI__ = { invoke };
  return { invoke, fetchSpy };
}

function restoreBackendProbes(fetchSpy: { mockRestore: () => void }) {
  const target = window as unknown as Record<string, unknown>;
  target.__TAURI_INTERNALS__ = undefined;
  target.__TAURI__ = undefined;
  fetchSpy.mockRestore();
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('动手练习内容完整性（六个小节）', () => {
  it('三个练习都渲染，且六个小节标题齐全', () => {
    const { container } = render(<TeachingExerciseGuide onNavigatePanel={() => {}} />);
    const text = sectionText(container);
    expect(container.querySelectorAll('[data-testid^="exercise-body-"]')).toHaveLength(EXERCISE_IDS.length);
    for (const label of FIELD_LABELS) {
      expect(text, `练习区缺少小节：${label}`).toContain(label);
    }
  });

  it.each(EXERCISE_IDS)('%s：前置、操作、观察、限制条目都存在且非空', id => {
    render(<TeachingExerciseGuide onNavigatePanel={() => {}} />);
    const body = screen.getByTestId(`exercise-body-${id}`);
    const count = (testId: string) => body.querySelectorAll(`[data-testid="${testId}"]`);

    expect((body.querySelector(`[data-testid="exercise-${id}-goal"]`)?.textContent ?? '').length).toBeGreaterThan(10);
    expect(count(`exercise-${id}-prerequisite`).length).toBeGreaterThanOrEqual(3);
    expect(body.querySelectorAll(`[data-testid^="exercise-${id}-step-"]`).length).toBeGreaterThanOrEqual(5);
    expect(count(`exercise-${id}-observation`).length).toBeGreaterThanOrEqual(3);
    expect(count(`exercise-${id}-limitation`).length).toBeGreaterThanOrEqual(4);
    expect((body.querySelector(`[data-testid="exercise-${id}-restoration"]`)?.textContent ?? '')).toContain('恢复');
  });

  it.each(EXERCISE_IDS)('%s：每条观察都同时写明位置与现象', id => {
    render(<TeachingExerciseGuide onNavigatePanel={() => {}} />);
    const items = screen.getAllByTestId(`exercise-${id}-observation`);
    for (const item of items) {
      const spans = Array.from(item.querySelectorAll('span')).map(span => (span.textContent ?? '').trim());
      expect(spans[0].length, '观察项缺少位置说明').toBeGreaterThan(4);
      expect(spans[1].length, '观察项缺少现象说明').toBeGreaterThan(4);
    }
  });

  it('练习文本不含操作之外的自动动作承诺', () => {
    const { container } = render(<TeachingExerciseGuide onNavigatePanel={() => {}} />);
    const text = sectionText(container);
    for (const forbidden of [
      '自动为你训练', '自动完成实验', '自动导出', '自动添加层', '自动清空',
      '保证精度', '必然提升', '一定更快', '固定耗时', '五分钟内完成',
      '练习已完成', '已解锁', '解锁下一', '积分',
      '严格可比即显著提升', '说明该学习率更优',
    ]) {
      expect(text, `练习区出现错误承诺：${forbidden}`).not.toContain(forbidden);
    }
  });

  it('诚实边界写在练习里：单 seed、单点、静态结构、泛化未验证都不越界', () => {
    const { container } = render(<TeachingExerciseGuide onNavigatePanel={() => {}} />);
    const text = sectionText(container);
    for (const required of [
      '不能说明哪个学习率更好',
      '只能读那一个点的数值',
      '不是前向执行结果',
      '泛化能力尚未由冻结主张独立验证',
      '不等同于统计显著提升',
      '「指标不可用」',
      '不会出现 NaN',
      '官方测试集保持封存',
    ]) {
      expect(text, `练习区缺少边界说明：${required}`).toContain(required);
    }
  });

  it('不复制「结果怎么读」的裁决规则，只引用所在小节', () => {
    const { container } = render(<TeachingExerciseGuide onNavigatePanel={() => {}} />);
    const text = sectionText(container);
    expect(text).toContain('结果怎么读');
    for (const ruleCopy of ['区间下界 ≥ 验收线', '上界 < 验收线', 'INCONCLUSIVE：当前证据不足']) {
      expect(text, `练习区重复了裁决规则：${ruleCopy}`).not.toContain(ruleCopy);
    }
  });

  it('不复制新手路线：只引用第 1 步入口，不再列一遍七步', () => {
    const { container } = render(<TeachingExerciseGuide onNavigatePanel={() => {}} />);
    const text = sectionText(container);
    expect(text).toContain('与新手引导第 1 步是同一入口');
    expect(text).not.toContain('第 1 步：');
    expect(container.querySelectorAll('[data-testid^="guide-step-"]')).toHaveLength(0);
  });
});

describe('动手练习导航：只用真实面板 ID', () => {
  it('导航按钮集合与声明的面板 ID 完全一致，且全部是存在的 RightPanelId', () => {
    const expectedTestIds = EXERCISE_IDS.flatMap(
      id => EXERCISE_PANEL_IDS[id].map(panelId => `exercise-nav-${id}-${panelId}`),
    );
    const { container } = render(<TeachingExerciseGuide onNavigatePanel={() => {}} />);
    expect(navTestIds(container).sort()).toEqual([...expectedTestIds].sort());
    for (const panelId of ALL_NAV_IDS) {
      expect(isRightPanelId(panelId), `导航目标 ${panelId} 不是真实面板 ID`).toBe(true);
      expect(RIGHT_PANEL_IDS).toContain(panelId);
    }
  });

  it('按钮名称取自共享面板元数据，不存在第二份名称表', () => {
    const { container } = render(<TeachingExerciseGuide onNavigatePanel={() => {}} />);
    for (const id of EXERCISE_IDS) {
      for (const panelId of EXERCISE_PANEL_IDS[id]) {
        const button = screen.getByTestId(`exercise-nav-${id}-${panelId}`);
        expect(button.textContent).toBe(`打开「${getRightPanelMeta(panelId).label}」面板`);
      }
    }
  });

  it('面板名称只有一份来源：改共享 label 后按钮文本同步变化（证明没有本地副本）', () => {
    const target = RIGHT_PANELS.find(panel => panel.id === 'dataset');
    if (!target) throw new Error('共享面板元数据必须包含 dataset');
    const original = target.label;
    target.label = 'SHARED_PANEL_LABEL_PROBE';
    try {
      render(<TeachingExerciseGuide onNavigatePanel={() => {}} />);
      const button = screen.getByTestId('exercise-nav-locate-shape-error-dataset');
      expect(button.textContent).toContain('SHARED_PANEL_LABEL_PROBE');
      // 组件若自带第二份名称表，旧文案会继续出现，这里必须失败
      expect(button.textContent).not.toContain(original);
    } finally {
      target.label = original;
    }
  });

  it('左侧模型库与底部训练栏不给按钮，只给文字位置说明', () => {
    const { container } = render(<TeachingExerciseGuide onNavigatePanel={() => {}} />);
    const text = sectionText(container);
    expect(text).toContain('左侧「层组件库」');
    expect(text).toContain('底部训练栏');
    for (const testId of navTestIds(container)) {
      expect(testId).not.toMatch(/-(gpu|cloud|predict|code|help)$/);
    }
    expect(container.querySelectorAll('[data-testid^="exercise-nav-"]')).toHaveLength(ALL_NAV_IDS.length);
  });

  it('每个按钮以自身面板 ID 调用回调，重复点击不产生其他 ID', () => {
    const calls: RightPanelId[] = [];
    render(<TeachingExerciseGuide onNavigatePanel={id => calls.push(id)} />);
    for (const id of EXERCISE_IDS) {
      for (const panelId of EXERCISE_PANEL_IDS[id]) {
        const button = screen.getByTestId(`exercise-nav-${id}-${panelId}`);
        fireEvent.click(button);
        fireEvent.click(button);
      }
    }
    expect(calls).toEqual(EXERCISE_IDS.flatMap(id => EXERCISE_PANEL_IDS[id].flatMap(panelId => [panelId, panelId])));
  });

  it('缺少回调时安全退化：说明完整可读，不渲染无法使用的按钮', () => {
    const { container } = render(<TeachingExerciseGuide />);
    expect(navTestIds(container)).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid^="exercise-body-"]')).toHaveLength(EXERCISE_IDS.length);
    expect(sectionText(container)).toContain('把内置数据集选为 MNIST');
  });
});

describe('动手练习折叠与键盘语义', () => {
  it('折叠只切换展示，aria-expanded 与内容存在状态始终一致', () => {
    const { container } = render(<TeachingExerciseGuide onNavigatePanel={() => {}} />);
    const sectionToggle = screen.getByTestId('teaching-exercises-toggle');

    expect(sectionToggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(sectionToggle);
    expect(sectionToggle).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelectorAll('[data-testid^="exercise-body-"]')).toHaveLength(0);
    expect(container.querySelector('[data-testid="teaching-exercises-body"]')).toBeNull();

    fireEvent.click(sectionToggle);
    expect(sectionToggle).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelectorAll('[data-testid^="exercise-body-"]')).toHaveLength(EXERCISE_IDS.length);
  });

  it.each(EXERCISE_IDS)('%s：单个练习折叠后再展开，内容数量一致', id => {
    render(<TeachingExerciseGuide onNavigatePanel={() => {}} />);
    const toggle = screen.getByTestId(`exercise-toggle-${id}`);
    const countSteps = () => screen
      .getByTestId(`exercise-body-${id}`)
      .querySelectorAll(`[data-testid^="exercise-${id}-step-"]`).length;
    const stepsBefore = countSteps();

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId(`exercise-body-${id}`)).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(countSteps()).toBe(stepsBefore);
  });

  it('全部入口都是原生 button（type=button），一次激活只产生一次效果', () => {
    const calls: RightPanelId[] = [];
    const { container } = render(<TeachingExerciseGuide onNavigatePanel={id => calls.push(id)} />);
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        '[data-testid^="exercise-toggle-"], [data-testid^="exercise-nav-"], [data-testid="teaching-exercises-toggle"]',
      ),
    );
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.tagName).toBe('BUTTON');
      expect(button).toHaveAttribute('type', 'button');
      expect(button).toBeEnabled();
    }

    // 折叠按钮一次点击只切换一次状态；导航按钮一次点击只回调一次
    fireEvent.click(screen.getByTestId('exercise-nav-locate-shape-error-dataset'));
    expect(calls).toEqual(['dataset']);
    fireEvent.click(screen.getByTestId('exercise-toggle-locate-shape-error'));
    expect(screen.queryByTestId('exercise-body-locate-shape-error')).toBeNull();
    fireEvent.click(screen.getByTestId('exercise-toggle-locate-shape-error'));
    expect(screen.getByTestId('exercise-body-locate-shape-error')).toBeInTheDocument();
  });
});

describe('动手练习零业务副作用', () => {
  it('折叠全部练习、重复导航：业务 store 与存储一律不变，也不调用后端', () => {
    const probes = installBackendProbes();
    const stateBefore = businessStateSnapshot();
    const storageBefore = localStorageSnapshot();
    const setItem = vi.spyOn(window.localStorage, 'setItem');
    const { container } = render(<TeachingExerciseGuide onNavigatePanel={() => {}} />);

    for (const id of EXERCISE_IDS) {
      fireEvent.click(screen.getByTestId(`exercise-toggle-${id}`));
      fireEvent.click(screen.getByTestId(`exercise-toggle-${id}`));
    }
    for (const testId of navTestIds(container)) {
      fireEvent.click(screen.getByTestId(testId));
      fireEvent.click(screen.getByTestId(testId));
    }
    fireEvent.click(screen.getByTestId('teaching-exercises-toggle'));
    fireEvent.click(screen.getByTestId('teaching-exercises-toggle'));

    expect(businessStateSnapshot()).toEqual(stateBefore);
    expect(localStorageSnapshot()).toEqual(storageBefore);
    expect(window.localStorage.length).toBe(0);
    expect(setItem).not.toHaveBeenCalled();
    expect(probes.invoke).not.toHaveBeenCalled();
    expect(probes.fetchSpy).not.toHaveBeenCalled();
    setItem.mockRestore();
    restoreBackendProbes(probes.fetchSpy);
  });

  it('选中态与参数量等既有展示状态不被导航触碰', () => {
    const before = {
      selectedId: useLayerStore.getState().selectedId,
      layers: useLayerStore.getState().layers.length,
      totalParams: useLayerStore.getState().totalParams,
      dataset: useDatasetStore.getState().datasetInfo?.type ?? null,
      trainingStatus: useTrainingStore.getState().status,
    };
    const { container } = render(<TeachingExerciseGuide onNavigatePanel={() => {}} />);
    for (const testId of navTestIds(container)) {
      fireEvent.click(screen.getByTestId(testId));
    }
    expect({
      selectedId: useLayerStore.getState().selectedId,
      layers: useLayerStore.getState().layers.length,
      totalParams: useLayerStore.getState().totalParams,
      dataset: useDatasetStore.getState().datasetInfo?.type ?? null,
      trainingStatus: useTrainingStore.getState().status,
    }).toEqual(before);
  });
});

describe('练习 C 导出说明与真实导出行为一致', () => {
  /** 恢复说明小节的文本：练习 C 关于「导出会不会留下痕迹」的唯一表述位置。 */
  function restorationText(): string {
    render(<TeachingExerciseGuide onNavigatePanel={() => {}} />);
    return screen.getByTestId('exercise-export-honest-record-restoration').textContent ?? '';
  }

  it('承认追加导出审计事件：三种事件按 ExportPanel 的真实事件名写出', () => {
    const text = restorationText();
    expect(text).toContain('审计事件');
    // 事件名必须与 ExportPanel 实际 appendEvent 的类型一致，不能只写成模糊的「留痕」
    expect(text).toContain('experiment_package_export_requested');
    expect(text).toContain('experiment_package_export_completed');
    expect(text).toContain('failed');
  });

  it('承认写入实验包文件，并保留「拒绝静默覆盖」与「无需恢复工程配置」', () => {
    const text = restorationText();
    expect(text).toMatch(/写入实验包/);
    expect(text).toContain('拒绝覆盖');
    expect(text).toContain('无需恢复工程配置');
    // 如实说明导出不碰网络参数：这是它确实不写的部分，不能连这条一起删成「什么都写」
    expect(text).toContain('不修改网络参数');
  });

  it('绝对化只读措辞已清除：练习 C 不再声称导出不改变档案', () => {
    render(<TeachingExerciseGuide onNavigatePanel={() => {}} />);
    const exerciseC = screen.getByTestId('exercise-body-export-honest-record').textContent ?? '';
    for (const claim of [
      '不改变运行档案', '没有需要撤销的工作区状态', '导出是只读',
      '不会留下任何记录', '不留痕', '不写任何记录',
    ]) {
      expect(exerciseC, `练习 C 仍有绝对化只读承诺：${claim}`).not.toContain(claim);
    }
    // 「只读」只允许出现在被否定的句子里：放行「不是纯只读投递」，不放行把它说成事实
    for (const sentence of exerciseC.split(/[。；\n]/)) {
      if (!sentence.includes('只读')) continue;
      expect(sentence, `只读表述没有否定成分：${sentence}`).toMatch(/不是|并非|不等于/);
    }
    // 按钮不再承载免责声明：长说明归正文，按钮只剩图标 + 短标题
    const toggle = screen.getByTestId('teaching-exercises-toggle');
    expect(toggle.textContent).toBe('▼ 动手练习');
    expect(toggle.textContent).not.toContain('只读');
  });

  it('短标题不吞掉说明：折叠图标随状态切换，只读与手动操作的解释仍在正文里', () => {
    render(<TeachingExerciseGuide onNavigatePanel={() => {}} />);
    const toggle = screen.getByTestId('teaching-exercises-toggle');

    expect(toggle.textContent).toBe('▼ 动手练习');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const intro = screen.getByTestId('teaching-exercises-body').querySelector('.help-exercises__intro');
    expect(intro, '正文缺少只读边界说明').not.toBeNull();
    expect(intro?.textContent).toContain('本区域只读');
    expect(intro?.textContent).toContain('由你手动完成');
    // 说明确实归正文：按钮文本里不应该再出现这些长句片段
    for (const fragment of ['只读', '手动完成', '不会替你配置工程']) {
      expect(toggle.textContent, `按钮标题仍夹带免责声明：${fragment}`).not.toContain(fragment);
    }

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle.textContent).toBe('▶ 动手练习');
    expect(screen.queryByTestId('teaching-exercises-body')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.textContent).toBe('▼ 动手练习');
    expect(screen.getByTestId('teaching-exercises-body').textContent).toContain('本区域只读');
  });

  it('限制条目也承认导出会写文件与追加事件，同时保留测试集封存边界', () => {
    render(<TeachingExerciseGuide onNavigatePanel={() => {}} />);
    const limitations = screen
      .getAllByTestId('exercise-export-honest-record-limitation')
      .map(item => item.textContent ?? '');
    const sealed = limitations.find(item => item.includes('官方测试集保持封存'));
    expect(sealed, '缺少测试集封存条目').toBeDefined();
    expect(sealed).toContain('写文件');
    expect(sealed).toContain('追加导出审计事件');
    expect(sealed).toContain('不替你做任何评估决定');
  });

  it('组件自己一个导出事件都不追加：文案说的写入只发生在用户手动导出时', () => {
    const eventsBefore = useExperimentStore.getState().ledger.events;
    render(<TeachingExerciseGuide onNavigatePanel={() => {}} />);

    fireEvent.click(screen.getByTestId('exercise-toggle-export-honest-record'));
    fireEvent.click(screen.getByTestId('exercise-toggle-export-honest-record'));
    for (const panelId of EXERCISE_PANEL_IDS['export-honest-record']) {
      const button = screen.getByTestId(`exercise-nav-export-honest-record-${panelId}`);
      fireEvent.click(button);
      fireEvent.click(button);
    }

    const eventsAfter = useExperimentStore.getState().ledger.events;
    expect(eventsAfter).toHaveLength(eventsBefore.length);
    expect(eventsAfter.filter(event => event.eventType.startsWith('experiment_package_export_'))).toHaveLength(0);
    // 折叠两轮后练习 C 仍然展开：恢复说明文字依旧完整可读
    expect(screen.getByTestId('exercise-export-honest-record-restoration').textContent).toContain('审计事件');
  });
});

describe('动手练习样式作用域', () => {
  it('新增规则只落在组件自己的类名上，且不写死宽度', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf-8');
    const start = css.indexOf('帮助面板动手练习');
    expect(start, '缺少练习区样式注释块').toBeGreaterThan(-1);
    const nextBlock = css.indexOf('/* ----------', start + 10);
    const block = css.slice(start, nextBlock === -1 ? css.length : nextBlock);
    const selectors = block
      .split('\n')
      .filter(line => line.trimEnd().endsWith('{'))
      .map(line => line.trim().replace(/\{$/, '').trim());

    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(selector, `练习样式越界：${selector}`).toMatch(/^\.help-exercises/);
    }
    expect(block).toContain('overflow-wrap: anywhere');
    expect(block).not.toMatch(/(?:^|[\s;])(?:min-|max-)?width\s*:/);
  });
});
