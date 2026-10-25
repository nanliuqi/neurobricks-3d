/**
 * 结果解读共享文案契约（R1 + 文案澄清补丁）：
 * - 帮助面板原有五项的标题、条目与顺序不得变化；其中四条正文逐字不变（迁移不是重写）；
 * - verdict_three_way 的正文经过一次授权澄清：只改写「裁决结果与可信等级」的关系，
 *   区间判据、有效样本量、不等同执行失败、禁止事后改验收线等内容必须逐字保留，
 *   因此本文件的测试名如实区分「逐字未变」与「授权澄清」，不声称五项全部原样迁移；
 * - 训练曲线「如何读图」引用既有那一条「Loss 下降不等于泛化改善」，不另存重复文案；
 * - 新主题必须与真实实现口径一致：train/batch 与 validation/epoch 分线、
 *   横轴存在 step/globalStep 口径、只有 accuracy 用百分比显示、方向取自记录字段；
 * - 单点说明必须是条件式，不能断言当前数据只有一个点，也不能建议补点或插值；
 * - 模块只有静态文案：不读 store、不导入运行时、不调后端、不引入新的裁决等级。
 * R2 追加对比区与完成卡片两个分组：同样只允许通用读法，不复用第二份正文，
 * 不把「严格可比」「局部放大」「最佳 Epoch」讲成显著性、泛化或金标证明。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COMPARISON_READING_TOPIC_IDS,
  HELP_RESULT_READING_TOPIC_IDS,
  RESULT_READING_TOPICS,
  TRAINING_CHART_READING_TOPIC_IDS,
  TRAIN_RESULT_READING_TOPIC_IDS,
  resultReadingTopics,
  type ResultReadingTopicId,
} from '@/content/resultInterpretation';

/** 迁移前 HelpPanel 本地 READING_GUIDE 的逐字内容（除经授权澄清的裁决主题外）。 */
const VERBATIM_GUIDE = [
  {
    id: 'loss_not_generalization' as ResultReadingTopicId,
    title: 'Loss 下降不等于泛化改善',
    text: '训练 Loss 下降表示当前训练目标在改善，不代表泛化能力一定提高。开发阶段使用验证集比较方案；封存测试集只在主张冻结后按既定协议评估，不用于反复调参或选模。',
  },
  {
    id: 'trust_not_quality' as ResultReadingTopicId,
    title: '执行可信不等于模型优秀',
    text: '受控管线只证明这次运行可追溯、指标不是手工填的；它不评价模型好坏，也不能替代独立测试集给出的结论。',
  },
  {
    id: 'gold_label_one_claim' as ResultReadingTopicId,
    title: '金标属于一条评估主张',
    text: '金标授予解封前冻结的具体主张（指标口径、目标类别、阈值、测试集与模型身份），不是给模型打的质量评级；换指标或换阈值就是另一条主张。',
  },
  {
    id: 'preset_is_structure_only' as ResultReadingTopicId,
    title: '经典模型是结构预设',
    text: 'LeNet-5、AlexNet、VGG-16 等预设只导入网络结构供你继续修改，不保证完整复刻原论文实现，也不附带论文里的训练配方和精度。',
  },
];

/** 迁移后帮助面板仍应展示的五项与顺序（澄清补丁只改一条正文，不动条目与分组）。 */
const MIGRATED_TOPIC_ORDER: ResultReadingTopicId[] = [
  'loss_not_generalization',
  'trust_not_quality',
  'gold_label_one_claim',
  'verdict_three_way',
  'preset_is_structure_only',
];

/** 裁决主题里必须逐字保留的既有判据与边界；只有可信等级那一句被授权改写。 */
const RETAINED_VERDICT_FRAGMENTS = [
  '对 ≥ 主张（如召回率），区间下界 ≥ 验收线为 PASS，上界 < 验收线为 FAIL；'
    + '对 ≤ 主张（如 MAE），区间上界 ≤ 验收线为 PASS，下界 > 验收线为 FAIL。',
  '区间无法确定是否达标，或有效样本量未满足冻结规格时，为 INCONCLUSIVE：',
  '当前证据不足，不自动等于样本量不足、执行失败或模型差',
  '不能在看过结果后修改验收线把不确定改成通过。',
];

function topic(id: ResultReadingTopicId): string {
  return `${RESULT_READING_TOPICS[id].title} ${RESULT_READING_TOPICS[id].text}`;
}

describe('共享文案来源纪律', () => {
  it('每个主题 ID 唯一，且与记录键一致', () => {
    const entries = Object.entries(RESULT_READING_TOPICS);
    expect(new Set(entries.map(([key]) => key)).size).toBe(entries.length);
    for (const [key, value] of entries) {
      expect(value.id).toBe(key);
      expect(value.title.trim().length).toBeGreaterThan(0);
      expect(value.text.trim().length).toBeGreaterThan(0);
    }
  });

  it('模块只有静态文案：不读 store、不导入运行时、不调后端', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/content/resultInterpretation.ts'),
      'utf-8',
    );
    for (const forbidden of [
      '@/stores', '@/trainingRuntime', '@tauri-apps', 'invoke(', 'fetch(', 'localStorage',
      '@/utils/metricSeries', '@/types/experiment', '@/types/training',
    ]) {
      expect(source, `共享文案模块不应依赖 ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('resultReadingTopics 只按传入顺序取文案，不增删条目', () => {
    const topics = resultReadingTopics(TRAINING_CHART_READING_TOPIC_IDS);
    expect(topics.map(item => item.id)).toEqual([...TRAINING_CHART_READING_TOPIC_IDS]);
    for (const item of topics) expect(item).toBe(RESULT_READING_TOPICS[item.id]);
  });
});

describe('历史主题迁入：四条逐字未变，裁决主题经授权澄清', () => {
  it.each(VERBATIM_GUIDE)('$title 的标题与正文逐字未变', ({ id, title, text }) => {
    expect(RESULT_READING_TOPICS[id].title).toBe(title);
    expect(RESULT_READING_TOPICS[id].text).toBe(text);
  });

  it('帮助面板分组仍是同样的五项且顺序不变', () => {
    expect([...HELP_RESULT_READING_TOPIC_IDS]).toEqual(MIGRATED_TOPIC_ORDER);
  });

  it('裁决主题标题未变，既有判据与边界逐字保留', () => {
    const item = RESULT_READING_TOPICS.verdict_three_way;
    expect(item.title).toBe('PASS / FAIL / INCONCLUSIVE');
    for (const fragment of RETAINED_VERDICT_FRAGMENTS) {
      expect(item.text, `裁决文案丢失既有边界：${fragment}`).toContain(fragment);
    }
  });

  it('裁决结果与可信等级分开管理：不自动授予，也不自动取消', () => {
    const text = topic('verdict_three_way');
    expect(text).toContain('裁决结果本身不自动授予或取消可信等级');
    expect(text).toContain('具体等级一律以既有可信协议投影为准');
  });

  it('INCONCLUSIVE 不自动获得金标，也不自动失去金标资格', () => {
    const text = topic('verdict_three_way');
    // 不自动失去：三种裁决都可能是获得金标的那条主张
    expect(text).toContain('PASS、FAIL、INCONCLUSIVE 都可能是获得金标的那条裁决');
    // 不自动获得：档案不满足协议时仍不获背书
    expect(text).toContain('也可能因档案不满足协议而不获背书');
    for (const promise of ['必然获得金标', '一定能拿金标', '自动获得金标', '总是金标', '一律不获金标']) {
      expect(text, `裁决文案做出金标承诺：${promise}`).not.toContain(promise);
    }
  });

  it('有歧义的旧句「也不授予可信等级」已清除，且未被换成另一种绝对化表述', () => {
    const text = topic('verdict_three_way');
    expect(text).not.toContain('也不授予可信等级');
    expect(text).not.toMatch(/不授予任何等级|永远不会获得金标|与可信等级无关/);
  });

  it('澄清只落在裁决主题：其余四条正文不含可信等级授予关系的新表述', () => {
    for (const item of VERBATIM_GUIDE) {
      expect(RESULT_READING_TOPICS[item.id].text).not.toContain('可信等级');
    }
  });

  it('裁决文案仍只复述既有三向裁决，不新增等级或门槛', () => {
    const text = topic('verdict_three_way');
    expect(text).toContain('PASS');
    expect(text).toContain('INCONCLUSIVE');
    expect(text).not.toMatch(/部分通过|待复核|四级|GRADUATED|WARN/);
  });
});

describe('训练图新主题与真实实现口径一致', () => {
  it('复用既有「Loss 下降不等于泛化改善」，全来源只有一条', () => {
    expect(TRAINING_CHART_READING_TOPIC_IDS).toContain('loss_not_generalization');
    const duplicates = Object.values(RESULT_READING_TOPICS)
      .filter(item => item.title === 'Loss 下降不等于泛化改善');
    expect(duplicates).toHaveLength(1);
    const similar = Object.values(RESULT_READING_TOPICS)
      .filter(item => item.text.includes('不代表泛化能力一定提高'));
    expect(similar).toHaveLength(1);
  });

  it('记录范围主题区分 train/batch 与 validation/epoch，且不冒充最终验证证据', () => {
    const text = topic('chart_record_scope');
    expect(text).toContain('train/batch');
    expect(text).toContain('validation/epoch');
    expect(text).toContain('过程记录不能冒充最终验证证据');
    expect(text).toContain('以图例、曲线下方说明和证据标签为准');
  });

  it('横轴口径不承诺一定是 epoch：明确存在 step/globalStep', () => {
    const text = topic('chart_record_scope');
    expect(text).toContain('step/globalStep');
    expect(text).toMatch(/不保证所有曲线都以轮次为横轴/);
    expect(text).not.toMatch(/横轴(统一|一律|都)?为 ?(epoch|轮次)/);
  });

  it('单点主题是条件式说明，不断言当前数据、不建议补点或插值', () => {
    const text = topic('chart_single_point');
    expect(text).toContain('如果某条序列只有一个有效点');
    expect(text).toContain('不能据此判断训练趋势');
    expect(text).toMatch(/不插值、不复制数值，也不把线延长/);
    for (const advice of ['建议补点', '可以插值', '应补齐', '手动加点', '延长这条线', '复制上一个值']) {
      expect(text, `单点说明不得建议：${advice}`).not.toContain(advice);
    }
    for (const assertion of ['当前只有一个点', '本次训练只有一个点', '你的图只有一个点']) {
      expect(text, `单点说明不得断言当前数据：${assertion}`).not.toContain(assertion);
    }
  });

  it('数值主题给出百分点与相对百分比的区别', () => {
    const text = topic('chart_value_unit');
    expect(text).toContain('Accuracy 0.95 可以显示为 95%');
    expect(text).toContain('从 94% 到 95% 是增加 1 个百分点');
    expect(text).toContain('不是相对提升 1%');
  });

  it('数值主题不把 MAE/RMSE/R² 与未知指标讲成百分比', () => {
    const text = topic('chart_value_unit');
    expect(text).toContain('MAE、RMSE、R² 和未知指标不能统一乘 100 再加百分号');
    expect(text).toMatch(/以这次运行记录的指标规格为准，不按指标名猜测/);
  });

  it('新主题不诊断当前模型、不授予证据资格，也不引入新的结论等级', () => {
    const chartText = resultReadingTopics(TRAINING_CHART_READING_TOPIC_IDS)
      .map(item => `${item.title} ${item.text}`).join('\n');
    for (const forbidden of [
      '当前模型', '稳定提升', '显著提升', '表现良好', '说明模型优秀', '一定更好', '训练正常',
      '可信等级', '证据等级', '金标', '严格证据', '可信背书', '构成证据',
    ]) {
      expect(chartText, `读图文案越界承诺：${forbidden}`).not.toContain(forbidden);
    }
    expect(chartText).not.toMatch(/推荐|应该把|建议把/);
  });
});

/* ---------------- R2：对比区「如何比较」与完成卡片「结果说明」 ---------------- */

const R2_NEW_TOPIC_IDS = [
  'comparison_strictness_limits',
  'comparison_seed_variance',
  'final_point_best_epoch',
] as const;

function groupText(ids: readonly ResultReadingTopicId[]): string {
  return resultReadingTopics(ids).map(item => `${item.title} ${item.text}`).join('\n');
}

describe('R2 静态分组：条目、顺序与来源纪律固定', () => {
  it('两个新分组的内容与顺序完全确定，且每项指向真实主题', () => {
    expect([...COMPARISON_READING_TOPIC_IDS]).toEqual([
      'comparison_strictness_limits',
      'comparison_seed_variance',
      'trust_not_quality',
      'chart_value_unit',
    ]);
    expect([...TRAIN_RESULT_READING_TOPIC_IDS]).toEqual([
      'final_point_best_epoch',
      'trust_not_quality',
      'gold_label_one_claim',
    ]);
    for (const id of [...COMPARISON_READING_TOPIC_IDS, ...TRAIN_RESULT_READING_TOPIC_IDS]) {
      expect(RESULT_READING_TOPICS[id].id).toBe(id);
      expect(RESULT_READING_TOPICS[id].title.trim().length).toBeGreaterThan(0);
      expect(RESULT_READING_TOPICS[id].text.trim().length).toBeGreaterThan(0);
    }
  });

  it('R1 的两个分组未被 R2 触碰，新主题不泄漏进训练图或帮助面板', () => {
    expect([...TRAINING_CHART_READING_TOPIC_IDS]).toEqual([
      'loss_not_generalization',
      'chart_record_scope',
      'chart_single_point',
      'chart_value_unit',
    ]);
    for (const id of R2_NEW_TOPIC_IDS) {
      expect(TRAINING_CHART_READING_TOPIC_IDS).not.toContain(id);
      expect(HELP_RESULT_READING_TOPIC_IDS).not.toContain(id);
    }
  });

  it('复用主题只引用同一份正文：全来源无重复标题或重复正文', () => {
    for (const item of resultReadingTopics(COMPARISON_READING_TOPIC_IDS)) {
      expect(item).toBe(RESULT_READING_TOPICS[item.id]);
    }
    for (const item of resultReadingTopics(TRAIN_RESULT_READING_TOPIC_IDS)) {
      expect(item).toBe(RESULT_READING_TOPICS[item.id]);
    }
    const texts = Object.values(RESULT_READING_TOPICS).map(item => item.text);
    const titles = Object.values(RESULT_READING_TOPICS).map(item => item.title);
    expect(new Set(texts).size).toBe(texts.length);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('模块零导入：不接 store、指标序列、比较、统计或信任计算', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/content/resultInterpretation.ts'),
      'utf-8',
    );
    expect(source.match(/^import\b/gm)).toBeNull();
    for (const forbidden of [
      '@/utils/comparisonViewModel', '@/utils/metricSeries', '@/utils/statistics',
      '@/utils/trainingMonitorViewModel', '@/utils/claimProtocol', '@/utils/comparability',
      '@/stores', '@/trainingRuntime', '@tauri-apps', 'invoke(', 'fetch(', 'localStorage',
    ]) {
      expect(source, `R2 文案模块不应引用 ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe('R2 文案边界：只讲读法，不替现有判定背书', () => {
  it('可比性主题保留三条既有边界，不解除限制也不替代确认', () => {
    const text = RESULT_READING_TOPICS.comparison_strictness_limits.text;
    expect(text).toContain('它不自动证明差异显著、稳定或具有因果性');
    expect(text).toContain('只是显式切换的视觉放大，不增加证据');
    expect(text).toContain('以现有水印与限制说明为准');
    expect(text).toContain('这段解释不能解除限制，也不能替代显式确认与永久留痕');
  });

  it('方差主题如实复述现有徽章语义，不自造统计口径', () => {
    const text = RESULT_READING_TOPICS.comparison_seed_variance.text;
    expect(text).toContain('不能证明稳定提升');
    expect(text).toContain('不自动构成配对消融证据');
    expect(text).toContain('以现有的方差徽章和消融证据面板为准');
    for (const invented of ['p 值', '显著性水平', '置信区间', '方差已验证']) {
      expect(text, `方差主题引入既有口径之外的概念：${invented}`).not.toContain(invented);
    }
  });

  it('验证点主题区分最近有效点、最佳 Epoch 与完成通知', () => {
    const text = RESULT_READING_TOPICS.final_point_best_epoch.text;
    expect(text).toContain('不一定等于计划轮数的最后一轮');
    expect(text).toContain('缺少的记录不会被补齐');
    expect(text).toContain('不等于独立测试集通过');
    expect(text).toContain('两次运行的最终值可能来自不同的 epoch');
    expect(text).toContain('训练完成通知本身只说明这次运行已结束，不构成验证结论，也不授予金标');
  });

  it('严格可比、局部放大、最佳 Epoch 与完成通知都不被讲成显著性、泛化或金标证明', () => {
    const all = `${groupText(COMPARISON_READING_TOPIC_IDS)}\n${groupText(TRAIN_RESULT_READING_TOPIC_IDS)}`;
    for (const claim of [
      '严格可比证明', '严格可比即显著', '局部观察证明', '放大后就是显著',
      '最佳 Epoch 说明泛化', '完成即金标', '训练完成代表通过验证', '多 seed 即稳定',
      '已获得批准', '可以宣称',
    ]) {
      expect(all, `文案把边界讲成了证明：${claim}`).not.toContain(claim);
    }
  });

  it('新说明不诊断当前模型，也不断定当前选择属于哪一种情况', () => {
    const all = `${groupText(COMPARISON_READING_TOPIC_IDS)}\n${groupText(TRAIN_RESULT_READING_TOPIC_IDS)}`;
    for (const forbidden of [
      '当前模型', '你的对比', '本次对比已', '当前对比已经', '属于严格可比',
      '这次训练说明', '稳定提升已被证实', '推荐', '应该把', '建议把',
    ]) {
      expect(all, `静态说明越界诊断或建议：${forbidden}`).not.toContain(forbidden);
    }
    expect(RESULT_READING_TOPICS.comparison_seed_variance.text).toContain('本说明不推断当前选择属于哪一种');
  });

  it('新主题不引入裁决等级、执行模式或导出承诺', () => {
    const all = `${groupText(COMPARISON_READING_TOPIC_IDS)}\n${groupText(TRAIN_RESULT_READING_TOPIC_IDS)}`;
    for (const forbidden of ['GRADUATED', 'WARN', '四级', '部分通过', '待复核', '导出报告已包含', '水印将被移除']) {
      expect(all, `静态说明引入既有协议之外的措辞：${forbidden}`).not.toContain(forbidden);
    }
    expect(all).not.toMatch(/自动(授予|获得|取消)金标/);
  });
});
