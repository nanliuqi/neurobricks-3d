import { useEffect, useState } from 'react';
import { useGPUStore } from '@/stores/useGPUStore';
import type { GPUInfo } from '@/types/gpu';

// Tauri API 动态导入（不使用 isTauri 守卫，直接 try/catch）

/** GPU 分类 */
type GPUCategory = 'discrete' | 'integrated' | 'unknown';

/** 通过 WebGL 获取 GPU 渲染器信息 */
function detectWebGLGPU(): { renderer: string; vendor: string } | null {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return null;

    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (!debugInfo) {
      return {
        renderer: gl.getParameter(gl.RENDERER),
        vendor: gl.getParameter(gl.VENDOR),
      };
    }

    return {
      renderer: gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL),
      vendor: gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL),
    };
  } catch {
    return null;
  }
}

/** 判断 GPU 是独显还是核显 */
function classifyGPU(renderer: string): GPUCategory {
  const lower = renderer.toLowerCase();

  // 独立显卡
  if (lower.includes('geforce') || lower.includes('rtx') || lower.includes('gtx') || lower.includes('quadro') || lower.includes('tesla')) return 'discrete';
  if (lower.includes('radeon rx') || lower.includes('radeon pro') || lower.includes('radeon rx') || lower.match(/radeon.?\s*vii/i) || lower.match(/radeon.?\s*\d{4}\s/)) return 'discrete';

  // 集成显卡
  if (lower.includes('intel') && (lower.includes('uhd') || lower.includes('iris') || lower.includes('hd graphics') || lower.includes('xe') || lower.includes('graphics '))) return 'integrated';
  if (lower.includes('amd') && (lower.includes('radeon(tm)') || lower.includes('radeon graphics') || lower.includes('radeon vega') || lower.match(/radeon.?\s*\d{1,2}i/))) return 'integrated';
  if (lower.includes('apple m') && lower.includes('gpu')) return 'integrated';

  // NVIDIA 的一般也是独显
  if (lower.includes('nvidia') && !lower.includes(' tegra')) return 'discrete';

  return 'unknown';
}

/** 获取平台/架构信息 */
function detectPlatform(): { os: string; arch: string } {
  const ua = navigator.userAgent;
  let os = '未知';
  let arch = '';

  if (ua.includes('Windows')) {
    os = 'Windows';
    if (ua.includes('Win64') || ua.includes('x64') || ua.includes('WOW64')) arch = 'x64';
    else if (ua.includes('ARM')) arch = 'ARM64';
    else arch = 'x86';
  } else if (ua.includes('Mac OS X')) {
    os = 'macOS';
    if (ua.includes('ARM') || (ua.includes('Mac OS X') && !ua.includes('Intel'))) arch = 'Apple Silicon';
    else arch = 'Intel';
  } else if (ua.includes('Linux')) {
    os = 'Linux';
    arch = ua.includes('x86_64') || ua.includes('x64') ? 'x64' : ua.includes('aarch64') ? 'ARM64' : '';
  }

  return { os, arch };
}

/** 获取 CPU 核心数 */
function detectCPUCores(): number {
  return navigator.hardwareConcurrency || 0;
}

/** 获取设备内存（GB）*/
function detectDeviceMemory(): number | null {
  try {
    return (navigator as any).deviceMemory ?? null;
  } catch {
    return null;
  }
}

/** 浏览器环境检测：用 WebGL + Web APIs 获取设备信息 */
function detectBrowserDevices(): GPUInfo[] {
  const devices: GPUInfo[] = [];
  const gpuInfo = detectWebGLGPU();
  const platform = detectPlatform();
  const cores = detectCPUCores();
  const memGB = detectDeviceMemory();

  // GPU 设备
  if (gpuInfo && gpuInfo.renderer && !gpuInfo.renderer.includes('SwiftShader') && !gpuInfo.renderer.includes('llvmpipe')) {
    const category = classifyGPU(gpuInfo.renderer);
    const isNVIDIA = gpuInfo.renderer.toLowerCase().includes('nvidia') || gpuInfo.renderer.toLowerCase().includes('geforce');
    const isIntegrated = category === 'integrated';

    devices.push({
      available: true,
      deviceName: gpuInfo.renderer,
      vramTotal: isIntegrated && memGB ? memGB * 1024 : 0, // 核显共享内存
      vramUsed: 0,
      cudaVersion: isNVIDIA ? '需Tauri后端检测' : '',
      isIntegrated,
      category,
    });
  }

  // CPU 设备
  const coreLabel = cores > 0 ? `${cores}核` : '';
  const archLabel = platform.arch;
  const memLabel = memGB ? `${memGB}GB` : '';
  const cpuParts = [coreLabel, archLabel, memLabel].filter(Boolean);
  const cpuLabel = `CPU · ${cpuParts.join(' · ')}`;

  devices.push({
    available: true,
    deviceName: cpuLabel,
    vramTotal: memGB ? memGB * 1024 : 0,
    vramUsed: 0,
    cudaVersion: '',
    isIntegrated: false,
    category: 'cpu' as any,
  });

  return devices;
}

export default function GPUPanel() {
  const devices = useGPUStore(state => state.devices);
  const selectedDevice = useGPUStore(state => state.selectedDevice);
  const selectDevice = useGPUStore(state => state.selectDevice);
  const setDevices = useGPUStore(state => state.setDevices);

  const [detecting, setDetecting] = useState(true);

  // 检测设备函数（可复用）
  const handleDetect = async () => {
    setDetecting(true);

    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      const deviceList = await invoke<GPUInfo[]>('detect_devices');
      setDevices(deviceList);

      if (deviceList.length > 0) {
        const gpuDevice = deviceList.find(d => d.available && !d.deviceName.includes('CPU'));
        const defaultDevice = gpuDevice || deviceList[0];
        selectDevice(defaultDevice.deviceName);
      }
    } catch (error) {
      console.error('Failed to detect devices via Tauri:', error);
      // 退回浏览器检测
      const browserDevices = detectBrowserDevices();
      setDevices(browserDevices);
      if (browserDevices.length > 0) selectDevice(browserDevices[0].deviceName);
    }

    setDetecting(false);
  };

  useEffect(() => {
    handleDetect();
  }, [setDevices, selectDevice]);

  const formatVRAM = (vramMB: number): string => {
    if (vramMB === 0) return 'N/A';
    if (vramMB >= 1024) return `${(vramMB / 1024).toFixed(1)} GB`;
    return `${vramMB} MB`;
  };

  const getDeviceType = (device: GPUInfo): 'CUDA' | 'MPS' | 'iGPU' | 'dGPU' | 'CPU' => {
    if (device.category === 'cpu' || device.deviceName.startsWith('CPU')) return 'CPU';
    const lower = device.deviceName.toLowerCase();
    if (lower.includes('nvidia') || lower.includes('geforce') || lower.includes('rtx') || lower.includes('gtx') || lower.includes('quadro')) return 'CUDA';
    if (lower.includes('apple') || lower.includes('metal') || lower.includes('mps')) return 'MPS';
    if (device.isIntegrated || device.category === 'integrated') return 'iGPU';
    return 'dGPU';
  };

  const getDeviceIcon = (type: string): string => {
    switch (type) {
      case 'CUDA': return '🟢';
      case 'MPS': return '🔵';
      case 'dGPU': return '🟡';
      case 'iGPU': return '🟠';
      case 'CPU': return '⚪';
      default: return '⚫';
    }
  };

  const getTypeLabel = (type: string): string => {
    switch (type) {
      case 'CUDA': return 'NVIDIA 独显';
      case 'MPS': return 'Apple GPU';
      case 'dGPU': return '独立显卡';
      case 'iGPU': return '核显·共享内存';
      case 'CPU': return '处理器';
      default: return '未知';
    }
  };

  return (
    <div style={{ padding: '12px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          color: 'white',
          fontSize: '14px',
          fontWeight: 600,
          marginBottom: '16px',
          paddingBottom: '8px',
          borderBottom: '1px solid #0f3460',
        }}
      >
        设备选择
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {detecting ? (
          <div style={{ color: '#94a3b8', fontSize: '12px', textAlign: 'center', padding: '20px' }}>
            🔍 正在检测设备...
          </div>
        ) : devices.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: '12px', textAlign: 'center', padding: '20px' }}>
            未检测到设备
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {devices.map(device => {
              const deviceType = getDeviceType(device);
              const isSelected = device.deviceName === selectedDevice;

              return (
                <div
                  key={device.deviceName}
                  onClick={() => selectDevice(device.deviceName)}
                  style={{
                    padding: '12px',
                    backgroundColor: isSelected ? '#1e40af' : '#0f3460',
                    border: isSelected ? '2px solid #3b82f6' : '1px solid #1a3a5c',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.backgroundColor = '#1a3a5c';
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.backgroundColor = '#0f3460';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '16px' }}>{getDeviceIcon(deviceType)}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: 'white', fontSize: '13px', fontWeight: 600 }}>
                        {device.deviceName}
                      </div>
                      <div style={{ color: '#94a3b8', fontSize: '11px' }}>
                        {getTypeLabel(deviceType)}{device.cudaVersion ? ` · CUDA ${device.cudaVersion}` : ''}
                      </div>
                    </div>
                    {isSelected && (
                      <div
                        style={{
                          backgroundColor: '#10b981',
                          color: 'white',
                          fontSize: '10px',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontWeight: 600,
                        }}
                      >
                        已选中
                      </div>
                    )}
                  </div>

                  {/* 核显共享内存提示 */}
                  {device.isIntegrated && (
                    <div style={{
                      marginBottom: '8px',
                      padding: '6px 8px',
                      backgroundColor: 'rgba(245, 158, 11, 0.15)',
                      border: '1px solid rgba(245, 158, 11, 0.3)',
                      borderRadius: '4px',
                      fontSize: '11px',
                      color: '#f59e0b',
                    }}>
                      ⚠️ 核显与CPU共享系统内存，性能低于独显
                    </div>
                  )}

                  {device.vramTotal > 0 && (
                    <div style={{ marginTop: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px' }}>
                        <span style={{ color: '#94a3b8' }}>
                          {device.category === 'cpu' ? '系统内存' : device.isIntegrated ? '共享内存' : '显存总量'}
                        </span>
                        <span style={{ color: 'white' }}>{formatVRAM(device.vramTotal)}</span>
                      </div>
                      {!device.isIntegrated && device.category !== 'cpu' && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                          <span style={{ color: '#94a3b8' }}>显存使用</span>
                          <span style={{ color: 'white' }}>{formatVRAM(device.vramUsed)}</span>
                        </div>
                      )}

                      <div
                        style={{
                          marginTop: '6px',
                          height: '4px',
                          backgroundColor: '#1a3a5c',
                          borderRadius: '2px',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${Math.min((device.vramUsed / device.vramTotal) * 100, 100)}%`,
                            height: '100%',
                            backgroundColor: device.vramUsed / device.vramTotal > 0.8 ? '#ef4444' : '#10b981',
                            transition: 'width 0.3s ease',
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div
        style={{
          marginTop: '12px',
          padding: '8px',
          backgroundColor: '#0f3460',
          borderRadius: '4px',
          fontSize: '11px',
          color: '#94a3b8',
        }}
      >
        💡 优先选择 GPU 设备以获得更快的训练速度
      </div>

      {/* 重新检测按钮 */}
      <button
        onClick={handleDetect}
        disabled={detecting}
        style={{
          marginTop: '8px',
          width: '100%',
          padding: '8px',
          backgroundColor: detecting ? '#2a4a6c' : '#1a3a5c',
          color: detecting ? '#94a3b8' : 'white',
          border: '1px solid #2a4a6c',
          borderRadius: '4px',
          cursor: detecting ? 'not-allowed' : 'pointer',
          fontSize: '12px',
          fontWeight: 600,
          transition: 'background-color 0.2s',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
        }}
        onMouseEnter={(e) => { if (!detecting) e.currentTarget.style.backgroundColor = '#2a4a6c'; }}
        onMouseLeave={(e) => { if (!detecting) e.currentTarget.style.backgroundColor = '#1a3a5c'; }}
      >
        {detecting && (
          <svg
            style={{
              animation: 'spin 1s linear infinite',
              width: '14px',
              height: '14px',
            }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
        )}
        {detecting ? '检测中...' : '🔄 重新检测'}
      </button>
    </div>
  );
}
