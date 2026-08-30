# Tree-sitter 代码结构与流程图

当前实现分析 Monaco 中的单个 C11 文件：

```text
代码变化
→ 400ms 防抖
→ Web Worker 中复用 Tree-sitter Parser
→ CodeStructure
→ 函数关系图 / 单函数控制流图
→ Monaco 与 Trace 联动
```

## 分层边界

- `frontend/src/analysis/analysis.worker.ts` 只负责加载 Wasm、解析代码和返回纯 JSON。
- `frontend/src/analysis/codeStructureMapper.ts` 把原始 Tree-sitter 节点转换为稳定的教学结构，并建立 `contains / calls / reads / writes / includes / uses_type` 关系。
- `frontend/src/analysis/flowGraphBuilder.ts` 从 `CodeStructure` 生成函数总图和控制流图，流程边不混入 AST 关系。
- `frontend/src/visualizations/registry.tsx` 注册可信的仓库内可视化模块。
- `frontend/src/components/StructureWorkspace.tsx` 只管理右侧内部组件窗口；网页三栏本身不可自由缩放。

## 稳定身份

`id` 包含文件、节点类型和源码位置，用于一次分析内精确引用。`stableKey` 使用语义名称和父级路径，
用于代码重新解析后恢复函数窗口和 React Flow 节点的手动位置。因此插入空行会改变 `id`，但通常不会改变 `stableKey`。

## 部分代码

Tree-sitter 遇到 `ERROR` 或缺失节点时仍会返回可恢复语法树。系统把状态标记为 `partial`，显示诊断，
同时保留能识别的函数、变量和语句。只有 Worker 或 Wasm 初始化失败时才返回 `failed`，Monaco 编辑不受影响。

## 扩展可视化

新增数组、内存或调用栈组件时：

1. 新建 React 可视化组件。
2. 在 `visualizationRegistry` 注册 `id/title/component/defaultSize/minSize/allowMultiple`。
3. 从 `VisualizationContext` 读取代码结构、流程图和当前 Trace 状态。

窗口管理器不需要知道具体算法，也不会加载外部任意代码。

## 当前限制

- 只分析编辑器中的单个 C11 文件。
- 不展开宏，不读取头文件，不解析跨文件符号。
- 函数指针和复杂指针只保留语法信息，不推断运行时指向。
- 外部调用显示为未解析目标，未来可由 Clang 适配器补充严格语义。
