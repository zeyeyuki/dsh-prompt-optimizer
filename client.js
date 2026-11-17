/**
 * dsh-prompt-optimizer — browser half.
 *
 * A hand-written `__ModuleLoader__` bundle (no build step):
 *   1. a 「优化提示词」 chip in the composer tool row's left seat
 *      (`conversation.input.left`), which hands the current draft to…
 *   2. …a 「提示词优化」 page registered as a right-Sidebar tab type, where the
 *      user edits a prompt, picks a task type and strength, and gets a
 *      structured, expanded prompt back.
 *
 * The expansion is a local rule engine: no API key, no network, no model call.
 * Everything the panel needs arrives through slot props (`inputActions`,
 * `useInput`) or the page's own hooks, so no Host capability is required.
 */
window.__ModuleLoader__.load({
  id: 'dsh-prompt-optimizer',
  factory(require) {
    'use strict'

    var React = require('react')
    var h = React.createElement
    var useEffect = React.useEffect
    var useMemo = React.useMemo
    var useRef = React.useRef
    var useState = React.useState

    var NS = 'prompt-optimizer'
    var TAB_KIND = 'prompt-optimizer'
    var TAB_ID = 'dsh-prompt-optimizer'
    var STORE_KEY = 'dsh-prompt-optimizer:state:v1'

    /* ------------------------------------------------------------------ *
     * helpers
     * ------------------------------------------------------------------ */

    function z(zh, en) { return { zh: zh, en: en || zh } }
    function pick(v, lang) { return v && (lang === 'en' ? (v.en || v.zh) : v.zh) }
    function hasCjk(s) { return /[\u3400-\u9fff]/.test(s) }
    function rotate(arr, n) {
      if (!arr || arr.length === 0) return []
      var k = ((n % arr.length) + arr.length) % arr.length
      return arr.slice(k).concat(arr.slice(0, k))
    }
    function uniq(arr) {
      var seen = {}
      var out = []
      for (var i = 0; i < arr.length; i++) {
        var k = String(arr[i])
        if (k && !seen[k]) { seen[k] = 1; out.push(k) }
      }
      return out
    }
    function readStore() {
      try {
        var raw = window.localStorage.getItem(STORE_KEY)
        var v = raw ? JSON.parse(raw) : null
        return v && typeof v === 'object' ? v : {}
      } catch (e) { return {} }
    }
    function writeStore(patch) {
      try {
        var next = readStore()
        for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) next[k] = patch[k]
        window.localStorage.setItem(STORE_KEY, JSON.stringify(next))
      } catch (e) { /* storage may be unavailable; the panel still works */ }
    }
    function copyText(text) {
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          return navigator.clipboard.writeText(text).then(function () { return true }, function () { return legacyCopy(text) })
        }
      } catch (e) { /* permission policy or an insecure context: use the legacy path */ }
      try { return Promise.resolve(legacyCopy(text)) } catch (e) { return Promise.resolve(false) }
    }
    function legacyCopy(text) {
      try {
        var el = document.createElement('textarea')
        el.value = text
        el.setAttribute('readonly', '')
        el.style.position = 'fixed'
        el.style.opacity = '0'
        el.style.pointerEvents = 'none'
        document.body.appendChild(el)
        el.select()
        var ok = document.execCommand('copy')
        document.body.removeChild(el)
        return ok
      } catch (e) { return false }
    }

    /* ------------------------------------------------------------------ *
     * the rule engine: task domains
     *
     * Each domain supplies the scaffolding a strong prompt needs but a rough
     * one-liner lacks: the role, the context to fill in, concrete requirement
     * lines, the output shape, the quality bar, and the questions worth asking.
     * ------------------------------------------------------------------ */

    var DOMAINS = [
      {
        id: 'code',
        label: z('代码', 'Code'),
        kw: ['代码', '编程', '脚本', '程序', '函数', '方法', '接口', '报错', '错误', '调试', 'bug', 'script', 'function', 'python', 'javascript', 'js', 'typescript', 'java', 'golang', 'rust', 'c++', 'c#', 'sql', 'regex', '正则', '爬虫', '抓取', '自动化', 'excel', 'vba', 'html', 'css', 'react', 'vue', 'node', 'docker', 'git', 'shell', 'bash', '命令行', '算法', '重构', '单元测试', '部署', '服务器', '数据库', '实现', '修复', '运行'],
        role: z('你是一位资深软件工程师：习惯先明确边界条件和失败路径，再写出能直接运行、可维护的实现，并在关键取舍处说明理由。',
          'You are a senior software engineer: you pin down edge cases and failure paths first, then write runnable, maintainable code, and explain the trade-offs at the decisions that matter.'),
        context: [
          z('【待补】运行环境：语言/框架版本、操作系统、已安装的依赖', 'To fill in: runtime — language/framework versions, OS, installed dependencies'),
          z('【待补】输入的真实样子：字段、规模、一到两条样例数据', 'To fill in: what the input really looks like — fields, size, one or two samples'),
          z('【待补】已经试过的做法或报错原文；没有就写“没有”', 'To fill in: what you already tried, or the exact error text; write "none" if none'),
        ],
        reqs: [
          z('先给一份可直接运行的最小实现，再说明关键设计取舍。', 'Deliver a minimal but runnable implementation first, then explain the key trade-offs.'),
          z('明确列出你做的假设；不确定的地方按最合理的默认处理，可调整的点单独列在最后。', 'State your assumptions; pick the most reasonable default where unsure and list the adjustable points at the end.'),
          z('不要用省略号或伪代码代替可运行代码，不要省掉中间步骤。', 'No ellipses or pseudo-code instead of runnable code; do not skip the middle steps.'),
          z('处理常见异常：空输入、类型不符、路径或网络失败、并发与超时。', 'Handle the usual failures: empty input, wrong types, path/network errors, concurrency and timeouts.'),
          z('依赖尽量少；需要第三方库时给出安装命令和版本说明。', 'Keep dependencies minimal; when a third-party library is needed, give the install command and version note.'),
          z('关键逻辑加简短注释；函数职责单一、命名清晰。', 'Comment the non-obvious logic briefly; keep functions single-purpose and well named.'),
          z('给出一个可复制运行的示例，含示例输入和预期输出。', 'Include one runnable example with sample input and expected output.'),
          z('如果存在更简单或更稳妥的方案，先说明再实现。', 'If a simpler or safer approach exists, name it before implementing.'),
        ],
        format: [
          z('按顺序给出：1) 思路与关键假设（3–5 条）2) 完整代码 3) 运行方式与示例 4) 常见坑与可扩展点', 'In order: 1) approach and assumptions (3–5) 2) complete code 3) how to run, with an example 4) pitfalls and extension points'),
          z('代码放在带语言标注的代码块里，可直接复制；说明文字分点、简短。', 'Put code in a fenced block with a language tag so it can be copied as-is; keep prose short and bulleted.'),
        ],
        quality: [
          z('代码必须能直接运行，包含导入与依赖声明，不能是片段。', 'The code must run as-is, including imports and dependency declarations — not a fragment.'),
          z('不臆造不存在的库、API 或参数；无法验证的地方标注“未验证”。', 'Never invent libraries, APIs or arguments; mark anything unverified as "unverified".'),
          z('最后用不超过 3 条告诉我应该先检查什么。', 'Close with at most three things I should check first.'),
        ],
        ask: [
          z('需要兼容哪些运行环境或版本？', 'Which runtime or versions must be supported?'),
          z('有没有现成的代码或报错可以贴过来？', 'Can you paste the existing code or the error text?'),
          z('更看重“最短最快”还是“可扩展、可维护”？', 'Do you optimise for the shortest path or for something extensible?'),
        ],
        tech: [
          { re: /python|pandas|numpy|django|flask|fastapi/i, req: z('使用 Python 实现，列出 pip 安装命令，并说明虚拟环境。', 'Implement in Python, list the pip install command, and mention the virtual environment.') },
          { re: /webp|jpg|jpeg|png|图片|图像|缩略图/i, req: z('处理图片时说明画质参数、透明通道（alpha）与 EXIF 的处理方式。', 'For image work, state the quality parameter, alpha handling and what happens to EXIF.') },
          { re: /excel|表格|vba|wps/i, req: z('给出可直接粘贴的公式或脚本，并注明适用的版本。', 'Give a formula or script that can be pasted directly, noting which version it fits.') },
          { re: /sql|数据库|mysql|postgres|sqlite/i, req: z('给出建表或查询语句，并说明索引与性能影响。', 'Provide the DDL/queries and explain index and performance impact.') },
          { re: /爬虫|抓取|scrape|spider/i, req: z('遵守 robots.txt，加入限速、重试与 User-Agent 说明。', 'Respect robots.txt and add rate limiting, retries and a User-Agent note.') },
          { re: /正则|regex/i, req: z('给出正则表达式本体、逐段解释，并附 2–3 个测试用例。', 'Give the regex, explain it piece by piece, and attach 2–3 test cases.') },
          { re: /react|vue|前端|css|html|小程序/i, req: z('说明组件边界与状态来源，给一个不依赖额外设计库的最小可用实现。', 'Define component boundaries and state ownership, and keep the UI free of extra design libraries.') },
        ],
      },
      {
        id: 'writing',
        label: z('写作', 'Writing'),
        kw: ['写一篇', '写个', '文案', '文章', '公众号', '小红书', '知乎', '标题', '故事', '小说', '作文', '演讲稿', '邮件', '周报', '日报', '总结', '润色', '改写', '扩写', '缩写', '朋友圈', '推文', '宣传', '广告', '剧本', '读后感', '祝福', '文案策划', '开篇', '结尾', 'write a', 'blog post', 'copywriting', 'essay', 'headline', 'newsletter', 'cover letter'],
        role: z('你是一位资深内容编辑：擅长抓住读者和场景，用具体细节代替空话，并按渠道惯例组织结构。',
          'You are a senior content editor: you write for a specific reader and situation, replace empty phrases with concrete detail, and follow the conventions of the channel.'),
        context: [
          z('【待补】发布渠道与读者是谁：年龄、身份、他们关心什么', 'To fill in: channel and reader — age, role, what they care about'),
          z('【待补】希望读者看完做什么：关注、购买、转发，还是理解某个观点', 'To fill in: what the reader should do next — follow, buy, share, or understand something'),
          z('【待补】必须出现或必须避开的事实、数据、词句', 'To fill in: facts, numbers and wording that must appear or must be avoided'),
        ],
        reqs: [
          z('先明确目标读者、发布场景和希望达成的效果，再动笔。', 'Pin down the reader, the venue and the intended effect before writing.'),
          z('用具体场景、细节和例子替代形容词堆砌；删掉换成任何主题都成立的空话。', 'Replace stacked adjectives with concrete scenes and examples; delete anything that would fit any topic.'),
          z('开头三句内给出钩子；每段只讲一件事，段落短。', 'Hook the reader within three sentences; one idea per paragraph, and keep paragraphs short.'),
          z('给 3 个标题备选，并说明它们在点击欲与可信度上的差别。', 'Offer three headline options and say how they trade curiosity against credibility.'),
          z('保持事实准确，不虚构数据、引语或他人的经历。', 'Stay factually accurate; never invent data, quotes or other people’s experiences.'),
          z('结尾给明确的行动指引，而不是泛泛的“希望大家喜欢”。', 'End with a concrete call to action, not a vague "hope you like it".'),
          z('语气贴合渠道惯例，避免书面腔、学生腔和翻译腔。', 'Match the channel’s voice; avoid stiff, studentish or translated-sounding prose.'),
        ],
        format: [
          z('按顺序给出：1) 一句话定位（读者/场景/目的）2) 3 个标题备选 3) 正文（分段）4) 一句行动号召', 'In order: 1) one-line positioning (reader/venue/goal) 2) three headlines 3) the body 4) one call to action'),
          z('正文用短段落；需要小标题时用编号或短句，不要花哨符号。', 'Short paragraphs; use plain numbered or short subheads rather than decorative symbols.'),
        ],
        quality: [
          z('每一段都要能回答“为什么读者在乎这一段”。', 'Every paragraph must answer "why does the reader care about this".'),
          z('不重复我的原话来凑字数。', 'Do not pad by restating my request.'),
          z('最后用一句话说明这篇内容最容易失败的地方。', 'Close with one sentence on where this piece is most likely to fail.'),
        ],
        ask: [
          z('发布在哪个平台，目标读者是谁？', 'Which platform, and who is the reader?'),
          z('语气想要专业、亲切、犀利还是幽默？', 'Which voice: professional, warm, sharp or funny?'),
          z('有没有必须包含的事实、数据或链接？', 'Any facts, numbers or links that must be included?'),
        ],
        tech: [
          { re: /小红书/i, req: z('小红书风格：短句分段、口语化、适度 emoji 与话题标签，开头两句给结论。', 'Rednote style: short lines, spoken tone, restrained emoji and hashtags, conclusion in the first two lines.') },
          { re: /公众号/i, req: z('公众号结构：钩子开头 + 小标题分段 + 结尾引导。', 'WeChat post: hook opener, subheaded sections, guided ending.') },
          { re: /邮件|email/i, req: z('邮件结构：主题行、称呼、结论先行、明确请求与结尾。', 'Email: subject line, salutation, conclusion first, an explicit ask, and a sign-off.') },
          { re: /演讲|口播|主持/i, req: z('按口语写：短句、可停顿处标注、控制在给定时间长度内。', 'Write for speech: short sentences, marked pauses, within the given time budget.') },
        ],
      },
      {
        id: 'analysis',
        label: z('分析', 'Analysis'),
        kw: ['分析', '报告', '调研', '研究', '评估', '对比', '比较', '优劣', '趋势', '原因', '为什么', '影响', '数据', '指标', '统计', '结论', '可行性', '风险', '值得吗', '选哪个', '哪个好', 'compare', 'comparison', 'versus', 'trade-off', 'pros and cons', 'which is better', 'worth it'],
        role: z('你是一位严谨的分析师：先界定问题和判定标准，再给证据、结论和可执行建议，并严格区分事实、推断与猜测。',
          'You are a rigorous analyst: you define the question and the success criterion first, then give evidence, conclusion and next actions, keeping facts, inferences and guesses apart.'),
        context: [
          z('【待补】要回答的具体问题，以及怎样算“好”或“成功”', 'To fill in: the exact question, and what would count as a good answer'),
          z('【待补】可用的数据或来源；没有就说明只能做定性判断', 'To fill in: available data or sources; if none, say the analysis is qualitative only'),
          z('【待补】决策的时间与资源约束', 'To fill in: the time and resource limits around the decision'),
        ],
        reqs: [
          z('先复述问题与判定标准，确认分析范围，再展开。', 'Restate the question and the criterion first, then proceed.'),
          z('明确区分【事实/数据】、【推断】、【猜测】，并标注来源与不确定性。', 'Label facts/data, inferences and guesses separately, with sources and uncertainty.'),
          z('给 2–3 个可选方案，用同一组维度对比：成本、收益、风险、见效速度。', 'Compare 2–3 options on the same axes: cost, payoff, risk, time to effect.'),
          z('指出反例、边界条件，以及最可能失败的地方（至少 2 条）。', 'Name counterexamples, boundary conditions and at least two likely failure points.'),
          z('结论先行：开头三句给出核心判断，并说明把握程度。', 'Conclusion first: the core judgment within three sentences, with a confidence level.'),
          z('最后给出可执行的下一步，标出谁在什么时候做什么。', 'End with executable next steps: who does what, by when.'),
          z('不编造数据；缺失处写“需要补充”，并说明怎么拿到。', 'Never invent data; mark gaps as "needs input" and say how to obtain it.'),
        ],
        format: [
          z('按顺序给出：1) 常见结论 2) 关键证据（表格）3) 对比与取舍 4) 风险与反向观点 5) 下一步行动清单', 'In order: 1) conclusion 2) key evidence in a table 3) trade-offs 4) risks and the opposing view 5) next actions'),
          z('用表格承载对比；每个结论后面跟一条依据。', 'Use a table for the comparison; attach one basis line to each conclusion.'),
        ],
        quality: [
          z('不要用“综合来看”这类模糊收尾，要给出可证伪的判断。', 'No "all things considered" endings; commit to a falsifiable judgment.'),
          z('如果证据不足以支撑结论，直接说“证据不足”，并说明缺什么。', 'If the evidence cannot support a conclusion, say so and name what is missing.'),
          z('用不超过 3 条告诉我这个判断最可能错在哪里。', 'In at most three lines, tell me where this judgment is most likely wrong.'),
        ],
        ask: [
          z('现在能拿到哪些数据或材料？', 'What data or material can you actually get?'),
          z('这个判断要用来做什么决策？', 'What decision will this judgment feed?'),
          z('最晚什么时候要结果？', 'When do you need the result at the latest?'),
        ],
        tech: [],
      },
      {
        id: 'plan',
        label: z('方案', 'Plan'),
        kw: ['计划', '方案', '规划', '安排', '流程', '步骤', '路线', '清单', '时间表', '学习', '学会', '入门', '教程', '怎么学', '教我', '如何', '方法', '落地', '执行', '项目', '目标', '拆解', '复习', '备考', '路线图', '怎么做', '从哪开始', '每天', '每周', '坚持', '练习', 'roadmap', 'study plan', 'curriculum', 'schedule', 'learn', 'step by step'],
        role: z('你是一位擅长把目标拆成可执行步骤的规划者：先确认目标和约束，再给阶段、里程碑与检查点。',
          'You are a planner who turns goals into executable steps: confirm the goal and constraints first, then give phases, milestones and checkpoints.'),
        context: [
          z('【待补】目标的具体形态：做到什么算完成，截止时间是什么', 'To fill in: the concrete goal — what counts as done, and the deadline'),
          z('【待补】每天/每周能投入多少时间，现在的基础到哪里', 'To fill in: hours available per day/week, and your current level'),
          z('【待补】硬性限制：预算、工具、必须满足的条件', 'To fill in: hard limits — budget, tools, non-negotiables'),
        ],
        reqs: [
          z('先给总览（阶段/里程碑/预计耗时），再展开每个阶段的具体动作。', 'Overview first (phases, milestones, effort), then the concrete actions inside each phase.'),
          z('每个步骤写成可勾选的动词句，标明产出物和完成标准。', 'Write every step as a checklistable action with a deliverable and a done criterion.'),
          z('标注依赖关系和关键路径，指出最可能卡住的地方和绕开办法。', 'Mark dependencies and the critical path, plus where it will most likely stall and how to route around it.'),
          z('以“现在立刻能做的最小一步”开头，不要只说“先了解基础”。', 'Open with the smallest step you can take right now, not "learn the basics first".'),
          z('给出时间预算：乐观、现实、悲观三档。', 'Give three time budgets: optimistic, realistic, pessimistic.'),
          z('提供自检点：我怎么判断这一步真的完成了。', 'Give checkpoints so I can tell whether a step is genuinely done.'),
          z('如果目标本身有问题（过大、标准模糊），先指出，并给一个更合理的版本。', 'If the goal itself is off (too big, too vague), say so and offer a better version.'),
        ],
        format: [
          z('按顺序给出：1) 目标与约束确认 2) 总览表（阶段/耗时/产出）3) 分阶段步骤清单 4) 检查点与调整规则 5) 立刻可做的第一步', 'In order: 1) goal and constraints 2) overview table 3) phase-by-phase steps 4) checkpoints and adjustment rules 5) the first step you can take now'),
          z('步骤清单用编号，每条一行，便于我直接勾掉。', 'Number the steps, one line each, so I can tick them off.'),
        ],
        quality: [
          z('不要写“多练习”“保持耐心”这类无法执行的话。', 'No unactionable advice such as "practise more" or "be patient".'),
          z('每个阶段都要有一个我能拿给别人看的产出物。', 'Every phase must produce something I can show someone.'),
          z('最后告诉我这个计划最可能在哪一周崩掉，以及怎么补救。', 'Close by saying which week this plan is most likely to break, and how to recover.'),
        ],
        ask: [
          z('你每天/每周能投入多少时间？', 'How much time can you invest per day or week?'),
          z('现在已经会什么、卡在哪？', 'What can you already do, and where are you stuck?'),
          z('什么时间点必须看到什么结果？', 'What must be visible, and by when?'),
        ],
        tech: [],
      },
      {
        id: 'image',
        label: z('生图', 'Image'),
        kw: ['画一', '画个', '插画', '海报', '封面', '头像', '壁纸', 'logo', '标志', '配图', '生图', '出图', '画面', '构图', '写实', '水彩', '赛博朋克', '油画', '像素', 'midjourney', 'stable diffusion', 'dall', 'banner', '立绘', '三视图', '风格', 'draw', 'illustration', 'wallpaper', 'poster', 'portrait', 'photo of'],
        role: z('你是一位图像提示工程师：把模糊的想法整理成可复现的画面提示词，按主体、动作、环境、构图、镜头、光线、材质、风格分项写清，并一律用正向描述。',
          'You are an image prompt engineer: you turn a vague idea into a reproducible prompt, itemised by subject, action, environment, composition, lens, light, material and style, always phrased positively.'),
        context: [
          z('【待补】用途与画幅：封面/头像/海报，横版还是竖版', 'To fill in: use and aspect — cover, avatar, poster; landscape or portrait'),
          z('【待补】主体是谁或什么：外观细节、服装、材质，在做什么', 'To fill in: the subject — appearance, clothing, material, and what it is doing'),
          z('【待补】风格参照与必须避开的元素', 'To fill in: style references and elements to avoid'),
        ],
        reqs: [
          z('把提示词拆成固定字段：主体｜外观细节｜动作与神态｜场景｜构图与镜头｜光线｜色彩｜材质｜风格与渲染｜画幅。', 'Split the prompt into fixed fields: subject, appearance, action and expression, setting, composition and lens, light, colour, material, style and rendering, aspect.'),
          z('每个字段用具体名词和可视化形容词，禁用“好看”“高级”这类空词。', 'Use concrete nouns and visible adjectives; never "beautiful" or "premium".'),
          z('用正向描述替代否定句：不要写 no/without，改写成你想要的替代状态。', 'Replace negations with the state you want; no "no/without" phrasing.'),
          z('给出 1 条可直接粘贴的主提示词（英文，逗号分隔）+ 1 条中文对照说明。', 'Give one paste-ready English prompt (comma separated) plus a Chinese line-by-line gloss.'),
          z('给出一份负面提示词（negative prompt）。', 'Also give a negative prompt.'),
          z('标注画幅比例与光线方向；缺失的关键信息按最合理默认补全，并在末尾列出。', 'State the aspect ratio and light direction; fill missing details with sensible defaults and list them at the end.'),
          z('不要在画面里塞文字（容易糊）；确实需要文字时单独说明后期添加。', 'Keep text out of the image; when text is required, say it is added afterwards.'),
        ],
        format: [
          z('按顺序给出：1) 主提示词（英文可直接粘贴）2) 中文对照 3) Negative prompt 4) 参数建议（比例/风格强度）5) 5 个可微调的变量', 'In order: 1) the English prompt 2) a Chinese gloss 3) the negative prompt 4) suggested parameters (ratio, style strength) 5) five variables you can tune'),
        ],
        quality: [
          z('提示词必须能独立成立：不引用“上一张图”或未描述的对象。', 'The prompt must stand alone: no reference to a previous image or an undescribed object.'),
          z('风格词要具体到可复现（如“35mm 胶片颗粒、柔和侧逆光”），而不是抽象品味。', 'Style words must be reproducible (e.g. "35mm grain, soft rim light"), not taste adjectives.'),
          z('最后说明这套提示词最可能在哪一项上翻车。', 'Close by naming which field is most likely to break.'),
        ],
        ask: [
          z('这张图用在哪、什么比例？', 'Where will it be used, at what aspect ratio?'),
          z('主体的细节能补充多少（年龄、服饰、材质）？', 'How much subject detail can you give — age, clothing, material?'),
          z('有没有喜欢的风格参照？', 'Any style reference you like?'),
        ],
        tech: [],
      },
      {
        id: 'roleplay',
        label: z('角色', 'Role-play'),
        kw: ['扮演', '角色扮演', '模拟面试', '面试', '对话', '聊天', '人设', '甲方', '客户', '面试官', '导师', '教练', '陪练', '辩论', '谈判', '你当', '情景', '仿真', 'act as', 'pretend you are', 'interview me', 'roleplay'],
        role: z('你是一位擅长角色扮演的对话者：严格保持在指定角色和知识边界内，像真人一样说话，不跳出角色解释规则。',
          'You are a role-play partner: you stay inside the given role and its knowledge, speak like a real person, and never step out to explain the setup.'),
        context: [
          z('【待补】你要扮演的角色：身份、水平、性格、说话风格、知道什么/不知道什么', 'To fill in: the role you play — identity, level, temperament, voice, what it knows and does not know'),
          z('【待补】我扮演谁、我的目标是什么、对话在哪里结束', 'To fill in: who I am, what I want, and where the conversation ends'),
          z('【待补】是否需要每轮点评或最后打分', 'To fill in: whether you score or coach each round'),
        ],
        reqs: [
          z('先用一句话确认角色、语气和边界，然后立刻进入角色，不要长篇铺垫。', 'Confirm the role, voice and boundaries in one line, then start immediately — no long preamble.'),
          z('每轮回复简短口语化（不超过 4 句），像真实对话而不是讲课。', 'Keep each reply short and spoken (max 4 sentences), like a real conversation, not a lecture.'),
          z('不要替我说台词，也不要一次性结束对话；每轮留一个自然的追问或反应。', 'Never speak my lines and never end the scene early; leave a natural question or reaction each round.'),
          z('保持角色一致：不要突然变回助手口吻，也不要主动说明“这是设定”。', 'Stay in character: no sudden assistant voice and no meta remarks about the setup.'),
          z('当我说“暂停”或“点评”时跳出角色，给 3 条改进建议，再回到角色。', 'When I say pause or review, step out, give three improvements, then resume.'),
          z('我的输入含糊时按最合理解读继续，不要反复确认。', 'If my input is vague, continue with the most reasonable reading instead of asking again.'),
        ],
        format: [
          z('先给 1 行角色与场景确认，然后直接开始对话；每轮是「回应 + 一个推进问题」。', 'One line of role and scene confirmation, then straight into dialogue: each round is a reply plus one pushing question.'),
        ],
        quality: [
          z('对话要能推进，不能原地打转或连续认同。', 'The dialogue must move; no going in circles or reflexive agreement.'),
          z('角色要有明确的立场和偏好，不要当万能的顺从者。', 'The character needs a real stance and preferences, not endless compliance.'),
        ],
        ask: [
          z('这个角色要多严格、多难缠？', 'How strict or difficult should this character be?'),
          z('对话结束时你想达成什么？', 'What do you want to have achieved by the end?'),
          z('需要每轮给评分吗？', 'Should each round be scored?'),
        ],
        tech: [],
      },
      {
        id: 'general',
        label: z('通用', 'General'),
        kw: [],
        role: z('你是一位把模糊需求变成清晰交付物的助手：先补齐目标、受众、约束和验收标准，再给出可直接使用的成果。',
          'You turn vague requests into clear deliverables: you pin down the goal, audience, constraints and acceptance criteria, then produce something usable.'),
        context: [
          z('【待补】目标：这件事做成什么样算完成', 'To fill in: the goal — what "done" looks like'),
          z('【待补】使用者或受众：给谁看、在什么场合用', 'To fill in: who uses it, and on what occasion'),
          z('【待补】约束：时间、格式、字数、不能碰的边界', 'To fill in: limits — time, format, length, hard boundaries'),
        ],
        reqs: [
          z('先用一句话复述你理解的目标；如果有歧义，给出你的理解版本再继续。', 'Restate the goal in one sentence; if it is ambiguous, state your reading and continue.'),
          z('直接给出可使用的成果，而不是关于成果的建议。', 'Give the deliverable itself, not advice about the deliverable.'),
          z('明确写出关键假设；不确定处按合理默认推进，可调整点列在最后。', 'State your assumptions; proceed on a sensible default where unsure, and list the adjustable points last.'),
          z('用分点、短句；不要复述我的原话，也不要空泛套话。', 'Bullets and short sentences; do not echo my wording or pad with generalities.'),
          z('额外给一个更好的替代思路，并说明它的代价。', 'Offer one better alternative and say what it costs.'),
          z('不编造事实、数据或引用；需要我补充的信息单独列出。', 'Never invent facts, data or citations; list what you need from me separately.'),
        ],
        format: [
          z('按顺序给出：1) 一句话目标复述 2) 成果本身 3) 关键假设与取舍 4) 需要我确认的点（≤3 条）', 'In order: 1) one-line restatement 2) the deliverable 3) assumptions and trade-offs 4) at most three things to confirm'),
        ],
        quality: [
          z('成果要能直接使用或复制，不需要我再加工一遍。', 'The result must be usable as-is, without another pass from me.'),
          z('不确定的地方明确标注，而不是含糊带过。', 'Mark uncertainty explicitly instead of smoothing over it.'),
        ],
        ask: [
          z('这份成果给谁用、在什么场合用？', 'Who uses this, and on what occasion?'),
          z('有硬性的格式或字数要求吗？', 'Any hard format or length requirement?'),
          z('什么时候需要它？', 'When do you need it?'),
        ],
        tech: [],
      },
    ]

    var BY_ID = {}
    for (var di = 0; di < DOMAINS.length; di++) BY_ID[DOMAINS[di].id] = DOMAINS[di]

    /* Requirement lines that make the prompt stricter as the strength rises. */
    var STRENGTH_LINES = {
      light: [
        z('回答控制在 300 字以内，直接给结果，不要逐条解释过程。', 'Keep it under 300 words; give the result and skip the walkthrough.'),
      ],
      standard: [
        z('先给结论或成果，再给必要的解释；不要复述我的原话。', 'Lead with the result, then only the explanation that is needed; do not repeat my request.'),
        z('不确定的地方明确说“不确定”，并给出最合理的默认选择。', 'Say "not sure" where you are not sure, and give the most reasonable default.'),
        z('最后用不超过 3 条告诉我下一步做什么。', 'End with at most three next steps.'),
      ],
      deep: [
        z('先给结论或成果，再给必要的解释；不要复述我的原话。', 'Lead with the result, then only the explanation that is needed; do not repeat my request.'),
        z('区分【事实】、【推断】和【猜测】，不要把三者混在一起。', 'Separate facts, inferences and guesses; never blend them.'),
        z('写出影响方案选择的 3–5 个关键判断，并说明假设不成立时会怎样。', 'Name the 3–5 judgement calls behind the chosen approach, and what breaks if they are wrong.'),
        z('给出验收标准：我自己怎么判断这份成果算合格。', 'Give acceptance criteria I can check myself.'),
        z('不要用“可能”“建议考虑”这类模糊措辞，给明确判断。', 'Avoid hedges such as "might" or "consider"; commit to a judgment.'),
      ],
    }

    /* Rotating closers so 「换个写法」 produces a visibly different prompt. */
    var VARIANT_EXTRAS = [
      [
        z('先用一句话复述你对任务的理解再开始；如果我的说法有两种解释，把两种都写出来，并说明你选哪种。', 'Restate your understanding in one sentence first; if the request has two readings, state both and say which you follow.'),
        z('给我一个“最小可用版本”，再给一个“更好的版本”，并说明差别。', 'Give me a minimum viable version, then a better one, and say what differs.'),
      ],
      [
        z('最后指出这个需求里最可能出问题的地方，并给一个更省事的替代方案。', 'Close by naming the most likely failure point and one cheaper alternative.'),
        z('举一个具体的正例和一个反例，说明差别在哪里。', 'Show one concrete good example and one bad example, and say what separates them.'),
      ],
      [
        z('把关键结论标上把握程度（高/中/低）并说明依据。', 'Tag the key conclusions with confidence (high/medium/low) and the basis.'),
        z('如果这件事必须在一小时内做完，告诉我应该砍掉什么。', 'If this must ship within an hour, tell me what to cut.'),
      ],
    ]

    /* Extra requirement lines pulled in by what the user already wrote. */
    function signalLines(flags, lang) {
      var out = []
      if (flags.lengthText) {
        out.push(lang === 'en'
          ? 'Length: stay strictly within "' + flags.lengthText + '".'
          : '篇幅：严格按「' + flags.lengthText + '」执行，不要超出。')
      }
      if (flags.formatText) {
        out.push(lang === 'en'
          ? 'Format: follow exactly the output form I named ("' + flags.formatText + '").'
          : '格式：用「' + flags.formatText + '」输出，这是硬性要求。')
      }
      if (flags.toneText) {
        out.push(lang === 'en'
          ? 'Voice: "' + flags.toneText + '" — keep it consistent from start to end.'
          : '语气：保持「' + flags.toneText + '」，从头到尾不要漂移。')
      }
      if (flags.audienceText) {
        out.push(lang === 'en'
          ? 'Audience: write for "' + flags.audienceText + '"; assume only what they already know.'
          : '受众：面向「' + flags.audienceText + '」，只按他们已有的认知解释。')
      }
      if (flags.forbidText) {
        out.push(lang === 'en'
          ? 'Hard no: ' + flags.forbidText + '.'
          : '明确不要：' + flags.forbidText + '。')
      }
      if (flags.mustText) {
        out.push(lang === 'en'
          ? 'Required: ' + flags.mustText + '.'
          : '必须满足：' + flags.mustText + '。')
      }
      return out
    }

    function analyze(raw) {
      var s = raw
      var length = /(\d+\s*(?:字|词|行|条|句|个|页|words?|chars?))/i.exec(s)
      var format = /(表格|列表|清单|大纲|分点|思维导图|json|markdown|代码块|ppt|幻灯片)/i.exec(s)
      var tone = /(正式|轻松|幽默|专业|口语化|简洁|犀利|温柔|严肃|亲切|高级感|热情|克制)/.exec(s)
      var audience = /(读者|受众|用户|客户|老板|领导|新人|小白|学生|面试官|甲方|同事|团队)/.exec(s)
      var forbid = /(?:不要|别|禁止|避免|不许)([^，。；\n]{1,28})/.exec(s)
      var must = /(?:必须|一定要|务必|只能)([^，。；\n]{1,28})/.exec(s)
      return {
        lengthText: length ? length[1].trim() : '',
        formatText: format ? format[1] : '',
        toneText: tone ? tone[1] : '',
        audienceText: audience ? audience[1] : '',
        forbidText: forbid ? forbid[1].trim() : '',
        mustText: must ? must[1].trim() : '',
        hasRole: /(你(?:是|作为)|扮演|角色是|以.{0,6}身份)/.test(s),
      }
    }

    /** Phrases that outrank a single keyword match, whatever keywords share the text. */
    var DOMAIN_BONUS = [
      { re: /(compare|versus|\bvs\.?\b|trade-?offs?|pros and cons|对比|比较|优劣|哪个好|选哪个|值得吗|该不该|要不要)/i, id: 'analysis', add: 4 },
      { re: /(规划|计划|路线图|拆解|怎么学|学习|入门|备考|方案|预案|策划)/, id: 'plan', add: 2 },
      { re: /(画一[张个]|画面|构图|midjourney|stable diffusion|生图|出图|插画|壁纸)/i, id: 'image', add: 3 },
      { re: /(扮演|模拟面试|面试我|角色扮演)/, id: 'roleplay', add: 3 },
    ]

    function detectDomain(input) {
      var low = input.toLowerCase()
      var bonus = {}
      for (var b = 0; b < DOMAIN_BONUS.length; b++) {
        if (DOMAIN_BONUS[b].re.test(input)) bonus[DOMAIN_BONUS[b].id] = (bonus[DOMAIN_BONUS[b].id] || 0) + DOMAIN_BONUS[b].add
      }
      var best = null
      var bestScore = 0
      for (var i = 0; i < DOMAINS.length; i++) {
        var d = DOMAINS[i]
        if (!d.kw || d.kw.length === 0) continue
        var score = bonus[d.id] || 0
        for (var k = 0; k < d.kw.length; k++) {
          var kw = d.kw[k]
          if (low.indexOf(kw.toLowerCase()) !== -1) score += kw.length >= 2 ? 2 : 1
        }
        if (score > bestScore) { bestScore = score; best = d }
      }
      return bestScore >= 2 && best ? best : BY_ID.general
    }

    var KW_STOP = { '写个': 1, '写篇': 1, '如何': 1, '方法': 1, '实现': 1, '运行': 1, '修复': 1, '执行': 1, '目标': 1, '项目': 1, '能力': 1, '问题': 1 }

    function keywordsOf(input) {
      var out = []
      var latin = input.match(/[A-Za-z][A-Za-z0-9+#._-]{1,20}/g) || []
      for (var i = 0; i < latin.length && out.length < 6; i++) {
        if (latin[i].length >= 2) out.push(latin[i])
      }
      var all = DOMAINS
      for (var d = 0; d < all.length; d++) {
        var kws = all[d].kw || []
        for (var k = 0; k < kws.length; k++) {
          if (kws[k].length > 1 && !KW_STOP[kws[k]] && input.indexOf(kws[k]) !== -1) out.push(kws[k])
        }
      }
      return uniq(out).slice(0, 8)
    }

    var H = {
      zh: { role: '角色', task: '任务', context: '背景与已知信息', reqs: '具体要求', format: '输出格式', quality: '质量标准（自检）', ask: '如果信息不足', extra: '补充要求' },
      en: { role: 'Role', task: 'Task', context: 'Context', reqs: 'Requirements', format: 'Output format', quality: 'Quality bar (self-check)', ask: 'If information is missing', extra: 'Additional asks' },
    }

    /**
     * Expand one rough prompt into a structured one.
     * @param {string} raw - what the user typed.
     * @param {{domain?: string, strength?: string, variant?: number}} opts
     * @returns {null | {text: string, domainId: string, lang: string, ratio: number, chars: number, questions: number}}
     */
    function buildPrompt(raw, opts) {
      var input = String(raw == null ? '' : raw).replace(/\r\n/g, '\n').trim()
      if (!input) return null
      var o = opts || {}
      var lang = hasCjk(input) ? 'zh' : 'en'
      var domain = (o.domain && o.domain !== 'auto' && BY_ID[o.domain]) ? BY_ID[o.domain] : detectDomain(input)
      var strength = o.strength === 'light' || o.strength === 'deep' ? o.strength : 'standard'
      var variant = Math.abs(o.variant || 0)
      var L = function (zh, en) { return lang === 'en' ? (en || zh) : zh }
      var head = H[lang]
      var flags = analyze(input)
      var seed = variant

      var out = []

      function section(title, body) {
        if (!body || body.length === 0) return
        out.push('## ' + title)
        out.push('')
        for (var i = 0; i < body.length; i++) out.push(body[i])
        out.push('')
      }
      function bullets(items) {
        var lines = []
        for (var i = 0; i < items.length; i++) lines.push('- ' + items[i])
        return lines.length ? lines : null
      }
      function numbered(items) {
        var lines = []
        for (var i = 0; i < items.length; i++) lines.push((i + 1) + '. ' + items[i])
        return lines.length ? lines : null
      }

      // 1. role
      section(head.role, [pick(domain.role, lang)])

      // 2. task — the user's own words stay intact, edited only for framing
      var quote = input.split('\n').map(function (line) { return '> ' + line }).join('\n')
      section(head.task, [
        L('把我下面这件事做成一份完整、可直接使用的成果：', 'Turn the request below into a complete, directly usable deliverable:'),
        '',
        quote,
      ])

      // 3. context — drafted from the domain, with the user's own signals
      if (strength !== 'light') {
        var ctxBody = []
        var items = []
        for (var c = 0; c < domain.context.length; c++) items.push(pick(domain.context[c], lang))
        ctxBody = bullets(items) || []
        ctxBody.push('')
        ctxBody.push(L('（标着【待补】的地方可以先跳过，没给的信息我会按最合理的默认处理。）',
          '(You can skip anything marked "to fill in"; I will take the most reasonable default.)'))
        var kws = keywordsOf(input)
        if (kws.length >= 2) {
          ctxBody.push('')
          ctxBody.push(L('我这段话里出现的关键词：' + kws.join('、'), 'Keywords present in my request: ' + kws.join(', ')))
        }
        section(head.context, ctxBody)
      }

      // 4. requirements
      var reqs = []
      var own = signalLines(flags, lang)
      for (var s = 0; s < own.length; s++) reqs.push(own[s])
      var pool = rotate(domain.reqs, seed)
      var take = strength === 'light' ? 3 : strength === 'deep' ? 7 : 5
      for (var r = 0; r < pool.length && reqs.length < own.length + take; r++) reqs.push(pick(pool[r], lang))
      if (domain.tech) {
        for (var t = 0; t < domain.tech.length; t++) {
          if (domain.tech[t].re.test(input)) reqs.push(pick(domain.tech[t].req, lang))
        }
      }
      var extra = VARIANT_EXTRAS[variant % VARIANT_EXTRAS.length]
      for (var v = 0; v < extra.length; v++) reqs.push(pick(extra[v], lang))
      var strengthLines = STRENGTH_LINES[strength] || []
      for (var q = 0; q < strengthLines.length; q++) reqs.push(pick(strengthLines[q], lang))
      var reqCap = strength === 'light' ? 5 : strength === 'deep' ? 13 : 9
      section(head.reqs, numbered(uniq(reqs).slice(0, reqCap)))

      // 5. output format
      var fmt = []
      for (var f = 0; f < domain.format.length; f++) fmt.push(pick(domain.format[f], lang))
      if (flags.formatText) {
        fmt.push(L('如果上面的格式和我给的「' + flags.formatText + '」冲突，以我的为准。',
          'If the shape above conflicts with the "' + flags.formatText + '" I asked for, mine wins.'))
      }
      section(head.format, bullets(fmt))

      // 6. quality bar
      if (strength !== 'light') {
        var quality = []
        for (var g = 0; g < domain.quality.length; g++) quality.push(pick(domain.quality[g], lang))
        quality.push(L('不要在结尾总结我上面说过的话，直接给新增的信息。',
          'Do not summarise what I already said; add only new information.'))
        section(head.quality, bullets(uniq(quality)))
      }

      // 7. open questions — turns unknowns into an explicit ask instead of filler
      var ask = rotate(domain.ask, seed)
      var askCount = strength === 'light' ? 0 : strength === 'deep' ? Math.min(3, ask.length) : Math.min(2, ask.length)
      var asked = []
      for (var a = 0; a < askCount; a++) asked.push(pick(ask[a], lang))
      if (asked.length) {
        section(head.ask, [
          L('先按最合理的假设给出方案，不要停下来等我回答；然后在最后列出这几条待确认项：',
            'Proceed on the most reasonable assumption instead of stopping to ask; then list these open questions at the end:'),
        ].concat(numbered(asked)))
      }

      var text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
      return {
        text: text,
        domainId: domain.id,
        lang: lang,
        ratio: Math.max(1, Math.round((text.length / Math.max(1, input.length)) * 10) / 10),
        chars: text.length,
        questions: asked.length,
      }
    }

    /* ------------------------------------------------------------------ *
     * copy (visible strings; `locale: NS` dictionaries mirror this table)
     * ------------------------------------------------------------------ */

    var DICT = {
      zh: {
        chip: '优化提示词',
        chipTitle: '把输入框里的内容带进提示词优化面板',
        title: '提示词优化',
        sub: '本地规则引擎 · 不联网 · 免费',
        source: '原始提示词',
        placeholder: '随手写一句就行。例如：写个脚本把文件夹里的图片批量转成 webp',
        clear: '清空',
        sample: '试试示例',
        step1: '① 先写一句粗糙的提示词（Ctrl/⌘ + Enter 直接优化）',
        step2: '② 需要时选任务类型和力度，默认「自动 + 标准」就够用',
        step3: '③ 结果会出现在下面，可复制、可填入输入框、可换个写法',
        domain: '任务类型',
        strength: '力度',
        light: '轻',
        standard: '标准',
        deep: '深度',
        lightHint: '轻：只要结果，控制在 300 字以内。',
        standardHint: '标准：补齐背景、输出格式与自检，适合大多数任务。',
        deepHint: '深度：再加验收标准、事实与推断分离、待确认问题。',
        run: '开始优化',
        result: '优化结果',
        copy: '复制',
        copied: '已复制',
        insert: '填入输入框',
        overwriteBtn: '覆盖输入框',
        inserted: '已填入输入框',
        insertFailed: '输入框暂时不能写入，结果已复制',
        busy: '输入框正在发送或执行命令，稍后再填入',
        overwriteHint: '输入框里已有别的内容，再点一次「覆盖输入框」确认',
        edit: '编辑',
        preview: '预览',
        again: '换个写法',
        stale: '输入已改动，点「开始优化」刷新',
        empty: '结果会出现在这里：角色、任务、背景、具体要求、输出格式、自检和待确认点。',
        noInput: '先写一句原始提示词',
        copyFail: '复制失败，请手动选择文本复制',
        meta: '识别为「{domain}」· {from} → {to} 字符',
        synced: '已同步输入框里的内容',
        cleared: '输入框是空的，已清空这里的旧内容',
        done: '已生成',
        chars: '字符',
        sampleText: '写个 Python 脚本，把文件夹里的图片批量转成 webp',
        domainAuto: '自动',
      },
      en: {
        chip: 'Optimize prompt',
        chipTitle: 'Bring the composer draft into the prompt optimizer',
        title: 'Prompt optimizer',
        sub: 'Local rule engine · no network · free',
        source: 'Your prompt',
        placeholder: 'One rough line is enough. E.g. a script that converts every image in a folder to webp',
        clear: 'Clear',
        sample: 'Try a sample',
        step1: '① Write one rough line (Ctrl/⌘ + Enter runs it immediately)',
        step2: '② Pick a task type and strength if you want; Auto + Standard is fine',
        step3: '③ The expanded prompt appears below: copy it, send it to the composer, or ask for another version',
        domain: 'Task type',
        strength: 'Strength',
        light: 'Light',
        standard: 'Standard',
        deep: 'Deep',
        lightHint: 'Light: result only, under 300 words.',
        standardHint: 'Standard: adds context, output format and self-check — right for most tasks.',
        deepHint: 'Deep: adds acceptance criteria, fact/inference separation and open questions.',
        run: 'Optimize',
        result: 'Result',
        copy: 'Copy',
        copied: 'Copied',
        insert: 'Put in composer',
        overwriteBtn: 'Replace composer text',
        inserted: 'Added to the composer',
        insertFailed: 'The composer is not writable now; the result was copied instead',
        busy: 'The composer is sending or running a command; try again in a moment',
        overwriteHint: 'The composer already has other text — click “Replace composer text” to confirm',
        edit: 'Edit',
        preview: 'Preview',
        again: 'Another version',
        stale: 'Input changed — run Optimize again',
        empty: 'The expanded prompt appears here: role, task, context, requirements, output format, self-check and open questions.',
        noInput: 'Write a rough prompt first',
        copyFail: 'Copy failed; select the text and copy manually',
        meta: '{domain} · {from} → {to} chars',
        synced: 'Synced from the composer',
        cleared: 'The composer was empty, so the old text here was cleared',
        done: 'Ready',
        chars: 'chars',
        sampleText: 'Write a Python script that converts every image in a folder to webp',
        domainAuto: 'Auto',
      },
    }

    var FALLBACK = DICT.zh

    /**
     * Resolve slot copy through the Client locale service, falling back to the
     * built-in Chinese strings when the seat or the dictionary is missing.
     * @param props - slot props carrying the framework `t` seat.
     * @returns `(key, params?) => string`
     */
    function tr(props) {
      var t = props && props.t
      return function (key, params) {
        var value = null
        if (typeof t === 'function') {
          try { value = t(key, params) } catch (e) { value = null }
        }
        if (typeof value !== 'string' || value === '' || value === key) value = FALLBACK[key]
        if (typeof value !== 'string') return ''
        if (!params) return value
        return value.replace(/\{(\w+)\}/g, function (match, name) {
          return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
        })
      }
    }

    /* ------------------------------------------------------------------ *
     * hand-off: the composer chip passes its draft to the panel
     *
     * `pending` marks a draft nobody consumed yet: the panel is created by the
     * same click that emits it, so it mounts *after* the hand-off and must
     * still apply it. Consuming clears the flag so a later remount does not
     * re-apply a stale draft over the user's own edits.
     * ------------------------------------------------------------------ */

    var handoff = { text: '', version: 0, pending: false }
    var handoffListeners = []

    function subscribeHandoff(listener) {
      handoffListeners.push(listener)
      return function () {
        var i = handoffListeners.indexOf(listener)
        if (i >= 0) handoffListeners.splice(i, 1)
      }
    }
    function emitHandoff(text) {
      handoff = { text: String(text || ''), version: handoff.version + 1, pending: true }
      var list = handoffListeners.slice()
      for (var i = 0; i < list.length; i++) {
        try { list[i]() } catch (e) { /* a listener must not break the setter */ }
      }
    }
    function useHandoff() {
      var pair = useState(handoff)
      useEffect(function () {
        return subscribeHandoff(function () { pair[1](handoff) })
      }, [])
      return pair[0]
    }

    /* ------------------------------------------------------------------ *
     * the composer chip
     * ------------------------------------------------------------------ */

    function Sparkle(props) {
      return h('svg', {
        width: props.size || 13, height: props.size || 13, viewBox: '0 0 16 16',
        fill: 'none', 'aria-hidden': true, focusable: 'false',
        className: 'dspo-chip-glyph',
      }, [
        h('path', { key: 'a', d: 'M3.2 2.6h6.4M3.2 5.6h4.2', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
        h('path', { key: 'b', d: 'M11.4 7l1 2.1 2.1 1-2.1 1-1 2.1-1-2.1-2.1-1 2.1-1z', fill: 'currentColor' }),
      ])
    }

    function ComposerChip(props) {
      var t = tr(props)
      var useInput = props && props.useInput
      var draft = ''
      if (typeof useInput === 'function') {
        try { draft = useInput(function (state) { return state && typeof state.draft === 'string' ? state.draft : '' }) || '' } catch (e) { draft = '' }
      }
      var onClick = function () {
        // An empty draft is handed over too: the panel must clear its old text
        // instead of appearing to already contain the user's prompt.
        emitHandoff(String(draft || '').trim())
        if (typeof props.openOptimizer === 'function') props.openOptimizer()
      }
      return h('button', {
        type: 'button',
        className: 'dspo-chip',
        title: t('chipTitle'),
        'aria-label': t('chip') + '：' + t('chipTitle'),
        'data-prompt-optimizer-chip': '',
        onClick: onClick,
      }, [h(Sparkle, { key: 'i' }), h('span', { key: 't', className: 'dspo-chip-text' }, t('chip'))])
    }

    /* ------------------------------------------------------------------ *
     * the right-Sidebar panel
     * ------------------------------------------------------------------ */

    var DOMAIN_ORDER = ['auto', 'code', 'writing', 'analysis', 'plan', 'image', 'roleplay', 'general']

    function domainLabel(id, t, lang) {
      if (id === 'auto') return t('domainAuto')
      var domain = BY_ID[id]
      if (!domain) return String(id)
      return pick(domain.label, lang || 'zh')
    }

    function Panel(props) {
      var t = tr(props)
      var initial = useState(function () { return readStore() })[0]
      var next = useHandoff()
      var uiLang = t('domainAuto') === 'Auto' ? 'en' : 'zh'

      // The composer's own state, when the seat provides it: used to refuse a
      // blind overwrite of text the user typed after opening the panel.
      var useInput = props && props.useInput
      var composerDraft = ''
      var composerPhase = undefined
      if (typeof useInput === 'function') {
        try {
          composerDraft = useInput(function (state) { return state && typeof state.draft === 'string' ? state.draft : '' }) || ''
          composerPhase = useInput(function (state) { return state && state.phase }) || undefined
        } catch (e) {
          composerDraft = ''
          composerPhase = undefined
        }
      }

      var [input, setInput] = useState(function () {
        return typeof initial.input === 'string' ? initial.input : ''
      })
      var [domain, setDomain] = useState(function () {
        return typeof initial.domain === 'string' && (initial.domain === 'auto' || BY_ID[initial.domain]) ? initial.domain : 'auto'
      })
      var [strength, setStrength] = useState(function () {
        return initial.strength === 'light' || initial.strength === 'deep' ? initial.strength : 'standard'
      })
      var [variant, setVariant] = useState(function () {
        return typeof initial.variant === 'number' ? initial.variant : 0
      })
      var [result, setResult] = useState(null)
      var [editing, setEditing] = useState(false)
      var [copyDone, setCopyDone] = useState(false)
      var [confirmInsert, setConfirmInsert] = useState(false)
      var [notice, setNotice] = useState(null)
      var noticeTimer = useRef(null)
      var resultRef = useRef(null)
      var inputRef = useRef(null)

      var flash = function (kind, message) {
        setNotice({ kind: kind, message: message })
        if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
        noticeTimer.current = window.setTimeout(function () { setNotice(null) }, 3000)
      }
      useEffect(function () {
        return function () {
          if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
        }
      }, [])

      // A draft handed over by the composer chip is applied exactly once.
      useEffect(function () {
        if (!next.pending) return
        handoff.pending = false
        var text = next.text || ''
        setInput(text)
        setResult(null)
        setEditing(false)
        setConfirmInsert(false)
        writeStore({ input: text })
        if (text) {
          flash('ok', t('synced'))
        } else {
          flash('ok', t('cleared'))
          try { if (inputRef.current && inputRef.current.focus) inputRef.current.focus() } catch (e) { /* focus is optional */ }
        }
      }, [next.version])

      var stale = result !== null && (
        result.source !== String(input || '').trim() ||
        result.strength !== strength ||
        result.domain !== domain
      )

      var run = function (overrides) {
        var o = overrides || {}
        var nextDomain = typeof o.domain === 'string' ? o.domain : domain
        var nextStrength = typeof o.strength === 'string' ? o.strength : strength
        var nextVariant = typeof o.variant === 'number' ? o.variant : variant
        var text = String(input || '').trim()
        if (!text) { flash('bad', t('noInput')); return }
        var built = buildPrompt(text, { domain: nextDomain, strength: nextStrength, variant: nextVariant })
        if (!built) { flash('bad', t('noInput')); return }
        built.source = text
        built.strength = nextStrength
        built.domain = nextDomain
        setResult(built)
        setVariant(nextVariant)
        setEditing(false)
        setConfirmInsert(false)
        writeStore({ input: text, domain: nextDomain, strength: nextStrength, variant: nextVariant })
        flash('ok', t('done'))
        window.setTimeout(function () {
          try {
            if (resultRef.current && resultRef.current.scrollIntoView) resultRef.current.scrollIntoView({ block: 'nearest' })
          } catch (e) { /* scrolling is cosmetic */ }
        }, 30)
      }

      var chooseDomain = function (id) {
        setDomain(id)
        writeStore({ domain: id })
        if (result !== null) run({ domain: id })
      }
      var chooseStrength = function (id) {
        setStrength(id)
        writeStore({ strength: id })
        if (result !== null) run({ strength: id })
      }

      var onCopy = function () {
        if (result === null) return
        var text = result.text
        var done = function (ok) {
          if (ok) {
            setCopyDone(true)
            window.setTimeout(function () { setCopyDone(false) }, 1600)
          }
          flash(ok ? 'ok' : 'bad', ok ? t('copied') : t('copyFail'))
        }
        try {
          copyText(text).then(done).catch(function () { done(false) })
        } catch (e) {
          done(false)
        }
      }

      var onInsert = function () {
        if (result === null) return
        var text = result.text
        var ia = props && props.inputActions
        if (composerPhase !== undefined && composerPhase !== 'plain') {
          flash('bad', t('busy'))
          return
        }
        if (!ia || typeof ia.setDraft !== 'function') {
          try {
            copyText(text).then(function (ok) { flash(ok ? 'ok' : 'bad', ok ? t('insertFailed') : t('copyFail')) })
          } catch (e) { flash('bad', t('copyFail')) }
          return
        }
        var current = String(composerDraft || '').trim()
        if (current && current !== text.trim() && !confirmInsert) {
          setConfirmInsert(true)
          flash('bad', t('overwriteHint'))
          return
        }
        setConfirmInsert(false)
        try {
          ia.setDraft(text)
          flash('ok', t('inserted'))
        } catch (e) {
          try {
            copyText(text).then(function (ok) { flash(ok ? 'ok' : 'bad', ok ? t('insertFailed') : t('copyFail')) })
          } catch (x) { flash('bad', t('copyFail')) }
        }
      }

      var domainChips = DOMAIN_ORDER.map(function (id) {
        return h('button', {
          key: id, type: 'button', className: 'dspo-tag',
          'aria-pressed': domain === id,
          onClick: function () { chooseDomain(id) },
        }, domainLabel(id, t, uiLang))
      })

      var strengthChips = ['light', 'standard', 'deep'].map(function (id) {
        return h('button', {
          key: id, type: 'button', className: 'dspo-tag',
          'aria-pressed': strength === id,
          onClick: function () { chooseStrength(id) },
        }, t(id))
      })

      var onKeyDown = function (event) {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault()
          run()
        }
      }

      var resultBlock = result === null ? null : h('section', {
        key: 'res', className: 'dspo-section', ref: resultRef, 'data-prompt-optimizer-result': '',
      }, [
        h('div', { key: 'h', className: 'dspo-result-head' }, [
          h('div', { key: 'm', className: 'dspo-result-meta' }, [
            h('span', { key: 'd' }, t('meta', {
              domain: domainLabel(result.domain, t, uiLang),
              from: String(result.source.length),
              to: String(result.text.length),
            })),
            stale ? h('span', { key: 's', className: 'dspo-stale' }, ' · ' + t('stale')) : null,
          ]),
          h('div', { key: 'a', className: 'dspo-actions' }, [
            h('button', { key: 'c', type: 'button', className: 'dspo-link', onClick: onCopy }, copyDone ? t('copied') : t('copy')),
            h('button', { key: 'i', type: 'button', className: 'dspo-link', onClick: onInsert }, confirmInsert ? t('overwriteBtn') : t('insert')),
            h('button', {
              key: 'e', type: 'button', className: 'dspo-link',
              onClick: function () { setEditing(!editing) },
            }, editing ? t('preview') : t('edit')),
            h('button', {
              key: 'a', type: 'button', className: 'dspo-link',
              onClick: function () { run({ variant: variant + 1 }) },
            }, t('again')),
          ]),
        ]),
        editing
          ? h('textarea', {
            key: 't', className: 'dspo-input dspo-result-edit', value: result.text, spellCheck: false,
            'aria-label': t('result'),
            onChange: function (event) {
              setResult(Object.assign({}, result, { text: event.target.value }))
            },
          })
          : h('pre', { key: 'p', className: 'dspo-result' }, result.text),
      ])

      var emptyBlock = resultBlock === null ? h('section', { key: 'empty', className: 'dspo-section' }, [
        h('div', { key: 'l', className: 'dspo-label' }, t('result')),
        h('div', { key: 'e', className: 'dspo-empty' }, [
          h('ol', { key: 's', className: 'dspo-steps' }, [
            h('li', { key: '1' }, t('step1')),
            h('li', { key: '2' }, t('step2')),
            h('li', { key: '3' }, t('step3')),
          ]),
        ]),
      ]) : null

      return h('div', { className: 'dspo-page', 'data-prompt-optimizer-panel': '' }, [
        h('header', { key: 'h', className: 'dspo-head' }, [
          h('div', { key: 't', className: 'dspo-title' }, t('title')),
          h('div', { key: 's', className: 'dspo-sub' }, t('sub')),
        ]),
        h('div', { key: 'b', className: 'dspo-body' }, [
          h('section', { key: 'src', className: 'dspo-section' }, [
            h('label', { key: 'l', className: 'dspo-label', htmlFor: 'dspo-input' }, t('source')),
            h('textarea', {
              key: 'i', id: 'dspo-input', ref: inputRef, className: 'dspo-input',
              placeholder: t('placeholder'),
              value: input,
              spellCheck: false,
              'aria-keyshortcuts': 'Control+Enter Meta+Enter',
              onChange: function (event) {
                var value = event.target.value
                setInput(value)
                setConfirmInsert(false)
                writeStore({ input: value })
              },
              onKeyDown: onKeyDown,
            }),
            h('div', { key: 'r', className: 'dspo-row' }, [
              h('span', { key: 'c', className: 'dspo-dim' }, String(input.length) + ' ' + t('chars')),
              h('span', { key: 'f', className: 'dspo-grow' }),
              h('button', {
                key: 'x', type: 'button', className: 'dspo-link',
                onClick: function () {
                  setInput('')
                  setResult(null)
                  setEditing(false)
                  writeStore({ input: '' })
                },
              }, t('clear')),
              h('button', {
                key: 's', type: 'button', className: 'dspo-link',
                onClick: function () {
                  setInput(t('sampleText'))
                  setResult(null)
                  setEditing(false)
                  writeStore({ input: t('sampleText') })
                },
              }, t('sample')),
            ]),
          ]),
          h('section', { key: 'ctl', className: 'dspo-section' }, [
            h('div', { key: 'dl', className: 'dspo-label' }, t('domain')),
            h('div', { key: 'dc', className: 'dspo-chips' }, domainChips),
            h('div', { key: 'sl', className: 'dspo-label dspo-label-gap' }, t('strength')),
            h('div', { key: 'sc', className: 'dspo-chips' }, strengthChips),
            h('div', { key: 'sh', className: 'dspo-hint' }, t(strength + 'Hint')),
          ]),
          h('div', { key: 'run', className: 'dspo-run-row' }, [
            h('button', {
              key: 'b', type: 'button', className: 'dspo-primary',
              disabled: String(input || '').trim() === '',
              onClick: function () { run() },
            }, t('run')),
            String(input || '').trim() === '' ? h('span', { key: 'n', className: 'dspo-hint' }, t('noInput')) : null,
          ]),
          resultBlock,
          emptyBlock,
        ]),
        notice === null ? null : h('div', {
          key: 'status', role: 'status', 'aria-live': 'polite',
          className: 'dspo-status ' + (notice.kind === 'ok' ? 'is-ok' : 'is-bad'),
        }, notice.message),
      ])
    }

    function PanelTitle(props) {
      return tr(props)('title')
    }

    /* ------------------------------------------------------------------ *
     * styles (one <style> element, removed on unload)
     * ------------------------------------------------------------------ */

    var CSS = [
      '.dspo-chip{display:inline-flex;align-items:center;gap:4px;flex:none;height:28px;padding:0 8px;',
      'border:none;border-radius:var(--dsw-radius-sm);background:transparent;',
      'color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:13px;font-weight:500;',
      'line-height:20px;cursor:pointer;white-space:nowrap;max-width:100%}',
      '@media (hover:hover){.dspo-chip:hover{background:var(--dsw-alias-interactive-bg-hover);',
      'color:var(--dsw-alias-label-primary)}}',
      '.dspo-chip:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-border-selected));outline-offset:2px}',
      '.dspo-chip-glyph{flex:none}',
      '.dspo-chip-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dspo-page{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);',
      'color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);',
      'font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px}',
      '.dspo-head{display:flex;flex-direction:column;gap:2px;flex:none;padding:12px 16px 10px;',
      'border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.dspo-title{font-size:14px;font-weight:600;line-height:22px}',
      '.dspo-sub{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
      '.dspo-body{display:flex;flex-direction:column;gap:14px;flex:1;min-height:0;overflow:auto;padding:14px 16px 28px}',
      '.dspo-section{display:flex;flex-direction:column;gap:8px}',
      '.dspo-label{font-size:12px;font-weight:500;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.dspo-label-gap{margin-top:4px}',
      '.dspo-input{box-sizing:border-box;width:100%;min-height:104px;max-height:260px;resize:vertical;',
      'padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);',
      'background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;',
      'font-size:inherit;line-height:20px;outline:none}',
      '.dspo-input:focus{border-color:var(--dsw-alias-border-selected)}',
      '.dspo-input:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-border-selected));outline-offset:1px}',
      '.dspo-input::placeholder{color:var(--dsw-alias-label-tertiary)}',
      '.dspo-result-edit{min-height:220px;max-height:none}',
      '.dspo-row{display:flex;align-items:center;gap:6px;min-height:24px}',
      '.dspo-grow{flex:1;min-width:0}',
      '.dspo-dim{font-size:12px;color:var(--dsw-alias-label-tertiary)}',
      '.dspo-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
      '.dspo-link{display:inline-flex;align-items:center;min-height:24px;padding:3px 8px;border:none;',
      'border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);',
      'font-family:inherit;font-size:12px;line-height:18px;cursor:pointer}',
      '@media (hover:hover){.dspo-link:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}}',
      '.dspo-link:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-border-selected));outline-offset:1px}',
      '.dspo-chips{display:flex;flex-wrap:wrap;gap:6px}',
      '.dspo-tag{height:28px;padding:0 9px;border:0.5px solid var(--dsw-alias-border-l2);',
      'border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);',
      'font-family:inherit;font-size:12px;line-height:26px;cursor:pointer;white-space:nowrap}',
      '@media (hover:hover){.dspo-tag:hover{border-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary)}}',
      '.dspo-tag[aria-pressed="true"]{border-color:var(--dsw-alias-border-selected);',
      'background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font-weight:500}',
      '.dspo-tag:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-border-selected));outline-offset:1px}',
      '.dspo-run-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.dspo-primary{height:32px;padding:0 14px;border:none;border-radius:var(--dsw-radius-sm);',
      'background:var(--dsw-alias-button-info-fill);color:var(--dsw-alias-label-on-color);font-family:inherit;',
      'font-size:13px;font-weight:500;line-height:20px;cursor:pointer}',
      '@media (hover:hover){.dspo-primary:hover:not(:disabled){background:var(--dsw-alias-button-info-hover)}}',
      '.dspo-primary:disabled{opacity:.5;cursor:default}',
      '.dspo-primary:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-border-selected));outline-offset:2px}',
      '.dspo-status{flex:none;display:flex;align-items:center;gap:6px;padding:8px 16px;',
      'border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);',
      'font-size:12px;line-height:18px}',
      '.dspo-status.is-ok{color:var(--dsw-alias-label-secondary)}',
      '.dspo-status.is-bad{color:var(--dsw-alias-state-error-primary)}',
      '.dspo-result-head{position:sticky;top:0;z-index:1;display:flex;align-items:flex-start;',
      'justify-content:space-between;gap:8px;flex-wrap:wrap;padding:6px 0;',
      'background:var(--dsw-alias-bg-base)}',
      '.dspo-result-meta{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.dspo-stale{color:var(--dsw-alias-state-business-primary)}',
      '.dspo-actions{display:flex;align-items:center;gap:2px;flex-wrap:wrap}',
      '.dspo-result{margin:0;padding:12px;border:1px solid var(--dsw-alias-border-l1);',
      'border-radius:var(--dsw-radius-md);background:var(--dsw-alias-card-fill);',
      'font-family:var(--dsw-font-family);font-size:inherit;line-height:21px;white-space:pre-wrap;word-break:break-word}',
      '.dspo-empty{padding:14px;border:1px dashed var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);',
      'color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:19px}',
      '.dspo-steps{margin:0;padding-left:18px}',
      '.dspo-steps li{margin:2px 0}',
    ].join('\n')

    /* ------------------------------------------------------------------ *
     * registration
     * ------------------------------------------------------------------ */

    /**
     * Register the chip, the page type, and the page body.
     * @param ctx - the client plugin context.
     */
    function apply(ctx) {
      var t = ctx.locale.bind(NS)

      ctx.effect(function () {
        var id = 'dsh-prompt-optimizer-styles'
        var el = document.getElementById(id)
        if (el === null) {
          el = document.createElement('style')
          el.id = id
          el.setAttribute('data-plugin', 'dsh-prompt-optimizer')
          document.head.appendChild(el)
        }
        el.textContent = CSS
        return function () {
          var node = document.getElementById(id)
          if (node && node.parentNode) node.parentNode.removeChild(node)
        }
      }, 'prompt-optimizer: styles')

      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: DICT.zh, en: DICT.en })
      }, 'prompt-optimizer: dictionaries')

      // The page type: opened by kind from the composer chip. No `priority`:
      // a third-party type is an extension, and an extension is what would be
      // in force over a built-in of the same kind.
      ctx.effect(function () {
        return ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: TAB_KIND,
          title: function () { return t('title') },
        })
      }, 'prompt-optimizer: tab type')

      ctx.effect(function () {
        return ctx.slots.inject('sidebar.right.pane.tab', function () {
          return ctx.slots.register({
            name: 'sidebar.right.pane.tab',
            key: TAB_ID,
            locale: NS,
          }, Panel)
        })
      }, 'prompt-optimizer: panel body')

      ctx.effect(function () {
        return ctx.slots.inject('sidebar.right.pane.tab.title', function () {
          return ctx.slots.register({
            name: 'sidebar.right.pane.tab.title',
            key: TAB_ID,
            locale: NS,
          }, PanelTitle)
        })
      }, 'prompt-optimizer: panel title')

      // Without the navigation controller the chip would be a dead button, so
      // it is not registered at all.
      var controller = ctx.sidebarRight
      if (!controller || typeof controller.openTab !== 'function') {
        try { console.warn('[prompt-optimizer] 右侧栏不可用，已跳过「优化提示词」按钮') } catch (e) { /* ignore */ }
        return
      }
      function ChipSeat(props) {
        return h(ComposerChip, Object.assign({}, props, {
          openOptimizer: function () {
            try {
              controller.openTab(TAB_KIND)
            } catch (error) {
              try { console.warn('[prompt-optimizer] 无法打开右侧面板：', error) } catch (e) { /* ignore */ }
            }
          },
        }))
      }
      ctx.effect(function () {
        return ctx.slots.inject('conversation.input.left', function () {
          return ctx.slots.register({
            name: 'conversation.input.left',
            id: 'prompt-optimizer',
            order: 40,
            locale: NS,
          }, ChipSeat)
        })
      }, 'prompt-optimizer: composer chip')
    }

    var mod = {
      name: 'prompt-optimizer',
      inject: ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs'],
      apply: apply,
      // Exposed for offline syntax/behaviour checks; never used by the UI.
      __test: { buildPrompt: buildPrompt, detectDomain: detectDomain, DOMAINS: DOMAINS, Panel: Panel, ComposerChip: ComposerChip, handoffSnapshot: function () { return handoff } },
    }
    return mod
  },
})