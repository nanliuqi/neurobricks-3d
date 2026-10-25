/**
 * 数据集工作台视图模型纯函数测试（模块 05 验收补丁修订版）：
 * - 预览：展示文本与完整安全文本分离、矩形化、安全上限；
 * - 身份摘要：异常值诚实处理；
 * - 特征列推导转发单一来源（规则本体测试在 datasetContract.test.ts）。
 */
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_DATASET_OPTIONS,
  buildBuiltinDatasetInfo,
  buildDatasetSummaryView,
  buildPreviewTableView,
  toPreviewTextView,
  type PreviewTableView,
} from '@/utils/datasetPanelViewModel';
import type { DatasetInfo } from '@/types/dataset';

function makeCsvDataset(overrides: Partial<DatasetInfo> = {}): DatasetInfo {
  return {
    name: 'regression',
    type: 'csv',
    sampleCount: 100,
    classCount: 0,
    columns: ['customer_id', 'captured_at', 'feature_a', 'target'],
    ...overrides,
  };
}

/** 取单元格展示文本。 */
function cellText(view: PreviewTableView | null, row: number, col: number): string {
  return view?.rows[row]?.[col]?.displayText ?? '<missing>';
}

describe('buildBuiltinDatasetInfo：内置元数据不变', () => {
  it('MNIST/CIFAR-10 元数据与既有协议一致', () => {
    const mnist = buildBuiltinDatasetInfo('mnist');
    expect(mnist).toMatchObject({
      datasetId: 'builtin-mnist-torchvision-v1',
      contentHash: 'builtin:mnist:torchvision-v1',
      sampleCount: 60000,
      classCount: 10,
      imageWidth: 28,
      imageHeight: 28,
      channels: 1,
      sampleIndependence: 'machine_verified',
      sampleUnit: 'image',
      machineChecks: [],
    });
    const cifar = buildBuiltinDatasetInfo('cifar10');
    expect(cifar).toMatchObject({ sampleCount: 50000, imageWidth: 32, channels: 3 });
    expect(cifar.classNames).toHaveLength(10);
    expect(typeof mnist.importedAt).toBe('number');
  });

  it('内置选项列表稳定', () => {
    expect(BUILTIN_DATASET_OPTIONS.map(option => option.value)).toEqual(['mnist', 'cifar10']);
  });
});

describe('buildDatasetSummaryView：身份语义诚实（含异常值）', () => {
  it('指纹存在时提供缩略值与完整值', () => {
    const view = buildDatasetSummaryView(makeCsvDataset({ contentHash: 'a'.repeat(64), importedAt: 1700000000000 }));
    expect(view.fingerprintShort).toBe(`${'a'.repeat(22)}…`);
    expect(view.fingerprintFull).toBe('a'.repeat(64));
    expect(view.importedAtText).not.toBe('未记录');
  });

  it('短指纹不追加误导性省略号', () => {
    const view = buildDatasetSummaryView(makeCsvDataset({ contentHash: 'abc123' }));
    expect(view.fingerprintShort).toBe('abc123');
    expect(view.fingerprintShort).not.toContain('…');
  });

  it('指纹缺失时不伪造，标记身份不完整', () => {
    const view = buildDatasetSummaryView(makeCsvDataset({ contentHash: undefined }));
    expect(view.fingerprintShort).toBeNull();
    expect(view.fingerprintFull).toBeNull();
  });

  it('CSV 显示回归任务标记；分类显示类别数', () => {
    expect(buildDatasetSummaryView(makeCsvDataset()).taskLine).toContain('监督式回归');
    const mnist: DatasetInfo = { name: 'MNIST', type: 'mnist', sampleCount: 60000, classCount: 10 };
    expect(buildDatasetSummaryView(mnist).taskLine).toContain('10 个类别');
  });

  it('classCount 缺失时不显示“未记录 个类别”', () => {
    const view = buildDatasetSummaryView({ name: 'imgs', type: 'local_image', sampleCount: 5 } as DatasetInfo);
    expect(view.taskLine).toBe('分类任务 · 类别数未记录');
    expect(view.taskLine).not.toContain('未记录 个类别');
  });

  it('无效导入时间（NaN/Infinity/非法值）显示“未记录”，不显示 Invalid Date', () => {
    for (const importedAt of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const view = buildDatasetSummaryView(makeCsvDataset({ importedAt }));
      expect(view.importedAtText).toBe('未记录');
      expect(view.importedAtText).not.toContain('Invalid Date');
    }
    const view = buildDatasetSummaryView(makeCsvDataset({ importedAt: undefined }));
    expect(view.importedAtText).toBe('未记录');
  });

  it('样本数为负数/NaN/Infinity 时显示“未记录”', () => {
    for (const sampleCount of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const view = buildDatasetSummaryView(makeCsvDataset({ sampleCount }));
      expect(view.sampleCountText).toBe('未记录');
      expect(view.sampleCountText).not.toMatch(/NaN|Infinity|-/);
    }
  });

  it('未知字段不出现 undefined/NaN/Infinity/null 字样', () => {
    const view = buildDatasetSummaryView(makeCsvDataset({ importedAt: undefined, contentHash: undefined }));
    expect(JSON.stringify(view)).not.toContain('undefined');
    expect(JSON.stringify(view)).not.toContain('NaN');
    expect(JSON.stringify(view)).not.toContain('Infinity');
  });

  it('图像数据集显示输入形状；表格显示列数', () => {
    const image: DatasetInfo = {
      name: 'imgs', type: 'local_image', sampleCount: 10, classCount: 2,
      channels: 3, imageHeight: 32, imageWidth: 32,
    };
    expect(buildDatasetSummaryView(image).inputText).toBe('3 × 32 × 32');
    expect(buildDatasetSummaryView(makeCsvDataset()).inputText).toBe('4 列');
  });
});

describe('toPreviewTextView：展示文本与完整安全文本分离', () => {
  it('短文本：展示即完整，不截断', () => {
    const view = toPreviewTextView('hello');
    expect(view).toEqual({ displayText: 'hello', fullText: 'hello', truncated: false });
  });

  it('300 字文本：展示截断，完整文本原样保留', () => {
    const long = '长'.repeat(300);
    const view = toPreviewTextView(long);
    expect(view.displayText.length).toBeLessThanOrEqual(81);
    expect(view.fullText).toBe(long); // title/详情必须完整等于原始值
    expect(view.truncated).toBe(true);
  });

  it('极端超大值：按安全上限截断并明确标注，不冒充完整值', () => {
    const huge = 'x'.repeat(100_000);
    const view = toPreviewTextView(huge);
    expect(view.fullText.length).toBeLessThan(2100);
    expect(view.fullText).toContain('预览值过长，已安全截断');
    expect(view.fullText).not.toBe(huge);
    expect(view.truncated).toBe(true);
  });
});

describe('buildPreviewTableView：安全格式化与矩形化', () => {
  it('对象行按 metadata.columns 顺序渲染', () => {
    const view = buildPreviewTableView([{ b: 2, a: 1 }], ['b', 'a']);
    expect(view?.columns.map(c => c.displayText)).toEqual(['b', 'a']);
    expect(view?.rows[0].map(c => c.displayText)).toEqual(['2', '1']);
  });

  it('额外字段按首次出现顺序追加，不被静默丢弃：[{a:1},{b:2}] 同时显示 a、b', () => {
    const view = buildPreviewTableView([{ a: 1 }, { b: 2 }]);
    expect(view?.columns.map(c => c.displayText)).toEqual(['a', 'b']);
    expect(view?.rows[0].map(c => c.displayText)).toEqual(['1', '—']);
    expect(view?.rows[1].map(c => c.displayText)).toEqual(['—', '2']);
  });

  it('对象后续行新增多个字段时按首次出现顺序追加', () => {
    const view = buildPreviewTableView([{ a: 1 }, { a: 2, c: 3, d: 4 }]);
    expect(view?.columns.map(c => c.displayText)).toEqual(['a', 'c', 'd']);
    expect(view?.rows[0].map(c => c.displayText)).toEqual(['1', '—', '—']);
    expect(view?.rows[1].map(c => c.displayText)).toEqual(['2', '3', '4']);
  });

  it('数组行超过已知列数时追加“列 N”，不丢值', () => {
    const view = buildPreviewTableView([[1, 2], [3, 4, 5, 6]]);
    expect(view?.columns.map(c => c.displayText)).toEqual(['列 1', '列 2', '列 3', '列 4']);
    expect(view?.rows[0].map(c => c.displayText)).toEqual(['1', '2', '—', '—']);
    expect(view?.rows[1].map(c => c.displayText)).toEqual(['3', '4', '5', '6']);
  });

  it('metadata.columns 优先，但额外字段仍被明确处理', () => {
    const view = buildPreviewTableView([{ b: 2, extra: 9 }], ['b']);
    expect(view?.columns.map(c => c.displayText)).toEqual(['b', 'extra']);
    expect(view?.rows[0].map(c => c.displayText)).toEqual(['2', '9']);
  });

  it('混合对象/数组/原始值行形成稳定矩形表格，所有行列数一致', () => {
    const view = buildPreviewTableView([{ a: 1, b: 2 }, [3, 4, 5], 'raw']);
    const columnCount = view?.columns.length ?? 0;
    expect(columnCount).toBeGreaterThan(0);
    for (const row of view?.rows ?? []) {
      expect(row).toHaveLength(columnCount);
    }
    expect(cellText(view, 0, 0)).toBe('1');
    expect(cellText(view, 1, 2)).toBe('5');
    expect(cellText(view, 2, 0)).toBe('raw');
    expect(cellText(view, 2, 1)).toBe('—');
  });

  it('null / undefined / 缺字段安全显示为占位符', () => {
    const view = buildPreviewTableView([{ a: null, b: undefined, c: '' }]);
    expect(view?.rows[0].map(c => c.displayText)).toEqual(['—', '—', '—']);
  });

  it('复杂值使用安全序列化，绝不出现 [object Object]', () => {
    const view = buildPreviewTableView([{ a: { nested: { deep: 1 } }, b: [1, 2] }]);
    expect(JSON.stringify(view)).not.toContain('[object Object]');
    expect(cellText(view, 0, 0)).toContain('nested');
    expect(cellText(view, 0, 1)).toContain('1,2');
  });

  it('循环引用不崩溃，回退为类型标签', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const view = buildPreviewTableView([cycle]);
    expect(cellText(view, 0, 0)).toContain('Object');
    expect(cellText(view, 0, 0)).not.toContain('[object Object]');
  });

  it('超长单元格：展示截断，完整安全文本原样保留（可用于 title）', () => {
    const long = '长'.repeat(300);
    const view = buildPreviewTableView([{ a: long }]);
    const cell = view!.rows[0][0];
    expect(cell.displayText.length).toBeLessThanOrEqual(81);
    expect(cell.fullText).toBe(long);
    expect(cell.truncated).toBe(true);
  });

  it('超长列名同样保留完整安全文本', () => {
    const longColumn = '列'.repeat(300);
    const view = buildPreviewTableView([{ a: 1 }], [longColumn]);
    const column = view!.columns[0];
    expect(column.displayText.length).toBeLessThanOrEqual(81);
    expect(column.fullText).toBe(longColumn);
    expect(column.truncated).toBe(true);
  });

  it('HTML/脚本文本保持纯文本语义（内容不被解释）', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const view = buildPreviewTableView([{ a: payload }]);
    expect(cellText(view, 0, 0)).toBe(payload);
    expect(view!.rows[0][0].fullText).toBe(payload);
  });

  it('空数据与异常输入回退为 null（不白屏）', () => {
    expect(buildPreviewTableView([])).toBeNull();
    expect(buildPreviewTableView(undefined)).toBeNull();
    expect(buildPreviewTableView(null)).toBeNull();
    expect(buildPreviewTableView('not-an-array' as never)).toBeNull();
    expect(buildPreviewTableView(42 as never)).toBeNull();
  });

  it('原始值行单列展示', () => {
    const view = buildPreviewTableView([1, 'text']);
    expect(view?.columns.map(c => c.displayText)).toEqual(['值']);
    expect(view?.rows.map(row => row.map(c => c.displayText))).toEqual([['1'], ['text']]);
  });
});
