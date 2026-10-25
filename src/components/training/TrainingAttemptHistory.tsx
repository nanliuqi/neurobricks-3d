import { useState } from 'react';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import type { AttemptMonitorItem } from '@/utils/trainingMonitorViewModel';

export interface TrainingAttemptHistoryProps {
  attempts: readonly AttemptMonitorItem[];
  selectedAttemptId: string | null;
  onSelect: (attemptId: string) => void;
}

export default function TrainingAttemptHistory({ attempts, selectedAttemptId, onSelect }: TrainingAttemptHistoryProps) {
  const [expanded, setExpanded] = useState(true);
  return (
    <section className="training-monitor__collapsible" aria-label="当前课题运行记录">
      <Button variant="ghost" size="small" className="training-monitor__section-toggle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
        当前课题 Attempt（{attempts.length}）{expanded ? ' 收起' : ' 展开'}
      </Button>
      {expanded && (
        <div className="training-monitor__attempts">
          {attempts.length === 0 ? <p className="training-monitor__muted">当前活动 Study 尚无 Attempt，或尚未选择活动 Study。</p> : attempts.map(item => (
            <button
              key={item.attempt.id}
              type="button"
              className={['training-monitor__attempt-card', selectedAttemptId === item.attempt.id && 'training-monitor__attempt-card--selected'].filter(Boolean).join(' ')}
              aria-pressed={selectedAttemptId === item.attempt.id}
              onClick={() => onSelect(item.attempt.id)}
            >
              <span className="training-monitor__attempt-heading"><strong>{item.experimentName} · Attempt {item.attempt.ordinal}</strong><StatusBadge tone={item.status.tone} label={item.status.label} /></span>
              <span>{item.evidence.label}</span>
              <span>{item.evidence.finalPoint ? `${item.evidence.metricName ?? '指标'}：${item.evidence.finalPoint.text}（epoch ${item.evidence.finalPoint.epoch}）` : '没有可采信的最终 validation/epoch 指标'}</span>
              <small>{item.resumeLabel} · {item.startedText} · {item.durationText}</small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
