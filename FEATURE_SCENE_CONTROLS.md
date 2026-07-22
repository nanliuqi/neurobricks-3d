# NeuroBricks 3D - 新功能说明

## 📌 新增功能：3D 场景控制按钮

### ✨ 功能概述

在 3D 场景左上角添加了悬浮控制按钮组，提供两个核心功能：

1. **固定视角** - 锁定/解锁相机控制（禁止/允许旋转、缩放、平移）
2. **一键复位** - 将相机重置到默认位置和角度

---

### 🎯 功能详情

#### 1. 固定视角按钮 🔒

**位置**: 3D 场景左上角第一个按钮  
**图标**: 锁形图标（锁定/解锁状态切换）  
**功能**:
- **未锁定状态**: 显示"固定视角"，允许自由操作相机
- **已锁定状态**: 显示"已锁定"，禁用所有相机控制（旋转、缩放、平移）

**视觉反馈**:
- 未锁定: 灰色半透明背景 (`bg-gray-900/70`)
- 已锁定: 蓝色高亮背景 (`bg-blue-500/80`)

**使用场景**:
- 查看模型细节时防止误触移动
- 演示时保持固定视角
- 精确对齐积木时避免视角变化

---

#### 2. 一键复位按钮 🔄

**位置**: 3D 场景左上角第二个按钮  
**图标**: 循环箭头图标  
**功能**: 
- 将相机位置重置为初始状态：`position: [0, 5, 10]`
- 恢复相机朝向：看向原点 `[0, 0, 0]`
- 重置 OrbitControls 的所有变换

**视觉反馈**:
- 点击时有缩放动画效果 (`active:scale-95`)
- 悬停时背景变亮

**使用场景**:
- 迷失视角后快速恢复
- 开始新建模前清理视角
- 分享模型时统一视角

---

### 🎨 UI 设计

#### 布局结构
```
┌─────────────────────────────────┐
│ [🔒 固定视角] [🔄 复位]        │ ← 左上角悬浮
│                                 │
│         3D 场景内容              │
│                                 │
│                                 │
└─────────────────────────────────┘
```

#### 样式特性
- **毛玻璃效果**: `backdrop-blur-md` - 半透明模糊背景
- **圆角边框**: `rounded-lg` - 现代化圆角设计
- **阴影效果**: `shadow-lg` - 浮层立体感
- **过渡动画**: `transition-all duration-200` - 平滑状态切换
- **响应式悬停**: hover 状态颜色变化

#### 颜色方案
| 状态 | 背景色 | 边框色 | 文字色 |
|------|--------|--------|--------|
| 固定视角（未锁定） | `gray-900/70` | `gray-700` | `gray-200` |
| 固定视角（已锁定） | `blue-500/80` | `blue-400` | `white` |
| 复位按钮 | `gray-900/70` | `gray-700` | `gray-200` |

---

### 🔧 技术实现

#### 文件结构
```
src/components/scene3d/
├── NeuroScene.tsx          # 主场景组件（已更新）
├── SceneControls.tsx       # 新增：控制按钮组件
├── GridFloor.tsx           # 网格地面
├── Layer3DBlock.tsx        # 3D 积木
├── ConnectionLine.tsx      # 连接线
├── ShapeTooltip.tsx        # 形状提示
├── GhostPreview.tsx        # 幽灵预览
└── SceneStats.tsx          # 场景统计
```

#### 核心代码逻辑

**NeuroScene.tsx 修改**:
```typescript
// 1. 添加控制器引用
const controlsRef = useRef<any>(null);

// 2. 固定视角功能
const handleToggleFixedView = () => {
  if (controlsRef.current) {
    controlsRef.current.enabled = !controlsRef.current.enabled;
  }
};

// 3. 一键复位功能
const handleResetView = () => {
  if (controlsRef.current) {
    camera.position.set(0, 5, 10);
    camera.lookAt(0, 0, 0);
    controlsRef.current.reset();
  }
};

// 4. 传递 ref 给 OrbitControls
<OrbitControls 
  ref={controlsRef}
  makeDefault 
  enablePan 
  enableZoom 
  enableRotate 
/>

// 5. 渲染控制按钮
<SceneControls 
  onToggleFixedView={handleToggleFixedView}
  onResetView={handleResetView}
/>
```

**SceneControls.tsx 组件**:
```typescript
interface SceneControlsProps {
  onToggleFixedView: () => void;
  onResetView: () => void;
}

export default function SceneControls({ 
  onToggleFixedView, 
  onResetView 
}: SceneControlsProps) {
  const [isFixedView, setIsFixedView] = useState(false);

  return (
    <div className="absolute top-4 left-4 flex gap-2 z-10">
      {/* 固定视角按钮 */}
      <button onClick={() => {
        setIsFixedView(!isFixedView);
        onToggleFixedView();
      }}>
        {/* ... 图标和文本 ... */}
      </button>

      {/* 复位按钮 */}
      <button onClick={onResetView}>
        {/* ... 图标和文本 ... */}
      </button>
    </div>
  );
}
```

---

### 📝 使用说明

#### 基本操作

1. **固定视角**:
   - 点击"固定视角"按钮 → 视角被锁定
   - 再次点击 → 视角解锁，可自由操作

2. **一键复位**:
   - 点击"复位"按钮 → 相机立即回到默认位置
   - 无需确认，立即生效

#### 快捷键建议（未来可扩展）
```
F - 切换固定视角
R - 一键复位
```

---

### 🧪 测试要点

#### 功能测试
- [ ] 点击"固定视角"后无法旋转/缩放/平移
- [ ] 再次点击后恢复正常控制
- [ ] 点击"复位"后相机回到 `[0, 5, 10]`
- [ ] 复位后相机看向原点 `[0, 0, 0]`

#### UI 测试
- [ ] 按钮位于左上角，不遮挡主要内容
- [ ] 毛玻璃效果正常显示
- [ ] 悬停时颜色变化流畅
- [ ] 已锁定状态显示蓝色高亮

#### 边界情况
- [ ] 快速连续点击不会出错
- [ ] 复位时正在拖拽不影响操作
- [ ] 小屏幕下按钮依然可见

---

### 🎯 用户体验优化

#### 当前实现
✅ 清晰的图标和文本标签  
✅ 平滑的过渡动画  
✅ 直观的视觉反馈（锁定状态高亮）  
✅ 不遮挡 3D 场景主要内容  

#### 未来改进方向
- 添加键盘快捷键支持
- 保存多个预设视角
- 添加视角历史记录（后退/前进）
- 支持自定义默认视角位置
- 添加操作提示（首次使用时）

---

### ⚠️ 注意事项

1. **性能影响**: 
   - 按钮使用 CSS 定位，不影响 Three.js 渲染性能
   - 毛玻璃效果在低端设备可能略有性能开销

2. **兼容性**:
   - `backdrop-filter` 需要现代浏览器支持
   - 旧版浏览器会降级为纯色背景

3. **与其他功能交互**:
   - 固定视角不影响积木拖拽和选择
   - 复位不会影响已添加的积木位置
   - 与 Hover 提示、幽灵预览无冲突

---

### 📊 代码统计

| 指标 | 数值 |
|------|------|
| 新增文件 | 1 个 (SceneControls.tsx) |
| 修改文件 | 1 个 (NeuroScene.tsx) |
| 新增代码行数 | ~100 行 |
| 修改代码行数 | ~30 行 |
| 依赖引入 | 无（仅使用 React 和 Tailwind） |

---

### 🔗 相关文件

- **组件**: [`SceneControls.tsx`](file://d:\个人项目1\项目代码文件\neurobricks-3d\src\components\scene3d\SceneControls.tsx)
- **集成**: [`NeuroScene.tsx`](file://d:\个人项目1\项目代码文件\neurobricks-3d\src\components\scene3d\NeuroScene.tsx)
- **类型定义**: [`layer.ts`](file://d:\个人项目1\项目代码文件\neurobricks-3d\src\types\layer.ts)

---

最后更新：2026-06-05
