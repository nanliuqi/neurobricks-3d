import { useEffect, useState } from 'react';
import { useCloudStore } from '@/stores/useCloudStore';
import { useLayerStore } from '@/stores/useLayerStore';
import { useDatasetStore } from '@/stores/useDatasetStore';
import { useCloudTraining } from '@/hooks/useCloudTraining';
import { toast } from '@/components/ui/Toast';
import type { TrainConfig, TrainMetric } from '@/types/training';
import type { SSHConfig, SSHAuthType, CloudTaskStatus } from '@/types/cloud';
import { projectLatestTrainingDiagnostics } from '@/utils/trainingMonitorViewModel';

const STATUS_LABELS: Record<CloudTaskStatus, string> = {
  pending: '待上传',
  uploading: '上传中',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  stopped: '已停止',
};

function CloudTaskMetricSummary({ metrics }: { metrics: readonly TrainMetric[] }) {
  if (metrics.length === 0) return null;
  const diagnostics = projectLatestTrainingDiagnostics(metrics);
  if (!diagnostics.loss && !diagnostics.metric) {
    return (
      <div className="cloud-task-metrics cloud-task-metrics--warning" role="status">
        指标记录缺少明确作用域或有限数值，未猜测 Loss / Accuracy。
      </div>
    );
  }

  return (
    <div className="cloud-task-metrics" aria-label="云端任务诊断指标">
      {[diagnostics.loss, diagnostics.metric].filter((item): item is NonNullable<typeof item> => item !== null)
        .map(item => (
          <span key={item.label} className="cloud-task-metrics__item">
            {item.context} epoch {item.epoch} {item.label}：
            <strong>{item.valueText}</strong>
          </span>
        ))}
      {diagnostics.warnings.length > 0 && (
        <span className="cloud-task-metrics__warning" title={diagnostics.warnings.join('\n')}>
          部分记录未进入摘要
        </span>
      )}
    </div>
  );
}

export default function CloudPanel() {
  const servers = useCloudStore(state => state.servers);
  const tasks = useCloudStore(state => state.tasks);
  const addServer = useCloudStore(state => state.addServer);
  const removeServer = useCloudStore(state => state.removeServer);
  const updateServer = useCloudStore(state => state.updateServer);
  const layers = useLayerStore(state => state.layers);
  const datasetInfo = useDatasetStore(state => state.datasetInfo);
  
  // 云端训练 hook
  const { stopTask } = useCloudTraining();

  // 表单状态
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedServerId, setSelectedServerId] = useState('');
  const [epochs, setEpochs] = useState(10);
  const [batchSize, setBatchSize] = useState(32);
  const [learningRate, setLearningRate] = useState(0.001);
  const [sessionSecret, setSessionSecret] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    host: '',
    port: 22,
    username: '',
    authType: 'password' as SSHAuthType,
    password: '',
    privateKeyPath: '',
  });

  useEffect(() => {
    setSessionSecret('');
  }, [selectedServerId]);

  // 添加服务器
  const handleAddServer = () => {
    if (!formData.name || !formData.host || !formData.username) {
      toast.warning('请填写必填字段（名称、主机地址、用户名）');
      return;
    }
    if (formData.authType === 'password' && !formData.password) {
      toast.warning('请输入密码');
      return;
    }
    if (formData.authType === 'private_key' && !formData.privateKeyPath) {
      toast.warning('请输入私钥路径');
      return;
    }

    const config: SSHConfig = {
      id: crypto.randomUUID(),
      name: formData.name,
      host: formData.host,
      port: formData.port,
      username: formData.username,
      authType: formData.authType,
      password: formData.authType === 'password' ? formData.password : undefined,
      privateKeyPath: formData.authType === 'private_key' ? formData.privateKeyPath : undefined,
      remoteWorkDir: '/tmp/neurobricks',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    addServer(config);
    setShowAddForm(false);
    setFormData({
      name: '',
      host: '',
      port: 22,
      username: '',
      authType: 'password',
      password: '',
      privateKeyPath: '',
    });
  };

  // 测试连接
  const handleTestConnection = async (config: SSHConfig) => {
    if (config.authType === 'password' && !config.password) {
      setSelectedServerId(config.id);
      toast.warning('该服务器的密码未持久化，请先输入本次会话凭据');
      return;
    }
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      await invoke('test_ssh_connection', { config });
      toast.success(`连接到 ${config.name} 成功！`);
    } catch (error) {
      console.error('Connection test failed:', error);
      toast.error(`连接失败：${(error as Error).message}`);
    }
  };

  // 提交云端训练
  const handleSubmitTraining = async () => {
    if (layers.length === 0) {
      toast.warning('请先添加网络层');
      return;
    }
    if (!datasetInfo) {
      toast.warning('请先在数据集面板中选择数据集');
      return;
    }
    const trainConfig: TrainConfig = {
      epochs,
      learningRate,
      batchSize,
      dataset: datasetInfo.type,
      device: 'cuda',
      layers: layers.map(layer => ({
        type: layer.type,
        params: layer.params,
      })),
    };

    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      
      // 获取选中的服务器配置
      const selectedServer = servers.find(s => s.id === selectedServerId);
      if (!selectedServer) {
        toast.warning('请选择服务器');
        return;
      }
      if (selectedServer.authType === 'password' && !selectedServer.password) {
        toast.warning('请输入并应用本次会话密码后再提交训练');
        return;
      }

      await invoke('submit_cloud_training', { 
        serverConfig: selectedServer, 
        trainConfig 
      });
      toast.success('训练任务已提交到云端');
    } catch (error) {
      console.error('Failed to submit cloud training:', error);
      toast.error('提交失败：' + (error as Error).message);
    }
  };

  // 获取当前选中服务器的任务
  const currentTasks = tasks.filter(t => t.serverId === selectedServerId);
  const selectedServer = servers.find(s => s.id === selectedServerId);

  const handleApplySessionSecret = () => {
    if (!selectedServer) return;
    if (selectedServer.authType === 'password' && sessionSecret.trim() === '') {
      toast.warning('本次会话密码不能为空');
      return;
    }

    updateServer(selectedServer.id, {
      password: selectedServer.authType === 'password' ? sessionSecret : undefined,
      passphrase: selectedServer.authType === 'private_key' && sessionSecret !== ''
        ? sessionSecret
        : undefined,
      updatedAt: Date.now(),
    });
    setSessionSecret('');
    toast.success('凭据已应用到本次会话，关闭应用后不会保留');
  };

  return (
    <div style={{ padding: '12px', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
      {/* 面板标题 */}
      <div style={{
        color: 'white',
        fontSize: '14px',
        fontWeight: 600,
        marginBottom: '12px',
        paddingBottom: '8px',
        borderBottom: '1px solid #0f3460',
      }}>
        \u2601\ufe0f 云端训练
      </div>

      {/* ===== 服务器区域 ===== */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ color: '#94a3b8', fontSize: '12px', fontWeight: 600 }}>服务器</span>
          <button
            type="button"
            onClick={() => setShowAddForm(!showAddForm)}
            style={{
              padding: '4px 10px',
              backgroundColor: showAddForm ? '#475569' : '#1e40af',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: 600,
            }}
          >
            {showAddForm ? '取消' : '+ 添加'}
          </button>
        </div>

        {/* 添加服务器表单 */}
        {showAddForm && (
          <div style={{
            backgroundColor: '#0f3460',
            padding: '12px',
            borderRadius: '6px',
            marginBottom: '8px',
          }}>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <div style={{ flex: 1 }}>
                <label htmlFor="cloud-server-name" style={{ display: 'block', color: '#94a3b8', fontSize: '10px', marginBottom: '2px' }}>名称 *</label>
                <input id="cloud-server-name" type="text" value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  placeholder="我的GPU服务器"
                  style={{ width: '100%', padding: '6px', backgroundColor: '#1a3a5c', border: '1px solid #2a4a6c', borderRadius: '4px', color: 'white', fontSize: '11px' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label htmlFor="cloud-server-username" style={{ display: 'block', color: '#94a3b8', fontSize: '10px', marginBottom: '2px' }}>用户名 *</label>
                <input id="cloud-server-username" type="text" value={formData.username}
                  onChange={e => setFormData({ ...formData, username: e.target.value })}
                  placeholder="root"
                  style={{ width: '100%', padding: '6px', backgroundColor: '#1a3a5c', border: '1px solid #2a4a6c', borderRadius: '4px', color: 'white', fontSize: '11px' }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <div style={{ flex: 2 }}>
                <label htmlFor="cloud-server-host" style={{ display: 'block', color: '#94a3b8', fontSize: '10px', marginBottom: '2px' }}>主机地址 *</label>
                <input id="cloud-server-host" type="text" value={formData.host}
                  onChange={e => setFormData({ ...formData, host: e.target.value })}
                  placeholder="192.168.1.100"
                  style={{ width: '100%', padding: '6px', backgroundColor: '#1a3a5c', border: '1px solid #2a4a6c', borderRadius: '4px', color: 'white', fontSize: '11px' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label htmlFor="cloud-server-port" style={{ display: 'block', color: '#94a3b8', fontSize: '10px', marginBottom: '2px' }}>端口</label>
                <input id="cloud-server-port" type="number" value={formData.port}
                  onChange={e => setFormData({ ...formData, port: Number(e.target.value) })}
                  min={1} max={65535}
                  style={{ width: '100%', padding: '6px', backgroundColor: '#1a3a5c', border: '1px solid #2a4a6c', borderRadius: '4px', color: 'white', fontSize: '11px' }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <div style={{ flex: 1 }}>
                <label htmlFor="cloud-server-auth" style={{ display: 'block', color: '#94a3b8', fontSize: '10px', marginBottom: '2px' }}>认证方式</label>
                <select id="cloud-server-auth" value={formData.authType}
                  onChange={e => setFormData({ ...formData, authType: e.target.value as SSHAuthType })}
                  style={{ width: '100%', padding: '6px', backgroundColor: '#1a3a5c', border: '1px solid #2a4a6c', borderRadius: '4px', color: 'white', fontSize: '11px' }}
                >
                  <option value="password">密码</option>
                  <option value="private_key">私钥</option>
                </select>
              </div>
              <div style={{ flex: 2 }}>
                <label htmlFor="cloud-server-credential" style={{ display: 'block', color: '#94a3b8', fontSize: '10px', marginBottom: '2px' }}>
                  {formData.authType === 'password' ? '密码' : '私钥路径'}
                </label>
                <input
                  id="cloud-server-credential"
                  type={formData.authType === 'password' ? 'password' : 'text'}
                  value={formData.authType === 'password' ? formData.password : formData.privateKeyPath}
                  onChange={e => formData.authType === 'password'
                    ? setFormData({ ...formData, password: e.target.value })
                    : setFormData({ ...formData, privateKeyPath: e.target.value })
                  }
                  placeholder={formData.authType === 'password' ? '输入密码' : '~/.ssh/id_rsa'}
                  style={{ width: '100%', padding: '6px', backgroundColor: '#1a3a5c', border: '1px solid #2a4a6c', borderRadius: '4px', color: 'white', fontSize: '11px' }}
                />
              </div>
            </div>
            <button type="button" onClick={handleAddServer}
              style={{ width: '100%', padding: '8px', backgroundColor: '#10b981', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
              确认添加
            </button>
          </div>
        )}

        {/* 服务器列表 / 选择 */}
        {servers.length === 0 ? (
          <div style={{
            padding: '16px',
            textAlign: 'center',
            backgroundColor: '#0f3460',
            borderRadius: '6px',
            border: '1px dashed #1a3a5c',
          }}>
            <div style={{ color: '#64748b', fontSize: '12px', marginBottom: '8px' }}>
              \u26a0\ufe0f 未添加云服务器
            </div>
            <div style={{ color: '#94a3b8', fontSize: '11px' }}>
              点击上方"+ 添加"按钮配置远程GPU服务器
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {servers.map(server => (
              <div key={server.id}
                style={{
                  padding: '10px',
                  backgroundColor: server.id === selectedServerId ? '#1e40af' : '#0f3460',
                  border: server.id === selectedServerId ? '2px solid #3b82f6' : '1px solid #1a3a5c',
                  borderRadius: '6px',
                  transition: 'all 0.2s ease',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button
                    type="button"
                    className="cloud-server-select"
                    aria-pressed={server.id === selectedServerId}
                    aria-label={`${server.id === selectedServerId ? '取消选择' : '选择'}服务器 ${server.name}`}
                    onClick={() => setSelectedServerId(server.id === selectedServerId ? '' : server.id)}
                  >
                    <span className="cloud-server-select__name">
                      {server.name}
                      {server.id === selectedServerId && (
                        <span style={{ marginLeft: '6px', padding: '1px 6px', backgroundColor: '#10b981', borderRadius: '3px', fontSize: '9px', fontWeight: 600, color: 'white' }}>已选中</span>
                      )}
                    </span>
                    <span className="cloud-server-select__meta">
                      {server.host}:{server.port} \u00b7 {server.username}
                    </span>
                  </button>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button type="button" onClick={() => void handleTestConnection(server)}
                      style={{ padding: '4px 8px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '10px' }}>
                      测试
                    </button>
                    <button type="button" onClick={() => { removeServer(server.id); if (selectedServerId === server.id) setSelectedServerId(''); }}
                      style={{ padding: '4px 8px', backgroundColor: '#ef4444', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '10px' }}>
                      删除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===== 训练配置区域（选中服务器后显示）===== */}
      {selectedServer && (
        <div style={{
          borderTop: '1px solid #0f3460',
          paddingTop: '12px',
          marginBottom: '12px',
        }}>
          <div style={{ color: '#94a3b8', fontSize: '12px', fontWeight: 600, marginBottom: '8px' }}>
            训练参数 \u00b7 {selectedServer.name}
          </div>

          <div className="cloud-session-credential" role="group" aria-label="本次会话 SSH 凭据">
            <label htmlFor="cloud-session-secret">
              {selectedServer.authType === 'password' ? '本次会话密码' : '本次会话私钥口令（可选）'}
            </label>
            <div className="cloud-session-credential__controls">
              <input
                id="cloud-session-secret"
                type="password"
                autoComplete="off"
                value={sessionSecret}
                onChange={event => setSessionSecret(event.target.value)}
                placeholder={selectedServer.authType === 'password'
                  ? (selectedServer.password ? '已设置，可重新输入替换' : '重启应用后需重新输入')
                  : (selectedServer.passphrase ? '已设置，可重新输入替换' : '未加密私钥可留空')}
              />
              <button type="button" onClick={handleApplySessionSecret}>应用</button>
            </div>
            <span>密码和私钥口令只保留在当前进程内，不写入本地配置、实验档案或导出物。</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <div style={{ flex: 1 }}>
                <label htmlFor="cloud-train-epochs" style={{ color: '#94a3b8', fontSize: '10px', marginBottom: '2px', display: 'block' }}>Epochs</label>
                <input id="cloud-train-epochs" type="number" value={epochs} onChange={e => setEpochs(Number(e.target.value))} min={1} max={100}
                  style={{ width: '100%', padding: '6px', backgroundColor: '#0f3460', border: '1px solid #1a3a5c', borderRadius: '4px', color: 'white', fontSize: '11px' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label htmlFor="cloud-train-batch" style={{ color: '#94a3b8', fontSize: '10px', marginBottom: '2px', display: 'block' }}>Batch Size</label>
                <input id="cloud-train-batch" type="number" value={batchSize} onChange={e => setBatchSize(Number(e.target.value))} min={1} max={512}
                  style={{ width: '100%', padding: '6px', backgroundColor: '#0f3460', border: '1px solid #1a3a5c', borderRadius: '4px', color: 'white', fontSize: '11px' }}
                />
              </div>
            </div>
            <div>
              <label htmlFor="cloud-train-lr" style={{ color: '#94a3b8', fontSize: '10px', marginBottom: '2px', display: 'block' }}>Learning Rate</label>
              <input id="cloud-train-lr" type="number" value={learningRate} onChange={e => setLearningRate(Number(e.target.value))} step={0.0001} min={0.0001} max={0.1}
                style={{ width: '100%', padding: '6px', backgroundColor: '#0f3460', border: '1px solid #1a3a5c', borderRadius: '4px', color: 'white', fontSize: '11px' }}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={handleSubmitTraining}
            disabled={layers.length === 0 || !datasetInfo}
            style={{
              width: '100%',
              padding: '10px',
              backgroundColor: layers.length === 0 || !datasetInfo ? '#475569' : '#8b5cf6',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: layers.length === 0 || !datasetInfo ? 'not-allowed' : 'pointer',
              fontSize: '13px',
              fontWeight: 600,
              transition: 'background-color 0.2s',
            }}
          >
            \ud83d\ude80 提交训练
          </button>
          {(!datasetInfo || layers.length === 0) && (
            <div style={{ color: '#64748b', fontSize: '10px', textAlign: 'center', marginTop: '4px' }}>
              {!datasetInfo ? '请先选择数据集' : '请先添加网络层'}
            </div>
          )}
        </div>
      )}

      {/* ===== 任务监控（选中服务器且有任务时显示）===== */}
      {selectedServer && currentTasks.length > 0 && (
        <div style={{ borderTop: '1px solid #0f3460', paddingTop: '12px' }}>
          <div style={{ color: '#94a3b8', fontSize: '12px', fontWeight: 600, marginBottom: '8px' }}>任务监控</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {currentTasks.map(task => (
              <div key={task.id} style={{ backgroundColor: '#0f3460', borderRadius: '6px', padding: '10px', border: '1px solid #1a3a5c' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ color: 'white', fontSize: '11px', fontWeight: 600 }}>{task.serverName}</span>
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <span style={{
                      padding: '1px 6px', borderRadius: '3px', fontSize: '9px', fontWeight: 600, color: 'white',
                      backgroundColor: task.status === 'running' ? '#1e40af' : task.status === 'completed' ? '#065f46' : task.status === 'failed' ? '#7f1d1d' : '#475569',
                    }}>
                      {STATUS_LABELS[task.status] ?? task.status}
                    </span>
                    {task.status === 'running' && (
                      <button 
                        type="button"
                        onClick={() => stopTask(task.id)}
                        style={{ 
                          padding: '2px 6px', 
                          backgroundColor: '#ef4444', 
                          color: 'white', 
                          border: 'none', 
                          borderRadius: '3px', 
                          cursor: 'pointer', 
                          fontSize: '9px',
                          fontWeight: 600,
                        }}
                      >
                        停止
                      </button>
                    )}
                  </div>
                </div>

                <CloudTaskMetricSummary metrics={task.metrics} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
