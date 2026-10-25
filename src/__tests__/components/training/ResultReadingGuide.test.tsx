/**
 * 「如何读图」折叠组件契约（R1）：
 * - 默认收起，触发器标题只有固定的短文案「如何读图」（加状态图标），长说明归正文；
 * - 原生 button 语义：type="button"、aria-expanded 与真实展开状态一致、
 *   aria-controls 指向实际存在的内容区；键盘切换只依赖原生激活，不叠加处理；
 * - 多实例必须各有自己的 DOM ID，不共用同一个 aria-controls；
 * - 展开内容留在正常 HTML 文档流里，不进入 SVG、不悬浮遮挡；
 * - 只维护局部展开状态：折叠/展开/重复点击都不读 store、不写存储、不调后端；
 * - 主题只由传入的静态 ID 分组决定，组件不自造或按数据增删条目；
 * - 样式只落在本组件类名上，窄面板靠换行，不写死宽高或浮层定位。
 * R2 追加可选 label：未传时行为与 R1 完全一致，传入时只替换触发器上的固定短文案。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ResultReadingGuide from '@/components/training/ResultReadingGuide';
import {
  COMPARISON_READING_TOPIC_IDS,
  HELP_RESULT_READING_TOPIC_IDS,
  RESULT_READING_TOPICS,
  TRAINING_CHART_READING_TOPIC_IDS,
  TRAIN_RESULT_READING_TOPIC_IDS,
} from '@/content/resultInterpretation';
import { useDatasetStore } from '@/stores/useDatasetStore';
import { useExperimentStore } from '@/stores/useExperimentStore';
import { useGPUStore } from '@/stores/useGPUStore';
import { useLayerStore } from '@/stores/useLayerStore';
import { useTrainingStore } from '@/stores/useTrainingStore';

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

/** 只取正文文本，免得把触发器标题算进措辞检查。 */
function bodyText(container: HTMLElement): string {
  const body = container.querySelector('[data-testid="result-reading-guide-body"]');
  return body?.textContent ?? '';
}

function toggleOf(container: HTMLElement, index = 0): HTMLElement {
  const toggles = Array.from(container.querySelectorAll('[data-testid="result-reading-guide-toggle"]'));
  const toggle = toggles[index];
  if (!toggle) throw new Error('读图触发器必须渲染');
  return toggle;
}

function installBackendProbes() {
  const invoke = vi.fn(() => {
    throw new Error('读图说明不得调用 Tauri 后端');
  });
  const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation(() => {
    throw new Error('读图说明不得发起网络请求');
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

const initialTrainingState = useTrainingStore.getState();

beforeEach(() => {
  window.localStorage.clear();
  useTrainingStore.setState(initialTrainingState, true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('默认收起与短标题', () => {
  it('收起时正文不存在，标题只有固定的短文案', () => {
    const { container } = render(<ResultReadingGuide topicIds={TRAINING_CHART_READING_TOPIC_IDS} />);
    const toggle = toggleOf(container);
    expect(toggle.textContent).toBe('▶ 如何读图');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-testid="result-reading-guide-body"]')).toBeNull();
    expect(container.textContent).not.toContain('两条线来自不同的记录范围');
  });

  it('标题不塞免责声明：长说明只出现在正文里', () => {
    const { container } = render(<ResultReadingGuide topicIds={TRAINING_CHART_READING_TOPIC_IDS} />);
    const toggle = toggleOf(container);
    for (const long of ['不会修改', '只读', '不替代', '过程记录', '百分点']) {
      expect(toggle.textContent, `触发器标题不应出现：${long}`).not.toContain(long);
    }
    fireEvent.click(toggle);
    expect(bodyText(container)).toContain('过程记录不能冒充最终验证证据');
  });
});

describe('展开/收起状态机', () => {
  it('一次点击展开全部主题，再次点击收起', () => {
    const { container } = render(<ResultReadingGuide topicIds={TRAINING_CHART_READING_TOPIC_IDS} />);
    const toggle = toggleOf(container);

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe('▼ 如何读图');
    const items = container.querySelectorAll('[data-testid^="result-reading-topic-"]');
    expect(items).toHaveLength(TRAINING_CHART_READING_TOPIC_IDS.length);
    for (const id of TRAINING_CHART_READING_TOPIC_IDS) {
      const item = container.querySelector(`[data-testid="result-reading-topic-${id}"]`);
      expect(item, `缺少主题 ${id}`).not.toBeNull();
      expect(item?.textContent).toContain(RESULT_READING_TOPICS[id].title);
      expect(item?.textContent).toContain(RESULT_READING_TOPICS[id].text);
    }

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-testid="result-reading-guide-body"]')).toBeNull();
    expect(container.querySelectorAll('[data-testid^="result-reading-topic-"]')).toHaveLength(0);
  });

  it('重复点击只按点击次数切换，不出现残留隐藏内容', () => {
    const { container } = render(<ResultReadingGuide topicIds={TRAINING_CHART_READING_TOPIC_IDS} />);
    const toggle = toggleOf(container);
    for (let round = 0; round < 4; round += 1) fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelectorAll('[data-testid="result-reading-guide-body"]')).toHaveLength(0);
    fireEvent.click(toggle);
    expect(container.querySelectorAll('[data-testid="result-reading-guide-body"]')).toHaveLength(1);
  });

  it('主题集合由传入分组决定：换分组就换内容，组件不自造条目', () => {
    const { container } = render(<ResultReadingGuide topicIds={HELP_RESULT_READING_TOPIC_IDS} />);
    fireEvent.click(toggleOf(container));
    expect(container.querySelectorAll('[data-testid^="result-reading-topic-"]'))
      .toHaveLength(HELP_RESULT_READING_TOPIC_IDS.length);
    expect(container.querySelector('[data-testid="result-reading-topic-verdict_three_way"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="result-reading-topic-chart_value_unit"]')).toBeNull();
  });

  it('组件不接受业务实体、不读 metrics：内容只是文案', () => {
    const { container } = render(<ResultReadingGuide topicIds={TRAINING_CHART_READING_TOPIC_IDS} />);
    fireEvent.click(toggleOf(container));
    const text = bodyText(container);
    for (const id of TRAINING_CHART_READING_TOPIC_IDS) {
      expect(text).toContain(RESULT_READING_TOPICS[id].text);
    }
    expect(text).not.toMatch(/NaN|Infinity|undefined/);
  });
});

describe('原生 button 与 aria 关联', () => {
  it('触发器是原生 button，type="button"，aria-controls 指向真实内容区', () => {
    const { container } = render(<ResultReadingGuide topicIds={TRAINING_CHART_READING_TOPIC_IDS} />);
    const toggle = toggleOf(container);
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('type')).toBe('button');
    expect(toggle.hasAttribute('aria-controls')).toBe(true);
    const controlsId = toggle.getAttribute('aria-controls');
    expect(controlsId).toBeTruthy();
    expect(container.querySelector(`[data-testid="result-reading-guide-body"]`)).toBeNull();

    fireEvent.click(toggle);
    const body = document.getElementById(controlsId as string);
    expect(body).not.toBeNull();
    expect(body?.getAttribute('data-testid')).toBe('result-reading-guide-body');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('收起后 aria-controls 指向的 ID 不再存在于文档中', () => {
    const { container } = render(<ResultReadingGuide topicIds={TRAINING_CHART_READING_TOPIC_IDS} />);
    const toggle = toggleOf(container);
    fireEvent.click(toggle);
    const controlsId = toggle.getAttribute('aria-controls') as string;
    expect(document.getElementById(controlsId)).not.toBeNull();
    fireEvent.click(toggle);
    expect(document.getElementById(controlsId)).toBeNull();
    expect(toggle.getAttribute('aria-controls')).toBe(controlsId);
  });

  it('展开内容留在文档流里，不放进 SVG、不悬浮遮挡', () => {
    const { container } = render(
      <div>
        <svg data-testid="decoy" role="img" aria-label="图形"><circle cx="1" cy="1" r="1" /></svg>
        <ResultReadingGuide topicIds={TRAINING_CHART_READING_TOPIC_IDS} />
      </div>,
    );
    fireEvent.click(toggleOf(container));
    const guide = container.querySelector('[data-testid="result-reading-guide"]');
    const body = container.querySelector('[data-testid="result-reading-guide-body"]');
    expect(guide?.closest('svg')).toBeNull();
    expect(body?.closest('svg')).toBeNull();
    expect(container.querySelector('svg')?.contains(guide as Node)).toBe(false);
    expect(body?.parentElement).toBe(guide);
  });

  it('键盘切换只依赖原生 button：组件不自行绑定 keydown/keyup', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/training/ResultReadingGuide.tsx'),
      'utf-8',
    );
    for (const handler of ['onKeyDown', 'onKeyUp', 'onKeyPress', 'addEventListener', 'preventDefault']) {
      expect(source, `不得叠加自定义键盘处理：${handler}`).not.toContain(handler);
    }
  });

  it('两个实例的 DOM ID 不重复，各自控制自己的内容区', () => {
    const { container } = render(
      <div>
        <ResultReadingGuide topicIds={HELP_RESULT_READING_TOPIC_IDS} />
        <ResultReadingGuide topicIds={TRAINING_CHART_READING_TOPIC_IDS} />
      </div>,
    );
    const toggles = [toggleOf(container, 0), toggleOf(container, 1)];
    const ids = toggles.map(toggle => toggle.getAttribute('aria-controls'));
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBeTruthy();

    // 只展开第二个实例：第一个的内容区不存在，第二个指向自己的那一份
    fireEvent.click(toggles[1]);
    expect(document.getElementById(ids[0] as string)).toBeNull();
    const secondBody = document.getElementById(ids[1] as string);
    expect(secondBody).not.toBeNull();
    expect(secondBody?.textContent).toContain(RESULT_READING_TOPICS.chart_value_unit.title);
    expect(secondBody?.textContent).not.toContain(RESULT_READING_TOPICS.verdict_three_way.title);
    expect(toggles[0].getAttribute('aria-expanded')).toBe('false');
    expect(toggles[1].getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(toggles[0]);
    expect(document.getElementById(ids[0] as string)?.textContent)
      .toContain(RESULT_READING_TOPICS.verdict_three_way.text);
    expect(container.querySelectorAll('[data-testid="result-reading-guide-body"]')).toHaveLength(2);
  });
});

describe('零业务副作用', () => {
  it('展开、收起、重复点击：业务 store、存储与后端一律不动', () => {
    const probes = installBackendProbes();
    const stateBefore = businessStateSnapshot();
    const storageBefore = localStorageSnapshot();
    const setItem = vi.spyOn(window.localStorage, 'setItem');
    const { container } = render(<ResultReadingGuide topicIds={TRAINING_CHART_READING_TOPIC_IDS} />);
    const toggle = toggleOf(container);

    for (let round = 0; round < 5; round += 1) fireEvent.click(toggle);

    expect(businessStateSnapshot()).toEqual(stateBefore);
    expect(localStorageSnapshot()).toEqual(storageBefore);
    expect(window.localStorage.length).toBe(0);
    expect(setItem).not.toHaveBeenCalled();
    expect(probes.invoke).not.toHaveBeenCalled();
    expect(probes.fetchSpy).not.toHaveBeenCalled();
    setItem.mockRestore();
    restoreBackendProbes(probes.fetchSpy);
  });

  it('组件不订阅 store：训练状态变化不影响展开内容与资格措辞', () => {
    const { container } = render(<ResultReadingGuide topicIds={TRAINING_CHART_READING_TOPIC_IDS} />);
    fireEvent.click(toggleOf(container));
    const before = bodyText(container);
    useTrainingStore.setState({ isTraining: true, status: 'training', currentEpoch: 1, totalEpochs: 2 });
    expect(bodyText(container)).toBe(before);
    expect(bodyText(container)).not.toMatch(/已完成|通过验收|训练成功/);
    useTrainingStore.setState({ isTraining: false, status: 'idle' });
  });
});

/**
 * R2：折叠组件新增可选短标签，必须完全向后兼容。
 * 未传 label 时 R1 的标题、主题与交互逐字节不变；标签只是触发器上的固定短文案，
 * 不进入正文、不改变主题集合、不承载实验名/指标值/免责声明，也不新增副作用。
 */
describe('可选短标签（R2）', () => {
  it('未传 label 与显式传默认值完全等价：标题、图标与主题集合一致', () => {
    const { container } = render(
      <div>
        <ResultReadingGuide topicIds={TRAINING_CHART_READING_TOPIC_IDS} />
        <ResultReadingGuide topicIds={TRAINING_CHART_READING_TOPIC_IDS} label="如何读图" />
      </div>,
    );
    const first = toggleOf(container, 0);
    const second = toggleOf(container, 1);
    expect(first.textContent).toBe('▶ 如何读图');
    expect(second.textContent).toBe('▶ 如何读图');
    fireEvent.click(first);
    fireEvent.click(second);
    expect(first.textContent).toBe('▼ 如何读图');
    expect(toggleOf(container, 1).textContent).toBe('▼ 如何读图');
    expect(container.querySelectorAll('[data-testid^="result-reading-topic-"]')).toHaveLength(8);
  });

  it.each([
    ['如何比较', COMPARISON_READING_TOPIC_IDS],
    ['结果说明', TRAIN_RESULT_READING_TOPIC_IDS],
  ] as const)('标签「%s」只替换标题文字，主题仍由分组决定', (label, ids) => {
    const { container } = render(<ResultReadingGuide topicIds={ids} label={label} />);
    const toggle = toggleOf(container);
    expect(container.querySelector('[data-testid="result-reading-guide-body"]')).toBeNull();
    expect(toggle.textContent).toBe(`▶ ${label}`);
    fireEvent.click(toggle);
    expect(toggle.textContent).toBe(`▼ ${label}`);
    const items = container.querySelectorAll('[data-testid^="result-reading-topic-"]');
    expect(items).toHaveLength(ids.length);
    expect([...items].map(item => item.getAttribute('data-testid')))
      .toEqual(ids.map(id => `result-reading-topic-${id}`));
    // 标签不写进正文，正文也不混入其他分组的主题
    const text = bodyText(container);
    expect(text).not.toContain(label);
    for (const id of ids) expect(text).toContain(RESULT_READING_TOPICS[id].text);
    expect(text).not.toContain(RESULT_READING_TOPICS.verdict_three_way.text);
  });

  it('带标签时 ARIA 关系与收起行为不变', () => {
    const { container } = render(
      <ResultReadingGuide topicIds={COMPARISON_READING_TOPIC_IDS} label="如何比较" />,
    );
    const toggle = toggleOf(container);
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('type')).toBe('button');
    const controlsId = toggle.getAttribute('aria-controls');
    expect(controlsId).toBeTruthy();
    fireEvent.click(toggle);
    expect(document.getElementById(controlsId as string)?.getAttribute('data-testid'))
      .toBe('result-reading-guide-body');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(document.getElementById(controlsId as string)).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('两种新标签各一个实例：ID 不重复、展开互不影响', () => {
    const { container } = render(
      <div>
        <ResultReadingGuide topicIds={COMPARISON_READING_TOPIC_IDS} label="如何比较" />
        <ResultReadingGuide topicIds={TRAIN_RESULT_READING_TOPIC_IDS} label="结果说明" />
      </div>,
    );
    const toggles = [toggleOf(container, 0), toggleOf(container, 1)];
    const ids = toggles.map(toggle => toggle.getAttribute('aria-controls'));
    expect(new Set(ids).size).toBe(2);
    fireEvent.click(toggles[1]);
    expect(document.getElementById(ids[0] as string)).toBeNull();
    expect(document.getElementById(ids[1] as string)?.textContent)
      .toContain(RESULT_READING_TOPICS.final_point_best_epoch.text);
    expect(toggles[0].getAttribute('aria-expanded')).toBe('false');
    expect(toggles[1].getAttribute('aria-expanded')).toBe('true');
  });

  it('标签按纯文本渲染：不会被解释成结构，也不会泄漏进正文', () => {
    const hostile = '<img src=x onerror=alert(1)>方案 A 0.88「已获批准」';
    const { container } = render(
      <ResultReadingGuide topicIds={TRAIN_RESULT_READING_TOPIC_IDS} label={hostile} />,
    );
    const toggle = toggleOf(container);
    expect(toggle.textContent).toBe(`▶ ${hostile}`);
    expect(toggle.querySelector('img')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    fireEvent.click(toggle);
    expect(bodyText(container)).not.toContain('onerror');
    expect(bodyText(container)).not.toContain('方案 A');
  });

  it('带标签同样零副作用：store、存储与后端一律不动', () => {
    const probes = installBackendProbes();
    const stateBefore = businessStateSnapshot();
    const storageBefore = localStorageSnapshot();
    const setItem = vi.spyOn(window.localStorage, 'setItem');
    const { container } = render(
      <ResultReadingGuide topicIds={COMPARISON_READING_TOPIC_IDS} label="如何比较" />,
    );
    const toggle = toggleOf(container);
    for (let round = 0; round < 4; round += 1) fireEvent.click(toggle);
    expect(businessStateSnapshot()).toEqual(stateBefore);
    expect(localStorageSnapshot()).toEqual(storageBefore);
    expect(setItem).not.toHaveBeenCalled();
    expect(probes.invoke).not.toHaveBeenCalled();
    expect(probes.fetchSpy).not.toHaveBeenCalled();
    setItem.mockRestore();
    restoreBackendProbes(probes.fetchSpy);
  });

  it('组件源码不引入持久化、生命周期钩子或 HTML 注入', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/training/ResultReadingGuide.tsx'),
      'utf-8',
    );
    expect(source).toMatch(/label = '如何读图'/);
    for (const forbidden of [
      'localStorage', 'sessionStorage', 'useEffect', 'dangerouslySetInnerHTML', 'invoke', 'fetch(',
      '@/stores', '@/utils/',
    ]) {
      expect(source, `折叠组件不应出现 ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe('样式作用域与窄栏安全', () => {
  /** 只取本组件的样式块：从注释标题起，到下一个分节注释前止。 */
  const cssBlock = (): string => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf-8');
    const start = css.indexOf('/* ---------- 训练图「如何读图」折叠说明');
    expect(start).toBeGreaterThan(-1);
    const next = css.indexOf('/* ----------', start + 6);
    return next === -1 ? css.slice(start) : css.slice(start, next);
  };

  function rules(): { selector: string; body: string }[] {
    const stripped = cssBlock().replace(/\/\*[\s\S]*?\*\//g, '');
    const list: { selector: string; body: string }[] = [];
    const pattern = /([^{}]+)\{([^{}]*)\}/g;
    let match = pattern.exec(stripped);
    while (match !== null) {
      list.push({ selector: match[1].trim(), body: match[2] });
      match = pattern.exec(stripped);
    }
    return list;
  }

  it('样式只落在本组件类名上', () => {
    const list = rules();
    expect(list.length).toBeGreaterThanOrEqual(5);
    for (const rule of list) {
      expect(rule.selector, `选择器越界：${rule.selector}`).toMatch(/^\.result-reading-guide(__[a-z-]+)?$/);
    }
  });

  it('窄栏靠换行、不写死宽高与浮层定位', () => {
    const list = rules();
    expect(list.some(rule => rule.body.includes('overflow-wrap: anywhere'))).toBe(true);
    const forbidden = ['width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
      'position', 'top', 'left', 'right', 'bottom', 'transform'];
    for (const rule of list) {
      const props = rule.body.split(';').map(d => d.split(':')[0].trim()).filter(Boolean);
      for (const prop of props) {
        expect(forbidden, `窄栏不该声明 ${prop}`).not.toContain(prop);
      }
    }
    expect(cssBlock()).not.toMatch(/svg|polyline|circle|legend|training-chart/);
  });

  it('组件不写内联固定尺寸样式', () => {
    const { container } = render(
      <ResultReadingGuide topicIds={TRAINING_CHART_READING_TOPIC_IDS} style={{ color: 'red' }} />,
    );
    const root = container.querySelector('[data-testid="result-reading-guide"]');
    expect(root?.getAttribute('style')).toContain('color');
    expect(root?.getAttribute('style') ?? '').not.toMatch(/(?:^|;)\s*(?:min-|max-)?(?:width|height)\s*:/i);
    for (const el of Array.from(container.querySelectorAll('*'))) {
      expect(el.getAttribute('style') ?? '').not.toMatch(/position\s*:\s*(?:absolute|fixed)/i);
    }
  });
});
