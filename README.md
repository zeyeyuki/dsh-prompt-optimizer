# dsh-prompt-optimizer

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Web / 桌面界面加一个**离线**的提示词优化面板：输入框左边点一下，最右侧打开一页，把你随手写的一句话展开成一条结构化提示词。

**不接 API、不需要 Key、不联网、不调用模型**，全部是浏览器里的本地规则引擎。

A local, offline prompt optimizer for DeepSeek Harness: an **Optimize prompt** chip beside the composer opens a panel in the right Sidebar that expands a rough prompt into a structured one. No API key, no network request, no model call — a rule engine running in the browser.

![提示词优化面板](docs/preview.svg)

---

## 功能 / Features

- **输入框左边的入口**：工具行里多一个「优化提示词」按钮，带着当前草稿打开面板。
- **右侧独立页面**：面板是右侧栏的一个 page tab，不挤占对话区。
- **任务类型**：自动 / 代码 / 写作 / 分析 / 方案 / 生图 / 角色 / 通用。自动档按关键词与固定短语打分识别。
- **力度分级**：轻（只要结果）/ 标准（加背景、格式、自检）/ 深度（再加事实与推断分离、验收标准、待确认问题）。
- **结果处理**：复制、填入输入框（输入框已有别的内容会先让你确认一次，发送中会拒绝）、编辑、换个写法。
- **本机记忆**：只记住上次输入与选项，不保存生成结果，不发送任何内容。

输出结构：`角色` → `任务`（保留你的原话）→ `背景与已知信息`（标【待补】的可以跳过）→ `具体要求` → `输出格式` → `质量标准（自检）` → `如果信息不足`（先按最合理假设给方案，再列待确认项）。

你写了但没说硬的约束——字数、格式、语气、受众、禁止项、必须项——会被抽出来变成显式要求。

## 安装 / Install

需要 DeepSeek Harness 的 Bundles / 插件安装能力（桌面版或 `dsh` CLI 都可以）。

**方式一：本地目录**

```bash
git clone https://github.com/zeyeyuki/dsh-prompt-optimizer.git
```

- 桌面版：**插件** → **添加插件**，选择克隆下来的目录。
- 或在 profile 里执行：把目录路径作为 `plugin_manager` 的 `install_bundle` 目标安装。

**方式二：写进 profile**

在 `$DSH_PROFILE_DIR/package.json` 的依赖里加 `"dsh-prompt-optimizer": "file:/path/to/dsh-prompt-optimizer"`，再在 profile 的 `cordis.patch.yml` 里补一行：

```yaml
- insert:
    - id: prompt-optimizer
      name: dsh-prompt-optimizer
```

安装后**刷新页面**（客户端模块在启动时加载）。按钮没出现就重启一次应用。

## 使用 / Usage

1. 输入框工具行左侧（`+` 与模式按钮之后）点「**优化提示词**」。
2. 最右侧栏出现「**提示词优化**」页，输入框里已有的草稿会被带进来。
3. 写/贴一句粗糙的提示词，需要时选任务类型和力度（默认「自动 + 标准」就够用）。
4. 点「**开始优化**」，结果出现在下方；`Ctrl/⌘ + Enter` 也可以直接优化。
5. 「复制」拿走，「填入输入框」写回输入框，「编辑」微调，「换个写法」换一组要求与收尾。

## 原理 / How it works

规则引擎，不是模型：

1. **识别**：关键词加权 + 固定短语加分（如「对比 / 比较」偏向分析，「规划 / 路线图」偏向方案），识别不出走通用模板。
2. **展开**：按任务类型填入角色、背景待补项、可执行要求、输出格式、自检与反问；力度决定展开多少。
3. **抽取**：用正则把你写明的字数、格式、语气、受众、禁止项、必须项抽成显式要求。
4. **变体**：`换个写法` 轮换要求子集与收尾条目。

代码只有两个文件：`client.js`（浏览器端，手写的 `__ModuleLoader__` bundle，无需构建）与 `index.js`（Host 端占位）。

## 限制 / Limitations

- **它不创作**：不会替你补事实、数据或内容，只补齐结构与约束。
- 输出语言跟随输入语言（中文输入 → 中文提示词；英文输入 → 英文提示词）。
- 类型识别是启发式的，边界情况会归类不准；面板里可以手动指定类型。
- 面板在本机 `localStorage` 记住上次输入与选项，不上传任何东西。
- 关掉插件后按钮和页面消失，输入框本身不受影响。

## 开发 / Development

没有任何依赖，只用 `node`：

```bash
node test/engine-check.cjs  # 规则引擎：类型识别、约束抽取、变体、力度
node test/smoke.cjs         # 注册、渲染冒烟、草稿交接、样式 token、manifest 一致性
```

改了 `client.js` 后刷新页面即可（客户端模块按路径加载）；改了 `package.json` 里的包名或 `dsh.client` 字段则需要重新安装。

## 目录 / Layout

```
client.js         浏览器端：按钮、面板、规则引擎（__ModuleLoader__ bundle）
index.js          Host 端占位
cordis.patch.yml  插件行
locale/           插件管理页的标题与描述（zh / en）
docs/             详情页图片与说明
test/             离线测试
icon.svg          插件图标
```

## License

[MIT](LICENSE) © 2026 沢雪 (zeyeyuki)