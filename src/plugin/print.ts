import type { PDFDocumentProxy } from "pdfjs-dist"

/** 打印分辨率（CSS 像素 / PDF 点），96dpi / 72dpi。 */
const PRINT_UNITS = 96 / 72

export interface PrintOptions {
  /** 打印时自动旋转横向页面，使页面铺满纸张。 */
  enablePrintAutoRotate?: boolean
  /** 打印进度（current/total 为页数）。 */
  onProgress?: (progress: { current: number; total: number }) => void
}

/**
 * 在隐藏 iframe 中按打印分辨率逐页渲染并调用浏览器打印。
 * 逐页顺序渲染，避免大文件一次性占用过多内存。
 */
export async function printPdf(
  pdfDocument: PDFDocumentProxy,
  options: PrintOptions = {},
): Promise<void> {
  const { enablePrintAutoRotate = false, onProgress } = options
  const total = pdfDocument.numPages
  if (total === 0) return

  const iframe = document.createElement("iframe")
  iframe.setAttribute("aria-hidden", "true")
  iframe.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden"
  document.body.appendChild(iframe)

  const win = iframe.contentWindow
  if (!win) {
    iframe.remove()
    throw new Error("无法创建打印窗口。")
  }

  const doc = win.document
  doc.open()
  doc.write(printHtml(total))
  doc.close()

  const pages = Array.from(doc.querySelectorAll<HTMLDivElement>(".ppv-print-page"))

  try {
    for (let i = 0; i < total; i++) {
      const page = await pdfDocument.getPage(i + 1)
      const isLandscape = page.view[2] > page.view[3]
      const rotate = enablePrintAutoRotate && isLandscape ? 90 : 0
      const viewport = page.getViewport({ scale: PRINT_UNITS, rotation: rotate })
      const canvas = pages[i].querySelector<HTMLCanvasElement>("canvas")
      if (!canvas) continue
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      const pageStyle = pages[i].style
      pageStyle.width = `${Math.floor(viewport.width)}px`
      pageStyle.height = `${Math.floor(viewport.height)}px`
      await page.render({
        canvasContext: canvas.getContext("2d")!,
        viewport,
        canvas,
      }).promise
      page.cleanup()
      onProgress?.({ current: i + 1, total })
    }

    await new Promise<void>((resolve) => {
      // 等所有页面渲染进 DOM 后再触发打印
      requestAnimationFrame(() => resolve())
    })

    win.focus()
    // 同步阻塞直至打印对话框关闭
    win.print()

    // 打印对话框关闭后清理（部分浏览器 afterprint 不触发，双保险）
    await new Promise<void>((resolve) => {
      const done = () => resolve()
      win.addEventListener("afterprint", done, { once: true })
      setTimeout(done, 1500)
    })
  } finally {
    iframe.remove()
  }
}

function printHtml(total: number): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>打印</title>
<style>
  @page { size: auto; margin: 0; }
  html, body { margin: 0; padding: 0; }
  body { display: flex; flex-direction: column; align-items: center; background: #fff; }
  .ppv-print-page { position: relative; overflow: hidden; margin: 0; page-break-after: always; }
  .ppv-print-page:last-child { page-break-after: auto; }
  .ppv-print-page canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
</style>
</head>
<body>
${Array.from(
  { length: total },
  (_, i) =>
    `<div class="ppv-print-page" data-page="${i + 1}" style="width:0;height:0"><canvas></canvas></div>`,
).join("\n")}
</body>
</html>`
}
