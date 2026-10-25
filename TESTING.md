# NeuroBricks 3D - 自动化测试指南

## 📋 目录

- [快速开始](#快速开始)
- [测试架构](#测试架构)
- [运行测试](#运行测试)
- [编写测试](#编写测试)
- [测试覆盖率](#测试覆盖率)
- [CI/CD 集成](#cicd-集成)
- [常见问题](#常见问题)

---

## 快速开始

### 1. 安装依赖

使用 Node.js >=20（推荐 22/24；项目已在 24.16.0 验证）。完整环境和源码启动步骤见[开发与评审指南](docs/开发与评审指南.md)。

```bash
npm ci
```

当前测试依赖已包含在 `package.json` 的 `devDependencies` 中：
- Vitest - 单元测试框架
- React Testing Library - 组件测试

Playwright 规格文件仍保留在仓库中，但当前尚未安装 Playwright 依赖，也没有可执行的 E2E 脚本；不得把这些规格描述为已经运行的自动化门禁。

### 2. 运行所有测试

```bash
# 监听模式（开发推荐）
npm test

# 一次性运行
npm run test:run
```

---

## 测试架构

```
src/__tests__/
├── setup.ts                  # 测试全局配置
├── unit/                     # 单元测试
│   ├── utils/               # 工具函数测试
│   │   ├── shapeInference.test.ts
│   │   └── codeGenerator.test.ts
│   ├── stores/              # Store 状态测试
│   │   └── useLayerStore.test.ts
│   └── types/               # 类型推断测试
├── components/              # 组件测试
│   ├── panels/             # 面板组件
│   │   └── ErrorPanel.test.tsx
│   ├── scene3d/            # 3D 场景组件
│   └── layout/             # 布局组件
└── e2e/                    # E2E 测试
    ├── fixtures/           # 测试夹具
    └── specs/              # 测试规格
        └── core-functionality.spec.ts
```

### 测试技术栈

| 层级 | 工具 | 用途 |
|------|------|------|
| 单元测试 | Vitest + Happy-DOM | 工具函数、Store、类型推断 |
| 组件测试 | React Testing Library | UI 组件渲染和交互 |
| E2E 测试规格（未接入门禁） | Playwright | 待安装依赖并在浏览器执行，不代表当前已通过 |

---

## 运行测试

### 单元测试 & 组件测试

```bash
# 监听模式（文件变化自动重新测试）
npm test

# 一次性运行所有测试
npm run test:run

# 运行 Rust 测试
npm run test:rust

# 运行训练 sidecar 的无 GPU 协议测试
npm run test:python

# TypeScript 类型检查
npm run typecheck

# 完整源码健康门禁：前端测试 + Rust 测试 + Python sidecar 测试 + 生产构建
npm run verify
```

`test:python` 和 `verify` 调用 PATH 中的 `python`，不会读取仅供 Rust 训练器定位的 `NEUROBRICKS_PYTHON`。先安装 sidecar requirements，再确认所用解释器；也可在源码根目录显式运行：

```powershell
.\src-tauri\sidecars\nb-trainer\.venv\Scripts\python.exe -B -m unittest discover -s .\src-tauri\sidecars\nb-trainer\tests -p "test_*.py"
# 若使用 npm run verify，在当前终端将该虚拟环境加入 PATH 后核对：
$env:PATH = "$(Resolve-Path .\src-tauri\sidecars\nb-trainer\.venv\Scripts);$env:PATH"
python --version
```

只通过前端测试不等于 Rust/Python 或干净机器验收通过；按实际执行的门禁分别记录结果。

### E2E 测试

`src/__tests__/e2e/` 保存了浏览器端流程规格，但 Playwright 尚未成为当前安装依赖和发布门禁。完成依赖接入并在真实浏览器运行之前，这些文件只代表待执行规格，不代表已验证结果。

### 选择性运行测试

```bash
# 运行特定测试文件
npx vitest run src/__tests__/unit/utils/shapeInference.test.ts

# 运行匹配的测试
npx vitest run -t "应该正确推断 Conv2D"

# 按失败用例的描述重新运行（替换为输出中的真实用例名）
npx vitest run -t "失败用例的描述"
```

---

## 编写测试

### 单元测试示例

```typescript
import { describe, it, expect } from 'vitest';
import { inferOutputShape } from '@/utils/shapeInference';

describe('shapeInference', () => {
  it('应该正确推断 Conv2D 层输出形状', () => {
    const inputShape = [1, 28, 28] as const;
    const params = {
      inChannels: 1,
      outChannels: 32,
      kernelSize: 3,
      stride: 1,
      padding: 0,
    };
    
    const outputShape = inferOutputShape('Conv2D', params, inputShape);
    
    expect(outputShape).toEqual([32, 26, 26]);
  });

  it('应该处理 padding=0 的情况', () => {
    // 确保 0 值不被默认值覆盖
    const params = { padding: 0 };
    // ... 测试逻辑
  });
});
```

### 组件测试示例

参见可执行的 [ErrorPanel.test.tsx](src/__tests__/components/panels/ErrorPanel.test.tsx)。它用现有的 `render`、`screen`、`fireEvent` 构造交互，明确设置校验结果夹具，并在用例之间清理 store，避免依赖其他测试残留的状态。项目未安装 `@testing-library/user-event`，无需为运行该示例另加依赖。

```bash
npx vitest run src/__tests__/components/panels/ErrorPanel.test.tsx
```

### E2E 测试示例

```typescript
import { test, expect } from '@playwright/test';

test('应该能够拖拽添加图层', async ({ page }) => {
  await page.goto('/');
  
  // 拖拽图层卡片到 3D 场景
  const layerCard = page.locator('[data-testid="layer-card-Conv2D"]');
  const scene = page.locator('[data-testid="neuro-scene"]');
  
  await layerCard.dragTo(scene);
  
  // 验证积木已添加
  await expect(page.locator('[data-testid="layer-block"]')).toHaveCount(1);
});
```

---

## 测试覆盖率

当前尚未接入覆盖率 provider，也没有 `test:coverage` 脚本。覆盖率目标是后续质量门禁，不应在接入前声称已有覆盖率报告。

### 覆盖率目标

| 指标 | 目标 | 当前 |
|------|------|------|
| 语句覆盖率 | > 80% | - |
| 分支覆盖率 | > 75% | - |
| 函数覆盖率 | > 85% | - |
| 行覆盖率 | > 80% | - |

---

## CI/CD 集成

仓库当前没有已启用的 CI 工作流。`npm run verify` 是本地唯一完整源码健康门禁；未来接入 CI 时应直接调用这一入口，避免本地和 CI 使用两套不同命令。

---

## 常见问题

### 1. Tauri API Mock

**问题**: 测试中调用 Tauri API 导致错误

**解决**: 在 `setup.ts` 中已全局 Mock

```typescript
Object.defineProperty(window, '__TAURI_INTERNALS__', {
  value: undefined,
  configurable: true,
});
```

或在单个测试中：

```typescript
vi.mock('@tauri-apps/api/tauri', () => ({
  invoke: vi.fn().mockResolvedValue({}),
}));
```

### 2. Zustand Store 状态污染

**问题**: 测试之间状态相互影响

**解决**: 每个测试前重置 Store

```typescript
beforeEach(() => {
  useLayerStore.setState({
    layers: [],
    selectedId: null,
    validationResult: { isValid: true, errors: [], warnings: [] },
  });
});
```

### 3. Three.js 组件测试

**问题**: WebGL 上下文在测试环境中不可用

**解决**: Mock Three.js 模块（已在 `setup.ts` 中配置）

```typescript
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }) => <div data-testid="canvas">{children}</div>,
  useFrame: vi.fn(),
  useThree: vi.fn(),
}));
```

### 4. 异步操作超时

**问题**: 异步断言超时

**解决**: 使用 `waitFor` 并增加超时时间

```typescript
import { waitFor } from '@testing-library/react';

await waitFor(() => {
  expect(screen.getByText('updated')).toBeInTheDocument();
}, { timeout: 3000 });
```

### 5. Playwright 浏览器下载慢

**解决**: 使用国内镜像或预安装

```bash
# 使用清华镜像
export PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright

npx playwright install
```

### 6. 测试运行缓慢

**优化建议**:
- 使用 `test.only` 聚焦单个测试
- 并行执行：Vitest 默认并行
- 缓存 Mock：`vi.mock` 自动缓存
- 选择性运行：按文件名或描述过滤

```bash
# 仅运行包含 "Conv2D" 的测试
npx vitest run -t "Conv2D"

# 运行特定文件
npx vitest run shapeInference.test.ts
```

---

## 最佳实践

### 1. AAA 模式

```typescript
it('应该正确处理输入', () => {
  // Arrange - 准备
  const input = [1, 28, 28];
  
  // Act - 执行
  const result = functionName(input);
  
  // Assert - 断言
  expect(result).toBe(expectedValue);
});
```

### 2. 测试用户行为，而非实现细节

```typescript
// ❌ 不好 - 测试内部状态
expect(store.layers.length).toBe(1);

// ✅ 好 - 测试用户可见行为
expect(screen.getByText('Conv2D')).toBeInTheDocument();
```

### 3. 清晰的错误信息

```typescript
// ❌ 不好
expect(result).toBeTruthy();

// ✅ 好
expect(result.isValid).toBe(true);
expect(result.errors).toHaveLength(0);
```

### 4. 避免测试框架代码

```typescript
// ❌ 不要测试
expect(component.props.className).toContain('bg-gray-900');

// ✅ 测试业务逻辑
expect(screen.getByRole('button')).toBeEnabled();
```

### 5. 定期重构测试

- 保持测试代码与生产代码同步
- 提取重复的测试辅助函数
- 删除过时的快照测试

---

## 贡献指南

### 添加新测试

1. 确定测试类型（单元/组件/E2E）
2. 在对应目录创建测试文件
3. 遵循命名规范：`*.test.ts` 或 `*.spec.ts`
4. 编写测试用例，确保覆盖边界情况
5. 运行测试验证通过
6. 提交 PR

### 测试审查清单

- [ ] 测试描述清晰（使用中文）
- [ ] 覆盖正常流程和边界情况
- [ ] 使用 `??` 而非 `||` 处理默认值
- [ ] Mock 外部依赖（Tauri API、文件系统）
- [ ] 测试独立，不依赖其他测试
- [ ] 断言信息清晰易懂
- [ ] 无 console.error 输出（预期警告除外）

---

## 资源链接

- [Vitest 官方文档](https://vitest.dev/)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [Playwright 官方文档](https://playwright.dev/)
- [测试最佳实践](https://testing-library.com/docs/guiding-principles/)

---

## 维护者

如有问题或建议，请提 Issue 或 PR。

最后更新：2026-06-05
