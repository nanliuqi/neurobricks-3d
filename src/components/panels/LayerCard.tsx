import { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { LayerMeta } from '../../types/layer';

interface LayerCardProps {
  layer: LayerMeta;
}

/** 线条风格的层图标 SVG */
function LayerIcon({ icon, color }: { icon: string; color: string }) {
  const size = 20;
  const stroke = color;
  const sw = 1.5;

  switch (icon) {
    case 'input':
      // 箭头指向方块 → 数据流入
      return (
        <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
          <rect x="8" y="4" width="10" height="12" rx="1" stroke={stroke} strokeWidth={sw} />
          <path d="M2 10H8" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
          <path d="M6 7L9 10L6 13" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'conv':
      // 网格 + 滑动窗口
      return (
        <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
          <rect x="2" y="2" width="7" height="7" stroke={stroke} strokeWidth={sw} />
          <rect x="5" y="5" width="7" height="7" stroke={stroke} strokeWidth={sw} opacity="0.5" />
          <rect x="8" y="8" width="7" height="7" stroke={stroke} strokeWidth={sw} opacity="0.8" />
          <rect x="11" y="11" width="7" height="7" stroke={stroke} strokeWidth={sw} />
        </svg>
      );

    case 'pool':
      // 4格 → 1格 缩小
      return (
        <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
          <rect x="1" y="2" width="7" height="7" stroke={stroke} strokeWidth={sw} />
          <rect x="9" y="2" width="7" height="7" stroke={stroke} strokeWidth={sw} />
          <rect x="1" y="11" width="7" height="7" stroke={stroke} strokeWidth={sw} />
          <rect x="9" y="11" width="7" height="7" stroke={stroke} strokeWidth={sw} />
          <path d="M8.5 10L11 10" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeDasharray="1.5 1.5" />
          <rect x="12" y="7" width="6" height="6" stroke={stroke} strokeWidth={2} />
        </svg>
      );

    case 'linear':
      // 左侧多个点连到右侧少个点
      return (
        <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
          <circle cx="3" cy="3" r="1.5" fill={stroke} />
          <circle cx="3" cy="7" r="1.5" fill={stroke} />
          <circle cx="3" cy="11" r="1.5" fill={stroke} />
          <circle cx="3" cy="15" r="1.5" fill={stroke} />
          <circle cx="3" cy="19" r="1.5" fill={stroke} />
          <line x1="4.5" y1="3" x2="15.5" y2="5" stroke={stroke} strokeWidth={sw * 0.7} />
          <line x1="4.5" y1="7" x2="15.5" y2="5" stroke={stroke} strokeWidth={sw * 0.7} />
          <line x1="4.5" y1="11" x2="15.5" y2="5" stroke={stroke} strokeWidth={sw * 0.7} />
          <line x1="4.5" y1="15" x2="15.5" y2="14" stroke={stroke} strokeWidth={sw * 0.7} />
          <line x1="4.5" y1="19" x2="15.5" y2="14" stroke={stroke} strokeWidth={sw * 0.7} />
          <circle cx="17" cy="5" r="1.5" fill={stroke} />
          <circle cx="17" cy="14" r="1.5" fill={stroke} />
        </svg>
      );

    case 'relu':
      // ReLU 折线: 平后上升
      return (
        <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
          <path d="M2 16H10L18 4" stroke={stroke} strokeWidth={sw * 1.5} strokeLinecap="round" strokeLinejoin="round" />
          <line x1="2" y1="16" x2="18" y2="16" stroke={stroke} strokeWidth={sw * 0.5} opacity="0.3" />
        </svg>
      );

    case 'sigmoid':
      // S 曲线
      return (
        <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
          <path d="M2 6C6 6 8 14 12 14C14 14 16 10 18 6" stroke={stroke} strokeWidth={sw * 1.5} strokeLinecap="round" fill="none" />
          <line x1="2" y1="10" x2="18" y2="10" stroke={stroke} strokeWidth={sw * 0.5} opacity="0.3" />
        </svg>
      );

    case 'tanh':
      // 双曲正切 S 形穿过中线
      return (
        <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
          <path d="M2 10C4 3 6 3 8 10C10 17 12 17 14 10C16 3 18 3 18 10" stroke={stroke} strokeWidth={sw * 1.5} strokeLinecap="round" fill="none" />
          <line x1="2" y1="10" x2="18" y2="10" stroke={stroke} strokeWidth={sw * 0.5} opacity="0.3" />
        </svg>
      );

    case 'batchnorm':
      // 钟形曲线 (正态分布)
      return (
        <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
          <path d="M2 16C4 16 6 14 8 8C9 4 10 4 10 4C10 4 11 4 12 8C14 14 16 16 18 16" stroke={stroke} strokeWidth={sw * 1.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <line x1="2" y1="16" x2="18" y2="16" stroke={stroke} strokeWidth={sw * 0.5} opacity="0.3" />
        </svg>
      );

    case 'layernorm':
      // 横向分层 + 归一化箭头
      return (
        <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
          <line x1="3" y1="4" x2="17" y2="4" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
          <line x1="3" y1="8" x2="17" y2="8" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
          <line x1="3" y1="12" x2="17" y2="12" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
          <line x1="3" y1="16" x2="17" y2="16" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
          <path d="M18 2V18" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeDasharray="2 2" />
        </svg>
      );

    case 'dropout':
      // 带叉号的点 (随机丢弃)
      return (
        <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
          <circle cx="5" cy="5" r="2" stroke={stroke} strokeWidth={sw} />
          <line x1="12" y1="4" x2="16" y2="8" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
          <line x1="16" y1="4" x2="12" y2="8" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
          <circle cx="5" cy="14" r="2" stroke={stroke} strokeWidth={sw} />
          <circle cx="14" cy="14" r="2" stroke={stroke} strokeWidth={sw} />
          <line x1="8" y1="3" x2="10" y2="7" stroke={stroke} strokeWidth={sw * 0.7} strokeLinecap="round" opacity="0.5" />
          <line x1="10" y1="3" x2="8" y2="7" stroke={stroke} strokeWidth={sw * 0.7} strokeLinecap="round" opacity="0.5" />
        </svg>
      );

    case 'flatten':
      // 立方体展平为线
      return (
        <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
          <rect x="1" y="3" width="8" height="8" stroke={stroke} strokeWidth={sw} />
          <path d="M1 3L4 1L12 1L9 3" stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          <path d="M12 1L12 9L9 11" stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          <path d="M12 9L9 11" stroke={stroke} strokeWidth={sw * 0.5} opacity="0.4" />
          <path d="M13 7H18" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeDasharray="1.5 1.5" />
          <line x1="13" y1="14" x2="19" y2="14" stroke={stroke} strokeWidth={sw * 1.5} strokeLinecap="round" />
        </svg>
      );

    default:
      return (
        <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
          <rect x="3" y="3" width="14" height="14" rx="2" stroke={stroke} strokeWidth={sw} />
        </svg>
      );
  }
}

const LayerCard = ({ layer }: LayerCardProps) => {
  const [showTooltip, setShowTooltip] = useState(false);

  const { attributes, listeners, setNodeRef } = useDraggable({
    id: `layer-${layer.type}`,
    data: {
      layerType: layer.type,
      defaultParams: layer.defaultParams,
    },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      className="group relative bg-gray-800 border border-gray-700 hover:border-gray-600 rounded-lg p-3 cursor-grab active:cursor-grabbing transition-all duration-200 hover:bg-gray-700"
      style={{ borderLeft: `4px solid ${layer.color}` }}
    >
      <div className="flex items-center gap-2">
        {/* 线条图标 */}
        <span className="flex-shrink-0">
          <LayerIcon icon={layer.icon} color={layer.color} />
        </span>

        <div className="flex-1 min-w-0">
          <div className="text-white text-xs font-medium">{layer.type} · {layer.label}</div>
          <div className="text-gray-500 text-[10px] truncate">{layer.description}</div>
        </div>
      </div>

      {/* Tooltip: 显示默认参数 */}
      {showTooltip && layer.defaultParams && Object.keys(layer.defaultParams).length > 0 && (
        <div
          className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-3 py-2 bg-[#0f3460] border border-[#1a3a5c] rounded shadow-xl z-50 whitespace-nowrap pointer-events-none"
          style={{ minWidth: '150px' }}
        >
          <div className="text-[#94a3b8] text-[10px] mb-1 font-semibold">
            {layer.type} 默认参数
          </div>
          {Object.entries(layer.defaultParams).map(([key, value]) => (
            <div key={key} className="text-white text-[11px] font-mono">
              {key}: {String(value)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default LayerCard;
