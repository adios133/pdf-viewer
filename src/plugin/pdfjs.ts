/**
 * pdf.js 环境引导
 *
 * pdfjs-dist 的“组件构建”(web/pdf_viewer.mjs) 依赖全局 `globalThis.pdfjsLib`，
 * 并且要求核心库版本与组件版本完全一致（内部有 version 校验）。
 * 这里在动态加载组件之前，把核心库挂到全局。
 *
 * worker 地址不在模块加载时写死（库模式下 `?url` 会被固定成库自己的构建路径），
 * 由 ./assets 在每次打开文档前根据「实例选项 → 全局配置 → 默认 CDN」解析后写入
 * `GlobalWorkerOptions.workerSrc`。
 */
import * as pdfjsLib from "pdfjs-dist"

// pdf.js 组件库通过 `globalThis.pdfjsLib` 访问核心库；用类型断言挂载，
// 避免在发布的 .d.ts 里向宿主项目泄漏一个全局变量声明。
const globalScope = globalThis as typeof globalThis & {
  pdfjsLib?: typeof import("pdfjs-dist")
}
globalScope.pdfjsLib = pdfjsLib

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
