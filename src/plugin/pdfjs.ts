/**
 * pdf.js 环境引导
 *
 * pdfjs-dist 的“组件构建”(web/pdf_viewer.mjs) 依赖全局 `globalThis.pdfjsLib`，
 * 并且要求核心库版本与组件版本完全一致（内部有 version 校验）。
 * 这里在动态加载组件之前，把核心库挂到全局，并配置 worker。
 */
import * as pdfjsLib from "pdfjs-dist"
import { GlobalWorkerOptions } from "pdfjs-dist"
import workerSrc from "pdfjs-dist/build/pdf.worker.mjs?url"

declare global {
  // pdf.js 组件库通过 `globalThis.pdfjsLib` 访问核心库
  var pdfjsLib: typeof import("pdfjs-dist")
}

GlobalWorkerOptions.workerSrc = workerSrc
globalThis.pdfjsLib = pdfjsLib

export { pdfjsLib }
export type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist"

/** pdf.js 组件库的完整类型（与 pdfjs-dist/web/pdf_viewer.mjs 对齐）。 */
export type ViewerModule = typeof import("pdfjs-dist/web/pdf_viewer.mjs")

let viewerModulePromise: Promise<ViewerModule> | null = null

/**
 * 懒加载 pdf.js 的 viewer 组件（只加载一次）。
 * 注意：必须在 `globalThis.pdfjsLib` 赋值之后调用。
 */
export function loadViewerModule(): Promise<ViewerModule> {
  viewerModulePromise ??= import("pdfjs-dist/web/pdf_viewer.mjs")
  return viewerModulePromise
}
