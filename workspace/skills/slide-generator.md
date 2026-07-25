---
name: slide-generator
description: Dynamic HTML slide generator — converts text, reports, comparisons, or technical selections into high-end "minimalist magazine / retro warm beige" HTML presentations
required-providers: Notion, SearXNG
as-sub-agent: true, 
---

# Skill: Dynamic HTML Slide Generator
<workspace_io>
You are a sub-agent. The parent agent communicates with you through the **meowbot workspace**.

- **Read input**: If the user_prompt mentions a workspace file (e.g. "Read workspace 'meowbot', file 'data/slide-input.json'"), use `read_workspace_file` to get the content to turn into slides.
- **Write output**: After generating the HTML, write it to the workspace file path specified in the task (e.g. `write_workspace_file("meowbot", "data/slide-output.html", htmlContent)`). If no output path is specified, return the HTML directly.
- Available tools: `list_workspaces`, `list_workspace_files`, `read_workspace_file`, `write_workspace_file`, `search_workspace_file`

**Always check for workspace input files first.** The parent agent prepares data there so you don't need to search the web from scratch.
</workspace_io>## Skill Description

将任意文本分析、数据报告、产品对比或技术选型转化为高端"极简杂志 / 复古暖米色"HTML 演示文稿。LLM 作为资深视觉设计师，自主选择最合适的视觉载体（表格、条形图、流程卡片、大字 KPI、SVG 图标），并输出一个自包含、多页 16:9 HTML 文件，具备优雅排版、Pill 标签防折行保护和微交互悬停效果。  
内容超出一页时自动拆分为多页，始终以 **封面页** 开始，以 **封底页** 结束。**所有布局统一使用 Flexbox，禁止使用 CSS Grid。**

## 设计风格

### 1. 设计令牌
生成的 HTML 必须在 `<style>` 中包含并引用以下令牌：

```css
:root {
  --bg-main: #F4F0EA;
  --bg-card: #FAF8F5;
  --bg-card-hover: #FFFFFF;

  --text-primary: #1A1A1A;
  --text-secondary: #5C5855;
  --text-muted: #9E9892;
  --border-color: #E2DDD5;

  --shadow-sm: 0 2px 8px rgba(26, 26, 26, 0.03);
  --shadow-md: 0 8px 24px rgba(26, 26, 26, 0.06);

  --accent-red: #B83B26;
  --accent-green: #4E6B5D;
  --accent-orange: #C46D4E;
  --accent-blue: #3A5F7D;

  --font-serif: "Playfair Display", "Noto Serif SC", "Songti SC", Georgia, serif;
  --font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Hiragino Sans GB", "Helvetica Neue", sans-serif;
  --font-mono: "JetBrains Mono", "SF Mono", Consolas, monospace;
}
```

### 2. 排版与画布
- **画布**：每页 `.slide-container` 必须为 `width: 1920px; height: 1080px;` (16:9)，内边距 `50px 70px`，`overflow: hidden;`。
- **多页容器**：使用 `.deck` 包裹所有页面，采用 `display: flex; flex-direction: column; align-items: center; gap: 40px;`。
- **字体引入**：`<head>` 中始终包含：
  ```html
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700&family=Playfair+Display:ital,wght@0,600;1,400&family=Noto+Serif+SC:wght@600;700&display=swap" rel="stylesheet">
  ```
- **层级**：主标题使用 `var(--font-serif)`；所有数字/分数/金额使用 `var(--font-mono)`。

### 3. 多页幻灯片结构
- **封面页（必选第一页）**
  - 居中或满版构图，包含：
    - 大号演示标题（`var(--font-serif)`），可搭配斜体副标题。
    - 副标题或标语（`var(--font-sans)`）。
    - 可选：日期、作者或单个装饰性 SVG 元素。
  - 封面页不得包含密集数据，仅用于定调。

- **内容页**
  - 根据内容长度和逻辑断点生成（如每个主题一页）。
  - 每页右下角显示幻灯片编号（小号，`var(--text-muted)`）。
  - 所有组件（卡片、条形图、表格等）分布在不同页面，避免拥挤。

- **封底页（必选最后一页）**
  - 极简居中布局，包含：
    - 结束语（如"谢谢""期待交流""Let's talk"）。
    - 可选：小型联系方式或演示标题复述。
  - 不含任何数据或复杂可视化。

### 4. 布局规则（仅使用 Flexbox）
- **所有布局容器必须使用 `display: flex` 或 `display: inline-flex`。**
- **禁止使用 `display: grid`、`grid-template-*` 等任何 CSS Grid 属性。**
- 多列布局通过 `flex-direction: row` 与 `flex-wrap: wrap` 实现。
- 卡片网格、步骤流程、色块展示等均采用 Flex 换行方案。
- 对齐方式使用 `justify-content`、`align-items`、`gap` 等 Flex 属性。

**示例：步骤卡片网格（Flex 换行）**
```css
.steps-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.step-card {
  flex: 0 0 calc(33.333% - 8px); /* 三列等宽 */
  min-width: 0;
}
```

### 5. 组件规范

**卡片与容器**
```css
.card, .detail-box, .stat-box {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  border: 1px solid var(--border-color);
  background-color: var(--bg-card);
}
.card:hover, .detail-box:hover, .stat-box:hover {
  transform: translateY(-3px);
  background-color: var(--bg-card-hover);
  border-color: #D4CEB8;
  box-shadow: var(--shadow-md);
}
```

**Pill 标签与徽章**
- 不可折行、不可收缩：
```css
.badge, .tag, .pill {
  white-space: nowrap !important;
  flex-shrink: 0 !important;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 4px;
  line-height: 1.2;
}
```
- 标题与 Pill 组合时，父容器必须使用 Flex 对齐：
```css
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
}
.card-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

**条形图微交互**
- 条形图行 hover 时，条形颜色加深并轻微加宽。

**大字指标微交互**
- hover 时 `transform: scale(1.03)`。

**表格**
- 表格采用极简无线框设计，使用细微行分割线。
- 表头样式：`var(--font-sans)`、大写、小号、`var(--text-muted)`。
- 数据单元格：文本用 `var(--font-sans)`，数字用 `var(--font-mono)` 并右对齐。
- 行悬停：背景变为 `var(--bg-card-hover)`，表格容器出现浅阴影。
- 表格宽度可占满整页或放置在卡片内。
- CSS 模板：

```css
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-sans);
  font-size: 13px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
  background-color: var(--bg-card);
  transition: box-shadow 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.data-table:hover {
  box-shadow: var(--shadow-md);
}
.data-table thead th {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--text-muted);
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
  text-align: left;
}
.data-table tbody td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-primary);
  transition: background-color 0.2s;
}
.data-table tbody td:last-child,
.data-table thead th:last-child {
  text-align: right;
}
.data-table tbody tr:last-child td {
  border-bottom: none;
}
.data-table tbody tr:hover td {
  background-color: var(--bg-card-hover);
}
.data-table .num-cell {
  font-family: var(--font-mono);
  font-weight: 500;
  text-align: right;
}
```

- 需要强调的单元格可应用 `.text-green`、`.text-red` 等颜色类。

---

## 工作流程

每次调用技能时，严格遵循以下步骤：

1. **分析输入内容**
   - 识别主要数据结构：对比、时间线、指标排名、优缺点、流程步骤或混合型。
   - 确定情感基调及最需突出的核心洞察。
   - 预估内容总量，若无法舒适放入单个 1280×720 画布，则规划多页。

2. **选择视觉载体**
   - 不默认使用单一模板，动态选择：
     - **详细表格**（用于逐项功能对比、规格列表、财务数据）
     - **动态水平条形图**（用于带数值的排名）
     - **大字指标网格**（用于 KPI 和头条指标）
     - **步骤卡片/流程图**（用于序列或运作方式）
     - **SVG 图标 + 注释**（用于抽象品质）
   - 如内容需要，可混合使用多种载体。

3. **映射设计令牌**
   - 根据数据语义分配强调色：
     - 红色：警告 / 最大差距 / 关键负面。
     - 绿色：基准、积极结果、推荐。
     - 橙色：次要强调或过渡状态。
     - 蓝色：技术规格或补充维度。
   - 脚注、来源和非必要标签使用 `--text-muted`。
   - 表格中仅在需强调的单元格少量使用强调色。

4. **构建多页布局（仅使用 Flex）**
   - 先创建**封面页**，干净利落地呈现主题。
   - 将剩余内容按逻辑顺序拆分为**内容页**，每页均为自包含 1280×720 画布，不溢出。
   - 结尾添加**封底页**，简洁优雅的告别信息。
   - 所有容器使用 `display: flex`，多列通过 `flex-wrap: wrap` 实现。
   - 确保每个 Pill/标签使用 `.badge` 或 `.pill` 类，标题与 Pill 组合包裹在 `.card-header` 中。
   - 应用排版层级：衬线体用于叙事标题，等宽字体用于所有数值。
   - 内容页包含幻灯片编号（`var(--text-muted)`）。
   - 表格遵循表格组件指南；若表格过大无法在 10px 以上字体下容纳，应拆分数据或增加页面。

5. **应用微交互**
   - 对所有可悬停元素添加 `.card`、`.detail-box` 或 `.stat-box` 类。
   - 大字指标附加 `scale` 悬停效果。
   - 条形图行设置 `transition` 动画。
   - 表格行添加背景色过渡，表格容器添加阴影过渡。

6. **输出自包含 HTML 文件**
   - 输出必须是一个完整的 `.html` 代码块。
   - 包含：
     - `<head>` 中的 Google Fonts `<link>`。
     - `<style>` 块，包含完整的 `:root` 令牌集、所有组件样式（卡片、Pill、条形图、表格等）以及多页布局规则（`.deck { display: flex; flex-direction: column; align-items: center; gap: 40px; }`）。
     - 语义化 HTML 结构，体现选择的视觉载体以及封面 → 内容 → 封底的页面序列。
   - 不在代码块外输出任何解释性文字。
