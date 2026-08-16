/**
 * PdfPreview 插件入口
 *
 * 用法：
 *   import { PdfPreview } from "./main"
 *   const preview = new PdfPreview({ url: "/file.pdf", container: el })
 *   await preview.load()
 */
export { PdfPreview, createPdfPreview } from "./plugin/PdfPreview"
export type {
  PasswordCallback,
  PdfLoadInfo,
  PdfLoadProgress,
  PdfPreviewEventMap,
  PdfPreviewEventName,
  PdfPreviewEventListener,
  PdfPreviewOptions,
  PresetScale,
  Theme,
  ThemeInfo,
} from "./plugin/types"
export { THEMES } from "./plugin/types"
export { downloadPdf } from "./plugin/download"
export { printPdf } from "./plugin/print"
export type { PrintOptions } from "./plugin/print"
export type { Mark, MarkPoint, MarkStyle, MarkTool, MarkType } from "./plugin/marks/marks"

/** 滚动模式（与 pdf.js 组件库常量一致）。 */
export const ScrollMode = {
  VERTICAL: 0,
  HORIZONTAL: 1,
  WRAPPED: 2,
  PAGE: 3,
} as const

/** 双页展开模式。 */
export const SpreadMode = {
  NONE: 0,
  ODD: 1,
  EVEN: 2,
} as const

/** 文本层模式。 */
export const TextLayerMode = {
  DISABLE: 0,
  ENABLE: 1,
  ENABLE_PERMISSIONS: 2,
} as const

// 兼容旧的 loadPdf 用法（仅加载文档，不做渲染）
export { loadPdf } from "./loadPdf"
