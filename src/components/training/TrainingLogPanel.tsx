import { useEffect, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import type { LogEntry } from '@/types/training';
import { formatLogTime } from '@/utils/trainingMonitorViewModel';

export default function TrainingLogPanel({ logs }: { logs: readonly LogEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (expanded && containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [expanded, logs]);
  return (
    <section className="training-monitor__collapsible" aria-label="训练日志">
      <Button variant="ghost" size="small" className="training-monitor__section-toggle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
        训练日志（{logs.length}）{expanded ? ' 收起' : ' 展开'}
      </Button>
      {expanded && (
        <div className="training-monitor__logs" ref={containerRef} role="log" aria-live="polite">
          {logs.length === 0 ? <span className="training-monitor__muted">暂无日志</span> : logs.map((log, index) => (
            <div className={`training-monitor__log training-monitor__log--${log.level}`} key={`${log.timestamp}-${index}`}>
              <time>{formatLogTime(log)}</time><span>{log.message}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
