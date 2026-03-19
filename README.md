# One-Person Lab (多智能体一人研究实验室)

这是一个可真实落地运行的多智能体研究框架，不做 mock 评分。

核心循环：
1. `Idea 讨论组`：多个讨论智能体围绕主题辩论、收敛结论。
2. `Coding 验证组`：多个编码智能体生成可执行 Python 验证脚本，系统真实执行并回传日志。
3. `反馈回流`：将执行结果总结后反馈给讨论组继续迭代。
4. 多轮迭代后交给 `Paper 智能体` 输出论文草稿。

## 你得到的能力

- 前端可配置智能体数量与配置（名称、模型、温度、prompt、max tokens）
- 默认模型为 `gpt-5.3`（也可在界面改成 `gpt-5.2` 等）
- WebSocket 实时流式展示每个智能体 token 输出
- 真实 OpenAI API 调用（后端 `AsyncOpenAI`）
- 真实代码执行反馈（非打分）：命令、退出码、stdout、stderr、超时状态
- 自动生成论文草稿（Markdown）

## 项目结构

- `app/main.py`：FastAPI + WebSocket 入口
- `app/orchestrator.py`：三阶段编排器（讨论 -> 编码验证 -> 论文）
- `app/openai_client.py`：OpenAI 流式/非流式调用
- `app/execution.py`：提取代码块、执行实验、收集日志
- `app/schemas.py`：Pydantic 配置模型
- `app/templates/index.html`：控制台页面
- `app/static/app.js`：前端交互与实时事件渲染
- `app/static/style.css`：界面样式

## 启动

```bash
python3 -m pip install -r requirements.txt
uvicorn app.main:app --reload
```

打开：
- `http://127.0.0.1:8000`

终端直跑（不打开网页）：

```bash
python3 scripts/live_run.py --topic "你的研究问题"
```

## API Key

本项目通过环境变量 `OPENAI_API_KEY` 读取密钥。
支持 `.env` 自动加载（由 `python-dotenv` 处理），无需改代码。
如果 `.env` 不存在，也会自动读取 `.env.example`。

示例（终端临时设置）：

```bash
export OPENAI_API_KEY="your_key_here"
uvicorn app.main:app --reload
```

## 运行结果

- 每次 run 会在 `lab_runs/<run_id>/...` 下保存 coding 组生成并执行的脚本。
- 前端右侧实时看到讨论流、执行日志和最终论文草稿。

## 事件流（WebSocket）

主要事件：
- `run_started`
- `stage_started`
- `message_start`
- `token`
- `message_done`
- `execution_result`
- `consensus_update`
- `iteration_conclusion`
- `coding_summary_done`
- `run_finished`
- `error`

## 可扩展方向

- 在 `orchestrator` 增加并行 coding agent 执行（当前为顺序执行）
- 将 `execution.py` 接入容器沙箱（隔离运行不可信代码）
- 增加 MCP 工具桥接：让 coding agent 调用外部检索/数据库/实验平台
- 将论文输出结构化为 LaTeX + BibTeX
