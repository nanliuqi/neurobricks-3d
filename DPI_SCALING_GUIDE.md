# NeuroBricks 3D - DPI/缩放适配指南

## 📌 问题说明

在不同浏览器或显示设置下，界面比例可能出现不一致的问题。

---

## ✅ 已实施的修复

### 1. **Canvas DPR 配置**

在 [`NeuroScene.tsx`](file://d:\个人项目1\项目代码文件\neurobricks-3d\src\components\scene3d\NeuroScene.tsx) 中添加了设备像素比支持：

```typescript
<Canvas
  camera={{ position: [0, 5, 10], fov: 50 }}
  dpr={[1, 2]} // 支持 1x-2x 设备像素比
  onCreated={({ gl }) => {
    gl.setClearColor('#0a0a1a');
    // 限制最大像素比为 2，避免性能问题
    gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }}
>
```

**效果**:
- ✅ 自动适配高分屏（Retina、4K）
- ✅ 防止过度渲染（限制最大 2x）
- ✅ 保持清晰的 3D 渲染质量

---

## 🔍 常见问题排查

### 问题 1：Edge 浏览器比例异常

**可能原因**:
1. Edge 浏览器缩放不是 100%
2. Windows 系统显示缩放设置影响
3. 浏览器缓存了旧的样式

**解决方案**:

#### 方法 1：重置浏览器缩放
```
快捷键: Ctrl + 0 (数字零)
或菜单: 设置 → 外观 → 页面缩放 → 100%
```

#### 方法 2：检查 Windows 显示设置
```
设置 → 系统 → 显示 → 缩放与布局
推荐: 100% 或 125%（避免使用非整数倍如 110%）
```

#### 方法 3：清除浏览器缓存
```
Ctrl + Shift + Delete → 清除缓存和 Cookie
```

---

### 问题 2：Tauri 应用中的显示问题

**Tauri WebView 特性**:
- Tauri 使用系统 WebView（Windows 上是 Edge Chromium）
- 会自动继承系统的 DPI 设置
- 需要正确处理高 DPI 屏幕

**已优化项**:
```typescript
// Canvas 配置
dpr={[1, 2]}  // 自动适配 1x-2x DPI

// 像素比限制
gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
```

**额外建议**:

如果打包后的应用仍有问题，可以在 `tauri.conf.json` 中添加：

```json
{
  "tauri": {
    "windows": [
      {
        "title": "NeuroBricks 3D",
        "width": 1280,
        "height": 720,
        "resizable": true,
        "fullscreen": false,
        "decorations": true,
        "transparent": false,
        "center": true
      }
    ]
  }
}
```

---

## 🎯 最佳实践

### 1. CSS 单位选择

| 单位类型 | 适用场景 | 示例 |
|---------|---------|------|
| **相对单位** | 布局容器、间距 | `rem`, `em`, `%`, `vw/vh` |
| **固定单位** | 边框、图标大小 | `px` (小尺寸) |
| **视口单位** | 全屏布局 | `vh`, `vw` |

**当前项目**:
```tsx
// ✅ 正确：使用 Tailwind 响应式类
<div className="h-screen w-screen">  // 100vh, 100vw
<div className="w-60">               // 15rem (240px)
<div className="flex-1">             // flex-grow: 1

// ❌ 避免：硬编码像素值
<div style={{ width: '1280px' }}>
```

### 2. Three.js Canvas 配置

```typescript
// ✅ 推荐配置
<Canvas
  dpr={[1, 2]}  // 支持 1x-2x DPI
  camera={{ fov: 50 }}
>

// ❌ 不推荐：固定像素比
<Canvas dpr={1}>  // 高分屏会模糊
<Canvas dpr={3}>  // 性能浪费
```

### 3. 响应式设计检查清单

- [ ] 使用 `h-screen w-screen` 确保全屏
- [ ] 侧边栏使用固定宽度（`w-60`, `w-72`）
- [ ] 主内容区使用 `flex-1` 自适应
- [ ] Canvas 配置 `dpr={[1, 2]}`
- [ ] 测试不同缩放比例（100%, 125%, 150%）
- [ ] 测试不同分辨率（1920x1080, 2560x1440, 3840x2160）

---

## 🧪 测试步骤

### 1. 浏览器测试

```bash
# 启动开发服务器
npm run dev

# 在 Edge 中测试
1. 打开 http://localhost:5173
2. 按 F12 打开开发者工具
3. 切换到 Device Toolbar (Ctrl+Shift+M)
4. 测试不同设备和缩放比例
```

### 2. Tauri 应用测试

```bash
# 构建并运行
npm run tauri dev

# 检查点
- [ ] 窗口大小调整时布局正常
- [ ] 3D 场景清晰无模糊
- [ ] UI 元素位置正确
- [ ] 拖拽功能正常工作
```

### 3. 多显示器测试

如果有多个显示器：
- [ ] 主显示器（100% 缩放）
- [ ] 副显示器（125% 缩放）
- [ ] 4K 显示器（150%-200% 缩放）

---

## 📊 常见 DPI 场景

| 场景 | devicePixelRatio | Canvas DPR 设置 | 效果 |
|------|------------------|----------------|------|
| 普通显示器 | 1.0 | 1x | 标准清晰度 |
| Retina/Mac | 2.0 | 2x | 高清渲染 |
| 4K 显示器 | 1.5-2.0 | 1.5x-2x | 超清渲染 |
| 移动端 | 2.0-3.0 | 2x (限制) | 平衡性能 |

---

## ⚠️ 注意事项

### 1. 性能 vs 质量平衡

```typescript
// ✅ 平衡方案：限制最大 2x
gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// ❌ 过度渲染：可能导致卡顿
gl.setPixelRatio(window.devicePixelRatio); // 可能是 3x 或更高
```

### 2. 浏览器兼容性

| 浏览器 | DPI 处理 | 备注 |
|--------|---------|------|
| Chrome/Edge | ✅ 良好 | Chromium 内核一致 |
| Firefox | ✅ 良好 | 可能需要测试 |
| Safari | ✅ 优秀 | Retina 优化好 |
| Tauri WebView | ✅ 良好 | 继承系统设置 |

### 3. 用户自定义缩放

用户可能在浏览器中手动缩放（Ctrl +/-），这会影响布局：

**检测当前缩放**:
```javascript
console.log('当前缩放:', window.devicePixelRatio);
console.log('CSS 缩放:', window.outerWidth / window.innerWidth);
```

**建议**:
- 在应用中提示用户："建议使用 100% 缩放获得最佳体验"
- 或在 UI 中添加缩放重置按钮

---

## 🔧 调试技巧

### 1. 检查 Canvas 实际渲染尺寸

```javascript
// 在浏览器控制台执行
const canvas = document.querySelector('canvas');
console.log('Canvas 尺寸:', {
  clientWidth: canvas.clientWidth,
  clientHeight: canvas.clientHeight,
  renderWidth: canvas.width,   // 实际渲染宽度（考虑 DPR）
  renderHeight: canvas.height,  // 实际渲染高度
  pixelRatio: window.devicePixelRatio
});
```

### 2. 验证 Tailwind 类生效

```javascript
// 检查元素实际样式
const element = document.querySelector('.h-screen');
const styles = window.getComputedStyle(element);
console.log('高度:', styles.height);  // 应该是视口高度
```

### 3. 监控窗口大小变化

```typescript
useEffect(() => {
  const handleResize = () => {
    console.log('窗口尺寸:', {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio
    });
  };
  
  window.addEventListener('resize', handleResize);
  return () => window.removeEventListener('resize', handleResize);
}, []);
```

---

## 📝 总结

### ✅ 已完成
1. Canvas 添加 `dpr={[1, 2]}` 配置
2. 限制最大像素比为 2
3. 使用响应式 Tailwind 类

### 🎯 对最终应用的影响
- **正面影响**: 
  - ✅ 高分屏显示更清晰
  - ✅ 自动适配不同显示器
  - ✅ Tauri 应用中表现一致
  
- **需要注意**:
  - ⚠️ 用户浏览器缩放会影响布局
  - ⚠️ 建议在应用启动时检测并提示

### 💡 建议
1. **开发阶段**: 在多种缩放比例下测试
2. **发布前**: 在目标平台上全面测试
3. **用户文档**: 添加"最佳显示设置"说明

---

最后更新：2026-06-05
