import { useLayerStore } from '@/stores/useLayerStore';
import { useTrainingStore } from '@/stores/useTrainingStore';
import { generatePyTorchCode, generateKerasCode } from '@/utils/codeGenerator';

/** 浏览器端下载文件 */
function browserDownload(filename: string, content: string, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 保存文件：Tauri 用 save dialog + fs，失败降级到浏览器下载 */
async function saveFile(filename: string, content: string, mimeType = 'text/plain') {
  try {
    const { save } = await import('@tauri-apps/api/dialog');
    const { writeTextFile } = await import('@tauri-apps/api/fs');
    const filePath = await save({
      filters: [{ name: filename.split('.').pop()!.toUpperCase(), extensions: [filename.split('.').pop()!] }],
      defaultPath: filename,
    });
    if (!filePath) return;
    await writeTextFile(filePath, content);
  } catch {
    browserDownload(filename, content, mimeType);
  }
}

export default function ExportPanel() {
  const layers = useLayerStore(state => state.layers);
  const metrics = useTrainingStore(state => state.metrics);

  const handleExportPyTorch = async () => {
    try {
      const code = generatePyTorchCode(layers);
      await saveFile('model.py', code, 'text/x-python');
    } catch (error) {
      console.error('Failed to export PyTorch code:', error);
      alert('导出失败：' + (error as Error).message);
    }
  };

  const handleExportKeras = async () => {
    try {
      const code = generateKerasCode(layers);
      await saveFile('model_keras.py', code, 'text/x-python');
    } catch (error) {
      console.error('Failed to export Keras code:', error);
      alert('导出失败：' + (error as Error).message);
    }
  };

  const handleExportWeights = async () => {
    try {
      const { save } = await import('@tauri-apps/api/dialog');
      const { invoke } = await import('@tauri-apps/api/tauri');
      const filePath = await save({
        filters: [{ name: 'PyTorch Weights', extensions: ['pth'] }],
        defaultPath: 'model_weights.pth',
      });
      if (!filePath) return;
      await invoke('export_model_weights', { path: filePath });
      alert('PyTorch 权重导出成功\n\n使用方法：\nmodel.load_state_dict(torch.load("model_weights.pth"))');
    } catch (error) {
      console.error('Failed to export weights:', error);
      alert('导出失败：' + (error as Error).message);
    }
  };

  const handleExportFullModel = async () => {
    try {
      const { save } = await import('@tauri-apps/api/dialog');
      const { invoke } = await import('@tauri-apps/api/tauri');
      const filePath = await save({
        filters: [{ name: 'PyTorch Full Model', extensions: ['pt'] }],
        defaultPath: 'model_full.pt',
      });
      if (!filePath) return;
      await invoke('export_full_model', { path: filePath });
      alert('完整模型导出成功\n\n使用方法：\nmodel = torch.load("model_full.pt")\nmodel.eval()');
    } catch (error) {
      console.error('Failed to export full model:', error);
      alert('导出失败：' + (error as Error).message);
    }
  };

  const handleExportNumpy = async () => {
    try {
      const { save } = await import('@tauri-apps/api/dialog');
      const { invoke } = await import('@tauri-apps/api/tauri');
      const filePath = await save({
        filters: [{ name: 'NumPy Weights', extensions: ['npz'] }],
        defaultPath: 'model_weights.npz',
      });
      if (!filePath) return;
      await invoke('export_numpy_weights', { path: filePath });
      alert('NumPy 权重导出成功\n\n使用方法：\nimport numpy as np\ndata = np.load("model_weights.npz")\nfor key in data.files:\n    print(key, data[key].shape)');
    } catch (error) {
      console.error('Failed to export numpy weights:', error);
      alert('导出失败：' + (error as Error).message);
    }
  };

  const handleExportLogs = async () => {
    try {
      if (!metrics || metrics.length === 0) {
        alert('暂无训练日志可导出');
        return;
      }
      const headers = Object.keys(metrics[0]).join(',');
      const rows = metrics.map(m => Object.values(m).join(','));
      const csv = [headers, ...rows].join('\n');
      await saveFile('training_log.csv', csv, 'text/csv');
    } catch (error) {
      console.error('Failed to export training logs:', error);
      alert('导出失败：' + (error as Error).message);
    }
  };

  const handleExportChart = async () => {
    alert('📈 曲线图导出功能开发中');
  };

  return (
    <div style={{ padding: '12px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ color: 'white', fontSize: '14px', fontWeight: 600, marginBottom: '16px', paddingBottom: '8px', borderBottom: '1px solid #0f3460' }}>
        导出选项
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <button onClick={handleExportPyTorch} disabled={layers.length === 0}
          style={{ padding: '12px', backgroundColor: layers.length === 0 ? '#475569' : '#1e40af', color: 'white', border: 'none', borderRadius: '6px', cursor: layers.length === 0 ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 600, textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px' }}
          onMouseEnter={e => { if (layers.length > 0) e.currentTarget.style.backgroundColor = '#1e3a8a'; }}
          onMouseLeave={e => { if (layers.length > 0) e.currentTarget.style.backgroundColor = '#1e40af'; }}
        >
          <span style={{ fontSize: '16px' }}>🐍</span><span>导出 PyTorch 代码</span>
        </button>

        <button onClick={handleExportKeras} disabled={layers.length === 0}
          style={{ padding: '12px', backgroundColor: layers.length === 0 ? '#475569' : '#047857', color: 'white', border: 'none', borderRadius: '6px', cursor: layers.length === 0 ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 600, textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px' }}
          onMouseEnter={e => { if (layers.length > 0) e.currentTarget.style.backgroundColor = '#065f46'; }}
          onMouseLeave={e => { if (layers.length > 0) e.currentTarget.style.backgroundColor = '#047857'; }}
        >
          <span style={{ fontSize: '16px' }}>🔧</span><span>导出 Keras 代码</span>
        </button>

        <button onClick={handleExportWeights} disabled={layers.length === 0}
          style={{ padding: '10px 12px', backgroundColor: layers.length === 0 ? '#475569' : '#7c3aed', color: 'white', border: 'none', borderRadius: '6px', cursor: layers.length === 0 ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: 600, textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <span style={{ fontSize: '14px' }}>⚖️</span>
          <div>
            <div>PyTorch 权重 (.pth)</div>
            <div style={{ fontSize: '10px', fontWeight: 400, opacity: 0.7 }}>仅权重，需配合模型代码使用</div>
          </div>
        </button>

        <button onClick={handleExportFullModel} disabled={layers.length === 0}
          style={{ padding: '10px 12px', backgroundColor: layers.length === 0 ? '#475569' : '#6d28d9', color: 'white', border: 'none', borderRadius: '6px', cursor: layers.length === 0 ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: 600, textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <span style={{ fontSize: '14px' }}>📦</span>
          <div>
            <div>完整模型 (.pt)</div>
            <div style={{ fontSize: '10px', fontWeight: 400, opacity: 0.7 }}>结构+权重，torch.load 直接加载</div>
          </div>
        </button>

        <button onClick={handleExportNumpy} disabled={layers.length === 0}
          style={{ padding: '10px 12px', backgroundColor: layers.length === 0 ? '#475569' : '#5b21b6', color: 'white', border: 'none', borderRadius: '6px', cursor: layers.length === 0 ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: 600, textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <span style={{ fontSize: '14px' }}>🔢</span>
          <div>
            <div>NumPy 权重 (.npz)</div>
            <div style={{ fontSize: '10px', fontWeight: 400, opacity: 0.7 }}>不依赖 PyTorch，通用格式</div>
          </div>
        </button>

        <button onClick={handleExportLogs} disabled={!metrics || metrics.length === 0}
          style={{ padding: '12px', backgroundColor: !metrics || metrics.length === 0 ? '#475569' : '#ea580c', color: 'white', border: 'none', borderRadius: '6px', cursor: !metrics || metrics.length === 0 ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 600, textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px' }}
          onMouseEnter={e => { if (metrics && metrics.length > 0) e.currentTarget.style.backgroundColor = '#c2410c'; }}
          onMouseLeave={e => { if (metrics && metrics.length > 0) e.currentTarget.style.backgroundColor = '#ea580c'; }}
        >
          <span style={{ fontSize: '16px' }}>📊</span><span>导出训练日志</span>
        </button>

        <button onClick={handleExportChart} disabled={true}
          style={{ padding: '12px', backgroundColor: '#475569', color: '#94a3b8', border: 'none', borderRadius: '6px', cursor: 'not-allowed', fontSize: '13px', fontWeight: 600, textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <span style={{ fontSize: '16px' }}>📈</span><span>导出曲线图（开发中）</span>
        </button>
      </div>

      <div style={{ marginTop: '12px', padding: '10px', backgroundColor: '#0f3460', borderRadius: '6px', fontSize: '11px', color: '#94a3b8', lineHeight: '1.5' }}>
        💡 提示：<br />
        • 代码导出需要至少一个层组件<br />
        • 权重导出需要完成一次训练<br />
        • .pth 需配合模型代码：model.load_state_dict(torch.load(...))<br />
        • .pt 可直接加载：model = torch.load(...)<br />
        • .npz 用 NumPy 读取：np.load(...)<br />
        • 如果 .pth 被压缩软件打开，改用 .pt 或 .npz 格式
      </div>
    </div>
  );
}
