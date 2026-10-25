/**
 * 曲线展示（模块 07；M07-002~015 人工复测修复）：
 * - X 轴使用真实 epoch；单 epoch 退化跨度只画真实存在的刻度；
 * - Y 轴默认诚实全量尺度（比例指标 0～1）；用户可显式切换“局部观察范围”，
 *   切换必须携带“不代表统计显著或稳定提升”声明，且绝不修改原始点；
 * - SVG 内零常驻数值标签（人工复测确认逐 epoch 标注会互相覆盖遮挡曲线）；
 *   数值一律通过悬停/键盘 Tooltip 按需查看；近重合信息汇总为图表下方单行 HTML 文本；
 * - 每条曲线携带完整身份：Experiment 名 + Attempt #ordinal + ID 短码（ordinal 只在
 *   各自 Experiment 内唯一，跨 Experiment 可能同为 #1，必须附加短码消歧义）；
 * - 单点序列不绘制 polyline（不伪装趋势）；颜色+线型+marker 形状+描边四重区分；
 * - 非严格对比强制水印；语义化表格由 FinalMetricSummary 提供（读屏可用）。
 */
import { useState } from 'react';
import type { Attempt } from '@/types/experiment';
import { axisDomain, localObservationDomain, sharedEpochPoints, uniqueTicks } from '@/utils/comparisonViewModel';
import type { StrictSeriesOk, StrictSeriesResult } from '@/utils/metricSeries';
import { metricNameLabel } from '@/components/panels/study/studyLabels';
import { COMPARISON_WATERMARK } from '@/utils/comparability';

const COLORS = ['#60a5fa', '#f59e0b', '#34d399', '#f472b6'];
const DASH_PATTERNS = ['none', '7 4', '2 4', '10 3 2 3'];
const LINE_STYLE_NAMES = ['实线', '长虚线', '点线', '点划线'];
const MARKER_SHAPE_NAMES = ['圆点', '方块', '菱形', '三角'] as const;
/** 同 epoch 像素距离低于该阈值时计入近重合汇总（不移动数据，仅 HTML 文本说明）。 */
const NEAR_COINCIDENCE_PX = 6;
/** Attempt ID 短码长度：ordinal 跨 Experiment 不唯一，附加稳定短身份消歧义。 */
const SHORT_ID_LENGTH = 6;

function shortIdentity(attemptId: string): string {
  return `…${attemptId.slice(-SHORT_ID_LENGTH)}`;
}

const VIEW_W = 600;
const VIEW_H = 230;
const PAD_LEFT = 52;
const PAD_RIGHT = 12;
const PAD_TOP = 16;
const PAD_BOTTOM = 40;

interface MetricComparisonChartProps {
  selected: Attempt[];
  series: StrictSeriesResult[];
  metricName: string;
  taskType: string;
  overrideActive: boolean;
  experimentNameOf: (attempt: Attempt) => string;
}

/** marker 形状（确定性，按选择顺序分配；与图例一一对应）。坐标即真实数据映射，不含偏移。 */
function MarkerGlyph({ shape, x, y, color }: { shape: number; x: number; y: number; color: string }) {
  const stroke = '#0f172a';
  switch (shape % 4) {
    case 1:
      return <rect x={x - 3} y={y - 3} width={6} height={6} fill={color} stroke={stroke} strokeWidth="1" />;
    case 2:
      return <path d={`M ${x} ${y - 4} L ${x + 4} ${y} L ${x} ${y + 4} L ${x - 4} ${y} Z`} fill={color} stroke={stroke} strokeWidth="1" />;
    case 3:
      return <path d={`M ${x} ${y - 4} L ${x + 4} ${y + 3} L ${x - 4} ${y + 3} Z`} fill={color} stroke={stroke} strokeWidth="1" />;
    default:
      return <circle cx={x} cy={y} r="3" fill={color} stroke={stroke} strokeWidth="1" />;
  }
}

export default function MetricComparisonChart({
  selected,
  series,
  metricName,
  taskType,
  overrideActive,
  experimentNameOf,
}: MetricComparisonChartProps) {
  /* 局部观察范围（人工复测修复）：纯展示状态，默认全量尺度；
   * 切换不修改任何原始点，不产生审计/候选/结论状态变化。 */
  const [zoomed, setZoomed] = useState(false);

  /* 先配对再过滤（M07-002~015 修复）：每条曲线永久携带自己的 Attempt 身份，
   * key/颜色/线型/marker 与数据点的对应关系不依赖过滤后数组的下标对齐。 */
  const curvePairs = selected
    .map((attempt, index) => ({ attempt, result: series[index], index }))
    .filter((pair): pair is { attempt: Attempt; result: StrictSeriesOk; index: number } => Boolean(pair.result?.ok));
  const allValues = curvePairs.flatMap(pair => pair.result.points.map(point => point.value));
  const allEpochs = curvePairs.flatMap(pair => pair.result.points.map(point => point.epoch));
  // 尺度不依赖方向；方向只在严格序列内部验证，不存在未知方向按 maximize 处理的分支。
  const domain = zoomed ? localObservationDomain(allValues) : axisDomain(metricName, allValues);
  const epochMin = allEpochs.length ? Math.min(...allEpochs) : 0;
  const epochMax = allEpochs.length ? Math.max(...allEpochs) : 1;
  const epochSpan = Math.max(epochMax - epochMin, 1);
  const valueSpan = Math.max(domain.max - domain.min, 1e-9);

  const xOf = (epoch: number) => PAD_LEFT + ((epoch - epochMin) / epochSpan) * (VIEW_W - PAD_LEFT - PAD_RIGHT);
  const yOf = (value: number) => PAD_TOP + (1 - (value - domain.min) / valueSpan) * (VIEW_H - PAD_TOP - PAD_BOTTOM);

  // 刻度去重：短 epoch 区间插值四舍五入会产生重复值，直接渲染会生成
  // 重复 React key 与重叠刻度；按显示值去重，保留有意义的唯一刻度。
  const yTicks = uniqueTicks(
    [0, 0.25, 0.5, 0.75, 1].map(fraction => domain.min + fraction * valueSpan),
    value => value.toFixed(3),
  );
  /* 单 epoch 退化跨度（epochMax===epochMin）只画真实存在的那一个刻度：
   * 修复截图中"数据只有 epoch 1、X 轴却显示 1～2"的误导（插值 round 产生幽灵刻度）。 */
  const xTicks = uniqueTicks(
    epochMax === epochMin
      ? [epochMin]
      : [0, 0.25, 0.5, 0.75, 1].map(fraction => Math.round(epochMin + fraction * epochSpan)),
    value => String(value),
  );
  const label = metricNameLabel(metricName, taskType);

  /* 近重合汇总（人工复测修复）：逐 epoch 的 SVG 常驻标注会在多 epoch 近值场景下
   * 堆叠在图表顶部互相覆盖并遮挡曲线；改为单行 HTML 汇总文本（图表下方，零遮挡），
   * 逐点真实数值一律通过 Tooltip 按需查看。绝不移动/复制/修改任何数据点。 */
  const nearGroups = sharedEpochPoints(
    curvePairs.map(pair => pair.attempt),
    curvePairs.map(pair => pair.result),
  )
    .map(group => {
      const ys = group.entries.map(entry => yOf(entry.value));
      const pixelSpread = Math.max(...ys) - Math.min(...ys);
      const values = group.entries.map(entry => entry.value);
      return { pixelNear: pixelSpread < NEAR_COINCIDENCE_PX, valueSpread: Math.max(...values) - Math.min(...values) };
    })
    .filter(item => item.pixelNear);
  const nearSummary = nearGroups.length > 0
    ? {
        epochCount: nearGroups.length,
        maxSpread: Math.max(...nearGroups.map(item => item.valueSpread)),
      }
    : null;

  return (
    <div className="comparison-view__chart">
      {/* 尺度切换：默认全量；局部观察是显式、可逆的纯视觉放大，必须携带声明 */}
      <div className="comparison-view__zoom">
        <button
          type="button"
          className="comparison-view__zoom-toggle"
          aria-pressed={zoomed}
          onClick={() => setZoomed(current => !current)}
        >
          {zoomed ? '返回全量尺度（0～1 诚实语义）' : '局部观察范围（查看近值差异）'}
        </button>
        {zoomed && (
          <small className="comparison-view__zoom-disclaimer">
            Y 轴按当前观测范围放大，仅用于查看数值差异，不代表统计显著或稳定提升。
          </small>
        )}
      </div>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label={`${label} 对比曲线：X 轴 epoch ${epochMin} 至 ${epochMax}，Y 轴 ${domain.min.toFixed(3)} 至 ${domain.max.toFixed(3)}（${domain.scaleLabel}）${zoomed ? '，局部放大不代表统计显著' : ''}${overrideActive ? `，${COMPARISON_WATERMARK}` : ''}`}
      >
        {/* 轴与刻度 */}
        <line x1={PAD_LEFT} y1={VIEW_H - PAD_BOTTOM} x2={VIEW_W - PAD_RIGHT} y2={VIEW_H - PAD_BOTTOM} stroke="#334155" />
        <line x1={PAD_LEFT} y1={PAD_TOP} x2={PAD_LEFT} y2={VIEW_H - PAD_BOTTOM} stroke="#334155" />
        {yTicks.map(tick => (
          <g key={`y-${tick.key}`}>
            <line x1={PAD_LEFT - 4} y1={yOf(tick.value)} x2={PAD_LEFT} y2={yOf(tick.value)} stroke="#475569" />
            <text x={PAD_LEFT - 6} y={yOf(tick.value) + 3} textAnchor="end" fontSize="9" fill="#94a3b8">{tick.key}</text>
          </g>
        ))}
        {xTicks.map(tick => (
          <g key={`x-${tick.key}`}>
            <line x1={xOf(tick.value)} y1={VIEW_H - PAD_BOTTOM} x2={xOf(tick.value)} y2={VIEW_H - PAD_BOTTOM + 4} stroke="#475569" />
            <text x={xOf(tick.value)} y={VIEW_H - PAD_BOTTOM + 15} textAnchor="middle" fontSize="9" fill="#94a3b8">{tick.value}</text>
          </g>
        ))}
        <text x={(PAD_LEFT + VIEW_W - PAD_RIGHT) / 2} y={VIEW_H - 6} textAnchor="middle" fontSize="10" fill="#94a3b8">epoch（真实轮次）</text>
        <text x={12} y={PAD_TOP + 4} fontSize="10" fill="#94a3b8">{label}</text>

        {curvePairs.map(pair => (
          /* 颜色/线型/形状沿用选择顺序的下标（与图例一致）；key 用 Attempt ID，绝不用数组下标或共享字符串。 */
          <g key={pair.attempt.id}>
            {/* 单点序列不画 polyline：不伪装成有斜率的趋势线；≥2 点才存在线段。 */}
            {pair.result.points.length >= 2 && (
              <polyline
                points={pair.result.points.map(point => `${xOf(point.epoch).toFixed(2)},${yOf(point.value).toFixed(2)}`).join(' ')}
                fill="none"
                stroke={COLORS[pair.index % COLORS.length]}
                strokeWidth="2.5"
                strokeDasharray={DASH_PATTERNS[pair.index % DASH_PATTERNS.length]}
              />
            )}
            {/* 顶点 marker（含悬停/键盘 Tooltip）：坐标严格来自真实数据；
               data-x/data-y 为真实映射坐标（测试与审查可验证未被篡改）；
               形状+描边保证重合时两个 Attempt 的轮廓仍同时可见。 */}
            {pair.result.points.map(point => {
              const tooltip = `${experimentNameOf(pair.attempt)} · Attempt #${pair.attempt.ordinal} · ${shortIdentity(pair.attempt.id)}：epoch ${point.epoch}，${label}=${point.value.toFixed(6)}（严格 validation/epoch）`;
              return (
                <g
                  key={`${pair.attempt.id}-${point.epoch}`}
                  data-marker={pair.attempt.id}
                  data-x={xOf(point.epoch)}
                  data-y={yOf(point.value)}
                  tabIndex={0}
                  role="img"
                  aria-label={tooltip}
                  className="comparison-view__marker"
                >
                  <title>{tooltip}</title>
                  <MarkerGlyph shape={pair.index} x={xOf(point.epoch)} y={yOf(point.value)} color={COLORS[pair.index % COLORS.length]} />
                </g>
              );
            })}
          </g>
        ))}
        {overrideActive && (
          <text x={VIEW_W / 2} y={VIEW_H / 2} textAnchor="middle" className="comparison-view__watermark">
            {COMPARISON_WATERMARK}
          </text>
        )}
      </svg>
      <div className="comparison-view__legend">
        {selected.map((attempt, index) => (
          <span key={attempt.id}>
            <svg width="30" height="10" aria-hidden="true">
              <line x1="0" y1="5" x2="30" y2="5" stroke={COLORS[index % COLORS.length]} strokeWidth="2.5" strokeDasharray={DASH_PATTERNS[index % DASH_PATTERNS.length]} />
              <g transform="translate(15, 5)">
                <MarkerGlyph shape={index} x={0} y={0} color={COLORS[index % COLORS.length]} />
              </g>
            </svg>
            {/* 完整身份：Experiment 名 + ordinal + ID 短码（两个 Experiment 的首个 Attempt 同为 #1 时仍可区分） */}
            {experimentNameOf(attempt)} · Attempt #{attempt.ordinal} · {shortIdentity(attempt.id)} · {LINE_STYLE_NAMES[index % LINE_STYLE_NAMES.length]}{MARKER_SHAPE_NAMES[index % MARKER_SHAPE_NAMES.length]}
          </span>
        ))}
      </div>
      <small>
        Y 轴：{domain.scaleLabel}（默认不以极窄动态轴夸大微小差异；局部观察为显式切换的纯视觉放大）；各曲线按自身实际 epoch 覆盖范围绘制，不静默截断或补齐。
        悬停或键盘聚焦数据点可查看 Attempt 身份、epoch 与原始数值。
        {overrideActive ? `${COMPARISON_WATERMARK}：此水印会进入导出报告。` : ''}
      </small>
      {/* 近重合汇总（单行 HTML，零遮挡）：真实差值陈述，不移动任何数据点 */}
      {nearSummary && (
        <small className="comparison-view__near-note">
          两条曲线在 {nearSummary.epochCount} 个共享 epoch 上接近（最大真实差值 {nearSummary.maxSpread.toFixed(6)}），
          在当前尺度下像素距离极小；这是真实结果，未施加任何偏移。悬停或聚焦数据点可逐一查看各自身份与原始数值，精确差值见最终指标表。
        </small>
      )}
    </div>
  );
}
