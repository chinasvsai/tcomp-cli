# tcomp — 本地 NLP 文本压缩工具

> **在将内容发送给 AI 之前，先用 tcomp 提炼关键信息，节省 Token 消耗。**
> 纯本地运行，无需 API Key，数据不出本机。

[![Node.js](https://img.shields.io/badge/Node.js-≥18-brightgreen)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

---

## 目录

- [功能特性](#功能特性)
- [快速开始](#快速开始)
- [安装说明](#安装说明)
- [使用方式](#使用方式)
- [压缩模式详解](#压缩模式详解)
- [NLP 工具安装](#nlp-工具安装)
- [Claude Code 技能](#claude-code-技能)
- [项目结构](#项目结构)
- [工作原理](#工作原理)
- [性能说明](#性能说明)

---

## 功能特性

| 特性 | 说明 |
|------|------|
| 🔒 完全本地 | 无需联网，无 API Key，数据不离开本机 |
| 🌏 中英双语 | 中文、英文文本均支持 |
| 🧠 多种算法 | TextRank / LexRank / LSA 句子提取；spaCy POS 关键词过滤 |
| 📋 四种模式 | `sentences` / `keywords` / `requirements` / `prompt` |
| ✏️ 纠错预处理 | 集成 pycorrector，压缩前自动修正错别字（中文） |
| 🗑️ 去重过滤 | 自动检测并移除重复、近似重复的句子 |
| 🤖 Claude 技能 | 配套 `/tcomp` 技能，在 Claude Code 中一键压缩并确认 |

---

## 快速开始

```bash
# 安装
npm install -g tcomp-nlp

# 压缩 AI 提示词（中文）
tcomp -m prompt -t "辛苦您，能否帮��生成一个打卡工具"
# 输出: 生成打卡工具

# 压缩英文提示词
tcomp -m prompt -t "Could you please help me write a REST API for user login"
# 输出: write REST API user login

# 压缩长文章（提取关键句）
tcomp -m sentences --stats -t "$(cat article.txt)"

# 压缩软件需求文档
tcomp -m requirements --stats -r 0.5 srs.md
```

---

## 安装说明

### 方式一：npm 全局安装（推荐）

```bash
npm install -g tcomp-nlp
```

### 方式二：从源码安装

```bash
git clone https://github.com/chinasvsai/tcomp-cli.git
cd tcomp-cli
npm install
npm link          # 注册 tcomp 命令到全局
```

### 安装 Python NLP 工具（可选，提升中文效果）

不安装时使用内置 JS 兜底，可正常运行。安装后中文压缩质量显著提升。

```bash
# 一键安装脚本（自动创建 venv，无需 sudo）
npm run setup-nlp

# 仅安装中文支持
npm run setup-nlp:zh

# 仅安装英文支持
npm run setup-nlp:en

# 重置重装
npm run setup-nlp:reset
```

脚本会自动完成：
1. 创建独立虚拟环境 `~/.tcomp/venv`（绕过 macOS externally-managed 限制）
2. 安装 spaCy（中英文统一推荐工具）
3. 下载语言模型：`zh_core_web_sm`（中文，约 43MB）、`en_core_web_sm`（英文，约 12MB）
4. 安装 pycorrector（中文纠错，可选）
5. 注册 venv 路径，tcomp 自动优先使用

---

## 使用方式

### 基本语法

```
tcomp [文件] [选项]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-t, --text <文本>` | 直接输入文本（替代文件/stdin） | — |
| `-m, --mode <模式>` | 压缩模式：`sentences \| keywords \| requirements \| prompt` | `sentences` |
| `-a, --algorithm <算法>` | 句子提取算法（仅 sentences 模式）：`textrank \| lexrank \| lsa` | `textrank` |
| `-r, --ratio <数值>` | 保留比例 / POS 密度（0.1–0.9） | `0.5` |
| `--stats` | 显示 token 统计和工具信息 | `false` |

### 输入方式

```bash
# 方式1：直接输入文本
tcomp -m prompt -t "辛苦您，帮我生成一个登录页面"

# 方式2：从文件读取
tcomp -m requirements -r 0.5 --stats srs.md

# 方式3：从 stdin 管道
echo "Long article..." | tcomp --stats
cat requirements.txt | tcomp -m requirements
```

---

## 压缩模式详解

### `sentences` — 句子提取（默认）

从长文本中提取最关键的句子，适合文章摘要、长段落压缩。

```bash
tcomp -m sentences --stats -t "$(cat article.txt)"

# 指定算法
tcomp -m sentences -a lexrank -r 0.3 --stats doc.txt
tcomp -m sentences -a lsa    -r 0.4 --stats doc.txt
```

**算法说明：**

| 算法 | 原理 | 适用场景 |
|------|------|---------|
| `textrank`（默认） | 词重叠相似度 + PageRank | 通用，速度最快 |
| `lexrank` | TF-IDF 余弦相似度 + PageRank | 词汇多样性高的文本 |
| `lsa` | 奇异值分解（SVD），隐语义分析 | 话题明确的技术文档 |

**`--ratio` 参数：** 句子保留比例，0.3 = 保留 30% 句子。

---

### `keywords` — 关键词提取

将每个句子压缩为核心关键词，过滤停用词和功能词。

```bash
tcomp -m keywords -r 0.5 -t "用户需要能够通过邮箱和密码进行账号注册"
# 输出: 用户邮箱密码账号注册
```

**`--ratio` POS 密度说明：**

| 值 | 保留词性 | 适用场景 |
|----|---------|---------|
| ≤ 0.3 | 名词 | 最极致压缩 |
| ≤ 0.5 | 名词 + 动词 | 推荐（需求文档）|
| ≤ 0.7 | 名词 + 动词 + 形容词 | 保留更多语义 |
| > 0.7 | 全部实词（含副词、数词）| 轻度压缩 |

---

### `requirements` — 软件需求模式

专为 SRS / BRD 需求文档设计，自动处理：
- 保留需求 ID（REQ-001、FR-1、NFR-12 等）
- 剥离模态套话（"系统应该…"、"The system shall…"）
- 保留语义核心后提取关键词

```bash
tcomp -m requirements -r 0.5 --stats srs.md
```

**支持的需求 ID 格式：**
```
REQ-001   FR-1    NFR-12   UC-3   US-5   SRS-10
[REQ-1]   (FR-2)  需求1:   需求编号：FR-01
```

**示例：**
```
输入: FR-001 系统应该允许用户通过邮箱地址注册新账号
输出: [FR-001] 用户邮箱地址注册账号
```

---

### `prompt` — AI 提示词模式

专为人机对话输入设计，自动剥离：
- 礼貌开场白（"辛苦您"、"麻烦"、"Could you please"）
- 自我指代（"给我"、"帮我"、"for me"）
- 不定冠词/量词（"一个"、"a/an"）
- 请求套语（"我想要"、"I would like you to"）

```bash
tcomp -m prompt -t "辛苦您，能否帮我生成一个用户登录的 REST API"
# 输出: 生成用户登录REST API

tcomp -m prompt -t "Could you please help me write a user authentication module"
# 输出: write user authentication module
```

---

## NLP 工具安装

tcomp 使用分层工具链，按优先级依次尝试：

### 中文工具链

| 优先级 | 工具 | 安装方式 | 说明 |
|--------|------|---------|------|
| 1 ⭐ | **spaCy** + `zh_core_web_sm` | `npm run setup-nlp:zh` | 推荐，统一中英文 |
| 2 | 百度 LAC | `pip install lac` | 高精度中文分词 |
| 3 | THULAC | `pip install thulac` | 清华大学分词 |
| 4 | 哈工大 LTP | `pip install ltp` | 语言技术平台 |
| 5 | HanLP | `pip install hanlp` | 多语言 NLP |
| 兜底 | JS 内置 | 无需安装 | 停用词过滤，始终可用 |

### 英文工具链

| 优先级 | 工具 | 安装方式 |
|--------|------|---------|
| 1 ⭐ | **spaCy** + `en_core_web_sm` | `npm run setup-nlp:en` |
| 2 | NLTK | `pip install nltk` |
| 兜底 | JS 内置 | 无需安装 |

### 纠错工具（中文，可选）

```bash
# 通过安装脚本自动安装
npm run setup-nlp

# 或手动安装到 venv
~/.tcomp/venv/bin/pip install pycorrector
```

---

## Claude Code 技能

配套 `/tcomp` 技能，在 Claude Code 对话中一键完成：压缩 → 展示节省量 → 用户确认 → 继续处理。

### 安装技能

**个人使用（全局）：**
```bash
mkdir -p ~/.claude/commands
cp .claude/commands/tcomp.md ~/.claude/commands/
```

**团队共享（项目级）：**
```bash
# 将 .claude/commands/tcomp.md 提交到项目仓库
# 团队成员 git pull 后自动可用
```

### 使用技能

在 Claude Code 中输入：
```
/tcomp 辛苦您，帮我设计一个用户权限管理系统
```

技能自动执行：
1. 检测输入类型，选择最优压缩模式
2. 运行主模式 + 对比模式，展示压缩结果表格
3. 显示原始 token 数 vs 压缩后 token 数
4. 询问用户选择哪个版本
5. 用选定版本继续完成原始任务

**示例输出：**
```
## 压缩结果

**原文**（~14 tokens）
> 辛苦您，帮我设计一个用户权限管理系统

| 模式 | 压缩后内容 | Tokens | 节省 |
|------|-----------|--------|------|
| prompt ✦ 推荐 | 设计用户权限管理系统 | ~7 | 50.0% |
| sentences     | 设计一个用户权限管理系统 | ~9 | 35.7% |
```

---

## 项目结构

```
tcomp-cli/
├── bin/
│   └── compress.js              # CLI 入口（commander）
├── src/
│   ├── compressor.js            # 主分发逻辑（mode 路由）
│   ├── utils.js                 # 工具函数：分句、分词、去重、PageRank、token 估算
│   └── algorithms/
│       ├── textrank.js          # TextRank 句子提取
│       ├── lexrank.js           # LexRank 句子提取（TF-IDF 余弦）
│       ├── lsa.js               # LSA 句子提取（SVD）
│       ├── keyword.js           # 关键词提取（Python 子进程 + JS 兜底）
│       ├── requirements.js      # 需求模式：ID 提取 + 套话剥离
│       └── prompt.js            # 提示词模式：礼貌语剥离
│   └── python/
│       └── keyword_extractor.py # Python POS 词性标注脚本
├── scripts/
│   └── setup-nlp.sh             # NLP 工具一键安装脚本
├── .claude/
│   └── commands/
│       └── tcomp.md             # Claude Code /tcomp 技能文件
└── package.json
```

---

## 工作原理

### 整体流程

```
输入文本
    │
    ▼
splitSentences()        分句（中文按。！？；\n；英文按标点+换行）
    │
    ▼
deduplicateSentences()  去重（精确匹配 + Jaccard 近似去重，阈值 0.85）
    │
    ▼
┌───────────────────────────────┐
│  按 mode 路由                  │
│  prompt → compressPrompt()    │
│  requirements → compressReq() │
│  keywords → extractKeywords() │
│  sentences → TextRank/...     │
└───────────────────────────────┘
    │
    ▼
输出压缩结果 + stats（可选）
```

### 关键词提取流程（keywords / requirements / prompt 模式）

```
句子列表
    │
    ├─ [Python 可用] → pycorrector 纠错（中文）
    │                → spaCy / LAC / THULAC / LTP / HanLP POS 标注
    │                → 按 ratio 过滤词性 → 关键词列表
    │
    └─ [Python 不可用 / 工具均失败]
                     → JS 停用词过滤（ZH_DISPLAY_STOPWORDS / EN_DISPLAY_STOPWORDS）
                     → 保留实词（中文保留 CJK 非虚词；英文过滤停用词）
```

### 停用词设计

项目维护两套独立的停用词表：

| 停用词集 | 用途 | 包含否定词（不/not）|
|---------|------|------------------|
| `ZH_STOPWORDS` / `EN_STOPWORDS` | TF-IDF 相似度计算 | ✅ 包含 |
| `ZH_DISPLAY_STOPWORDS` / `EN_DISPLAY_STOPWORDS` | 输出过滤 | ❌ 不包含（保留语义）|

> 注：`ZH_DISPLAY_STOPWORDS` 仅包含纯虚词（的/了/着/地）和语气词，刻意保留"不"（否定）和"得"。

---

## 性能说明

| 模式 | 首次冷启动 | 后续调用 | 说明 |
|------|-----------|---------|------|
| `sentences` | ~1s | ~1s | 纯 JS，无 Python 开销 |
| `prompt` / `keywords`（有工具）| ~2s | ~2s | Python 子进程 + spaCy 推理 |
| `prompt` / `keywords`（无工具，首次）| ~25s | <1s | 首次触发工具探测；失败后写缓存 |
| `prompt` / `keywords`（无工具，后续）| <1s | <1s | 命中 `~/.cache/tcomp/no_python_tools` 缓存 |

### 性能优化列表

- **Python 可用性缓存**：`~/.cache/tcomp/python_cmd` / `no_python_tools`，跨进程持久化，1 小时 TTL
- **Set 预构建**：TextRank 的 `tokenSets[]` 在相似度矩阵循环外一次性计算
- **范数预计算**：LexRank 在 `buildTfIdf()` 中预计算 L2 范数，`cosine()` 直接使用
- **Python 探测提前**：`findPython()` 用 2s 超时快速确认可用性，缓存结果避免重复探测

---

## 开发与贡献

```bash
# 克隆仓库
git clone https://github.com/chinasvsai/tcomp-cli.git
cd tcomp-cli
npm install

# 本地链接（开发时使用）
npm link

# 测试各模式
tcomp -m prompt   --stats -t "辛苦您，给我生成一个打卡工具"
tcomp -m keywords --stats -t "用户可以通过邮箱注册账号"
tcomp -m sentences --stats -t "$(cat README.md)"
```

---

## License

MIT © 2026
