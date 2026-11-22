# DayDayUp 项目导引文件（CONTEXT.md）

> **给未来的我 / 换模型后的我读的第一份文件。**
> 本文件固化项目的全貌、云环境、数据层、功能清单、发布方式与踩坑记录。
> publishableKey / clientId 属前端公开配置（随代码分发），除此不含任何密钥。
>
> 最后更新：2026-11-22 · 当前版本：**v0.2.4**

---

## 0. 快速恢复（无上下文时从这里开始）

1. **确认现状**：`cat VERSION`（0.2.0）；`node output/test-static.js`（静态校验）；
   `node output/test-daydayup.js`（14 项核心逻辑 mock 测试）。
2. **继续开发**：读 §2 功能清单 + §3 云环境与数据层 + §6 踩坑记录，避免重复踩坑。
3. **发布预览**：用 sites skill 对本目录做 sites_deploy（复用 applicationId，见 §5）。
4. **推送 GitHub**：见 §4（沿用 Kronos 项目的 get_secret.py 读 token）。

> 本项目是旧「subject-checkin（学科打卡）」推倒重做的 v0.2，只保留云端题库。
> 旧项目在 `/Users/ccb/WorkBuddy/2026-11-17-21-46-03/subject-checkin/`，仅作历史参考，不再维护。

---

## 1. 项目概览

| 项 | 值 |
|---|---|
| 项目本质 | 九学科做题小程序：题库抽题 + AI 一句话出题 → 在线答题 / A4 打印卷（PDF 系统打印）→ 错题本 |
| **主工作目录** | `/Users/ccb/WorkBuddy/daydayup` |
| 学科 | 数/语/英/物/化/生/地/史/政 9 科（小学综合科不在需求内） |
| 页面 | 7 页 3 tab：学科(home) / 出题(setup) / 答题(quiz) / 结果(result) / 错题本(mistakes) / 打印卷(paper) / 我的(profile) |
| GitHub 仓库 | `jikhotel/daydayup`（main） |
| 前身 | subject-checkin v1.x（语文学科打卡），已废弃 |

**版本**：v0.2.0 = 推倒重做第一版 → v0.2.1 = 真机 PDF 修复 → v0.2.2 = 年级逐级可选 → v0.2.3 = 解答题（AI 阅卷）→ v0.2.4 = bug 修复（AI 积累题可见性/题型映射/输入光标/只勾AI组卷）。

---

## 2. 功能清单

| 页面 | 功能 |
|---|---|
| home（tab·学科） | 9 科网格 + 每科云端题量（`countBySubject`），点学科 → setup |
| setup（出题配置） | 知识点范围（题库 topic_name 去重）/ 年级（初中·高中·全部）/ 教材版本（默认人教版）/ 题量 stepper 5–40 / 题型多选（单选·多选·判断·填空·解答，v0.2.3 新增解答题）/ 来源多选（题库·AI）；勾选 AI 显示一句话描述（如「人教版高一上诗词古文练习，要有古文翻译」）；双出口：在线做题 / 生成打印卷 |
| quiz（在线答题） | 按题型渲染（单选/多选/判断/填空）、翻题、提交判分（云 AI 判分辅助） |
| result（结果） | 得分/用时/错题列表；错题一键生成同类巩固题（AI）；巩固题回写题库 |
| mistakes（tab·错题本） | 错题列表 + 已掌握(mastered)标记 + 隐藏已掌握开关 + 勾选错题 AI 出巩固题 |
| paper（打印卷） | canvas 绘卷 → 长图预览/存相册 → 分页 JPEG → 手写 PDF → `wx.openDocument` 系统打印 |
| profile（tab·我的） | 登录面板 / 退出登录 / 关于 |

**组卷策略（setup.buildPaper）**：题库优先抽题（`drawQuestions`），不足且勾选 AI 时由 LLM 补足；AI 题后台回写题库（source='ai'，djb2 确定性 id 幂等）。

---

## 3. 云环境与数据层

### 3.1 云服务（workbuddy 云开发，对标 Supabase）
- SDK：`@tencent-ai/workbuddy-cloud-sdk/miniprogram`，封装在 `utils/cloud.js`
- endpoint `https://mp-api.app.workbuddy.host`；publishableKey / OAuth clientId 见 `utils/cloud.js`（前端公开配置）
- applicationId：`wbapp_UpqjqB4h7FM0hgMavsaNw8`（贯穿复用，sites_deploy 也用它）

### 3.2 数据表
| 表 | 用途 | 关键列 |
|---|---|---|
| `question_bank` | 全量题库（16413 题，来自 cn-math-taxonomy） | subject / grade(7-9初中 10-12高中) / topic_name / type(choice·numeric·short) / prompt / choices / answer / accepts / explanation / source(taxonomy·ai) |
| `quiz_sessions` | 练习会话 | subject / textbook / questionCount / correctCount / durationSec / source(bank·generate·mistake) |
| `quiz_questions` | 会话题目+作答 | sessionId / type / stem / options / answer / accepts / isCorrect / userAnswer / mastered |

### 3.3 题型映射（应用 ↔ 题库）
`single/multi → choice`；`blank → numeric`；`solve → short`（`bank.appTypesToBankTypes`）。题库 short 行经 `toAppQuestion` 转为应用 `solve`（解答题，AI 阅卷）。

### 3.4 全量导入历史（勿重复踩坑）
REST 直连路径 `{endpoint}/.cloud/database/rest/v1/<表>`，鉴权头 `x-wb-webapp-access-key`。
anon 写入要过**两道门**：CREATE POLICY + GRANT，缺一即 42501；导完 DROP policy + REVOKE 收紧。
本地 Node 脚本分批 POST（merge-duplicates）：16413 题 8 秒导完，不流经模型上下文。

---

## 4. GitHub 推送方式（凭据加密）

仓库 `jikhotel/daydayup`（main）。token 用 Kronos 项目的加密凭据库读取：
`python3 /Users/ccb/WorkBuddy/kronos-1.10/tools/get_secret.py get github_token`

⚠️ 平台内置 GitHub connector 是只读的（push 返回 403）；唯一可行通道：**清代理 + URL 内嵌 token + 禁 credential helper**。

```bash
cd /Users/ccb/WorkBuddy/daydayup
TOKEN=$(python3 /Users/ccb/WorkBuddy/kronos-1.10/tools/get_secret.py get github_token)
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u ALL_PROXY -u all_proxy \
  git -c http.version=HTTP/1.1 -c credential.helper= \
  push "https://x-access-token:${TOKEN}@github.com/jikhotel/daydayup.git" main
```

---

## 5. 预览与发布

1. sites skill：`sites_deploy(directory=/Users/ccb/WorkBuddy/daydayup, applicationId=wbapp_UpqjqB4h7FM0hgMavsaNw8)` → 预览面板。
2. 正式发布：用户在预览面板点「分享」走发布流程（发布校验器要求**跨包引用必须相对路径**，见 §6.1）。
3. 小程序账号主体名 dolordoradoex 之类改名：在 mp 平台设置里改，非代码问题。

---

## 6. 踩坑记录（重要）

1. **发布校验器不支持 `/` 绝对路径 require**：跨包引用必须算清相对层数（分包页
   `packages/<pkg>/pages/x/` → 主包 utils 需 `../../../../utils/...`）。本项目当前无分包，
   统一 `../../utils/...`；若将来加分包，import 页要写相对层数。
2. **navigateTo 跳 tabBar 页静默失败**：跨 tab 传参只能 `switchTab` + `globalData`。
   tab 页间传参同样如此（如 home → setup 用 navigateTo 可行，因 setup 非 tab 页）。
3. **42501 anon 写库**：policy 与 grant 两道门缺一不可（§3.4）。
4. **LLM 流式**：`messages[0] 必须 system`；模型经 `cloud.llm.models.list()` 动态选
   （auto → 含 flash → 第一个可用）；`response_format: {type:'json_object'}`。
   模型输出可能带 ```json 围栏，`extractJson` 已兜底。
5. **PDF 无第三方库方案**：canvas 整卷绘制 → 按 A4 比例（pageH = W×297/210）逐页裁 JPEG →
   手写极简 PDF（每页一张 JPEG XObject，/DCTDecode 原始字节直嵌，无字体依赖）→
   `fs.writeFileSync(ArrayBuffer,'binary')` → `wx.openDocument(fileType:'pdf', showMenu:true)`。
   ⚠️ **真机踩坑（v0.2.1 修复）**：
   a. `fs.readFile` 返回的是 **ArrayBuffer**，必须 `new Uint8Array(r.data)` 包一层再进
      `buildPdf`——`TypedArray.set()` 不接受 ArrayBuffer，真机抛 `offset is out of bounds`
      （本地 Node 测试用 Buffer 复现不出来，Buffer 是 Uint8Array 子类）。
   b. iOS canvas 单边/面积有硬限制（约 4096/4096²）：整卷画布 totalH×dpr 可能超限导致
      导出失败或白图 → `clampDpr` 按 totalH 动态压 dpr（下限 1，约 150dpi 可打印）。
   c. 失败要可见：makePdf 分 3 阶段 loading + console.log('[paper]') 打点 +
      错误弹窗（只写 errorMsg 卡片用户看不到，会误以为「按钮没效果」）；
      openDocument 失败降级 `wx.shareFileMessage` 转发 PDF。
6. **grade 语义**：1-6 小学 / 7-9 初中 / 10-12 高中（已 group by 验证）。
7. **WXML 不支持复杂表达式/动态 bindtap**：绑定方法名必须静态存在于 js（`output/test-static.js` 会查）。
8. **AI 题回写幂等**：`ai_` + djb2(subject|stem) 确定性 id + upsert ignoreDuplicates。
9. **AI 积累题可见性（v0.2.4 修）**：saveGeneratedToBank 写 grade=null，任何 grade 过滤
   （gte/lte/in）都会把它们全部排除——drawQuestions 在「全部」年级时**不下发 grade 过滤**，
   countBySubject/listTopics 完全不过滤 grade。
10. **题型映射含 AI 行（v0.2.4 修）**：回写行 type 是 multi/judge 原值，appTypesToBankTypes
   必须映射 multi→multi、judge→judge，否则选多选/判断永远抽不到 AI 积累的题。
11. **quiz 输入光标（v0.2.4 修）**：textarea/input 每次 keying 都 setData 整个题目列表会
   光标跳动——onBlankInput 只更新圆点 answered，切题时再 _refreshView 同步输入值。
12. **只勾 AI 出题（v0.2.4 修）**：setup 只勾 AI 时不能再调 drawQuestions（空 sources 会
   回退成抽全部来源的题库题，AI 被跳过）。

---

## 7. 测试

| 文件 | 覆盖 |
|---|---|
| `output/test-static.js` | JSON 合法性 / 7 页四件套完整 / JS 语法 / wxml 绑定↔js 方法一致 / require 路径存在 |
| `output/test-daydayup.js` | 题型映射 / drawQuestions 查询条件（含 grade 区间）/ toAppQuestion / AI 回写幂等 / 判分（multi 顺序无关、blank 归一化别名）/ LLM JSON 解析 / setup.buildPaper 教材拼接与 AI 补足 |

mock 方式：require.cache 注入 fake cloud；`global.Page/wx/getApp` stub。

---

## 8. 状态快照（2026-11-22）

- 代码：7 页 + 6 utils + login-panel 组件全部就位；静态校验 + 14 项 mock 测试全过。
- 未验证：真机答题/打印/登录流程（沙盒无法真机跑）；发布需用户在预览面板点「分享」。
- 题库：16413 题在云端 `question_bank`，subject 字段已按 9 学科覆盖（数学为原始主体，
  其他学科题量以实际 countBySubject 为准）。
