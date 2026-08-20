import { useMemo, useState } from 'react';
import { useLayerStore } from '@/stores/useLayerStore';
import { generatePyTorchCode } from '@/utils/codeGenerator';

/**
 * 全局代码面板
 * 实时展示当前场景网络对应的 PyTorch 代码（随积木增删/参数修改即时更新），
 * 解决"搭积木时看不到对应代码"的问题，可直接复制用于编写和调试。
 */
export default function CodePanel() {
  const layers = useLayerStore(state => state.layers);
  const [copied, setCopied] = useState(false);

  const code = useMemo(() => generatePyTorchCode(layers), [layers]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy code:', e);
    }
  };

  return (
    <div style={{ padding: '12px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 标题栏 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '10px',
        paddingBottom: '8px',
        borderBottom: '1px solid #0f3460',
      }}>
        <span style={{ color: 'white', fontSize: '14px', fontWeight: 600 }}>PyTorch 代码</span>
        <button
          onClick={handleCopy}
          disabled={layers.length === 0}
          style={{
            padding: '3px 10px',
            backgroundColor: copied ? '#10b981' : (layers.length === 0 ? '#475569' : '#1e40af'),
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: layers.length === 0 ? 'not-allowed' : 'pointer',
            fontSize: '11px',
          }}
        >
          {copied ? '✓ 已复制' : '📋 复制'}
        </button>
      </div>

      {/* 说明 */}
      <div style={{ color: '#64748b', fontSize: '10px', marginBottom: '8px', lineHeight: 1.5 }}>
        代码随场景网络实时更新（{layers.length} 层），可直接复制到 Python 项目中使用
      </div>

      {/* 代码区 */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', backgroundColor: '#0f172a', border: '1px solid #1a3a5c', borderRadius: '6px' }}>
        {layers.length === 0 ? (
          <div style={{
            padding: '20px',
            color: '#475569',
            fontSize: '12px',
            textAlign: 'center',
            lineHeight: 1.8,
          }}>
            场景中还没有网络层<br />
            从左侧积木库拖入层或选择经典模型后，<br />这里会实时显示对应的 PyTorch 代码
          </div>
        ) : (
          <pre style={{
            margin: 0,
            padding: '10px',
            fontSize: '11px',
            fontFamily: 'Consolas, Monaco, monospace',
            color: '#e2e8f0',
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {code}
          </pre>
        )}
      </div>
    </div>
  );
}
