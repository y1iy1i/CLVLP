# C Language Visual Learning Platform

CLVLP 是一个基于 Web 的 C 语言可视化学习平台。当前 Phase 1 已打通完整数据流：
Monaco Editor 获取代码，React 调用 FastAPI，后端返回模拟 Execution Trace，前端按步骤展示代码位置、变量、调用栈、事件和程序输出。

`/api/run` 现在可以通过配置选择模拟 Trace 或真实 GDB Trace；`/api/execute`
会在受限 Docker 容器中真实编译并运行单文件 C 程序。

## 当前功能

- React + TypeScript + Vite 三栏 IDE
- Monaco C 语言编辑器
- FastAPI `/api/run` 接口
- 版本化 Execution Trace v1.0
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

## 项目结构

```text
CLVLP/
├── frontend/              React + TypeScript + Vite
│   └── src/
│       ├── components/    IDE 与可视化组件
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
```

## 开发路线

- Phase 1：编辑器、模拟 Trace、前后端通信和基础可视化
- Phase 2A：Docker 隔离的真实 C 编译与运行（已完成）
- Phase 2B：GDB 行级变量 Trace（真实引擎与 API 接入已完成）
- Phase 3：Clang AST 或 Tree-sitter 代码结构分析
- Phase 4：事件驱动的算法可视化
- Phase 5：LLM 教学解释、错误分析和内容生成
