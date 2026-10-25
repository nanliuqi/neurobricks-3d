import { useState } from 'react';
import Button from '../../ui/Button';
import { getRightPanelMeta, type RightPanelId } from '@/types/workspace';

/**
 * 动手练习（N6）：本区域只读，只提供文字说明与既有右侧面板跳转；练习动作全部由用户手动执行。
 *
 * 边界（与 QuickStartGuide 同一套纪律）：
 * - 本模块不是自动实验系统，也不做任务完成判定：没有进度、积分、解锁或达标状态；
 * - 组件不 import 任何 store，不调用加层/清场/切数据/改参数/训练/候选/冻结/解封/导出，
 *   也不读写 localStorage 或发起后端调用；折叠与否只保留在当前视图；
 * - 「只读」只描述本组件自身：练习里由用户手动执行的导出并不是只读操作，它会写入实验包
 *   目录下的文件并追加导出审计事件，文案必须按 ExportPanel 的真实行为写，不写成「不改变档案」；
 * - 面板名称一律经 getRightPanelMeta 取共享元数据，不建立第二份名称表；
 *   跳转只允许已经存在的 RightPanelId；
 * - 左侧模型库与底部训练栏没有面板 ID，对应步骤只给文字位置说明，不虚构入口；
 * - 「结果怎么读」与可信/裁决判定住在本面板既有小节里，此处只引用小节标题，不复制规则。
 *
 * 文案全部回源核对（层参数标签、清单状态文本、校验结果标签、训练前检查分组与阻断标题、
 * 课题对比标记、导出按钮/文件说明/README 语句），不凭记忆编写按钮名称，
 * 也不把预期方向写成已经得到的结果。
 */

export interface TeachingExerciseGuideProps {
  /**
   * 复用工作区唯一面板导航回调（由 MainLayout 注入现有 expandPanel）。
   * 缺省时练习说明仍完整可读，只是不渲染无法使用的导航按钮。
   */
  onNavigatePanel?: (panelId: RightPanelId) => void;
}

export type ExerciseId =
  | 'locate-shape-error'
  | 'compare-training-runs'
  | 'export-honest-record';

export interface ExerciseObservation {
  /** 观察位置：界面上真实存在的区域 */
  location: string;
  /** 应看到的现象 */
  phenomenon: string;
}

export interface TeachingExercise {
  id: ExerciseId;
  title: string;
  /** 学习目标 */
  goal: string;
  prerequisites: readonly string[];
  /** 具体操作：全部由用户手动完成 */
  steps: readonly string[];
  observations: readonly ExerciseObservation[];
  /** 结果不能说明什么 */
  limitations: readonly string[];
  /** 如何恢复原配置 */
  restoration: string;
  /** 该练习可跳转的真实右侧面板 ID；无面板 ID 的位置只写文字说明 */
  panelIds: readonly RightPanelId[];
}

const EXERCISES: readonly TeachingExercise[] = [
  {
    id: 'locate-shape-error',
    title: '练习 A：定位一个形状错误',
    goal: '学会用逐层结构清单与「校验结果」区判断错误归属在哪一层，并分清「静态结构没报错」与「真实训练已经成功」是两件事。',
    prerequisites: [
      '在「数据集」面板把内置数据集选为 MNIST，与新手引导第 1 步是同一入口。',
      '场景为空；若已有结构，先按原有方式自行保存，再走现有确认流程清空。经典模型是追加到已有积木栈顶部，不会替换现有结构。',
      '在左侧「层组件库」→「经典模型」小节（默认收起，先点标题展开）点 LeNet-5 卡片上的「+ 添加」。左侧模型库没有面板 ID，只能手动切换。',
    ],
    steps: [
      '打开右侧「参数」面板，看上方「网络结构」清单：第 1 层的「推导输出」是 [1, 28, 28]，第 2 层卷积的「推导输出」是 [6, 24, 24]。三维按 [C, H, W]，都不含 batch。',
      '点清单第 2 行选中那个卷积层（行按钮只切换选中，不写参数），在下方参数区把 inChannels (输入通道) 从 1 改成 3。',
      '依次核对四处：清单该行的状态文本变成「已记录结构错误」并显示错误原文；它之后的行出现「上游已记录错误，本行推导结果仅供定位参考」；右栏底部的「校验结果」区多出一条带「参数冲突」标签的条目，计数加一；底部训练栏的训练前检查出现「模型」分组的「网络结构存在形状错误」阻断。',
      '再读一次该行的「推导输出」：它仍是 [6, 24, 24]。输出按上游实际形状推导，冲突的是本层声明的 inChannels，不是上游形状变了——这正是只看输出形状容易误判的地方。',
      '点清单里的这一行，或点「校验结果」里的这条错误，确认选中跳回到出错的那一层。',
      '点「🚀 开始训练」：训练不会启动，检查面板展开并把焦点落到首个阻断项。',
      '把 inChannels (输入通道) 改回 1，确认该行状态回到「形状已静态推导」、「校验结果」区重新显示「✓ 网络结构校验通过」、「模型」分组的那条阻断也随之消失。',
    ],
    observations: [
      {
        location: '右侧「参数」面板上方的「网络结构」清单',
        phenomenon: '每行显示上游已记录输出、推导输出与参数量；状态文本区分「形状已静态推导」「已记录结构错误」「输出形状未记录」「形状记录无效」。',
      },
      {
        location: '右栏底部的「校验结果」区',
        phenomenon: '它是所有面板共用的页脚，切换面板时仍然在，只有收起右栏才随整个面板一起隐藏；错误条目带层类型与「参数冲突」等标签，并给出「将 inChannels 修改为 1」这类建议。',
      },
      {
        location: '底部训练栏的训练前检查',
        phenomenon: '阻断时显示「N 项阻断」，展开按数据/模型/切分/训练参数/运行环境/Study 启动阶段分组；每条阻断有「去处理」入口。',
      },
      {
        location: '清单与场景里的参数量',
        phenomenon: '合法参数量按千分位显示；某层参数量记录不可用时，各处显示的都是「不可用」，不会出现 NaN、Infinity，也不会显示成 0。',
      },
    ],
    limitations: [
      '清单全绿只表示静态推导与已记录校验通过。它不是前向执行结果，不证明训练跑成功过，更不证明泛化能力。',
      '训练前检查通过也不等于启动阶段的最终检查通过：检查面板顶部那句话已经写明数据契约、Study 与受控管线仍会在启动时执行最终检查。',
      '改回 1 之后错误消失，只说明声明值与上游形状重新一致，不说明这个配置更好或更差，也不构成任何实验结论。',
      '结果怎么读见本面板「结果怎么读」小节；那套 PASS / FAIL / INCONCLUSIVE 与可信等级判定不在这里重复一遍。',
    ],
    restoration:
      '把 inChannels (输入通道) 改回 1 就恢复了本次改动；本练习不动其他参数。「⚙ 高级」里的「恢复默认」只重置训练参数，既不撤销你对网络结构的改动，也不会保存或清空工程。',
    panelIds: ['dataset', 'param'],
  },
  {
    id: 'compare-training-runs',
    title: '练习 B：比较两个训练方案',
    goal: '只改变学习率跑两次真实训练，再用应用既有的严格可比分组判断这两次能否放在一起比，并按面板诚实读出各自的 epoch 覆盖。',
    prerequisites: [
      '练习 A 之后结构没有阻断；两次运行之间数据集、网络结构、切分、随机种子、优化器与「设备」面板所选设备都保持同一选择，本练习只改学习率一个因素。',
      '「课题」面板里的当前课题可用，且与当前网络配置一致；两次运行都记在同一个课题里。',
      '本练习不要求也不建议修改课题的类型、预算或选择规则；预算耗尽、课题已归档或配置不匹配时的处理见下面的限制条目。',
      '训练前检查没有阻断项。',
    ],
    steps: [
      '在底部训练栏点「⚙ 高级」，记下「学习率：」后面的数值，这是第 1 次的取值；Epochs 与 Batch 由你自己设定并保持不动。',
      '点「🚀 开始训练」完成第 1 次运行。只跑 1 个 epoch 时曲线只有一个点，这是正常现象，不是丢数据。',
      '第 1 次结束后，只在「⚙ 高级」里把「学习率」滑块移到另一个数值，其余参数一律不动，再点「🚀 开始训练」完成第 2 次。',
      '打开「训练监控」面板确认第 2 次的进度、日志与曲线；两次都以面板显示的运行语义为准。',
      '到「课题」面板的「证据对比与主张」小节 →「严格实验对比」，用面板原有的选择入口把这两次运行选进来，读面板给出的可比性标记与差异说明。',
      '在同一小节读每条结果的「epoch 覆盖」与记录点数：起点、终点和点数都按面板给出的抄，它写「指标不可用」时不要替它补一个数值。',
      '若面板给出「已阻止跨组叠加」：沿用面板提供的入口，包括需要显式确认并永久留痕的非严格对比入口；不在这里改课题定义去凑成同组。',
    ],
    observations: [
      {
        location: '「课题」面板 →「证据对比与主张」→「严格实验对比」',
        phenomenon: '面板自己声明分组条件并给出标记，例如「严格可比（同一考卷、同一指标口径）」或「已阻止跨组叠加」；判定以它为准，本练习不复制一份分组规则。',
      },
      {
        location: '同一小节的最终指标表',
        phenomenon: '两次运行各自的指标名、终值、epoch 覆盖与点数；缺失或非有限的值显示为「指标不可用」。',
      },
      {
        location: '底部训练栏与「训练监控」面板',
        phenomenon: '两次运行各自的轮数、日志与曲线点数；设备行为与阻断规则见本面板「常见问题」里的设备条目，这里不重述。',
      },
    ],
    limitations: [
      '每次运行只用了一个随机种子。单 seed 的两条结果之差不能说明哪个学习率更好，也不能称作稳定提升；本练习不预设方向，也不预写结果。',
      '只有 1 个点时只能读那一个点的数值，读不出下降趋势、收敛速度或是否过拟合。',
      '面板判为「严格可比」只表示同一考卷与同一指标口径，不等同于统计显著提升，也不授予结论可信等级；判为不同组时也不能凭肉眼差异推断原因，以面板声明的条件与差异说明为准。',
      '两条曲线的 epoch 覆盖不同时，重叠区间之外的部分不构成对比证据。',
      '训练被「Study/启动阶段」分组的阻断拦下，是课题契约的结果：沿用那条阻断自己的「去处理」入口，不改课题、不绕过协议，也不消耗封存测试集资格。',
      '本练习不生成、不引用任何模拟曲线或演示数据；浏览器演示的运行结果不是这里的比较对象。',
    ],
    restoration:
      '跑完第 2 次后，把「学习率」滑块拖回你记下的第 1 个数值，让「学习率：」显示的数值与第 1 次一致；或用「⚙ 高级」里的「恢复默认」把训练参数恢复到默认（只影响训练参数，不改网络结构）。已留档的运行记录属于档案，恢复参数不会删除它们，本练习也不删除任何记录。',
    panelIds: ['study', 'trainMonitor'],
  },
  {
    id: 'export-honest-record',
    title: '练习 C：导出一份诚实的实验记录',
    goal: '用一次真实完成的运行手动导出实验包，知道导出后该核对哪些文件与字段，也清楚这份包不能替你说明什么。',
    prerequisites: [
      '已有一次按受控管线完成、状态为已完成的真实训练，且带有原始权重与冻结预处理协议；浏览器演示数据不是这里的导出对象。',
      '「导出」面板的「导出实验复现包」按钮可点击。它禁用时把鼠标停在按钮上读那句提示，说明还缺哪个条件；本练习不绕过这些条件。',
      '本机磁盘上有可写位置：导出会先让你选目录，再在其下创建一个带时间戳的子目录。',
      '本练习不做候选选择、不冻结主张、不解封、不做裁决，因此不会消耗封存测试集资格。',
    ],
    steps: [
      '打开右侧「导出」面板，点「导出实验复现包」（按钮副标题写着「代码 + 原始权重 + 预处理 + 哈希；外部重跑单独留档」）。',
      '在系统目录选择器里选一个保存位置。若目标目录已存在，导出会拒绝而不是静默覆盖已有内容。',
      '导出完成后打开该目录，按 README.md 的「文件说明」逐条核对：model.py、train.py、requirements.txt、verify_package.py、results/metrics.csv、artifacts/ 与 preprocessing.json，以及 manifest.json。',
      '核对 manifest.json 里的 study、experiment、attempt、trust、claims、events 与 exportedArtifacts：每个产物条目带 path、role、sizeBytes、sha256 与 sourceAttemptId，逐个对回目录里的真实文件。',
      '核对 README.md 的结果描述：它引用的最终验证指标摘要写明来自哪一个 epoch，且能在 results/metrics.csv 找到对应的原始记录；口径不完整的行在 CSV 里写的是 metadata_missing，不是被悄悄补齐。',
      '可选：在该目录里运行 verify_package.py。它不执行模型代码，只核验实际导出文件的大小与 SHA-256。',
    ],
    observations: [
      {
        location: 'README.md 的「文件说明」与结果段落',
        phenomenon: '文件清单、超参表、复现命令与结论等级语句都在那里；缺少严格 validation/epoch 指标时，它直接说明不能生成最终验证指标摘要，并把原始诊断记录留在 metrics.csv。',
      },
      {
        location: 'manifest.json',
        phenomenon: '协议版本、study/experiment/attempt 身份、trust 字段（执行可信、结论可信、只追加审计）、claims 与 exportedArtifacts 的哈希和大小。',
      },
      {
        location: 'results/metrics.csv',
        phenomenon: '逐点记录各自的 split、scope、指标名与优化方向；不要只看摘要那一个数字。',
      },
      {
        location: '「课题」面板里同一条运行记录',
        phenomenon: '包里的身份与指标应能与面板中那条记录对上；对不上时先确认导出选的是哪一次运行。',
      },
    ],
    limitations: [
      '没有独立测试裁决时，这份包不能解释成泛化能力已经被验证。README 在结论等级为未评估时会自己写明当前结果仍是探索性证据、泛化能力尚未由冻结主张独立验证。',
      '清单与哈希全部对得上，只证明交付物自洽、可被独立核验，不证明模型更好，也不是给模型打的质量评级。',
      '结论可信等级只归属具体的评估主张，不代表整个模型；换指标或换阈值就是另一条主张。',
      '外部重跑产物按 external/unverified 解释，不能与受控原始结果混成一份证据。',
      '包里没有某个数值，不等于那个数值是 0；指标不可用与指标为零是两种不同的状态。',
      '官方测试集保持封存：导出投递的是已完成的记录，它会写文件、也会追加导出审计事件，但不替你做任何评估决定。',
    ],
    restoration:
      '导出不修改网络参数，也不改动任何既有的训练指标；但它不是纯只读投递：会写入实验包目录里的文件，并向该次运行追加 experiment_package_export_requested 与 experiment_package_export_completed（失败时为 failed）审计事件。这些留痕属于档案，不删除、不掩盖，也不需要你「恢复」掉。想再导一份就重新点一次并选一个新的位置——同名目录会被拒绝覆盖，所以你已交付的那一份不会被静默替换；完成后无需恢复工程配置，也不需要清理工程。',
    panelIds: ['export', 'study'],
  },
];

const EXERCISE_NOTES: readonly string[] = [
  '三个练习都是你手动操作的说明：本区域不记录完成情况，没有达标、解锁或评分，也不代替你判断结果好不好。',
  '导航按钮只切换右侧面板内容，不会加层、清场、改参数、切数据、启动训练或导出；未接导航时说明文字照样完整可读。',
  '左侧「层组件库」与底部训练栏没有面板 ID，涉及它们的步骤只给文字位置说明，不提供按钮。',
  '折叠只保留在当前视图：不写任何存储，回到帮助面板需要重新展开。',
];

/** 六个小节标题：练习卡片的固定结构，缺任何一项都算内容不完整。 */
const FIELD_LABELS = {
  goal: '学习目标',
  prerequisites: '前置条件',
  steps: '具体操作',
  observations: '看哪里、看什么',
  limitations: '结果不能说明什么',
  restoration: '如何恢复原配置',
} as const;

export default function TeachingExerciseGuide({ onNavigatePanel }: TeachingExerciseGuideProps) {
  const [sectionExpanded, setSectionExpanded] = useState(true);
  // 折叠状态集合：只影响渲染，不进入任何 store 或存储。
  const [collapsedIds, setCollapsedIds] = useState<readonly ExerciseId[]>([]);

  const toggleExercise = (id: ExerciseId) => {
    setCollapsedIds(previous =>
      previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id],
    );
  };

  return (
    <section
      data-testid="teaching-exercises"
      aria-label="动手练习"
      className="help-exercises"
      style={{ marginBottom: '16px' }}
    >
      <Button
        variant="ghost"
        size="small"
        data-testid="teaching-exercises-toggle"
        aria-expanded={sectionExpanded}
        aria-controls="help-exercises-list"
        onClick={() => setSectionExpanded(value => !value)}
      >
        {`${sectionExpanded ? '▼' : '▶'} 动手练习`}
      </Button>

      {sectionExpanded && (
        <div id="help-exercises-list" data-testid="teaching-exercises-body">
          <p className="help-exercises__intro">
            本区域只读：不会替你配置工程、不会启动训练或导出，也不写任何进度存储。下面三个练习的每一步都由你手动完成，这里只增加操作说明和面板跳转，不判断你有没有「做对」。
          </p>

          {EXERCISES.map(exercise => {
            const open = !collapsedIds.includes(exercise.id);
            const bodyId = `help-exercise-body-${exercise.id}`;
            return (
              <article
                key={exercise.id}
                data-testid={`exercise-${exercise.id}`}
                className="help-exercises__item"
              >
                <Button
                  variant="ghost"
                  size="small"
                  data-testid={`exercise-toggle-${exercise.id}`}
                  aria-expanded={open}
                  aria-controls={bodyId}
                  onClick={() => toggleExercise(exercise.id)}
                >
                  {`${open ? '▼' : '▶'} ${exercise.title}`}
                </Button>

                {open && (
                  <div id={bodyId} data-testid={`exercise-body-${exercise.id}`} className="help-exercises__body">
                    <div className="help-exercises__field" data-testid={`exercise-${exercise.id}-goal`}>
                      <span className="help-exercises__label">{FIELD_LABELS.goal}：</span>
                      {exercise.goal}
                    </div>

                    <div className="help-exercises__field">
                      <div className="help-exercises__label" data-testid={`exercise-${exercise.id}-prerequisites-label`}>
                        {FIELD_LABELS.prerequisites}
                      </div>
                      <ul className="help-exercises__list">
                        {exercise.prerequisites.map(item => (
                          <li key={item} data-testid={`exercise-${exercise.id}-prerequisite`}>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="help-exercises__field">
                      <div className="help-exercises__label" data-testid={`exercise-${exercise.id}-steps-label`}>
                        {FIELD_LABELS.steps}
                      </div>
                      <ol className="help-exercises__list">
                        {exercise.steps.map((item, index) => (
                          <li key={item} data-testid={`exercise-${exercise.id}-step-${index + 1}`}>
                            {item}
                          </li>
                        ))}
                      </ol>
                    </div>

                    <div className="help-exercises__field">
                      <div className="help-exercises__label" data-testid={`exercise-${exercise.id}-observations-label`}>
                        {FIELD_LABELS.observations}
                      </div>
                      <ul className="help-exercises__list">
                        {exercise.observations.map(item => (
                          <li key={item.location} data-testid={`exercise-${exercise.id}-observation`}>
                            <span className="help-exercises__where">{item.location}</span>
                            <span>——{item.phenomenon}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="help-exercises__field">
                      <div className="help-exercises__label" data-testid={`exercise-${exercise.id}-limitations-label`}>
                        {FIELD_LABELS.limitations}
                      </div>
                      <ul className="help-exercises__list">
                        {exercise.limitations.map(item => (
                          <li key={item} data-testid={`exercise-${exercise.id}-limitation`}>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="help-exercises__field" data-testid={`exercise-${exercise.id}-restoration`}>
                      <span className="help-exercises__label">{FIELD_LABELS.restoration}：</span>
                      {exercise.restoration}
                    </div>

                    {onNavigatePanel && exercise.panelIds.length > 0 && (
                      <div className="help-guide__actions">
                        {exercise.panelIds.map(panelId => (
                          <Button
                            key={panelId}
                            size="small"
                            variant="secondary"
                            className="help-guide__nav"
                            data-testid={`exercise-nav-${exercise.id}-${panelId}`}
                            onClick={() => onNavigatePanel(panelId)}
                          >
                            打开「{getRightPanelMeta(panelId).label}」面板
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}

          <ul className="help-exercises__notes">
            {EXERCISE_NOTES.map(note => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
