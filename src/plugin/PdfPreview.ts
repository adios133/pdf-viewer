/**
 * PdfPreview —— 基于 pdf.js 组件库的 PDF 预览插件。
 *
 * 功能对齐浏览器内置 PDF 查看器：
 *   - 连续滚动 + 懒渲染（渲染队列、优先级、滚动取消）
 *   - 缩放（自动/适合页宽/适合页面/百分比/自定义）、旋转
 *   - 页码导航、缩略图侧栏、文本选择、查找高亮
 *   - 打印、下载、全屏演示、键盘快捷键
 *
 * 大文件优化：
 *   - 默认流式加载 + Range 按需分块（disableStream/disableAutoFetch 均为 false）
 *   - 页面缓冲按视口自适应，滚动即取消非可视页渲染
 *   - maxCanvasPixels 上限 + 细节画布（超限时 CSS 缩放降级）
 *   - 空闲期（停止滚动/缩放 5s）自动清理文档资源
 *   - 缩略图懒渲染 + 并发上限 + 越界取消
 *   - 打印逐页渲染，避免一次性内存暴涨
 */
import { getDocument } from "pdfjs-dist"
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist"
import { pdfjsLib, loadViewerModule } from "./pdfjs"
import type { ViewerModule } from "./pdfjs"
import "pdfjs-dist/web/pdf_viewer.css"
import "./style.css"
import { FindBar, StatusBar, Toolbar } from "./toolbar"
import type { ToolbarActionEvent } from "./toolbar"
import { ThumbnailSidebar } from "./thumbnails"
import { printPdf } from "./print"
import { downloadPdf } from "./download"
import type {
  PasswordCallback,
  PdfLoadInfo,
  PdfPreviewEventMap,
  PdfPreviewEventName,
  PdfPreviewEventListener,
  PdfPreviewOptions,
  Theme,
} from "./types"
import { THEMES } from "./types"
import { MarkLayerManager } from "./marks/marks"
import type { Mark, MarkTool } from "./marks/marks"
import { MarkPanel } from "./marks/MarkPanel"
import { icons } from "./icons"

const DEFAULT_CMAP_URL = `${import.meta.env.BASE_URL || "/"}pdfjs/cmaps/`
const DEFAULT_STD_FONT_URL = `${import.meta.env.BASE_URL || "/"}pdfjs/standard_fonts/`
const IDLE_CLEANUP_DELAY = 5000
const THEME_STORAGE_KEY = "pdf-preview:theme"

type PDFViewerInstance = InstanceType<ViewerModule["PDFViewer"]>
type PDFLinkServiceInstance = InstanceType<ViewerModule["PDFLinkService"]>
type PDFFindControllerInstance = InstanceType<ViewerModule["PDFFindController"]>
type EventBusInstance = InstanceType<ViewerModule["EventBus"]>

interface LoadSource {
  url?: string
  file?: File | Blob
  data?: ArrayBuffer | Uint8Array
}

export class PdfPreview {
  readonly root: HTMLElement

  private options: PdfPreviewOptions
  private viewerModule: ViewerModule | null = null
  private eventBus: EventBusInstance | null = null
  private linkService: PDFLinkServiceInstance | null = null
  private findController: PDFFindControllerInstance | null = null
  private viewer: PDFViewerInstance | null = null
  private pdfDocument: PDFDocumentProxy | null = null
  private loadingTask: PDFDocumentLoadingTask | null = null
  private sourceUrl: string | null = null
  private objectUrls: string[] = []
  private filename = ""

  private toolbar: Toolbar
  private findBar: FindBar
  private statusBar: StatusBar
  private thumbSidebar: ThumbnailSidebar
  private markManager: MarkLayerManager
  private markPanel: MarkPanel
  private marksAvailable = false

  private viewerContainer: HTMLDivElement
  private viewerEl: HTMLDivElement
  private sidebarEl: HTMLDivElement
  private progressEl: HTMLDivElement
  private progressIndicator: HTMLDivElement
  private overlayEl: HTMLDivElement
  private overlayContent: HTMLDivElement

  private totalPages = 0
  private currentPage = 0
  private scale = 1
  private rotation = 0
  private theme: Theme = "light"
  private lastActivity = performance.now()
  private cleanupTimer: number | null = null
  private findState = 0
  private disposed = false
  private passwordCb: PasswordCallback | null = null
  private readonly listeners = new Map<PdfPreviewEventName, Set<(p: never) => void>>()

  constructor(options: PdfPreviewOptions = {}) {
    this.options = options
    this.passwordCb = typeof options.password === "function" ? options.password : null

    // ---- DOM ----
    this.root = document.createElement("div")
    this.root.className = "ppv-root"

    this.toolbar = new Toolbar((e) => this.onToolbarAction(e))
    this.findBar = new FindBar((e) => this.onToolbarAction(e))
    this.statusBar = new StatusBar()
    if (options.showToolbar === false) this.toolbar.el.style.display = "none"
    if (options.showStatusbar === false) this.statusBar.el.style.display = "none"

    // ---- 标绘层 ----
    this.markManager = new MarkLayerManager({
      getViewer: () => this.viewer,
      onMarksChange: (marks) => {
        this.syncMarkPanelState()
        this.emit("markschange", { marks })
        this.options.onMarksChange?.(marks)
      },
    })
    this.markPanel = new MarkPanel({
      onToolChange: (tool) => this.markManager.setTool(tool),
      onStyleChange: (style) => this.markManager.setStyle(style),
      onUndo: () => this.markManager.undo(),
      onRedo: () => this.markManager.redo(),
      onDelete: () => this.markManager.deleteSelected(),
      onClear: () => this.markManager.clearMarks(),
      onExport: () => this.exportMarksFile(),
      onImport: () => this.importMarksFile(),
    })
    this.markPanel.setStyle(this.markManager.getStyle())

    const body = document.createElement("div")
    body.className = "ppv-body"

    this.sidebarEl = document.createElement("div")
    this.sidebarEl.className = "ppv-sidebar"
    const sidebarHeader = document.createElement("div")
    sidebarHeader.className = "ppv-sidebar-header"
    const sidebarTitle = document.createElement("span")
    sidebarTitle.textContent = "缩略图"
    const sidebarClose = document.createElement("button")
    sidebarClose.type = "button"
    sidebarClose.className = "ppv-btn"
    sidebarClose.title = "关闭缩略图"
    sidebarClose.innerHTML = icons.close
    sidebarClose.addEventListener("click", () => this.toggleThumbnails(false))
    sidebarHeader.append(sidebarTitle, sidebarClose)
    this.thumbSidebar = new ThumbnailSidebar((pageNumber) => this.gotoPage(pageNumber))
    this.sidebarEl.append(sidebarHeader, this.thumbSidebar.el)

    const main = document.createElement("div")
    main.className = "ppv-main"
    this.viewerContainer = document.createElement("div")
    this.viewerContainer.className = "ppv-viewer-container"
    this.viewerContainer.tabIndex = 0
    this.viewerEl = document.createElement("div")
    this.viewerEl.className = "pdfViewer"
    this.viewerContainer.appendChild(this.viewerEl)
    main.appendChild(this.viewerContainer)

    body.append(this.sidebarEl, main)

    this.progressEl = document.createElement("div")
    this.progressEl.className = "ppv-progress"
    this.progressIndicator = document.createElement("div")
    this.progressIndicator.className = "ppv-progress-indicator"
    this.progressEl.appendChild(this.progressIndicator)

    this.overlayContent = document.createElement("div")
    this.overlayEl = document.createElement("div")
    this.overlayEl.className = "ppv-overlay hidden"
    this.overlayEl.appendChild(this.overlayContent)

    this.root.append(this.toolbar.el, body, this.statusBar.el, this.findBar.el)
    this.root.append(this.progressEl, this.overlayEl)
    this.root.appendChild(this.markPanel.el)
    this.root.appendChild(this.toolbar.themeMenu.el)

    this.attach(options.container)

    this.applyTheme(this.resolveInitialTheme(), false)

    this.toolbar.setEnabled(false)
    document.addEventListener("keydown", this.onKeyDown)
    document.addEventListener("fullscreenchange", this.onFullscreenChange)
  }

  // ================= 公开 API =================

  /** 加载并显示 PDF（可在构造时通过 options 提供来源，也可在此传入）。 */
  async load(source?: LoadSource): Promise<void> {
    if (this.disposed) throw new Error("PdfPreview 已销毁。")
    await this.ensureViewer()
    const src = source ?? this.options
    await this.openDocument(src)
  }

  /** 打开本地文件。 */
  openFile(file: File | Blob): Promise<void> {
    return this.load({ file })
  }

  /** 跳转到指定页（页码从 1 开始，支持负数倒数）。 */
  gotoPage(pageNumber: number): void {
    this.requireViewer()
    const n = pageNumber < 0 ? this.totalPages + pageNumber + 1 : pageNumber
    this.viewer!.currentPageNumber = Math.min(Math.max(1, n), Math.max(1, this.totalPages))
  }

  nextPage(): void {
    this.requireViewer()
    this.viewer!.nextPage()
  }

  previousPage(): void {
    this.requireViewer()
    this.viewer!.previousPage()
  }

  firstPage(): void {
    this.gotoPage(1)
  }

  lastPage(): void {
    this.gotoPage(this.totalPages)
  }

  zoomIn(): void {
    this.requireViewer()
    this.viewer!.increaseScale()
  }

  zoomOut(): void {
    this.requireViewer()
    this.viewer!.decreaseScale()
  }

  /** 重置为实际大小（100%）。 */
  resetZoom(): void {
    this.requireViewer()
    this.viewer!.currentScaleValue = "1"
  }

  /** 设置缩放：数字（1.5 = 150%）或字符串（"auto" | "page-fit" | "page-width" | "page-actual" | "1.5" | "150%"）。 */
  setScale(scale: number | string): void {
    this.requireViewer()
    if (typeof scale === "number") {
      this.viewer!.currentScale = scale
    } else {
      const m = /^(\d+(?:\.\d+)?)%$/.exec(scale.trim())
      this.viewer!.currentScaleValue = m ? String(parseFloat(m[1]) / 100) : scale
    }
  }

  fitWidth(): void {
    this.requireViewer()
    this.viewer!.currentScaleValue = "page-width"
  }

  fitPage(): void {
    this.requireViewer()
    this.viewer!.currentScaleValue = "page-fit"
  }

  /** 旋转（angle 为 0/90/180/270）。 */
  setRotation(angle: number): void {
    this.requireViewer()
    this.viewer!.pagesRotation = ((angle % 360) + 360) % 360
  }

  rotateCW(): void {
    this.requireViewer()
    this.viewer!.pagesRotation = (((this.viewer!.pagesRotation + 90) % 360) + 360) % 360
  }

  rotateCCW(): void {
    this.requireViewer()
    this.viewer!.pagesRotation = (((this.viewer!.pagesRotation - 90) % 360) + 360) % 360
  }

  setScrollMode(mode: number): void {
    this.requireViewer()
    this.viewer!.scrollMode = mode
  }

  setSpreadMode(mode: number): void {
    this.requireViewer()
    this.viewer!.spreadMode = mode
  }

  /** 查找：query 为空时清除高亮。 */
  find(query: string, opts: { caseSensitive?: boolean; highlightAll?: boolean } = {}): void {
    if (!this.eventBus) return
    const { caseSensitive = false, highlightAll = true } = opts
    if (!query) {
      this.eventBus.dispatch("findbarclose", { source: this.root })
      return
    }
    this.eventBus.dispatch("find", {
      source: this.root,
      type: "find",
      query,
      caseSensitive,
      entireWord: false,
      highlightAll,
      findPrevious: false,
      matchDiacritics: false,
    })
  }

  findNext(): void {
    this.findAgain(false)
  }

  findPrevious(): void {
    this.findAgain(true)
  }

  toggleFindBar(open?: boolean): void {
    const next = open ?? !this.findBar.isOpen()
    if (next) {
      this.findBar.open()
      this.toolbar.setFindActive(true)
    } else {
      this.closeFindBar()
    }
  }

  toggleThumbnails(open?: boolean): void {
    const next = open ?? !this.sidebarEl.classList.contains("open")
    this.sidebarEl.classList.toggle("open", next)
    this.toolbar.setThumbnailsActive(next)
    if (next) {
      this.thumbSidebar.highlight(this.currentPage || 1)
    }
  }

  // ---- 标绘层 ----

  /** 打开/关闭标绘面板（同时启用/停用标绘交互）。 */
  toggleMarks(open?: boolean): void {
    const next = open ?? !this.markPanel.isOpen()
    if (next) {
      this.markPanel.openPanel()
      this.markManager.setActive(true)
      this.toolbar.setMarksActive(true)
      this.markPanel.setStyle(this.markManager.getStyle())
      this.syncMarkPanelState()
    } else {
      this.markPanel.closePanel()
      this.markManager.setActive(false)
      this.toolbar.setMarksActive(false)
    }
  }

  /** 是否处于标绘模式。 */
  get marksActive(): boolean {
    return this.markManager.isActive()
  }

  getMarks(): Mark[] {
    return this.markManager.getMarks()
  }

  setMarks(marks: Mark[]): void {
    this.markManager.setMarks(marks)
  }

  clearMarks(pageNumber?: number): void {
    this.markManager.clearMarks(pageNumber)
  }

  /** 导出标绘数据（JSON 字符串）。 */
  exportMarks(): string {
    return this.markManager.exportJson()
  }

  /** 从 JSON 导入标绘数据，成功返回 true。 */
  importMarks(json: string): boolean {
    return this.markManager.importJson(json)
  }

  private syncMarkPanelState(): void {
    this.markPanel.setHistoryState(
      this.markManager.canUndo(),
      this.markManager.canRedo(),
      this.markManager.getMarks().length > 0,
    )
  }

  private exportMarksFile(): void {
    const json = this.markManager.exportJson()
    const blob = new Blob([json], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${this.filename || "document"}.marks.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  private importMarksFile(): void {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = "application/json,.json"
    input.addEventListener("change", () => {
      const file = input.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        const ok = this.markManager.importJson(String(reader.result ?? ""))
        if (!ok) {
          console.warn("[PdfPreview] 标绘数据导入失败：JSON 格式不正确。")
        }
      }
      reader.readAsText(file)
    })
    input.click()
  }

  // ---- 主题 ----

  /** 切换主题（light / dark / sepia / green）。 */
  setTheme(theme: Theme): void {
    if (!THEMES.some((t) => t.id === theme)) return
    if (theme === this.theme) return
    this.applyTheme(theme, true)
  }

  getTheme(): Theme {
    return this.theme
  }

  /** 打开/关闭主题切换菜单。 */
  toggleThemeMenu(open?: boolean): void {
    if (open === undefined) {
      this.toolbar.themeMenu.toggle()
    } else if (open) {
      this.toolbar.themeMenu.openMenu()
    } else {
      this.toolbar.themeMenu.close()
    }
  }

  private applyTheme(theme: Theme, notify: boolean): void {
    this.theme = theme
    this.root.dataset.theme = theme
    this.toolbar.setTheme(theme)
    if (this.options.persistTheme !== false) {
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, theme)
      } catch {
        /* 隐私模式等场景忽略 */
      }
    }
    if (notify) {
      this.emit("themechange", { theme })
      this.options.onThemeChange?.(theme)
    }
  }

  private resolveInitialTheme(): Theme {
    const fromOptions = this.options.theme
    if (fromOptions && THEMES.some((t) => t.id === fromOptions)) return fromOptions
    if (this.options.persistTheme !== false) {
      try {
        const stored = window.localStorage.getItem(THEME_STORAGE_KEY) as Theme | null
        if (stored && THEMES.some((t) => t.id === stored)) return stored
      } catch {
        /* ignore */
      }
    }
    return "light"
  }

  async print(): Promise<void> {
    const doc = this.pdfDocument
    if (!doc) return
    this.showOverlay("正在准备打印…")
    try {
      await printPdf(doc, {
        enablePrintAutoRotate: this.options.enablePrintAutoRotate ?? false,
        onProgress: ({ current, total }) => {
          if (this.overlayTitleEl) {
            this.overlayTitleEl.textContent = `正在准备打印… ${current}/${total}`
          }
        },
      })
    } finally {
      this.hideOverlay()
    }
  }

  async download(): Promise<void> {
    const doc = this.pdfDocument
    if (!doc) return
    this.showOverlay("正在准备下载…")
    try {
      await downloadPdf(doc, { url: this.sourceUrl ?? undefined, filename: this.filename })
    } finally {
      this.hideOverlay()
    }
  }

  async togglePresentation(): Promise<void> {
    if (document.fullscreenElement === this.root) {
      await document.exitFullscreen().catch(() => {})
      return
    }
    this.prevScaleValue = this.viewer?.currentScaleValue ?? null
    try {
      await this.root.requestFullscreen()
    } catch {
      // 浏览器不支持全屏时退化为“演示模式”布局
      this.root.classList.add("ppv-presentation")
      this.viewerContainer.classList.add("pdfPresentationMode")
      this.toolbar.setFullscreen(true)
      this.fitForPresentation()
    }
  }

  private prevScaleValue: string | null = null

  private onFullscreenChange = (): void => {
    const active = document.fullscreenElement === this.root
    this.root.classList.toggle("ppv-presentation", active)
    this.viewerContainer.classList.toggle("pdfPresentationMode", active)
    this.toolbar.setFullscreen(active)
    if (active) {
      this.fitForPresentation()
    } else if (this.prevScaleValue != null && this.viewer) {
      this.viewer.currentScaleValue = this.prevScaleValue
      this.prevScaleValue = null
    }
    this.viewerContainer.focus({ preventScroll: true })
  }

  private fitForPresentation(): void {
    const viewer = this.viewer
    if (!viewer) return
    viewer.currentScaleValue = "page-fit"
    viewer.currentPageNumber = this.currentPage || 1
  }

  /** 立即清理文档占用的内存（一般无需手动调用）。 */
  cleanup(): void {
    this.pdfDocument?.cleanup().catch(() => {})
  }

  destroy(): void {
    if (this.disposed) return
    this.disposed = true
    document.removeEventListener("keydown", this.onKeyDown)
    document.removeEventListener("fullscreenchange", this.onFullscreenChange)
    if (this.cleanupTimer !== null) {
      window.clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
    this.thumbSidebar.destroy()
    this.markManager.destroy()
    this.markPanel.el.remove()
    this.toolbar.destroy()
    try {
      this.viewer?.cleanup()
    } catch {
      /* ignore */
    }
    if (this.loadingTask) {
      void this.loadingTask.destroy()
      this.loadingTask = null
    }
    for (const url of this.objectUrls) URL.revokeObjectURL(url)
    this.objectUrls = []
    this.pdfDocument = null
    this.root.remove()
    this.listeners.clear()
  }

  // ---- 状态 ----

  get document(): PDFDocumentProxy | null {
    return this.pdfDocument
  }

  get totalPagesCount(): number {
    return this.totalPages
  }

  get pageNumber(): number {
    return this.currentPage
  }

  get zoom(): number {
    return this.scale
  }

  get currentRotation(): number {
    return this.rotation
  }

  // ---- 事件 ----

  on<K extends PdfPreviewEventName>(event: K, listener: PdfPreviewEventListener<K>): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener as (p: never) => void)
    return () => this.off(event, listener)
  }

  off<K extends PdfPreviewEventName>(event: K, listener: PdfPreviewEventListener<K>): void {
    this.listeners.get(event)?.delete(listener as (p: never) => void)
  }

  private emit<K extends PdfPreviewEventName>(event: K, payload: PdfPreviewEventMap[K]): void {
    this.listeners.get(event)?.forEach((fn) => {
      try {
        ;(fn as (p: PdfPreviewEventMap[K]) => void)(payload)
      } catch (err) {
        console.error(`[PdfPreview] ${event} 监听器异常:`, err)
      }
    })
  }

  // ================= 内部 =================

  private attach(container?: HTMLElement): void {
    if (container) {
      container.appendChild(this.root)
      // 宿主容器需为定位元素；这里尽量自适应
      const style = getComputedStyle(container)
      if (style.position === "static") container.style.position = "relative"
      this.root.style.position = "absolute"
      this.root.style.inset = "0"
    } else {
      document.body.appendChild(this.root)
      this.root.style.position = "fixed"
      this.root.style.inset = "0"
      this.root.style.zIndex = "2147483000"
    }
  }

  private overlayTitleEl: HTMLElement | null = null
  private overlayBtn: HTMLButtonElement | null = null

  private showOverlay(title: string, onCancel?: () => void, cancelLabel = ""): void {
    this.overlayContent.innerHTML = ""
    const spinner = document.createElement("div")
    spinner.className = "ppv-spinner"
    const titleEl = document.createElement("div")
    titleEl.className = "ppv-overlay-title"
    titleEl.textContent = title
    this.overlayTitleEl = titleEl
    this.overlayContent.append(spinner, titleEl)
    if (onCancel) {
      const btn = document.createElement("button")
      btn.className = "ppv-overlay-btn secondary"
      btn.textContent = cancelLabel || "取消"
      btn.addEventListener("click", onCancel)
      this.overlayBtn = btn
      this.overlayContent.appendChild(btn)
    }
    this.overlayEl.classList.remove("hidden")
  }

  private showError(message: string, detail?: unknown): void {
    this.overlayContent.innerHTML = ""
    const titleEl = document.createElement("div")
    titleEl.className = "ppv-overlay-title ppv-overlay-error"
    titleEl.textContent = message
    const detailEl = document.createElement("div")
    detailEl.className = "ppv-overlay-detail"
    detailEl.textContent = detail instanceof Error ? detail.message : String(detail ?? "")
    const btn = document.createElement("button")
    btn.className = "ppv-overlay-btn"
    btn.textContent = "关闭"
    btn.addEventListener("click", () => this.destroy())
    this.overlayContent.append(titleEl, detailEl, btn)
    this.overlayEl.classList.remove("hidden")
  }

  private hideOverlay(): void {
    this.overlayEl.classList.add("hidden")
    this.overlayContent.innerHTML = ""
    this.overlayTitleEl = null
    this.overlayBtn = null
  }

  private async ensureViewer(): Promise<void> {
    if (this.viewer) return
    if (this.options.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = this.options.workerSrc
    }
    const mod = await loadViewerModule()
    const { PDFViewer, EventBus, PDFLinkService, PDFFindController } = mod
    this.viewerModule = mod

    const eventBus = new EventBus()
    this.eventBus = eventBus
    const linkService = new PDFLinkService({ eventBus })
    const findController = new PDFFindController({ linkService, eventBus })
    this.linkService = linkService
    this.findController = findController

    this.viewer = new PDFViewer({
      container: this.viewerContainer,
      viewer: this.viewerEl,
      eventBus,
      linkService,
      findController,
      textLayerMode: this.options.textLayerMode,
      annotationMode: this.options.annotationMode,
      enablePrintAutoRotate: this.options.enablePrintAutoRotate,
      maxCanvasPixels: this.options.maxCanvasPixels,
      maxCanvasDim: this.options.maxCanvasDim,
      capCanvasAreaFactor: this.options.capCanvasAreaFactor,
      enableDetailCanvas: this.options.enableDetailCanvas,
      removePageBorders: this.options.removePageBorders,
    })
    linkService.setViewer(this.viewer)

    this.wireEvents()
  }

  private wireEvents(): void {
    const bus = this.eventBus!
    bus.on("pagesinit", () => this.onPagesInit(), { once: true })
    bus.on("pagesloaded", ({ pagesCount }: { pagesCount: number }) => {
      this.emit("pagesloaded", { numPages: pagesCount })
    })
    bus.on("pagechanging", ({ pageNumber }: { pageNumber: number }) => {
      this.currentPage = pageNumber
      this.toolbar.setPage(pageNumber, this.totalPages)
      this.statusBar.setPage(pageNumber, this.totalPages)
      this.thumbSidebar.highlight(pageNumber)
      this.touch()
      this.emit("pagechange", { pageNumber, total: this.totalPages })
      this.options.onPageChange?.({ pageNumber, total: this.totalPages })
    })
    bus.on("scalechanging", ({ scale, presetValue }: { scale: number; presetValue?: string }) => {
      this.scale = scale
      this.toolbar.setZoom(scale, presetValue ?? null)
      this.statusBar.setZoom(scale)
      this.touch()
      this.emit("scalechange", { scale, presetValue: presetValue ?? null })
      this.options.onScaleChange?.({ scale, presetValue: presetValue ?? null })
    })
    bus.on("rotationchanging", ({ pagesRotation }: { pagesRotation: number }) => {
      this.rotation = pagesRotation
      this.thumbSidebar.setRotation(pagesRotation)
      this.touch()
      this.emit("rotationchange", { rotation: pagesRotation })
    })
    bus.on("pagerendered", ({ pageNumber }: { pageNumber: number }) => {
      this.touch()
      this.emit("render", { pageNumber })
      this.options.onRender?.({ pageNumber })
      // 页面渲染完成后同步标绘图层
      this.markManager.onPageRendered(pageNumber)
    })
    bus.on(
      "updatefindcontrolstate",
      ({
        state,
        matchesCount,
        rawQuery,
      }: {
        state: number
        matchesCount: { current: number; total: number }
        rawQuery: string
      }) => {
        this.findState = state
        this.findBar.setCount(matchesCount.current, matchesCount.total, state)
        this.emit("findstate", {
          state,
          current: matchesCount.current,
          total: matchesCount.total,
          query: rawQuery ?? this.findBar.getQuery(),
        })
      },
    )
    bus.on(
      "updatefindmatchescount",
      ({ matchesCount }: { matchesCount: { current: number; total: number } }) => {
        this.findBar.setCount(matchesCount.current, matchesCount.total, this.findState)
      },
    )
  }

  private onPagesInit(): void {
    const viewer = this.viewer!
    const mod = this.viewerModule!
    this.totalPages = viewer.pagesCount
    this.toolbar.setEnabled(true)

    const initialScale = this.options.initialScale ?? "auto"
    if (typeof initialScale === "number") {
      viewer.currentScale = initialScale
    } else {
      viewer.currentScaleValue = initialScale
    }
    const rotation = this.options.rotation ?? 0
    if (rotation) viewer.pagesRotation = rotation
    const scrollMode = this.options.scrollMode ?? mod.ScrollMode.VERTICAL
    if (viewer.scrollMode !== scrollMode) viewer.scrollMode = scrollMode
    const spreadMode = this.options.spreadMode ?? mod.SpreadMode.NONE
    if (viewer.spreadMode !== spreadMode) viewer.spreadMode = spreadMode

    const initialPage = this.options.initialPage ?? 1
    if (initialPage > 1) viewer.currentPageNumber = initialPage

    // 初始化时 viewer 不会派发 pagechanging，这里同步一次 UI
    const pageNumber = viewer.currentPageNumber || 1
    this.currentPage = pageNumber
    this.toolbar.setPage(pageNumber, this.totalPages)
    this.statusBar.setPage(pageNumber, this.totalPages)
    this.thumbSidebar.highlight(pageNumber)
    this.emit("pagechange", { pageNumber, total: this.totalPages })
    this.options.onPageChange?.({ pageNumber, total: this.totalPages })

    if (this.options.showThumbnails) this.toggleThumbnails(true)
  }

  private async openDocument(source: LoadSource): Promise<void> {
    this.closeFindBar()
    this.thumbSidebar.clear()
    this.statusBar.setFile("", null)
    this.markManager.reset()

    let url: string | undefined
    let data: ArrayBuffer | Uint8Array | undefined
    let filename: string

    const file = source.file ?? this.options.file
    const srcUrl = source.url ?? this.options.url
    const srcData = source.data ?? this.options.data

    if (file) {
      const objectUrl = URL.createObjectURL(file)
      this.objectUrls.push(objectUrl)
      url = objectUrl
      filename = file instanceof File ? file.name : (this.options.filename ?? "document.pdf")
    } else if (srcUrl) {
      url = srcUrl
      filename = pdfjsLib.getFilenameFromUrl(srcUrl) || ""
    } else if (srcData) {
      data =
        srcData instanceof ArrayBuffer
          ? srcData
          : (srcData.buffer.slice(
              srcData.byteOffset,
              srcData.byteOffset + srcData.byteLength,
            ) as ArrayBuffer)
      filename = this.options.filename ?? "document.pdf"
    } else {
      throw new Error("未提供 PDF 来源（url / file / data）。")
    }
    this.filename = filename
    this.sourceUrl = url ?? null
    this.showOverlay(filename ? `正在加载 ${filename}…` : "正在加载文档…")

    const opts = this.options
    const loadingTask = getDocument({
      ...(url !== undefined ? { url } : {}),
      ...(data !== undefined ? { data } : {}),
      rangeChunkSize: opts.rangeChunkSize ?? 65536,
      disableAutoFetch: opts.disableAutoFetch ?? false,
      disableStream: opts.disableStream ?? false,
      withCredentials: opts.withCredentials ?? false,
      cMapUrl: opts.cMapUrl ?? DEFAULT_CMAP_URL,
      cMapPacked: opts.cMapPacked ?? true,
      standardFontDataUrl: opts.standardFontDataUrl ?? DEFAULT_STD_FONT_URL,
      useSystemFonts: opts.useSystemFonts ?? true,
      ...(typeof opts.password === "string" ? { password: opts.password } : {}),
    })
    this.loadingTask = loadingTask

    loadingTask.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
      this.progressEl.classList.add("visible")
      if (total > 0 && loaded <= total) {
        this.progressIndicator.style.width = `${Math.min(100, (loaded / total) * 100)}%`
      } else {
        this.progressIndicator.style.width = "100%"
        this.progressIndicator.style.animation = "ppv-indeterminate 1.2s ease-in-out infinite"
      }
      const percent = total > 0 ? Math.round((loaded / total) * 100) : 0
      this.emit("progress", { loaded, total, percent })
      this.options.onProgress?.({ loaded, total, percent })
    }

    if (this.passwordCb) {
      loadingTask.onPassword = (updatePassword: (password: string) => void, reason: number) => {
        this.promptPassword(updatePassword, reason)
      }
    }

    try {
      const doc = await loadingTask.promise
      this.pdfDocument = doc
      this.progressEl.classList.remove("visible")
      this.progressIndicator.style.width = "0"
      this.progressIndicator.style.animation = ""
      this.hideOverlay()

      this.viewer!.setDocument(doc)
      this.linkService!.setDocument(doc)
      this.findController!.setDocument(doc)
      this.thumbSidebar.setDocument(doc)

      const labels = await doc.getPageLabels().catch(() => null)
      if (labels) {
        this.viewer!.setPageLabels(labels)
        this.thumbSidebar.setPageLabels(labels)
      }

      const meta = await doc.getMetadata().catch(() => null)
      const info = meta?.info as { Title?: string } | undefined
      const title =
        typeof info?.Title === "string" && info.Title.trim() ? info.Title.trim() : filename
      this.toolbar.setTitle(title)

      const info2: PdfLoadInfo = {
        numPages: doc.numPages,
        filename,
        fingerprint: doc.fingerprints[0] ?? "",
        title: typeof info?.Title === "string" ? info.Title.trim() : null,
      }
      this.emit("load", info2)
      this.options.onLoad?.(info2)

      this.startIdleCleanup()
    } catch (err) {
      this.progressEl.classList.remove("visible")
      const error = toError(err)
      this.emit("error", error)
      this.options.onError?.(error)
      this.showError("无法加载 PDF 文件", error)
      throw error
    }
  }

  private promptPassword(updatePassword: (password: string) => void, reason: number): void {
    this.overlayContent.innerHTML = ""
    const titleEl = document.createElement("div")
    titleEl.className = "ppv-overlay-title"
    titleEl.textContent = reason === 2 ? "密码错误，请重试" : "该 PDF 已加密，请输入密码"
    this.overlayTitleEl = titleEl
    const input = document.createElement("input")
    input.type = "password"
    input.className = "ppv-password-input"
    input.placeholder = "密码"
    input.autocomplete = "off"
    const row = document.createElement("div")
    row.className = "ppv-overlay-actions"
    const ok = document.createElement("button")
    ok.className = "ppv-overlay-btn"
    ok.textContent = "确定"
    const cancel = document.createElement("button")
    cancel.className = "ppv-overlay-btn secondary"
    cancel.textContent = "取消"
    const submit = () => {
      const value = input.value
      if (value) updatePassword(value)
    }
    ok.addEventListener("click", submit)
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit()
    })
    cancel.addEventListener("click", () => {
      this.hideOverlay()
      // 终止挂起的加载任务，释放资源
      this.loadingTask?.destroy().catch(() => {})
      this.loadingTask = null
      this.showError("已取消打开加密文档")
    })
    row.append(ok, cancel)
    this.overlayContent.append(titleEl, input, row)
    this.overlayEl.classList.remove("hidden")
    input.focus()
  }

  // ---- 查找 ----

  private findAgain(findPrevious: boolean): void {
    const query = this.findBar.getQuery()
    if (!query || !this.eventBus) return
    this.eventBus.dispatch("find", {
      source: this.root,
      type: "findagain",
      query,
      caseSensitive: this.findCaseSensitive,
      entireWord: false,
      highlightAll: this.findHighlightAll,
      findPrevious,
      matchDiacritics: false,
    })
  }

  private findCaseSensitive = false
  private findHighlightAll = true

  private closeFindBar(): void {
    this.eventBus?.dispatch("findbarclose", { source: this.root })
    this.findBar.close()
    this.toolbar.setFindActive(false)
  }

  // ---- 工具栏动作 ----

  private onToolbarAction(e: ToolbarActionEvent): void {
    switch (e.action) {
      case "open-file":
        this.openFile(e.payload as File)
        break
      case "toggle-thumbnails":
        this.toggleThumbnails()
        break
      case "first-page":
        this.firstPage()
        break
      case "prev-page":
        this.previousPage()
        break
      case "next-page":
        this.nextPage()
        break
      case "last-page":
        this.lastPage()
        break
      case "goto-page":
        this.gotoPage(e.payload as number)
        break
      case "zoom-in":
        this.zoomIn()
        break
      case "zoom-out":
        this.zoomOut()
        break
      case "zoom-select":
        this.setScale(e.payload as string)
        break
      case "fit-width":
        this.fitWidth()
        break
      case "fit-page":
        this.fitPage()
        break
      case "rotate-cw":
        this.rotateCW()
        break
      case "rotate-ccw":
        this.rotateCCW()
        break
      case "toggle-find":
        this.toggleFindBar()
        break
      case "find-input": {
        const p = e.payload as { query: string; caseSensitive?: boolean; highlightAll?: boolean }
        this.findCaseSensitive = p.caseSensitive ?? false
        this.findHighlightAll = p.highlightAll ?? true
        this.find(p.query, {
          caseSensitive: this.findCaseSensitive,
          highlightAll: this.findHighlightAll,
        })
        break
      }
      case "find-prev":
        this.findPrevious()
        break
      case "find-next":
        this.findNext()
        break
      case "find-case":
      case "find-highlight":
        this.find(this.findBar.getQuery(), {
          caseSensitive: this.findCaseSensitive,
          highlightAll: this.findHighlightAll,
        })
        break
      case "find-close":
        this.closeFindBar()
        break
      case "print":
        void this.print()
        break
      case "download":
        void this.download()
        break
      case "fullscreen":
        void this.togglePresentation()
        break
      case "toggle-marks":
        this.toggleMarks()
        break
      case "theme-select":
        this.setTheme(e.payload as Theme)
        break
    }
  }

  // ---- 键盘快捷键 ----

  private onKeyDown = (event: KeyboardEvent): void => {
    if (this.disposed) return
    const target = event.target as HTMLElement | null
    if (isTypingTarget(target)) return

    // 仅当焦点在插件内部（或全屏演示）时才接管快捷键，避免影响宿主页面
    const inside =
      this.isPresentation ||
      !target ||
      this.root.contains(target) ||
      this.root.contains(document.activeElement)
    if (!inside) return

    const mod = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()

    // 标绘模式下的快捷键优先（工具切换 / 撤销重做）
    if (this.marksActive) {
      if (mod && key === "z") {
        event.preventDefault()
        if (event.shiftKey) this.markManager.redo()
        else this.markManager.undo()
        return
      } else if (mod && key === "y") {
        event.preventDefault()
        this.markManager.redo()
        return
      }
      const toolKeys: Record<string, MarkTool> = {
        v: "select",
        p: "pen",
        k: "ink",
        m: "marker",
        l: "line",
        a: "arrow",
        r: "rect",
        o: "ellipse",
        g: "polygon",
        n: "polyline",
        t: "text",
      }
      const tool = toolKeys[key]
      if (tool && !mod) {
        event.preventDefault()
        this.markManager.setTool(tool)
        this.markPanel.selectTool(tool)
        return
      }
    }

    if (mod && key === "f") {
      event.preventDefault()
      this.toggleFindBar(true)
    } else if (mod && key === "p") {
      event.preventDefault()
      void this.print()
    } else if (mod && key === "s") {
      event.preventDefault()
      void this.download()
    } else if (mod && key === "0") {
      event.preventDefault()
      this.resetZoom()
    } else if (mod && (key === "+" || key === "=")) {
      event.preventDefault()
      this.zoomIn()
    } else if (mod && key === "-") {
      event.preventDefault()
      this.zoomOut()
    } else if (event.key === "PageDown" || event.key === "PageUp") {
      if (this.isPresentation) {
        event.preventDefault()
        if (event.key === "PageDown") this.nextPage()
        else this.previousPage()
      }
    } else if (event.key === "Home") {
      if (this.isPresentation) {
        event.preventDefault()
        this.firstPage()
      }
    } else if (event.key === "End") {
      if (this.isPresentation) {
        event.preventDefault()
        this.lastPage()
      }
    } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      if (this.isPresentation) {
        event.preventDefault()
        this.nextPage()
      }
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      if (this.isPresentation) {
        event.preventDefault()
        this.previousPage()
      }
    } else if (event.key === "Escape") {
      if (this.findBar.isOpen()) {
        this.closeFindBar()
      } else if (document.fullscreenElement === this.root) {
        void document.exitFullscreen().catch(() => {})
      }
    } else if (!mod && key === "r") {
      this.rotateCW()
    } else if (!mod && key === "t") {
      this.toggleThumbnails()
    } else if (!mod && key === "f") {
      this.toggleFindBar(true)
    } else if (!mod && key === "d") {
      void this.download()
    } else if (!mod && key === "p") {
      void this.print()
    }
  }

  private get isPresentation(): boolean {
    return (
      document.fullscreenElement === this.root || this.root.classList.contains("ppv-presentation")
    )
  }

  // ---- 空闲清理（大文件内存管理） ----

  private touch(): void {
    this.lastActivity = performance.now()
  }

  private startIdleCleanup(): void {
    if (this.cleanupTimer !== null) return
    this.cleanupTimer = window.setInterval(() => {
      const doc = this.pdfDocument
      if (!doc || this.disposed) return
      if (performance.now() - this.lastActivity > IDLE_CLEANUP_DELAY) {
        doc.cleanup().catch(() => {})
      }
    }, IDLE_CLEANUP_DELAY)
  }

  private requireViewer(): void {
    if (!this.viewer) throw new Error("PDF 尚未加载完成。")
  }
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err))
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable
}

/** 便捷工厂：创建并加载。 */
export async function createPdfPreview(options: PdfPreviewOptions): Promise<PdfPreview> {
  const preview = new PdfPreview(options)
  try {
    await preview.load()
    return preview
  } catch {
    // load() 失败时预览自身已展示错误浮层，不再向上抛
    return preview
  }
}
