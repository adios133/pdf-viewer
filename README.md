# PdfPreview —— PDF 预览插件

基于 [pdf.js](https://github.com/mozilla/pdf.js) 组件库（`pdfjs-dist` v6）构建的 PDF 预览插件，
功能对齐浏览器内置 PDF 查看器，并针对大文件做了专门的懒加载与内存优化。

## 快速开始

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

演示页提供 4 个文档：

| 文档         | 说明                                 |
| ------------ | ------------------------------------ |
| `sample.pdf` | 本地 6 页示例（脚本生成，离线可用）  |
| `large.pdf`  | 本地 500 页大文件，用于验证懒渲染    |
| `git.pdf`    | 远程 19 页（经 Vite 代理）           |
| `测试.pdf`   | 远程中文 PDF（验证 CJK 编码与 cMap） |

## 使用

```ts
import { PdfPreview } from "./main"

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

// 标绘 API
preview.toggleMarks(true)
preview.setMarks([...]) / preview.getMarks() / preview.clearMarks()
preview.exportMarks() / preview.importMarks(json)
preview.on("markschange", ({ marks }) => ...)

// 主题
preview.setTheme("dark")            // light | dark | sepia | green
preview.getTheme() / preview.on("themechange", ({ theme }) => ...)

// 交互 API
preview.gotoPage(12)
preview.nextPage()
preview.zoomIn() /
  preview.zoomOut() /
  preview.setScale(1.5) /
  preview.fitWidth() /
  preview.fitPage()
preview.rotateCW() / preview.setRotation(90)
preview.find("pdf.js") / preview.findNext() / preview.findPrevious()
preview.toggleThumbnails(true) / preview.togglePresentation()
preview.print() / preview.download()
preview.destroy()
```

事件：`load` / `progress` / `error` / `pagechange` / `scalechange` / `rotationchange` /
`render` / `findstate` / `pagesloaded`，可用 `preview.on("pagechange", cb)` 订阅，
也支持选项里的 `onLoad`/`onError`/`onProgress`/`onPageChange`/`onScaleChange`/`onRender` 回调。

## 功能清单（对齐浏览器内置查看器）

- 连续滚动 + 页面懒渲染：只渲染可视区域附近的页面，滚动时取消非可视页的渲染任务
- 缩放：自动 / 实际大小 / 适合页宽 / 适合页面 / 50%~400% / 自定义；支持 Ctrl+滚轮（组件自带）与快捷键
- 旋转 0/90/180/270
- 页码导航（首页/上一页/下一页/末页、页码输入框）
- 缩略图侧栏：懒渲染、滚动缓冲、并发上限、当前页高亮
- 文本选择与复制（TextLayer）
- 查找（Ctrl+F）：匹配计数、高亮全部、区分大小写、上一个/下一个、循环提示
- 打印（隐藏 iframe 逐页渲染）、下载（同源直链 / getData 兜底）
- 标绘层：画笔/直线/箭头/矩形/椭圆/多边形/折线/文字标注，颜色/线宽/填充可调，
  选择移动、撤销重做、清空、JSON 导入导出；随缩放/旋转自动同步
- 主题切换：预设浅色 / 深色 / 护眼米黄 / 森林绿 4 套主题，
  工具栏调色板按钮一键切换，localStorage 记忆（`persistTheme: false` 关闭）
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

## 目录结构

```
src/
  main.ts                 # 插件入口（导出 PdfPreview、常量、工具）
  plugin/
    PdfPreview.ts         # 核心类：装配 viewer/查找/缩略图/打印/下载/快捷键
    pdfjs.ts              # 全局 pdfjsLib 桥接 + worker 配置 + 组件懒加载
    types.ts              # 选项与事件类型
    toolbar.ts            # 工具栏 / 查找栏 / 状态栏
    thumbnails.ts         # 懒渲染缩略图侧栏
    print.ts              # 隐藏 iframe 逐页打印
    download.ts           # 下载
    style.css             # 插件样式（含 pdf_viewer.css 引入）
  index.ts                # 演示页
scripts/
  make-sample-pdf.mjs     # 生成示例 PDF（PAGES=500 可生成大文件）
  smoke-test.mjs          # 无头 Chrome 冒烟测试（CDP）
public/pdfjs/             # cmaps + standard_fonts（CJK 等编码 PDF 需要）
```

## 静态资源说明

插件默认从 `<base>/pdfjs/cmaps/` 与 `<base>/pdfjs/standard_fonts/` 加载编码映射与标准字体，
这两份目录来自 `node_modules/pdfjs-dist`（Apache-2.0），部署时需随站点发布：

```bash
cp -R node_modules/pdfjs-dist/cmaps public/pdfjs/cmaps
cp -R node_modules/pdfjs-dist/standard_fonts public/pdfjs/standard_fonts
```

也可以通过选项覆盖：`cMapUrl` / `standardFontDataUrl` / `workerSrc`。

## 冒烟测试

```bash
pnpm dev                # 先启动 dev server
pnpm smoke              # 本地示例：加载/渲染/导航/缩放/查找/旋转/打印
node scripts/smoke-test.mjs "http://localhost:5179/" --select="/large.pdf"   # 500 页大文件
node scripts/smoke-test.mjs "http://localhost:5179/" --find=PDF              # 带查找验证
```

测试通过 Chrome DevTools Protocol 驱动无头浏览器，断言页面渲染、懒加载、交互与零控制台错误。
