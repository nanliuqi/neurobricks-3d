import { useId, useState, type CSSProperties } from 'react';
import Button from '@/components/ui/Button';
import { resultReadingTopics, type ResultReadingTopicId } from '@/content/resultInterpretation';

export interface ResultReadingGuideProps {
  /** 静态主题分组：内容只由文案来源决定，不接受业务实体作为推断输入。 */
  topicIds: readonly ResultReadingTopicId[];
  /**
   * 入口短标签：只接受调用方写死的短文案（如「如何比较」「结果说明」），
   * 不传时保持 R1 的「如何读图」；不得拼入实验名、指标值或免责声明。
   */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * 按需查看的结果解读入口：默认收起，只在本地维护展开状态。
 * 它不读 store、不调后端、不写进度，也不改变任何数据或证据资格；
 * 展开内容留在正常 HTML 文档流里，不进入 SVG，也不悬浮遮挡图形。
 */
export default function ResultReadingGuide({
  topicIds,
  label = '如何读图',
  className,
  style,
}: ResultReadingGuideProps) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const topics = resultReadingTopics(topicIds);

  return (
    <div
      className={['result-reading-guide', className].filter(Boolean).join(' ')}
      style={style}
      data-testid="result-reading-guide"
    >
      <Button
        variant="ghost"
        size="small"
        className="result-reading-guide__toggle"
        data-testid="result-reading-guide-toggle"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded(value => !value)}
      >
        {`${expanded ? '▼' : '▶'} ${label}`}
      </Button>
      {expanded && (
        <dl id={panelId} className="result-reading-guide__list" data-testid="result-reading-guide-body">
          {topics.map(topic => (
            <div key={topic.id} data-testid={`result-reading-topic-${topic.id}`}>
              <dt className="result-reading-guide__title">{topic.title}</dt>
              <dd className="result-reading-guide__text">{topic.text}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
