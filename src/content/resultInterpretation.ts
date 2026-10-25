/**
 * 结果解读文案的唯一来源（R1 + R2）。
 * 纪律：
 * - 只存放静态教学文案、稳定 ID 与必要的静态分组；
 * - 不读取任何 store、不导入训练运行时、不计算指标、不授予可信资格；
 * - 帮助面板「结果怎么读」与训练曲线下方的「如何读图」共同消费本模块，
 *   消费方不得再各存一份副本，否则文案会分叉；
 * - 文案不承诺精度、不诊断当前模型、不自动推荐调参，也不引入新的裁决等级。
 * R2 追加对比区「如何比较」与完成卡片「结果说明」两个静态分组：新增正文同样只讲
 * 通用读法，不读取 metrics/Study/Attempt/Claim，不调用比较、统计或信任计算函数，
 * 也不判断当前选择属于严格、非严格、单 seed 还是配对消融；百分点、执行可信与
 * 金标归属三条一律复用既有正文，不复制第二份。
 * 迁移记录：verdict_three_way 的正文经授权做过一次澄清（只改写裁决与可信等级的关系，
 * 区间判据、有效样本量、事后改验收线等内容逐字保留）；其余主题自 HelpPanel 迁入后逐字未变。
 */

export type ResultReadingTopicId =
  | 'loss_not_generalization'
  | 'trust_not_quality'
  | 'gold_label_one_claim'
  | 'verdict_three_way'
  | 'preset_is_structure_only'
  | 'chart_record_scope'
  | 'chart_single_point'
  | 'chart_value_unit'
  | 'comparison_strictness_limits'
  | 'comparison_seed_variance'
  | 'final_point_best_epoch';

export interface ResultReadingTopic {
  id: ResultReadingTopicId;
  title: string;
  text: string;
}

export const RESULT_READING_TOPICS: Record<ResultReadingTopicId, ResultReadingTopic> = {
  loss_not_generalization: {
    id: 'loss_not_generalization',
    title: 'Loss 下降不等于泛化改善',
    text: '训练 Loss 下降表示当前训练目标在改善，不代表泛化能力一定提高。开发阶段使用验证集比较方案；封存测试集只在主张冻结后按既定协议评估，不用于反复调参或选模。',
  },
  trust_not_quality: {
    id: 'trust_not_quality',
    title: '执行可信不等于模型优秀',
    text: '受控管线只证明这次运行可追溯、指标不是手工填的；它不评价模型好坏，也不能替代独立测试集给出的结论。',
  },
  gold_label_one_claim: {
    id: 'gold_label_one_claim',
    title: '金标属于一条评估主张',
    text: '金标授予解封前冻结的具体主张（指标口径、目标类别、阈值、测试集与模型身份），不是给模型打的质量评级；换指标或换阈值就是另一条主张。',
  },
  verdict_three_way: {
    id: 'verdict_three_way',
    title: 'PASS / FAIL / INCONCLUSIVE',
    text: '对 ≥ 主张（如召回率），区间下界 ≥ 验收线为 PASS，上界 < 验收线为 FAIL；对 ≤ 主张（如 MAE），区间上界 ≤ 验收线为 PASS，下界 > 验收线为 FAIL。区间无法确定是否达标，或有效样本量未满足冻结规格时，为 INCONCLUSIVE：当前证据不足，不自动等于样本量不足、执行失败或模型差。裁决结果本身不自动授予或取消可信等级：PASS、FAIL、INCONCLUSIVE 都可能是获得金标的那条裁决，也可能因档案不满足协议而不获背书，具体等级一律以既有可信协议投影为准。不能在看过结果后修改验收线把不确定改成通过。',
  },
  preset_is_structure_only: {
    id: 'preset_is_structure_only',
    title: '经典模型是结构预设',
    text: 'LeNet-5、AlexNet、VGG-16 等预设只导入网络结构供你继续修改，不保证完整复刻原论文实现，也不附带论文里的训练配方和精度。',
  },
  chart_record_scope: {
    id: 'chart_record_scope',
    title: '两条线来自不同的记录范围',
    text: '「训练批次」线来自 train/batch 记录，是训练过程中的上报；「验证轮次」线来自 validation/epoch 记录，是按轮次的验证观测。过程记录不能冒充最终验证证据。哪条线可画、哪些记录被排除，以图例、曲线下方说明和证据标签为准；横轴可能按 step/globalStep，也可能按 epoch，不保证所有曲线都以轮次为横轴。',
  },
  chart_single_point: {
    id: 'chart_single_point',
    title: '一个点只能说明一个位置',
    text: '如果某条序列只有一个有效点，图上只能看到该点，不能据此判断训练趋势。缺少的点不会被补出来：不插值、不复制数值，也不把线延长；可绘制点的总数显示在曲线上方的说明里。',
  },
  chart_value_unit: {
    id: 'chart_value_unit',
    title: '百分点不是相对提升',
    text: 'Accuracy 0.95 可以显示为 95%；从 94% 到 95% 是增加 1 个百分点，不是相对提升 1%。MAE、RMSE、R² 和未知指标不能统一乘 100 再加百分号；显示口径与优化方向以这次运行记录的指标规格为准，不按指标名猜测。',
  },
  comparison_strictness_limits: {
    id: 'comparison_strictness_limits',
    title: '严格可比只说明比较条件',
    text: '严格可比表示既定的比较条件（数据、切分、任务、预处理与指标口径）满足，它不自动证明差异显著、稳定或具有因果性；差异值不值得注意，仍要看有效点数、epoch 覆盖和方差资格。「局部观察范围」只是显式切换的视觉放大，不增加证据，也不修改任何原始点。非严格对比以现有水印与限制说明为准，这段解释不能解除限制，也不能替代显式确认与永久留痕。',
  },
  comparison_seed_variance: {
    id: 'comparison_seed_variance',
    title: 'seed 数量不替你证明稳定',
    text: '同一个 seed 下两次运行的数值差异只是这一对运行的观测结果，不能证明稳定提升；存在多条 seed 记录也不自动构成配对消融证据。方差资格、seed 数与配对情况以现有的方差徽章和消融证据面板为准，本说明不推断当前选择属于哪一种，也不把记录条数当成显著性。',
  },
  final_point_best_epoch: {
    id: 'final_point_best_epoch',
    title: '最近有效验证点与「最佳 Epoch」',
    text: '「最近有效验证点」取的是这次档案里最后一条合法记录，不一定等于计划轮数的最后一轮；请对照它自身的 epoch 与记录排除说明阅读，缺少的记录不会被补齐。「最佳 Epoch」是按这次运行已明确记录的优化方向，从可用验证记录中选出的观察点，不等于独立测试集通过，也不是对模型的最终评级。两次运行的最终值可能来自不同的 epoch，需要结合各自的 epoch 覆盖一起看。训练完成通知本身只说明这次运行已结束，不构成验证结论，也不授予金标。',
  },
};

/** 帮助面板「结果怎么读」：迁移前后顺序与条目完全一致。 */
export const HELP_RESULT_READING_TOPIC_IDS: readonly ResultReadingTopicId[] = [
  'loss_not_generalization',
  'trust_not_quality',
  'gold_label_one_claim',
  'verdict_three_way',
  'preset_is_structure_only',
];

/**
 * 训练曲线「如何读图」的静态主题集合：与当前 metrics 无关，
 * 「训练目标与泛化」直接复用既有那一条，不另写重复文案。
 */
export const TRAINING_CHART_READING_TOPIC_IDS: readonly ResultReadingTopicId[] = [
  'loss_not_generalization',
  'chart_record_scope',
  'chart_single_point',
  'chart_value_unit',
];

/**
 * 严格对比区「如何比较」的静态主题集合：与选了哪些 Attempt、哪个指标、
 * 是否 override 都无关；百分点与执行可信两条直接复用既有正文，不另存副本。
 */
export const COMPARISON_READING_TOPIC_IDS: readonly ResultReadingTopicId[] = [
  'comparison_strictness_limits',
  'comparison_seed_variance',
  'trust_not_quality',
  'chart_value_unit',
];

/**
 * 训练完成卡片「结果说明」的静态主题集合：只解释卡片自身显示的数字与标签，
 * 不判断这次运行是否匹配档案、也不改变任何证据资格。
 */
export const TRAIN_RESULT_READING_TOPIC_IDS: readonly ResultReadingTopicId[] = [
  'final_point_best_epoch',
  'trust_not_quality',
  'gold_label_one_claim',
];

/** 按 ID 顺序取出主题，顺序只由调用方传入的静态分组决定。 */
export function resultReadingTopics(ids: readonly ResultReadingTopicId[]): ResultReadingTopic[] {
  return ids.map(id => RESULT_READING_TOPICS[id]);
}
