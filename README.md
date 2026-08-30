# C Language Visual Learning Platform

CLVLP 是一个基于 Web 的 C 语言可视化学习平台。当前 Phase 1 已打通完整数据流：
Monaco Editor 获取代码，React 调用 FastAPI，后端返回模拟 Execution Trace，前端按步骤展示代码位置、变量、调用栈、事件和程序输出。

`/api/run` 现在可以通过配置选择模拟 Trace 或真实 GDB Trace；`/api/execute`
会在受限 Docker 容器中真实编译并运行单文件 C 程序。

## 当前功能

- React + TypeScript + Vite 三栏 IDE
- Monaco C 语言编辑器
- FastAPI `/api/run` 接口
- 版本化 Execution Trace v1.1 与统一 `ExecutionCursor`
- 上一步、下一步和代码行高亮
- 变量、调用栈、事件与程序输出面板
- `Trace 演示 / 真实运行` 前端模式切换
- 真实编译结果、stdout、stderr、退出码、耗时与沙箱限制面板
- 请求错误和运行状态提示
- FastAPI 自动接口文档与基础测试
- Docker 隔离的 C11 编译与运行
- 编译错误、运行错误、超时和输出捕获
- GDB/MI 行号、变量类型和值、调用栈快照采集
- GDB 快照到 Execution Trace 的差异转换器
- 自动 GDB 单步循环、系统函数跳过和最多500步截断
- Trace 中独立捕获 stdout 与 stderr，包括无换行和退出时输出
- 浏览器内 Tree-sitter C11 结构分析，输入停止约 400ms 后自动更新
- 通用 `CodeStructure`、作用域、函数调用、读写、类型和 include 关系
- 函数总关系图与单函数控制流图
- 右侧可视化组件可拖动、缩放、叠放、最小化和最大化
- 流程节点点击跳转 Monaco，Trace 驱动当前节点与祖先路径高亮
- 不完整代码的部分结构、诊断信息和可恢复编辑体验
- 默认简洁的教学程序地图，完整控制流保留为可下钻视图
- Trace、Monaco、流程图、数组比较卡片和内存视图统一联动
- 常驻、可折叠并可调宽度的逻辑内存抽屉
- 递归、嵌套循环、数组比较和交换候选的本地确定性识别
- 可选的 OpenAI 兼容算法识别 Agent，失败时自动保留本地结果

## 项目结构

```text
CLVLP/
├── frontend/              React + TypeScript + Vite
│   └── src/
│       ├── components/    IDE 与可视化组件
│       ├── analysis/      Tree-sitter Worker、结构映射与流程图生成
│       ├── visualizations/可视化注册表、函数关系图与流程图
│       ├── services/      FastAPI 请求
│       ├── mocks/         Phase 1 示例代码和模拟数据
│       └── types/         Trace TypeScript 协议
├── backend/               FastAPI
│   ├── app/
│   │   ├── api/           HTTP 路由
│   │   ├── models/        Pydantic Trace 协议
│   │   └── services/      模拟执行服务
│   ├── tests/
│   └── environment.yml    Conda 环境
└── docs/
```

## 环境要求

- Node.js 20 或更高版本
- npm
- Conda
- macOS、Linux 或 Windows

使用真实 C 执行接口需要 Docker Desktop。模拟 Trace 和普通前端开发不依赖 Docker。

## 第一次安装

### 后端

```bash
cd backend
conda env create -f environment.yml
```

### 前端

```bash
cd frontend
npm install
```

### Docker 执行镜像

启动 Docker Desktop，然后构建本地执行镜像：

```bash
cd backend/docker/executor
docker build -t clvlp-c-executor:phase2b-gdb .
```

## 本地启动

需要同时打开两个终端。

终端一运行后端：

```bash
conda activate clvlp
cd backend
CLVLP_TRACE_ENGINE=gdb python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

终端二运行前端：

```bash
cd frontend
npm run dev -- --host 127.0.0.1
```

启动后访问：

- 前端：http://127.0.0.1:5173
- API 文档：http://127.0.0.1:8000/docs
- 健康检查：http://127.0.0.1:8000/api/health

前端顶部可以选择两种模式：

- `Trace 追踪`：调用 `/api/run`，播放模拟 Trace 或真实 GDB Trace。
- `真实运行`：调用 `/api/execute`，在 Docker 中编译当前编辑器代码并展示真实结果。

右侧可以在 `运行可视化 / 代码结构` 之间切换。代码结构分析完全在浏览器中完成，
不依赖 FastAPI、Docker 或 GDB。三栏页面保持固定，只有右侧内部的可视化组件窗口
可以拖动、改变大小和叠放。

右侧的“教学地图”是默认入口，只显示函数、算法候选和关键操作。点击模块可定位
源码，点击“查看内部”才会进入完整流程图。内存抽屉始终保留在右侧边缘，新一次
Run 会清空上一轮状态；第一版展示变量、数组和调用栈组成的逻辑内存，真实地址、
堆对象与完整指针关系留给后续 GDB 采集。

### 可选算法识别 Agent

本地规则不需要任何模型即可识别递归、数组比较、交换候选和部分算法结构。若希望
识别算法家族及变种，可复制后端示例配置：

```bash
cd backend
cp .env.example .env
```

然后在 `.env` 中填写 OpenAI 兼容服务的 `BASE_URL`、`API_KEY` 和 `MODEL`，重启
后端即可。`.env` 不应提交到 Git，API Key 只由 FastAPI 读取，不会发送给浏览器。
Agent 只能推荐仓库已注册的可视化组件，也不能生成 Trace、运行时数值、内存地址
或 React 代码。未配置、超时或响应无效时，教学地图继续使用本地确定性结果。

## API

### `POST /api/run`

请求：

```json
{
  "code": "int main(void) { return 0; }",
  "entryFile": "main.c"
}
```

响应是 `ExecutionTrace`，主要包含：

```text
ExecutionTrace
├── schemaVersion
├── runId
├── status
├── source
├── trace[]
│   ├── location
│   ├── event
│   ├── state
│   └── output
├── summary
└── error
```

前端协议位于 `frontend/src/types/trace.ts`，后端对应模型位于
`backend/app/models/trace.py`。

### `POST /api/execute`

在临时 Docker 容器中使用 GCC 13.4 和 C11 编译、运行单个 `main.c`：

```json
{
  "code": "#include <stdio.h>\nint main(void) { printf(\"hello\\n\"); return 0; }",
  "entryFile": "main.c"
}
```

接口返回真实的 `stdout`、`stderr`、`exitCode` 和以下状态之一：

```text
completed
compile_error
runtime_error
timeout
```

每次执行都会禁用网络，限制 CPU、内存、进程数、运行时间和输出大小，并在结束后删除临时容器和构建卷。

### 算法识别 Agent

- `GET /api/agent/status`：查看 Agent 是否完成配置，不返回密钥。
- `POST /api/agent/analyze`：提交源码和本地结构证据，返回算法模块建议。

请求按源码哈希缓存；前端会丢弃过期编辑产生的结果，并再次验证所有源码节点 ID。

## 验证

后端测试：

```bash
conda activate clvlp
cd backend
python -m pytest -q
```

前端构建：

```bash
cd frontend
npm run build
npm test
npm run lint
```

## 开发路线

- Phase 1：编辑器、模拟 Trace、前后端通信和基础可视化
- Phase 2A：Docker 隔离的真实 C 编译与运行（已完成）
- Phase 2B：GDB 行级变量 Trace（真实引擎与 API 接入已完成）
- Phase 3A：Tree-sitter 单文件代码结构、函数关系图与控制流图（已完成）
- Phase 3B：Clang AST 严格语义与跨文件分析
- Phase 4A：ExecutionCursor、教学程序地图、比较动画与逻辑内存抽屉（已完成）
- Phase 4B：更多事件驱动算法组件、真实指针与堆内存
- Phase 5：LLM 教学解释、错误分析和内容生成
