# C Language Visual Learning Platform

CLVLP 是一个面向 C 语言初学者的 Web 可视化学习平台。它把浏览器中的源码结构分析与 Docker 中的真实 GCC/GDB 执行结合起来，让源码位置、变量变化、调用栈、内存对象、指针关系、控制流和数据结构能够在同一个执行步骤上联动。

当前版本主要在 **macOS + Docker Desktop** 上开发和验证。Windows 原生环境尚未完成兼容验收；后续会以 Windows 11 + Docker Desktop（WSL2 后端）为首要兼容目标。

## 当前能力

- React、TypeScript、Vite 和 Monaco Editor 构成的三栏 C 语言 IDE
- FastAPI 提供模拟 Trace、真实 GDB Trace 和真实编译运行接口
- Docker 隔离的 GCC 13.4 / C11 编译、运行和 GDB/MI 调试
- Execution Trace v1.2 和统一的 `ExecutionCursor`
- 当前停止行与刚执行行分离，支持逐步、回退和连续播放
- 参数、局部变量、全局变量、调用栈、输出和函数返回值采集
- 栈、全局区和堆对象的地址、大小、原始字节、字段与生命周期采集
- 指针目标、数组元素地址以及 `malloc/calloc/realloc/free` 事件采集
- 浏览器内 Tree-sitter C11 结构分析，不完整代码也能返回可用结构
- 函数关系图、单函数控制流图和教学程序地图
- 变量观察器、真实内存图和逻辑数据结构视图
- 数组、矩阵、结构体、链表、树、邻接表与邻接矩阵示例
- 可选的 OpenAI 兼容算法识别 Agent；不配置时不影响本地分析和执行

## 实际运行流程

### Trace 追踪

```text
Monaco 中的 C 源码
        │
        ├─ 浏览器 Tree-sitter
        │    └─ CodeStructure / 调用关系 / 读写关系 / 控制流
        │
        └─ POST /api/run
             └─ FastAPI 选择 Trace Engine
                  ├─ mock：返回内置演示 Trace
                  └─ gdb：Docker 中 GCC 编译并由 GDB/MI 单步执行
                              ↓
                         Execution Trace v1.2
                              ↓
                         ExecutionCursor
                              ↓
                         SemanticFact
                              ↓
              Monaco / 流程图 / 变量 / 内存 / 数据结构联动
```

`location` 表示 GDB 当前暂停、下一步准备执行的位置；`executedLocation` 表示刚执行并造成当前状态变化的位置。前端组件统一读取 `ExecutionCursor` 和标准化 Fact，不应各自猜测原始 GDB 事件。

### 真实运行

```text
Monaco 中的 C 源码
        ↓
POST /api/execute
        ↓
Docker 中 GCC 编译并运行
        ↓
编译状态 / stdout / stderr / exitCode / 耗时
```

“真实运行”只展示一次完整执行结果；需要逐行变量和内存状态时应使用“Trace 追踪”。

## 项目结构

```text
CLVLP/
├── frontend/                  React + TypeScript + Vite
│   └── src/
│       ├── analysis/          AST 映射、Cursor、Fact、流程与内存模型
│       ├── components/        IDE、工作区、运行面板和常驻抽屉
│       ├── visualizations/    可注册的变量、流程、内存和结构视图
│       ├── services/          FastAPI 请求
│       ├── mocks/             示例代码与模拟数据
│       └── types/             Trace 和可视化协议
├── backend/                   FastAPI + Docker/GDB 控制器
│   ├── app/
│   │   ├── api/               /api/run、/api/execute、/api/agent
│   │   ├── models/            Pydantic 请求与响应模型
│   │   └── services/          Docker、GDB/MI、Trace 转换和 Agent
│   ├── docker/executor/       GCC/GDB 执行镜像
│   ├── tests/
│   └── environment.yml
└── docs/
```

## 环境要求

当前已验证环境：

- macOS（当前主要开发与验收平台）
- Docker Desktop 已启动
- Conda
- Node.js `20.19+` 或 `22.12+`，推荐当前 Node.js LTS
- npm

仅查看编辑器和浏览器端代码结构时可以不启动 Docker。使用 `/api/execute` 或真实 GDB Trace 时必须启动 Docker Desktop，并在本机存在执行镜像。

> Windows 状态：目前还不能声明 Windows 原生环境已经兼容。后端仍有 macOS 临时目录假设，启动脚本和 Docker 挂载也尚未完成 PowerShell/WSL2 全量验证。现阶段如需尝试 Windows，优先使用 WSL2；正式兼容工作见“后续开发重点”。

## 第一次安装（macOS）

以下命令默认从仓库根目录 `CLVLP/` 开始。若终端当前不在仓库目录，请先进入本机的 CLVLP 克隆目录。

### 1. 创建后端环境

```bash
cd backend
conda env create -f environment.yml
```

如果 `clvlp` 环境已经存在，更新它：

```bash
conda activate clvlp
conda env update -f environment.yml --prune
```

项目也保留了 `backend/.venv`，但一次启动只使用一种 Python 环境。不要同时激活 Conda 和 `.venv`。

### 2. 安装前端依赖

```bash
cd frontend
npm install
```

### 3. 构建 Docker 执行镜像

先启动 Docker Desktop，再执行：

```bash
cd backend/docker/executor
docker build -t clvlp-c-executor:phase2b-gdb .
```

确认镜像存在：

```bash
docker image inspect clvlp-c-executor:phase2b-gdb
```

## 每次本地启动（macOS）

先确认 Docker Desktop 已经运行，然后打开两个终端。

### 终端一：后端

```bash
conda activate clvlp
cd /path/to/CLVLP/backend
CLVLP_TRACE_ENGINE=gdb python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

如果暂时不使用 Docker/GDB，可启动模拟 Trace：

```bash
conda activate clvlp
cd /path/to/CLVLP/backend
CLVLP_TRACE_ENGINE=mock python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### 终端二：前端

```bash
cd /path/to/CLVLP/frontend
npm run dev -- --host 127.0.0.1
```

启动后访问：

- 前端：http://127.0.0.1:5173
- API 文档：http://127.0.0.1:8000/docs
- 健康检查：http://127.0.0.1:8000/api/health

建议先打开健康检查，再进入前端点击 Run。真实 Trace 失败并提示镜像不可用时，检查 Docker Desktop 和 `clvlp-c-executor:phase2b-gdb` 镜像。

如果 8000 端口提示 `Address already in use`，说明后端通常已经启动。先访问健康检查，不要重复启动第二个 Uvicorn。需要查找进程时可使用：

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN
```

## 使用方式

顶部有两种执行模式：

- `Trace 追踪`：调用 `/api/run`，获得逐步 Trace 并驱动所有教学视图。
- `真实运行`：调用 `/api/execute`，获得一次完整的真实编译和运行结果。

推荐验证顺序：

1. 从左侧选择一个示例，代码会替换当前 `main.c` 并清空上一轮 Trace。
2. 选择 `Trace 追踪`，点击 Run。
3. 使用顶部上一步、下一步或播放按钮移动 ExecutionCursor。
4. 从最右侧悬浮入口打开变量、内存、数据结构、函数总图或当前函数流程。
5. 点击变量、内存对象、流程节点或逻辑节点，观察 Monaco 与其他窗口同步选择。

代码结构分析在浏览器中完成，因此即使后端或 Docker 未运行，`代码结构` 页面仍应工作。运行时变量、真实地址、堆对象和 GDB 指针目标则必须来自真实 Trace。

## 当前界面与已知限制

- 浮动可视化窗口当前可以在主工作区内拖动、缩放、最小化、最大化和叠放，但窗口多时容易相互遮挡；自动平铺、吸附、任务栏和更可靠的层级管理尚未完成。
- 左侧资源管理器可以收起，中间编辑器和右侧区域可以调整宽度；极窄窗口下的响应式布局仍需继续优化。
- 当前数据结构窗口以一个根变量为入口，再沿已解析指针扩展相关对象。它还没有升级为“自动发现多个变量共同组成的一整个逻辑结构”的程序级视图。
- 单函数流程图支持拖动节点并保存位置，但 Trace 步进触发重新布局时仍可能覆盖当前手动布局，这是待修复问题。
- Tree-sitter 提供语法级信息，不展开宏、不读取头文件，也不进行完整 C 类型与指针语义推断。
- GDB 只能展示当前调试步骤可观察到的值；未初始化数据不得被解释为有效结构。
- 当前只支持编辑器中的单个 C11 文件，不支持多文件项目。
- 内存图表示“已采集到的用户变量和对象”，不等于进程完整虚拟内存、RSS 或分配器内部开销。

## 可选算法识别 Agent

当前真实 Trace、AST、变量、内存和逻辑结构都不依赖大模型。只有在需要识别算法家族及变种时，才需要配置可选 Agent。

```bash
cd /path/to/CLVLP/backend
cp .env.example .env
```

然后在 `backend/.env` 中配置：

```dotenv
CLVLP_AGENT_BASE_URL=https://example.com/v1
CLVLP_AGENT_API_KEY=
CLVLP_AGENT_MODEL=
CLVLP_AGENT_TIMEOUT_SECONDS=30
```

API Key 只由 FastAPI 读取，不会发送到浏览器，也不应提交到 Git。未配置、超时或响应无效时，平台继续使用本地确定性分析。

## API

### `POST /api/run`

请求：

```json
{
  "code": "int main(void) { return 0; }",
  "entryFile": "main.c"
}
```

返回版本化的 `ExecutionTrace`。前端协议位于 `frontend/src/types/trace.ts`，后端模型位于 `backend/app/models/trace.py`。

### `POST /api/execute`

请求格式与 `/api/run` 相同。后端会在临时 Docker 容器中编译并运行单个 `main.c`，返回：

- `completed`
- `compile_error`
- `runtime_error`
- `timeout`

响应包含 `stdout`、`stderr`、`exitCode`、耗时、编译器描述和沙箱限制。每次执行禁用网络并限制 CPU、内存、进程数、运行时间和输出大小。

### Agent

- `GET /api/agent/status`：检查是否完成 Agent 配置，不返回密钥。
- `POST /api/agent/analyze`：提交源码和本地结构证据，返回允许列表内的算法模块建议。

## 验证

后端：

```bash
conda activate clvlp
cd /path/to/CLVLP/backend
python -m pytest -q
```

前端：

```bash
cd /path/to/CLVLP/frontend
npm test
npm run lint
npm run build
```

涉及真实 GDB、地址、指针或 Docker 沙箱的修改，还需要在 Docker Desktop 运行时执行相应集成测试并进行浏览器交互验收。

## 后续开发重点

现阶段基础采集链路已经建立，接下来的主要工作不再是继续堆叠大量独立模块，而是把已有能力打磨成稳定、清晰的教学体验：

1. **修复实际使用问题**：持续处理 Trace 行号、初始化状态、指针归属、布局保持、组件联动和异常降级等问题。
2. **完善典型例题的可视化演示**：围绕排序、查找、递归、链表、树、图、动态内存和指针等典型题目，补齐可以逐步验证的演示与测试。
3. **重构窗口系统**：减少遮挡，增加平铺、吸附、任务栏/窗口列表、焦点管理、布局预设、可靠恢复和小屏适配。
4. **升级数据结构视图**：从“以单个变量为入口”升级为“识别多个变量和内存对象共同组成的逻辑结构”，同时保留真实内存布局。
5. **完善程序数据流图**：在现有函数总图基础上增加参数传入、读取、写入、返回值和指针引用，并保留函数级总览与下钻。
6. **Windows 兼容**：移除 `/private/tmp` 等 macOS 假设，统一跨平台临时目录和路径处理，补充 PowerShell/WSL2 启动脚本，并在 Windows 11 + Docker Desktop 上完成前后端、Docker/GDB 和浏览器验收。
7. **保持回归质量**：每个典型例题和使用问题都应沉淀为单元测试、Docker 集成测试或浏览器验收用例。

Windows 兼容完成之前，README 会明确区分“已验证平台”和“计划支持平台”，不提前宣称已完成支持。
