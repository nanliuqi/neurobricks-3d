/**
 * S2 新手引导契约测试：
 * - 步骤齐全，每步都写清位置/操作/预期；
 * - 导航按钮只允许真实存在的右侧面板 ID，且回调收到精确的 ID；
 * - 缺少回调时步骤仍完整可读，不渲染无法使用的按钮；
 * - 折叠只是组件内展示状态：不写进度、不写持久化；
 * - 引导不触发任何业务 store 动作，也不改动 store 状态。
 * 断言对象是实际渲染结果与 store 状态，不做源码字符串搜索，也不给生产代码加测试专用接口。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import QuickStartGuide from '@/components/panels/help/QuickStartGuide';
import { RIGHT_PANEL_IDS, isRightPanelId } from '@/types/workspace';
import { useDatasetStore } from '@/stores/useDatasetStore';
import { useExperimentStore } from '@/stores/useExperimentStore';
import { useGPUStore } from '@/stores/useGPUStore';
import { useLayerStore } from '@/stores/useLayerStore';
import { useTrainingStore } from '@/stores/useTrainingStore';

/** 引导路线中确实提供跳转按钮的面板（左侧模型库与底部训练栏没有面板 ID）。 */
const NAVIGABLE_PANEL_IDS = ['dataset', 'param', 'trainMonitor', 'predict', 'study', 'export'] as const;

const BUSINESS_STORES = [
  useLayerStore,
  useDatasetStore,
  useTrainingStore,
  useExperimentStore,
  useGPUStore,
] as const;

function navButtonIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-testid^="guide-nav-"]'))
    .map(el => (el.getAttribute('data-testid') ?? '').replace('guide-nav-', ''));
}

function localStorageSnapshot(): Record<string, string> {
  const entries: Record<string, string> = {};
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (key !== null) entries[key] = window.localStorage.getItem(key) ?? '';
  }
  return entries;
}

function businessStateSnapshot() {
  // 排除动作函数后深拷贝业务数据，避免前后快照共享嵌套对象而漏掉原地修改。
  return BUSINESS_STORES.map(store => structuredClone(Object.fromEntries(
    Object.entries(store.getState()).filter(([, value]) => typeof value !== 'function'),
  )));
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('QuickStartGuide 步骤内容', () => {
  it('渲染 7 个步骤，每步都含位置、操作与预期', () => {
    const { container } = render(<QuickStartGuide onNavigatePanel={() => {}} />);
    const steps = container.querySelectorAll('[data-testid^="guide-step-"]');
    expect(steps).toHaveLength(7);
    steps.forEach((step, index) => {
      const text = step.textContent ?? '';
      expect(text, `第 ${index + 1} 步缺少位置说明`).toContain('第 ' + (index + 1) + ' 步：');
      expect(text, `第 ${index + 1} 步缺少操作说明`).toContain('操作：');
      expect(text, `第 ${index + 1} 步缺少预期说明`).toContain('预期：');
    });
  });

  it('必须说明的边界条件都真的渲染出来', () => {
    const { container } = render(<QuickStartGuide />);
    const text = container.textContent ?? '';
    for (const required of [
      '追加到已有积木栈顶部，不会清空或替换现有结构',
      '课题与当前配置不一致时沿用面板原有的不匹配提示与处理入口',
      '耗时取决于设备与数据量，不承诺五分钟内一定完成',
      '先按原有方式点选要核对的积木',
      '本模块只增加操作说明和导航，不会自动配置工程',
    ]) {
      expect(text, `引导缺少说明：${required}`).toContain(required);
    }
  });

  it('不虚构入口：只声明的右侧面板有按钮，左侧库与底部栏没有', () => {
    const { container } = render(<QuickStartGuide onNavigatePanel={() => {}} />);
    const ids = navButtonIds(container);
    expect([...ids].sort()).toEqual([...NAVIGABLE_PANEL_IDS].sort());
    for (const id of ids) {
      expect(isRightPanelId(id), `导航目标 ${id} 不是真实面板 ID`).toBe(true);
      expect(RIGHT_PANEL_IDS).toContain(id);
    }
    // 帮助面板自身与未纳入路线的面板不得出现跳转按钮
    for (const id of ['help', 'gpu', 'cloud', 'code'] as const) {
      expect(container.querySelector(`[data-testid="guide-nav-${id}"]`)).toBeNull();
    }
    // 第 2 步（左侧经典模型）与第 4 步（底部训练栏）只给文字说明
    expect(container.querySelector('[data-testid="guide-step-2"]')?.textContent).toContain('左侧「层组件库」');
    expect(container.querySelector('[data-testid="guide-step-4"]')?.textContent).toContain('底部训练栏');
    expect(container.querySelectorAll('[data-testid="guide-step-2"] [data-testid^="guide-nav-"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid="guide-step-4"] [data-testid^="guide-nav-"]')).toHaveLength(0);
  });

  it('选择数据集不承诺结构、运行时与课题检查一起通过', () => {
    render(<QuickStartGuide />);
    const step = screen.getByTestId('guide-step-1');
    expect(step).toHaveTextContent('这只完成数据集选择');
    expect(step).toHaveTextContent('检查仍需分别通过');
    expect(step).not.toHaveTextContent('阻断项随之消失');
  });

  it('教学路线使用真实的经典模型点击入口，不要求拖入场景', () => {
    render(<QuickStartGuide />);
    const step = screen.getByTestId('guide-step-2');
    expect(step).toHaveTextContent('点击 LeNet-5 卡片上的「+ 添加」');
    expect(step).toHaveTextContent('本路线不需要拖动卡片或场景积木');
    expect(step).not.toHaveTextContent('把卡片拖到场景中');
  });

  it('训练监控区分实时指标、留档曲线与真正没有证据的空态', () => {
    render(<QuickStartGuide />);
    const step = screen.getByTestId('guide-step-5');
    expect(step).toHaveTextContent('完成或中断后可查看当前课题已留档的曲线');
    expect(step).toHaveTextContent('没有可归属记录时才显示空态');
    expect(step).not.toHaveTextContent('没有正在进行的训练时按面板原有空态显示');
  });

  it('导航替换面板内容，不把帮助卸载说成右栏收起', () => {
    const { container } = render(<QuickStartGuide />);
    expect(container).toHaveTextContent('不会主动收起右栏');
    expect(container).toHaveTextContent('窗口过窄时仍沿用自动收起规则');
    expect(container).not.toHaveTextContent('本帮助面板会随之收起');
  });
});

describe('QuickStartGuide 导航回调', () => {
  it('每个按钮以自身面板 ID 调用回调，重复点击不产生其他 ID', () => {
    const calls: string[] = [];
    const { container } = render(<QuickStartGuide onNavigatePanel={id => calls.push(id)} />);
    for (const id of NAVIGABLE_PANEL_IDS) {
      const button = screen.getByTestId(`guide-nav-${id}`);
      fireEvent.click(button);
      fireEvent.click(button);
    }
    expect(calls).toEqual([...NAVIGABLE_PANEL_IDS.flatMap(id => [id, id])]);
  });

  it('按钮复用基础 Button：type=button 且可访问名称来自共享面板元数据', () => {
    render(<QuickStartGuide onNavigatePanel={() => {}} />);
    const button = screen.getByTestId('guide-nav-dataset');
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('nb-button');
    expect(button.textContent).toContain('数据集');
  });

  it('缺少回调时安全退化：不渲染导航按钮，步骤文字仍完整可读', () => {
    const { container } = render(<QuickStartGuide />);
    expect(container.querySelectorAll('[data-testid^="guide-nav-"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid^="guide-step-"]')).toHaveLength(7);
    expect(container.textContent).toContain('操作：手动设置 Epochs 与 Batch');
  });
});

describe('QuickStartGuide 折叠与副作用边界', () => {
  it('业务快照能检测已有积木参数的原地修改，不保留嵌套对象别名', () => {
    const original = useLayerStore.getState();
    try {
      // 只在测试夹具中构造并修改参数，验证无副作用断言本身能抓到此类错误。
      original.addLayer('Input', [0, 0, 0]);
      const before = businessStateSnapshot();
      const layer = useLayerStore.getState().layers[0];
      if (!layer) throw new Error('测试需要已存在的 Input 积木');
      layer.params.inChannels = 3;
      expect(businessStateSnapshot()).not.toEqual(before);
    } finally {
      useLayerStore.setState(original, true);
    }
  });

  it('折叠只切换展示，不记录进度也不写持久化', () => {
    const setItem = vi.spyOn(window.localStorage, 'setItem');
    const { container } = render(<QuickStartGuide onNavigatePanel={() => {}} />);
    const toggle = screen.getByTestId('quick-start-guide-toggle');

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelectorAll('[data-testid^="guide-step-"]')).toHaveLength(0);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelectorAll('[data-testid^="guide-step-"]')).toHaveLength(7);
    fireEvent.click(screen.getByTestId('guide-nav-dataset'));

    // 折叠/展开/导航都不写任何存储：既不新增键，也不改动既有键
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorageSnapshot()).toEqual({});
    expect(window.localStorage.length).toBe(0);
    setItem.mockRestore();
  });

  it('点击全部导航按钮与折叠：不触发业务动作，也不改动任何 store 状态', () => {
    const stateBefore = businessStateSnapshot();
    const storageBefore = localStorageSnapshot();
    const { container } = render(<QuickStartGuide onNavigatePanel={() => {}} />);

    for (const id of NAVIGABLE_PANEL_IDS) {
      fireEvent.click(screen.getByTestId(`guide-nav-${id}`));
    }
    fireEvent.click(screen.getByTestId('quick-start-guide-toggle'));
    fireEvent.click(screen.getByTestId('quick-start-guide-toggle'));

    expect(businessStateSnapshot()).toEqual(stateBefore);
    expect(localStorageSnapshot()).toEqual(storageBefore);
  });
});
