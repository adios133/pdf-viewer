# PdfPreview —— PDF 预览库

基于 [pdf.js](https://github.com/mozilla/pdf.js) 组件库（`pdfjs-dist` v6）的 PDF 预览库：
功能对齐浏览器内置 PDF 查看器，并针对大文件做了专门的懒加载与内存优化。

已改为**库模式**打包：`pnpm build` 产出 ESM 入口 + 独立样式 + 类型声明，
可以直接被 Vite / webpack / Rollup / Next.js 等宿主项目通过 npm 引入。

## 快速开始（宿主项目）

```bash
pnpm add pdf-preview-plugin pdfjs-dist   # pdfjs-dist 是 peerDependency，需宿主自行安装
```

```ts
import { PdfPreview } from "pdf-preview-plugin"
import "pdf-preview-plugin/style.css" // 库不会自动注入样式，需显式引入一次

const preview = new PdfPreview({
  container: document.querySelector("#app")!, // 可选：缺省铺满视口
  url: "/large.pdf", // 或 file: File / data: Uint8Array
  initialScale: "auto",
  showThumbnails: true,
  onLoad: (info) => console.log("loaded", info.numPages, "pages"),
  onError: (err) => console.error(err),
  onProgress: ({ percent }) => console.log(percent + "%"),
})
await preview.load()
preview.destroy() // 组件卸载时调用，释放 worker / 文档 / DOM
```

> 需要 `pdfjs-dist` v6（ESM）。库本身只打包「查看器 UI」，pdf.js 核心由宿主项目提供，
> 因此不会出现两份 pdf.js 互相打架的问题，也便于宿主统一升级。

### 在 Vue / React 中使用

```ts
// Vue：onMounted 创建、onBeforeUnmount 销毁
import { onMounted, onBeforeUnmount, ref } from "vue"
const el = ref<HTMLElement>()
let preview: PdfPreview | null = null
onMounted(async () => {
  preview = new PdfPreview({ container: el.value, url: "/file.pdf" })
  await preview.load()
})
onBeforeUnmount(() => preview?.destroy())
```

```ts
// React：useEffect 创建，cleanup 里销毁
useEffect(() => {
  const preview = new PdfPreview({ container: ref.current!, url: "/file.pdf" })
  preview.load()
  return () => preview.destroy()
}, [])
```

## 静态资源（worker / cMap / 字体 / wasm）

pdf.js 运行时还需要 worker 脚本和 cMap、标准字体、wasm、ICC 等静态资源。
库的默认策略是**按宿主安装的 pdfjs-dist 版本指向 jsDelivr CDN**，开箱即用：

- `workerSrc` → `https://cdn.jsdelivr.net/npm/pdfjs-dist@<version>/build/pdf.worker.min.mjs`
- `cMapUrl` → `.../cmaps/`
- `standardFontDataUrl` → `.../standard_fonts/`
- `wasmUrl` → `.../wasm/`
- `iccUrl` → `.../iccs/`

地址解析优先级：**实例选项 > `configurePdfPreviewAssets()` 全局配置 > 宿主已设置的
`GlobalWorkerOptions.workerSrc` > CDN 默认值**。

### 离线 / 内网部署

把资源从 `node_modules/pdfjs-dist` 拷到站点静态目录（注意各目录地址都要以 `/` 结尾）：

```bash
cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/pdfjs/
cp -R node_modules/pdfjs-dist/{cmaps,standard_fonts,wasm,iccs} public/pdfjs/
```

```ts
import { configurePdfPreviewAssets } from "pdf-preview-plugin"

configurePdfPreviewAssets({
  workerSrc: "/pdfjs/pdf.worker.min.mjs",
  cMapUrl: "/pdfjs/cmaps/",
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  wasmUrl: "/pdfjs/wasm/",
  iccUrl: "/pdfjs/iccs/",
})
```

也可以只对单个实例生效：

```ts
new PdfPreview({
  url: "/file.pdf",
  workerSrc: "/pdfjs/pdf.worker.min.mjs",
  cMapUrl: "/pdfjs/cmaps/",
})
```

> worker 版本必须与宿主安装的 `pdfjs-dist` 完全一致（pdf.js 内部有版本校验），
> 升级依赖后记得重新拷贝。`PDFJS_VERSION` 导出了当前运行时版本。

## 构建与发布

```bash
pnpm install
pnpm dev          # 本地演示页 http://localhost:5173
pnpm build        # 库构建：dist/ 下的 js + css + 类型声明
pnpm build:demo   # 演示页构建：输出到 dist-demo/
pnpm pack:check   # npm pack --dry-run，检查发布内容
npm publish       # 发布（prepublishOnly 会自动重新构建）
```

产物结构：

```
dist/
  pdf-preview.js        # ESM 入口（pdfjs-dist 保持 external）
  pdf-preview.js.map
  style.css             # 插件 + pdf_viewer 样式（图片已内联，单文件自包含）
  types/                # .d.ts 类型声明
```

`package.json` 已配置 `exports` / `types` / `files` / `peerDependencies`：

| 字段                     | 值                    | 说明                                    |
| ------------------------ | --------------------- | --------------------------------------- |
| `exports["."]`           | `dist/pdf-preview.js` | ESM 入口，附带 `types`                  |
| `exports["./style.css"]` | `dist/style.css`      | `import "pdf-preview-plugin/style.css"` |
| `peerDependencies`       | `pdfjs-dist ^6.2.0`   | 由宿主项目安装                          |
| `files`                  | `dist`                | 只发布构建产物                          |

在其他项目中本地联调：

```bash
# 方式一：本地路径依赖
pnpm add ../pdf-viewer          # 或 npm i ../pdf-viewer
# 方式二：先打包再安装
pnpm pack && pnpm add ./pdf-preview-plugin-1.0.0.tgz
# 方式三：pnpm link --global（在库目录执行 pnpm link --global，再在宿主项目 pnpm link --global pdf-preview-plugin）
```

> 采用库模式后 `pnpm build` 不再输出演示页；演示页仍可用 `pnpm dev` 开发，
> 需要静态部署演示页时用 `pnpm build:demo`。

## API

```ts
import {
  PdfPreview,
  createPdfPreview, // 创建 + 自动 load 的便捷工厂
  configurePdfPreviewAssets,
  ScrollMode,
  SpreadMode,
  TextLayerMode,
} from "pdf-preview-plugin"

// 交互
preview.gotoPage(12)
preview.nextPage()
preview.zoomIn() / preview.zoomOut() / preview.setScale(1.5) / preview.fitWidth() / preview.fitPage()
preview.rotateCW() / preview.setRotation(90)
preview.find("pdf.js") / preview.findNext() / preview.findPrevious()
preview.toggleThumbnails(true) / preview.toggleFindBar(true) / preview.togglePresentation()
preview.print() / preview.download()
preview.setScrollMode(ScrollMode.PAGE) / preview.setSpreadMode(SpreadMode.ODD)
preview.cleanup() / preview.destroy()

// 标绘 API
preview.toggleMarks(true)
// 标绘工具：V 选择、P 画笔、K 水墨笔、M 水性笔、L 直线、A 箭头、R 矩形、O 椭圆、G 多边形、N 折线、T 文字
preview.setMarks([...]) / preview.getMarks() / preview.clearMarks()
preview.exportMarks() / preview.importMarks(json)
preview.on("markschange", ({ marks }) => ...)

// 主题
preview.setTheme("dark") // light | dark | sepia | green
preview.setAccent("#ff6600") / preview.resetAccent()
preview.getTheme() / preview.on("themechange", ({ theme }) => ...)
```

事件：`load` / `progress` / `error` / `pagechange` / `scalechange` / `rotationchange` /
`render` / `findstate` / `pagesloaded` / `markschange` / `themechange`，可用
`preview.on("pagechange", cb)` 订阅（返回取消订阅函数），也支持选项里的
`onLoad` / `onError` / `onProgress` / `onPageChange` / `onScaleChange` / `onRender` /
`onMarksChange` / `onThemeChange` 回调。

`PdfPreviewOptions` 的完整字段见 `dist/types/plugin/types.d.ts`，常用的有：
`container`、`url` / `file` / `data`、`workerSrc`、`initialPage`、`initialScale`、
`rotation`、`scrollMode`、`spreadMode`、`showToolbar`、`showStatusbar`、`showThumbnails`、
`textLayerMode`、`annotationMode`、`maxCanvasPixels`、`rangeChunkSize`、`cMapUrl`、
`standardFontDataUrl`、`wasmUrl`、`iccUrl`、`theme`、`persistTheme`、`password` 等。

`loadPdf(src, assets?)` 仅加载文档不渲染，供需要自行控制渲染的场合使用。

## 功能清单（对齐浏览器内置查看器）

- 连续滚动 + 页面懒渲染：只渲染可视区域附近的页面，滚动时取消非可视页的渲染任务
- 缩放：自动 / 实际大小 / 适合页宽 / 适合页面 / 50%~400% / 自定义；支持 Ctrl+滚轮与快捷键
- 旋转 0/90/180/270
- 页码导航（首页/上一页/下一页/末页、页码输入框）
- 缩略图侧栏：懒渲染、滚动缓冲、并发上限、当前页高亮
- 文本选择与复制（TextLayer）
- 查找（Ctrl+F）：匹配计数、高亮全部、区分大小写、上一个/下一个、循环提示
- 打印（隐藏 iframe 逐页渲染）、下载（同源直链 / getData 兜底）
- 标绘层：画笔 + 水墨笔（变宽笔锋、墨晕）+ 水性笔，以及直线/箭头/矩形/椭圆/多边形/折线/文字标注；
  颜色/填充可调，笔宽 1~64px 任意自定义；选择移动、撤销重做、清空、JSON 导入导出；随缩放/旋转自动同步
- 主题切换：浅色 / 深色 / 护眼米黄 / 森林绿 4 套主题 + 自定义强调色，localStorage 记忆
- 全屏演示模式（页面居中、方向键翻页）
- 键盘快捷键：`f` 查找、`t` 缩略图、`d` 下载、`p` 打印、`r` 旋转、
  `Ctrl/Cmd+F/P/S/0/+/-`、`PageUp/PageDown`、`Home/End`（输入框内不拦截）
- 加密 PDF：密码输入提示（`password` 选项或回调）

## 大文件优化

| 手段                  | 说明                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 流式加载 + Range 分块 | `disableStream: false`、`disableAutoFetch: false`（默认），服务端支持 `Accept-Ranges` 时按 64KB 块按需拉取（`rangeChunkSize` 可调） |
| 懒渲染 + 渲染队列     | 只有视口附近页面进入渲染队列，高优先级页面优先，滚动即取消低优先级任务                                                              |
| 页面缓冲自适应        | 页面缓冲大小随可视页数动态调整（`max(10, 2×可视页+1)`），超出即销毁并释放                                                           |
| canvas 内存上限       | `maxCanvasPixels`（默认 32MP）+ 细节画布：超高缩放时 CSS 缩放 + 局部高清重绘，避免超大 canvas                                       |
| 空闲自动清理          | 停止滚动/缩放 5s 后自动 `document.cleanup()` 释放字体、图像等临时资源                                                               |
| 缩略图有界渲染        | IntersectionObserver + 600px 缓冲带 + 2 路并发，滚出视野即取消并清空画布                                                            |
| 打印逐页渲染          | 打印时顺序渲染每页，避免一次性占满内存                                                                                              |
| 文本层按需            | 文本层随页面渲染创建，查找时按页提取文本                                                                                            |

实测（500 页 large.pdf，无头 Chrome）：首屏仅渲染 2 个 canvas；滚动到第 300 页后，
DOM 中保持 ~8 个已渲染画布（视口 + 缓冲），页码同步为 300；缩略图只渲染视口附近约 70 张。

## 本地演示页

```bash
pnpm install
pnpm dev # http://localhost:5173
```

演示页提供 4 个文档：

| 文档         | 说明                                 |
| ------------ | ------------------------------------ |
| `sample.pdf` | 本地 6 页示例（脚本生成，离线可用）  |
| `large.pdf`  | 本地 500 页大文件，用于验证懒渲染    |
| `git.pdf`    | 远程 19 页（经 Vite 代理）           |
| `测试.pdf`   | 远程中文 PDF（验证 CJK 编码与 cMap） |

生成测试样本：`pnpm gen:sample` / `pnpm gen:large`。
演示页为了方便离线开发，直接使用本地 `node_modules` 里的 worker（Vite `?url`），
库消费者按上一节配置即可。

### 冒烟测试

```bash
pnpm dev                # 先启动 dev server
pnpm smoke              # 本地示例：加载/渲染/导航/缩放/查找/旋转/打印
node scripts/smoke-test.mjs "http://localhost:5179/" --select="/large.pdf"
node scripts/smoke-test.mjs "http://localhost:5179/" --find=PDF
```

测试通过 Chrome DevTools Protocol 驱动无头浏览器，断言页面渲染、懒加载、交互与零控制台错误。
脚本会自动查找本机的 Chrome / Edge，也可用环境变量 `CHROME_PATH` 显式指定浏览器路径。

## 目录结构

```
src/
  main.ts                 # 库入口（导出 PdfPreview、资源/主题配置、常量与工具）
  plugin/
    PdfPreview.ts         # 核心类：装配 viewer/查找/缩略图/打印/下载/快捷键
    assets.ts             # worker / cMap / 字体 / wasm / ICC 地址解析与全局配置
    pdfjs.ts              # 全局 pdfjsLib 桥接 + 组件懒加载
    types.ts              # 选项与事件类型
    toolbar.ts            # 工具栏 / 查找栏 / 状态栏
    thumbnails.ts         # 懒渲染缩略图侧栏
    print.ts              # 隐藏 iframe 逐页打印
    download.ts           # 下载
    style.css             # 插件样式（pdf_viewer.css 在 PdfPreview.ts 中引入）
  loadPdf.ts              # 仅加载文档的轻量 API
  index.ts                # 演示页（不参与库构建）
scripts/
  make-sample-pdf.mjs     # 生成示例 PDF（PAGES=500 可生成大文件）
  smoke-test.mjs          # 无头 Chrome 冒烟测试（CDP）
vite.config.ts            # 库构建（默认）/ 演示页构建（--mode demo）
tsconfig.build.json       # 仅生成 .d.ts 到 dist/types
public/                   # 演示页静态资源（不打包进库）
```

## 说明与限制

- 仅提供 **ESM** 产物：pdf.js v6 本身只发布 ESM，UMD/CJS 无法干净地复用同一份依赖。
  需要 `<script>` 直用时建议在你的项目里把本库再打包成 IIFE。
- 依赖浏览器环境（DOM、Worker、canvas），**不能做服务端渲染**。在 Next.js / Nuxt 等
  框架中请只在客户端加载本组件，例如 Next.js 用 `next/dynamic` 且 `{ ssr: false }`，
  并在 `useEffect` / `onMounted` 里创建、卸载时 `destroy()`。
- 样式需要显式引入一次：`import "pdf-preview-plugin/style.css"`。
