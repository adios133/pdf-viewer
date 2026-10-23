/**
 * pdf.js 运行时静态资源（worker / cMap / 标准字体 / wasm / ICC）的默认地址与全局配置。
 *
 * 应用模式可以直接依赖 Vite 的 `import.meta.env.BASE_URL`，但库模式构建后这段代码运行在
 * 宿主项目里，`<base>/pdfjs/...` 之类的相对约定不再成立，`?url` 资源导入也会把地址写死成
 * 库自身构建时的路径。因此这里统一在运行时解析：
 *
 *   1. 实例选项（`workerSrc` / `cMapUrl` / `standardFontDataUrl` / `wasmUrl` / `iccUrl`）
 *   2. `configurePdfPreviewAssets()` 设置的全局默认值
 *   3. 已由宿主项目设置的 `GlobalWorkerOptions.workerSrc`（仅 worker）
 *   4. 与当前 `pdfjs-dist` 版本严格一致的 jsDelivr CDN 地址
 *
 * 离线 / 内网部署时把 node_modules/pdfjs-dist 下的对应目录拷到站点根目录，
 * 然后调用 `configurePdfPreviewAssets()` 指过去即可（见 README）。
 */
import { GlobalWorkerOptions, version as PDFJS_VERSION } from "pdfjs-dist"

/** 当前宿主安装的 pdfjs-dist 版本（cdn 默认地址据此拼出）。 */
export { PDFJS_VERSION }

const CDN_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/`

/** pdf.js 运行时静态资源地址，所有字段可选，缺省用默认值。 */
export interface PdfPreviewAssets {
  /** pdf.js worker 脚本地址，缺省 CDN 上的 pdf.worker.min.mjs。 */
  workerSrc?: string
  /** cMap 目录（需以 / 结尾），中文等 CJK 编码 PDF 需要。 */
  cMapUrl?: string
  /** 标准字体目录（需以 / 结尾）。 */
  standardFontDataUrl?: string
  /** wasm 目录（需以 / 结尾），JPEG2000 等图像解码需要。 */
  wasmUrl?: string
  /** ICC 色彩配置目录（需以 / 结尾）。 */
  iccUrl?: string
}

/** 解析后的完整资源地址。 */
export type PdfPreviewResolvedAssets = Required<PdfPreviewAssets>

const DEFAULTS: PdfPreviewResolvedAssets = {
  workerSrc: `${CDN_BASE}build/pdf.worker.min.mjs`,
  cMapUrl: `${CDN_BASE}cmaps/`,
  standardFontDataUrl: `${CDN_BASE}standard_fonts/`,
  wasmUrl: `${CDN_BASE}wasm/`,
  iccUrl: `${CDN_BASE}iccs/`,
}

let globalAssets: PdfPreviewAssets = {}

/**
 * 设置全局默认资源地址，多次调用会合并（只覆盖传入的非空字段）。
 *
 * @example
 * ```ts
 * configurePdfPreviewAssets({
 *   workerSrc: "/pdfjs/pdf.worker.min.mjs",
 *   cMapUrl: "/pdfjs/cmaps/",
 *   standardFontDataUrl: "/pdfjs/standard_fonts/",
 * })
 * ```
 */
export function configurePdfPreviewAssets(assets: PdfPreviewAssets): void {
  globalAssets = { ...globalAssets, ...definedOnly(assets) }
}

/** 读取当前生效的资源地址（全局配置 + 宿主已设置的 worker + 内建默认，不含实例选项）。 */
export function getPdfPreviewAssets(): PdfPreviewResolvedAssets {
  return resolvePdfPreviewAssets()
}

/**
 * 解析最终生效的资源地址：实例选项 > 全局配置 > 宿主已设置的 worker > 内建默认。
 * PdfPreview 每次打开文档前调用，允许宿主在运行期调整。
 */
export function resolvePdfPreviewAssets(
  instanceAssets: PdfPreviewAssets = {},
): PdfPreviewResolvedAssets {
  const local = definedOnly(instanceAssets)
  const merged = { ...globalAssets, ...local }
  return {
    workerSrc: merged.workerSrc ?? GlobalWorkerOptions.workerSrc ?? DEFAULTS.workerSrc,
    cMapUrl: merged.cMapUrl ?? DEFAULTS.cMapUrl,
    standardFontDataUrl: merged.standardFontDataUrl ?? DEFAULTS.standardFontDataUrl,
    wasmUrl: merged.wasmUrl ?? DEFAULTS.wasmUrl,
    iccUrl: merged.iccUrl ?? DEFAULTS.iccUrl,
  }
}

/** 过滤掉未定义与空字符串，避免 `undefined` 覆盖全局配置。 */
function definedOnly(assets: PdfPreviewAssets): PdfPreviewAssets {
  const out: PdfPreviewAssets = {}
  if (assets.workerSrc) out.workerSrc = assets.workerSrc
  if (assets.cMapUrl) out.cMapUrl = assets.cMapUrl
  if (assets.standardFontDataUrl) out.standardFontDataUrl = assets.standardFontDataUrl
  if (assets.wasmUrl) out.wasmUrl = assets.wasmUrl
  if (assets.iccUrl) out.iccUrl = assets.iccUrl
  return out
}
