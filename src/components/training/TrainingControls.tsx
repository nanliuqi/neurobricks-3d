import Button from '@/components/ui/Button';
import type { TrainStatus } from '@/types/training';

export interface TrainingControlsProps {
  isTraining: boolean;
  isPaused: boolean;
  status: TrainStatus;
  canRestart: boolean;
  onResume: () => unknown | Promise<unknown>;
  onPause: () => unknown | Promise<unknown>;
  onStop: () => unknown | Promise<unknown>;
  onRestart: () => unknown | Promise<unknown>;
  onReset: () => void;
}

export default function TrainingControls({ isTraining, isPaused, status, canRestart, onResume, onPause, onStop, onRestart, onReset }: TrainingControlsProps) {
  if (!isTraining) {
    return (
      <div className="training-monitor__actions">
        {canRestart && <Button variant="primary" size="small" onClick={onRestart} data-testid="restart-train-btn">重新开始训练</Button>}
        <Button variant="secondary" size="small" onClick={onReset}>清除运行态提示</Button>
      </div>
    );
  }
  return (
    <div className="training-monitor__actions" aria-label="训练控制">
      <Button variant="primary" size="small" onClick={onResume} disabled={!isPaused || status === 'stopping'}>恢复</Button>
      <Button variant="warning" size="small" onClick={onPause} disabled={isPaused || status === 'starting' || status === 'stopping'}>暂停</Button>
      <Button variant="danger" size="small" onClick={onStop} disabled={status === 'stopping'}>{status === 'stopping' ? '正在停止…' : '停止'}</Button>
    </div>
  );
}
