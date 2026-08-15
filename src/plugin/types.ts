import type { PDFDocumentProxy } from "pdfjs-dist"
import type { ScrollMode, SpreadMode } from "pdfjs-dist/types/web/ui_utils"
import type { Mark } from "./marks/marks"

/** 密码回调：reason 为 PasswordResponses 中的值（NEED_PASSWORD=1 / INCORRECT_PASSWORD=2）。 */
export type PasswordCallback = (updatePassword: (password: string) => void, reason: number) => void

/** 预设缩放值，与 pdf.js 的 currentScaleValue 语义一致。 */
export type PresetScale = "auto" | "page-actual" | "page-width" | "page-fit"

export interface PdfLoadProgress {
  loaded: number
  total: number
  percent: number
}

export interface PdfLoadInfo {
  numPages: number
  filename: string
  fingerprint: string
  title: string | null
}

export interface PdfPreviewOptions {
  /** PDF 地址（支持跨域，配合 CORS；服务端支持 Range 时自动按需分块加载）。 */
  url?: string
  /** 本地文件（内部转为 object URL 流式加载，避免整体读入内存）。 */
  file?: File | Blob
  /** 原始字节（ArrayBuffer / Uint8Array）。 */
  data?: ArrayBuffer | Uint8Array
  /** 挂载点；缺省时创建一个铺满视口的浮层。 */
  container?: HTMLElement
  /** 自定义 worker 地址；缺省使用随包发布的 worker。 */
  workerSrc?: string
  /** 无文件名来源时使用的文件名（下载/标题等）。 */
  filename?: string
  /** 加密文档的密码，或请求密码的回调（返回 false 表示取消）。 */
  password?: string | PasswordCallback
  /** 初始页码（1 起）。 */
  initialPage?: number
  /** 初始缩放：数字（如 1.5）或预设值。缺省 "auto"（首次按页面宽度自适应）。 */
  initialScale?: number | PresetScale
  /** 初始旋转（0 / 90 / 180 / 270）。 */
  rotation?: 0 | 90 | 180 | 270
  /** 初始滚动模式，缺省 ScrollMode.VERTICAL。 */
  scrollMode?: number
  /** 初始双页模式，缺省 SpreadMode.NONE。 */
  spreadMode?: number
  /** 是否显示工具栏，缺省 true。 */
  showToolbar?: boolean
  /** 是否显示底部状态栏，缺省 true。 */
  showStatusbar?: boolean
  /** 是否默认打开缩略图侧栏，缺省 false。 */
  showThumbnails?: boolean
  /** 文本层模式（TextLayerMode），缺省 ENABLE（支持选择/搜索）。 */
  textLayerMode?: number
  /** 注释层模式（AnnotationMode），缺省 ENABLE_FORMS。 */
  annotationMode?: number
  /** 打印时是否自动旋转横向页面，缺省 false。 */
  enablePrintAutoRotate?: boolean
  /** 最大 canvas 总像素（宽×高），缺省 32MP；超过时自动降级为 CSS 缩放 + 细节画布。 */
  maxCanvasPixels?: number
  /** 最大 canvas 单边尺寸，缺省 32767。 */
  maxCanvasDim?: number
  /** 画布面积上限相对视口的倍数（百分比），缺省 200。 */
  capCanvasAreaFactor?: number
  /** 是否启用细节画布（enableDetailCanvas），缺省 true。 */
  enableDetailCanvas?: boolean
  /** 去掉页面描边/阴影，缺省 false。 */
  removePageBorders?: boolean

  // ---- 传输层（大文件相关） ----
  /** Range 请求的分块大小，缺省 65536（64KB）。 */
  rangeChunkSize?: number
  /** 是否禁用按需自动拉取页面数据，缺省 false（保持懒加载，大文件务必保持 false）。 */
  disableAutoFetch?: boolean
  /** 是否禁用流式加载（禁用后必须一次性下载完整文件），缺省 false。 */
  disableStream?: boolean
  /** 跨域请求是否携带凭据，缺省 false。 */
  withCredentials?: boolean
  /** cMap 目录地址（CJK 等编码 PDF 需要），缺省自动探测 <base>/pdfjs/cmaps/。 */
  cMapUrl?: string
  /** cMap 是否压缩（.bcmap），缺省 true。 */
  cMapPacked?: boolean
  /** 标准字体目录地址，缺省自动探测 <base>/pdfjs/standard_fonts/。 */
  standardFontDataUrl?: string
  /** 是否允许在 worker 中使用 eval，缺省 false（更安全）。 */
  isEvalSupported?: boolean
  /** 是否优先使用系统字体渲染，缺省 true。 */
  useSystemFonts?: boolean

  // ---- 事件回调 ----
  onLoad?: (info: PdfLoadInfo) => void
  onError?: (error: Error) => void
  onProgress?: (progress: PdfLoadProgress) => void
  onPageChange?: (info: { pageNumber: number; total: number }) => void
  onScaleChange?: (info: { scale: number; presetValue: string | null }) => void
  onRender?: (info: { pageNumber: number }) => void
  /** 标绘数据变化（增删/移动/撤销/导入导出）时触发。 */
  onMarksChange?: (marks: Mark[]) => void
}

/** 插件事件名与载荷。 */
export type PdfPreviewEventMap = {
  load: PdfLoadInfo
  progress: PdfLoadProgress
  error: Error
  pagechange: { pageNumber: number; total: number }
  scalechange: { scale: number; presetValue: string | null }
  rotationchange: { rotation: number }
  render: { pageNumber: number }
  findstate: { state: number; current: number; total: number; query: string }
  pagesloaded: { numPages: number }
  /** 标绘数据变化。 */
  markschange: { marks: Mark[] }
}

export type PdfPreviewEventName = keyof PdfPreviewEventMap
export type PdfPreviewEventListener<K extends PdfPreviewEventName> = (
  payload: PdfPreviewEventMap[K],
) => void

export type { PDFDocumentProxy }
export type { ScrollMode, SpreadMode }
