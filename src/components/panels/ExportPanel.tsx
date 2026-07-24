import { useState } from 'react';
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

  const [previewCode, setPreviewCode] = useState<string | null>(null);
  const [previewLang, setPreviewLang] = useState<'python' | 'keras' | null>(null);

  const handlePreviewPyTorch = () => {
    const code = generatePyTorchCode(layers);
    setPreviewCode(code);
    setPreviewLang('python');
  };

  const handlePreviewKeras = () => {
    const code = generateKerasCode(layers);
    setPreviewCode(code);
    setPreviewLang('keras');
  };

  const handleSavePyTorch = async () => {
    if (!previewCode) return;
    try {
      await saveFile('model.py', previewCode, 'text/x-python');
    } catch (error) {
      alert('导出失败：' + (error as Error).message);
    }
  };

  const handleSaveKeras = async () => {
    if (!previewCode) return;
    try {
      await saveFile('model_keras.py', previewCode, 'text/x-python');
    } catch (error) {
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

  const handleExportLogsTxt = async () => {
    try {
      const logs = useTrainingStore.getState().logs;
      if (!logs || logs.length === 0) {
        alert('暂无训练日志可导出');
        return;
      }
      const lines = logs.map(log => {
        const time = new Date(log.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
        return `[${time}] [${log.level.toUpperCase()}] ${log.message}`;
      });
      const content = `NeuroBricks 3D 训练日志\n导出时间: ${new Date().toLocaleString('zh-CN')}\n共 ${logs.length} 条日志\n${'='.repeat(50)}\n\n${lines.join('\n')}`;
      await saveFile('training_log.txt', content, 'text/plain');
    } catch (error) {
      console.error('Failed to export logs:', error);
      alert('导出失败：' + (error as Error).message);
    }
  };

  const handleExportChart = async () => {
    alert('📈 曲线图导出功能开发中');
  };

  // --- 项目保存 / 加载 ---

  /** 清理文件名中 Windows 不允许的字符（非法字符 / 尾部点空格 / 保留设备名） */
  const sanitizeFilename = (name: string): string => {
    const cleaned = name
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/[.\s]+$/, '')
      .replace(/^(con|prn|aux|nul|com\d|lpt\d)$/i, '$&_');
    return cleaned || 'untitled';
  };

  const handleSaveProject = async () => {
    try {
      const { save } = await import('@tauri-apps/api/dialog');
      const { invoke } = await import('@tauri-apps/api/tauri');

      const projectData = {
        version: '1.0',
        tower: {
          id: 'default',
          name: useLayerStore.getState().towerName,
          layers: useLayerStore.getState().layers,
          layoutMode: useLayerStore.getState().layoutMode,
          totalParams: useLayerStore.getState().totalParams,
          hasShapeError: useLayerStore.getState().hasShapeError,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      };

      const safeName = sanitizeFilename(useLayerStore.getState().towerName || 'untitled');
      const filePath = await save({
        filters: [{ name: 'NeuroBricks Project', extensions: ['nbproj'] }],
        defaultPath: `${safeName}.nbproj`,
      });
      if (!filePath) return;

      await invoke('save_project', { data: JSON.stringify(projectData, null, 2), path: filePath });
      alert('项目保存成功');
    } catch (error) {
      console.error('Failed to save project:', error);
      alert('保存失败：' + (error as Error).message);
    }
  };

  const handleLoadProject = async () => {
    try {
      const { open } = await import('@tauri-apps/api/dialog');
      const { invoke } = await import('@tauri-apps/api/tauri');

      const filePath = await open({
        filters: [{ name: 'NeuroBricks Project', extensions: ['nbproj'] }],
        multiple: false,
        title: '加载 NeuroBricks 项目',
      });
      if (!filePath || Array.isArray(filePath)) return;

      const jsonStr = await invoke<string>('load_project', { path: filePath });

      // 大文件保护：超过 10MB 拒绝解析，避免冻结 UI
      if (jsonStr.length > 10 * 1024 * 1024) {
        alert('文件过大（超过 10MB），不是有效的项目文件');
        return;
      }

      const data = JSON.parse(jsonStr);

      // 结构完整性检查
      if (!data.version || !data.tower || !Array.isArray(data.tower.layers)) {
        alert('无效的项目文件：缺少必要字段（version / tower.layers）');
        return;
      }

      // 层数据完整性修复：确保 recalcAll 依赖的字段存在（order/position/params），
      // 防止损坏文件中缺失字段导致排序 NaN 或形状推导崩溃
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const repairedLayers = (data.tower.layers as any[]).map((layer, index) => ({
        id: layer.id || `layer-${Date.now()}-${index}`,
        type: layer.type,
        params: layer.params || {},
        order: typeof layer.order === 'number' ? layer.order : index,
        position: Array.isArray(layer.position) && layer.position.length === 3
          ? layer.position
          : [0, 0, 0],
        outputShape: layer.outputShape ?? null,
        paramCount: typeof layer.paramCount === 'number' ? layer.paramCount : 0,
        validationError: layer.validationError ?? null,
      }));

      // 过滤缺少 type 的无效层（type 无法修复，无它则无法构建任何组件）
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const validLayers = repairedLayers.filter((l: any) => typeof l.type === 'string' && l.type.length > 0);
      if (validLayers.length === 0) {
        alert('无效的项目文件：未找到有效的网络层');
        return;
      }

      // layoutMode 只接受已知值，防止非法字符串传入 store
      const layoutMode = data.tower.layoutMode === 'free' ? 'free' : 'vertical';

      useLayerStore.getState().loadProject({ layers: validLayers, layoutMode });

      const skipped = data.tower.layers.length - validLayers.length;
      alert(`项目加载成功（${validLayers.length} 层${skipped > 0 ? `，跳过 ${skipped} 个无效层` : ''}）`);
    } catch (error) {
      console.error('Failed to load project:', error);
      alert('加载失败：' + (error as Error).message);
    }
  };

  return (
    <div style={{ padding: '12px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ color: 'white', fontSize: '14px', fontWeight: 600, marginBottom: '16px', paddingBottom: '8px', borderBottom: '1px solid #0f3460' }}>
        导出选项
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {/* 项目管理 */}
        <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600, marginBottom: '6px' }}>
          项目管理
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
          <button
            onClick={handleSaveProject}
            disabled={layers.length === 0}
            style={{
              flex: 1,
              padding: '10px',
              backgroundColor: layers.length === 0 ? '#475569' : '#0891b2',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: layers.length === 0 ? 'not-allowed' : 'pointer',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            💾 保存项目
          </button>
          <button
            onClick={handleLoadProject}
            style={{
              flex: 1,
              padding: '10px',
              backgroundColor: '#0e7490',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            📂 加载项目
          </button>
        </div>

        <button onClick={handlePreviewPyTorch} disabled={layers.length === 0}
          style={{ padding: '12px', backgroundColor: layers.length === 0 ? '#475569' : '#1e40af', color: 'white', border: 'none', borderRadius: '6px', cursor: layers.length === 0 ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 600, textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px' }}
          onMouseEnter={e => { if (layers.length > 0) e.currentTarget.style.backgroundColor = '#1e3a8a'; }}
          onMouseLeave={e => { if (layers.length > 0) e.currentTarget.style.backgroundColor = '#1e40af'; }}
        >
          <span style={{ fontSize: '16px' }}>🐍</span><span>导出 PyTorch 代码</span>
        </button>

        <button onClick={handlePreviewKeras} disabled={layers.length === 0}
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

        <button onClick={handleExportLogsTxt} disabled={!metrics || metrics.length === 0}
          style={{ padding: '12px', backgroundColor: !metrics || metrics.length === 0 ? '#475569' : '#d97706', color: 'white', border: 'none', borderRadius: '6px', cursor: !metrics || metrics.length === 0 ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 600, textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px' }}
          onMouseEnter={e => { if (metrics && metrics.length > 0) e.currentTarget.style.backgroundColor = '#b45309'; }}
          onMouseLeave={e => { if (metrics && metrics.length > 0) e.currentTarget.style.backgroundColor = '#d97706'; }}
        >
          <span style={{ fontSize: '16px' }}>📄</span><span>导出训练日志 (.txt)</span>
        </button>

        <button onClick={handleExportChart} disabled={true}
          style={{ padding: '12px', backgroundColor: '#475569', color: '#94a3b8', border: 'none', borderRadius: '6px', cursor: 'not-allowed', fontSize: '13px', fontWeight: 600, textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <span style={{ fontSize: '16px' }}>📈</span><span>导出曲线图（开发中）</span>
        </button>
      </div>

      {/* 代码预览区域 */}
      {previewCode && (
        <div style={{ marginBottom: '12px', marginTop: '12px' }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '6px',
          }}>
            <span style={{ color: '#94a3b8', fontSize: '11px', fontWeight: 600 }}>
              代码预览 ({previewLang === 'python' ? 'PyTorch' : 'Keras'})
            </span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={previewLang === 'python' ? handleSavePyTorch : handleSaveKeras}
                style={{
                  padding: '4px 12px',
                  backgroundColor: '#10b981',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '11px',
                  fontWeight: 600,
                }}
              >
                保存到文件
              </button>
              <button
                onClick={() => { setPreviewCode(null); setPreviewLang(null); }}
                style={{
                  padding: '4px 12px',
                  backgroundColor: '#475569',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '11px',
                }}
              >
                关闭
              </button>
            </div>
          </div>
          <pre style={{
            backgroundColor: '#0f172a',
            border: '1px solid #1a3a5c',
            borderRadius: '6px',
            padding: '10px',
            maxHeight: '300px',
            overflow: 'auto',
            fontSize: '11px',
            fontFamily: 'monospace',
            color: '#e2e8f0',
            lineHeight: '1.5',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            margin: 0,
          }}>
            {previewCode}
          </pre>
        </div>
      )}

      <div style={{ marginTop: '12px', padding: '10px', backgroundColor: '#0f3460', borderRadius: '6px', fontSize: '11px', color: '#94a3b8', lineHeight: '1.5' }}>
        💡 提示：<br />
        • 代码导出需要至少一个层组件<br />
        • 权重导出需要完成一次训练<br />
        • .pth 需配合模型代码：model.load_state_dict(torch.load(...))<br />
        • .pt 可直接加载：model = torch.load(...)<br />
        • .npz 用 NumPy 读取：np.load(...)<br />
        • 如果 .pth 被压缩软件打开，改用 .pt 或 .npz 格式<br />
        • 项目文件格式为 .nbproj（JSON），可保存/加载网络结构
      </div>
    </div>
  );
}
