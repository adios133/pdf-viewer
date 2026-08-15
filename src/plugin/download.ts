import { getFilenameFromUrl } from "pdfjs-dist"
import type { PDFDocumentProxy } from "pdfjs-dist"
import { loadViewerModule } from "./pdfjs"

export interface DownloadOptions {
  /** 原始 URL（同源时直接以链接下载，避免整体读入内存）。 */
  url?: string
  /** 建议文件名。 */
  filename?: string
}

/**
 * 下载当前 PDF：
 * 1. 同源 URL 直接用 <a download> 流式下载；
 * 2. 否则通过 getData() 取回完整字节后保存（与官方查看器行为一致）。
 */
export async function downloadPdf(
  pdfDocument: PDFDocumentProxy,
  options: DownloadOptions = {},
): Promise<void> {
  const { url, filename } = options
  let name = filename

  if (!name) {
    if (url) name = getFilenameFromUrl(url)
    if (!name) {
      const meta = await pdfDocument.getMetadata().catch(() => null)
      const title = (meta?.info as { Title?: unknown } | undefined)?.Title
      name = typeof title === "string" && title.trim() ? `${title.trim()}.pdf` : ""
    }
    if (!name) {
      const fp = pdfDocument.fingerprints?.[0]
      name = fp ? `document-${fp}.pdf` : "document.pdf"
    }
  }
  if (!/\.pdf$/i.test(name)) name = `${name}.pdf`

  // 同源（或 blob/data）URL：直接触发浏览器下载，不占用内存
  if (url) {
    try {
      const target = new URL(url, window.location.href)
      if (target.protocol === "blob:" || target.origin === window.location.origin) {
        const a = document.createElement("a")
        a.href = target.href
        a.download = name
        a.target = "_blank"
        a.rel = "noopener"
        document.body.appendChild(a)
        a.click()
        a.remove()
        return
      }
    } catch {
      /* 无效 URL，走 getData */
    }
  }

  const data = await pdfDocument.getData()
  const { DownloadManager } = await loadViewerModule()
  new DownloadManager().downloadData(data, name, "application/pdf")
}
