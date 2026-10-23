import { getDocument, GlobalWorkerOptions } from "pdfjs-dist"
import type { DocumentInitParameters } from "pdfjs-dist/types/src/display/api"
import { resolvePdfPreviewAssets } from "./plugin/assets"
import type { PdfPreviewAssets } from "./plugin/assets"

/**
 * 仅加载 PDF 文档（不渲染）。用于需要自行控制渲染的场合。
 *
 * worker / cMap / 字体等资源地址与 PdfPreview 共用同一套解析规则：
 * 显式传入 > `configurePdfPreviewAssets()` 全局配置 > 默认 CDN。
 */
export async function loadPdf(src: DocumentInitParameters, assets?: PdfPreviewAssets) {
  const resolved = resolvePdfPreviewAssets(assets)
  GlobalWorkerOptions.workerSrc = resolved.workerSrc
  try {
    return await getDocument({
      ...src,
      cMapUrl: src.cMapUrl ?? resolved.cMapUrl,
      standardFontDataUrl: src.standardFontDataUrl ?? resolved.standardFontDataUrl,
      wasmUrl: src.wasmUrl ?? resolved.wasmUrl,
      iccUrl: src.iccUrl ?? resolved.iccUrl,
    }).promise
  } catch {
    return null
  }
}
