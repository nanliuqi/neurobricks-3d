# NeuroBricks 3D - 场景控制按钮优化说明

## 📌 优化内容

### ✨ 新增功能特性

#### 1. **固定视角按钮状态指示** 🔒

**优化前**:
- 按钮始终显示灰色，无法直观判断是否已锁定

**优化后**:
- ✅ **未锁定状态**: 灰色半透明背景 (`bg-gray-900/70`) + "固定视角"文本 + 解锁图标
- ✅ **已锁定状态**: 蓝色高亮背景 (`bg-blue-500/80`) + "已锁定"文本 + 锁定图标
- ✅ **视觉反馈**: 点击后立即变色，清晰指示当前状态

**代码实现**:
```typescript
const [isFixedView, setIsFixedView] = useState(false);

<button
  onClick={() => {
    setIsFixedView(!isFixedView);
    window.dispatchEvent(new CustomEvent('toggle-fixed-view'));
  }}
  className={`... ${
    isFixedView
      ? 'bg-blue-500/80 border-blue-400 text-white'  // 已锁定
      : 'bg-gray-900/70 border-gray-700 text-gray-200' // 未锁定
  }`}
>
  {isFixedView ? <LockIcon /> : <UnlockIcon />}
  <span>{isFixedView ? '已锁定' : '固定视角'}</span>
</button>
```

---

#### 2. **一键复位功能增强** 🔄

**优化前**:
- 仅复位相机位置

**优化后**:
- ✅ **同时复位相机和积木**
  - 相机: 回到默认位置 `[0, 5, 10]`，看向原点
  - 积木: 清空后按原始顺序重新添加到默认位置 `[0, 0, 0]`, `[0, 0.7, 0]`, `[0, 1.4, 0]`...
- ✅ **防止积木丢失**: 解决积木被拖拽到场景外无法选中的问题
- ✅ **保持顺序**: 复位后积木的层级顺序不变

**使用场景**:
- 积木被意外拖拽到视野外
- 场景混乱需要快速整理
- 开始新建模前清理场景

**代码实现**:

**MainLayout.tsx** - 触发复位事件:
```typescript
<button
  onClick={() => {
    // 复位相机
    window.dispatchEvent(new CustomEvent('reset-view'));
    // 复位所有积木
    window.dispatchEvent(new CustomEvent('reset-layers'));
  }}
>
  🔄 复位
</button>
```

**NeuroScene.tsx** - 监听并执行复位:
```typescript
const handleResetLayers = () => {
  const store = useLayerStore.getState();
  const currentLayers = [...store.layers];
  
  if (currentLayers.length === 0) {
    console.log('ℹ️ 没有积木需要复位');
    return;
  }

  // 清空所有图层
  store.clearLayers();
  
  // 按原始顺序重新添加，位置从 [0, 0, 0] 开始递增
  currentLayers.forEach((layer, index) => {
    store.addLayer(layer.type, [0, index * BLOCK_STEP, 0]);
  });
  
  console.log(`✅ 已复位 ${currentLayers.length} 个积木到默认位置`);
};

window.addEventListener('reset-layers', handleResetLayers);
```

---

### 🎨 UI 设计更新

#### 按钮布局
```
┌─────────────────────────────────┐
│ [🔒 已锁定] [🔄 复位]          │ ← 左上角悬浮
│                                 │
│         3D 场景内容              │
│                                 │
└─────────────────────────────────┘
```

#### 颜色方案

| 按钮 | 状态 | 背景色 | 边框色 | 文字色 | 图标 |
|------|------|--------|--------|--------|------|
| 固定视角 | 未锁定 | `gray-900/70` | `gray-700` | `gray-200` | 🔓 |
| 固定视角 | 已锁定 | `blue-500/80` | `blue-400` | `white` | 🔒 |
| 复位 | 默认 | `gray-900/70` | `gray-700` | `gray-200` | 🔄 |

#### 交互效果
- **悬停**: 背景变亮 (`hover:bg-gray-800/70`)
- **点击复位**: 缩放动画 (`active:scale-95`)
- **状态切换**: 平滑过渡 (`transition-all duration-200`)

---

### 🔧 技术实现细节

#### 1. 状态管理
```typescript
// MainLayout 中管理固定视角状态
const [isFixedView, setIsFixedView] = useState(false);

// 点击时同步更新本地状态和触发 3D 场景事件
onClick={() => {
  setIsFixedView(!isFixedView);
  window.dispatchEvent(new CustomEvent('toggle-fixed-view'));
}}
```

#### 2. 事件通信架构
```
MainLayout (UI层)
    ↓ dispatchEvent('reset-layers')
NeuroScene (3D层)
    ↓ handleResetLayers()
useLayerStore (状态层)
    ↓ clearLayers() + addLayer()
UI 自动更新
```

#### 3. 积木复位逻辑
```typescript
// 1. 保存当前积木列表（保持类型和顺序）
const currentLayers = [...store.layers];

// 2. 清空所有积木
store.clearLayers();

// 3. 按原始顺序重新添加到默认位置
currentLayers.forEach((layer, index) => {
  store.addLayer(layer.type, [0, index * BLOCK_STEP, 0]);
});
```

**关键点**:
- 使用 `BLOCK_STEP = 0.7` 确保积木间距一致
- 保持原始顺序（通过数组遍历顺序）
- 自动触发形状重新计算（Store 内部机制）

---

### 📊 功能对比

| 功能 | 优化前 | 优化后 |
|------|--------|--------|
| 固定视角状态提示 | ❌ 无视觉反馈 | ✅ 蓝色高亮 + 图标切换 |
| 复位范围 | ❌ 仅相机 | ✅ 相机 + 积木 |
| 积木丢失恢复 | ❌ 需手动删除重建 | ✅ 一键复位 |
| 复位后顺序 | N/A | ✅ 保持原始顺序 |
| 控制台日志 | ⚠️ 简单提示 | ✅ 详细反馈 |

---

### 🧪 测试要点

#### 功能测试
- [ ] 点击"固定视角"按钮后变为蓝色，显示"已锁定"
- [ ] 再次点击后恢复灰色，显示"固定视角"
- [ ] 已锁定状态下无法旋转/缩放/平移相机
- [ ] 点击"复位"后相机回到 `[0, 5, 10]`
- [ ] 点击"复位"后所有积木排列在 Y 轴上，间距 0.7
- [ ] 积木类型和顺序与复位前一致

#### UI 测试
- [ ] 按钮位于左上角，不遮挡主要内容
- [ ] 状态切换动画流畅（200ms）
- [ ] 悬停效果正常
- [ ] 复位按钮点击有缩放反馈

#### 边界情况
- [ ] 空场景点击复位不会报错
- [ ] 大量积木（50+）复位性能良好
- [ ] 复位过程中拖拽操作不会冲突
- [ ] 快速连续点击不会导致状态不同步

---

### 💡 用户体验提升

#### 问题解决
1. **视角迷失**: 蓝色高亮明确指示锁定状态
2. **积木丢失**: 一键复位找回所有积木
3. **场景混乱**: 快速恢复到初始整洁状态

#### 操作简化
- **之前**: 需要逐个删除积木 → 重新拖拽添加
- **现在**: 点击一次"复位"按钮即可

#### 视觉反馈
- 状态变化立即响应
- 控制台输出详细日志
- 图标语义清晰（锁/解锁）

---

### ⚠️ 注意事项

1. **性能影响**: 
   - 复位操作会触发多次 Store 更新
   - 大规模模型（100+ 积木）可能有短暂卡顿
   - 建议限制单次复位积木数量

2. **状态同步**:
   - MainLayout 的 `isFixedView` 状态独立于 NeuroScene
   - 刷新页面后状态重置为未锁定

3. **与其他功能交互**:
   - 复位不会影响参数面板的选中状态
   - 复位后会自动取消选中（`setSelectedId(null)`）
   - 训练进度条不受影响

---

### 📝 代码统计

| 指标 | 数值 |
|------|------|
| 修改文件 | 2 个 (MainLayout.tsx, NeuroScene.tsx) |
| 新增代码行数 | ~60 行 |
| 修改代码行数 | ~40 行 |
| 新增状态变量 | 1 个 (`isFixedView`) |
| 新增事件监听器 | 1 个 (`reset-layers`) |

---

### 🔗 相关文件

- **主布局**: [`MainLayout.tsx`](file://d:\个人项目1\项目代码文件\neurobricks-3d\src\components\layout\MainLayout.tsx)
- **3D场景**: [`NeuroScene.tsx`](file://d:\个人项目1\项目代码文件\neurobricks-3d\src\components\scene3d\NeuroScene.tsx)
- **图层Store**: [`useLayerStore.ts`](file://d:\个人项目1\项目代码文件\neurobricks-3d\src\stores\useLayerStore.ts)
- **常量定义**: [`layer.ts`](file://d:\个人项目1\项目代码文件\neurobricks-3d\src\types\layer.ts) (BLOCK_STEP)

---

最后更新：2026-06-05
