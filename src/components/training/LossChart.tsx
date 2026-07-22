import { useRef, useEffect } from 'react';
import { useTrainingStore } from '../../stores/useTrainingStore';

/**
 * 简易 Loss/Accuracy 曲线图
 * 使用 Canvas 直接绘制，无需 echarts 依赖
 */
export default function LossChart() {
  const metrics = useTrainingStore(state => state.metrics);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // 高 DPI 适配
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    const w = Math.floor(rect.width);
    const h = Math.floor(rect.height);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    const width = w;
    const height = h;

    // 清空画布
    ctx.fillStyle = '#0f3460';
    ctx.fillRect(0, 0, width, height);

    if (metrics.length < 2) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('等待训练数据...', width / 2, height / 2);
      return;
    }

    const padding = { top: 20, right: 50, bottom: 30, left: 50 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;

    // 计算数据范围
    const losses = metrics.map(m => m.loss);
    const maxLoss = Math.max(...losses, 0.1);
    const minLoss = 0;

    // 绘制网格线
    ctx.strokeStyle = '#1a3a5c';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (plotHeight / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
    }

    // 辅助函数：数据点 → 画布坐标
    const toX = (index: number) => padding.left + (index / (metrics.length - 1)) * plotWidth;
    const toYLoss = (loss: number) => padding.top + (1 - (loss - minLoss) / (maxLoss - minLoss)) * plotHeight;
    const toYAcc = (acc: number) => padding.top + (1 - acc) * plotHeight;

    // 绘制 Loss 曲线
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    metrics.forEach((m, i) => {
      const x = toX(i);
      const y = toYLoss(m.loss);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 绘制 Accuracy 曲线
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    metrics.forEach((m, i) => {
      const x = toX(i);
      const y = toYAcc(m.accuracy);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 绘制图例
    ctx.font = '10px sans-serif';

    // Loss 图例
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(width - padding.right + 8, padding.top, 8, 8);
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'left';
    ctx.fillText('Loss', width - padding.right + 20, padding.top + 8);

    // Acc 图例
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(width - padding.right + 8, padding.top + 16, 8, 8);
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('Acc', width - padding.right + 20, padding.top + 24);

    // Y 轴标签
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'right';
    ctx.fillText(maxLoss.toFixed(2), padding.left - 5, padding.top + 4);
    ctx.fillText('0', padding.left - 5, padding.top + plotHeight + 4);

    // 最新值标注
    const latest = metrics[metrics.length - 1];
    ctx.fillStyle = '#3b82f6';
    ctx.textAlign = 'left';
    ctx.fillText(latest.loss.toFixed(4), width - padding.right + 5, toYLoss(latest.loss) + 3);

    ctx.fillStyle = '#f59e0b';
    ctx.fillText(`${(latest.accuracy * 100).toFixed(1)}%`, width - padding.right + 5, toYAcc(latest.accuracy) + 3);

  }, [metrics]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', borderRadius: '4px' }}
      />
    </div>
  );
}
