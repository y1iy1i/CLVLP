# C Language Visual Learning Platform

CLVLP 是一个基于 Web 的 C 语言可视化学习平台。当前 Phase 1 已打通完整数据流：
Monaco Editor 获取代码，React 调用 FastAPI，后端返回模拟 Execution Trace，前端按步骤展示代码位置、变量、调用栈、事件和程序输出。

> 当前版本不会编译或执行用户提交的 C 代码，`/api/run` 返回固定的教学演示 Trace。

## 当前功能

- React + TypeScript + Vite 三栏 IDE
- Monaco C 语言编辑器
- FastAPI `/api/run` 接口
- 版本化 Execution Trace v1.0
- 上一步、下一步和代码行高亮
- 变量、调用栈、事件与程序输出面板
- 请求错误和运行状态提示
- FastAPI 自动接口文档与基础测试

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

Docker 将在真实 C 编译和隔离执行阶段接入，Phase 1 不需要 Docker。

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

## 本地启动

需要同时打开两个终端。

终端一运行后端：

```bash
conda activate clvlp
cd backend
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
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
- Phase 2：Docker 隔离的真实 C 编译与运行、GDB Trace
- Phase 3：Clang AST 或 Tree-sitter 代码结构分析
- Phase 4：事件驱动的算法可视化
- Phase 5：LLM 教学解释、错误分析和内容生成
