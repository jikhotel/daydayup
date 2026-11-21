# DayDayUp

九学科做题小程序（数 / 语 / 英 / 物 / 化 / 生 / 地 / 史 / 政），v0.2.0。

- **出题**：题库抽题（16k+ 题云端题库）+ AI 一句话出题（如「人教版高一上诗词古文练习，要有古文翻译」），可配置知识点范围 / 年级 / 教材版本 / 题量 / 题型 / 来源
- **做题**：在线答题，自动判分；答错的题自动收进错题本，可一键生成同类巩固题
- **打印**：一键生成 A4 练习卷 PDF，调起系统打印
- **错题本**：错题归档、已掌握标记、按错题再出题

架构与踩坑记录见 [CONTEXT.md](./CONTEXT.md)。

## 开发

```bash
npm install            # 安装 @tencent-ai/workbuddy-cloud-sdk
node output/test-static.js    # 静态校验（页面完整 / 绑定一致 / 语法）
node output/test-daydayup.js  # 核心逻辑 mock 测试（14 项）
```

用 WorkBuddy 的小程序开发流程打开本目录进行预览与发布。
