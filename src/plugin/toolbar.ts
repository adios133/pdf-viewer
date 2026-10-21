import { icons } from "./icons"
import type { IconName } from "./icons"
import { THEMES } from "./types"
import type { Theme } from "./types"
import { PpvSelect } from "./ui/Select"
import { PpvSwitch } from "./ui/Switch"
import { ColorPicker } from "./ui/ColorPicker"

/** 工具栏动作：由 PdfPreview 统一处理。 */
export type ToolbarAction =
  | "open-file"
  | "toggle-thumbnails"
  | "first-page"
  | "prev-page"
  | "next-page"
  | "last-page"
  | "goto-page"
  | "zoom-in"
  | "zoom-out"
  | "zoom-select"
  | "fit-width"
  | "fit-page"
  | "rotate-cw"
  | "rotate-ccw"
  | "toggle-find"
  | "find-input"
  | "find-prev"
  | "find-next"
  | "find-case"
  | "find-highlight"
  | "find-close"
  | "print"
  | "download"
  | "fullscreen"
  | "toggle-marks"
  | "theme-select"

export interface ToolbarActionEvent {
  action: ToolbarAction
  payload?: unknown
}

export type ToolbarActionHandler = (event: ToolbarActionEvent) => void

const ZOOM_PRESETS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "auto", label: "自动缩放" },
  { value: "page-actual", label: "实际大小" },
  { value: "page-fit", label: "适合页面" },
  { value: "page-width", label: "适合页宽" },
  { value: "0.5", label: "50%" },
  { value: "0.75", label: "75%" },
  { value: "1", label: "100%" },
  { value: "1.25", label: "125%" },
  { value: "1.5", label: "150%" },
  { value: "2", label: "200%" },
  { value: "3", label: "300%" },
  { value: "4", label: "400%" },
]

function button(
  name: IconName,
  title: string,
  action: ToolbarAction,
  handler: ToolbarActionHandler,
): HTMLButtonElement {
  const btn = document.createElement("button")
  btn.type = "button"
  btn.className = "ppv-btn"
  btn.title = title
  btn.setAttribute("aria-label", title)
  btn.innerHTML = icons[name]
  btn.addEventListener("click", () => handler({ action }))
  return btn
}

/**
 * 顶部工具栏：导航、缩放、旋转、查找、打印/下载/全屏等。
 */
export class Toolbar {
  readonly el: HTMLElement
  readonly fileInput: HTMLInputElement

  private readonly handler: ToolbarActionHandler
  private readonly refs = {
    btnThumbnails: null as HTMLButtonElement | null,
    btnMarks: null as HTMLButtonElement | null,
    btnTheme: null as HTMLButtonElement | null,
    btnFirst: null as HTMLButtonElement | null,
    btnPrev: null as HTMLButtonElement | null,
    btnNext: null as HTMLButtonElement | null,
    btnLast: null as HTMLButtonElement | null,
    btnZoomIn: null as HTMLButtonElement | null,
    btnZoomOut: null as HTMLButtonElement | null,
    btnFitWidth: null as HTMLButtonElement | null,
    btnFitPage: null as HTMLButtonElement | null,
    btnFind: null as HTMLButtonElement | null,
    btnPrint: null as HTMLButtonElement | null,
    btnDownload: null as HTMLButtonElement | null,
    btnFullscreen: null as HTMLButtonElement | null,
    pageInput: null as HTMLInputElement | null,
    totalLabel: null as HTMLElement | null,
    zoomSelect: null as PpvSelect | null,
    zoomLabel: null as HTMLElement | null,
    title: null as HTMLElement | null,
  }

  constructor(handler: ToolbarActionHandler, onAccent?: (color: string) => void) {
    this.handler = handler
    this.el = document.createElement("div")
    this.el.className = "ppv-toolbar"

    const g = (container: HTMLElement) => {
      const group = document.createElement("div")
      group.className = "ppv-group"
      container.appendChild(group)
      return group
    }

    // 左侧：缩略图 + 打开文件
    const left = g(this.el)
    const btnThumbnails = button("viewThumbnail", "缩略图 (T)", "toggle-thumbnails", handler)
    left.appendChild(btnThumbnails)
    this.refs.btnThumbnails = btnThumbnails

    const fileInput = document.createElement("input")
    fileInput.type = "file"
    fileInput.accept = "application/pdf,.pdf"
    fileInput.style.display = "none"
    this.fileInput = fileInput
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0]
      if (file) {
        handler({ action: "open-file", payload: file })
      }
      fileInput.value = ""
    })
    const btnOpen = button("openFile", "打开文件", "open-file", () => fileInput.click())
    left.appendChild(btnOpen)
    left.appendChild(fileInput)

    // 页面导航
    const nav = g(this.el)
    nav.classList.add("ppv-page-nav")
    const btnFirst = button("firstPage", "第一页 (Home)", "first-page", handler)
    const btnPrev = button("pageUp", "上一页 (↑)", "prev-page", handler)
    const pageInput = document.createElement("input")
    pageInput.className = "ppv-page-input"
    pageInput.type = "text"
    pageInput.inputMode = "numeric"
    pageInput.autocomplete = "off"
    pageInput.spellcheck = false
    pageInput.title = "页码"
    pageInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const n = parseInt(pageInput.value, 10)
        if (Number.isFinite(n)) handler({ action: "goto-page", payload: n })
        pageInput.blur()
      }
    })
    pageInput.addEventListener("focus", () => pageInput.select())
    const totalLabel = document.createElement("span")
    totalLabel.className = "ppv-page-total"
    const btnNext = button("pageDown", "下一页 (↓)", "next-page", handler)
    const btnLast = button("lastPage", "最后一页 (End)", "last-page", handler)
    nav.append(btnFirst, btnPrev, pageInput, totalLabel, btnNext, btnLast)
    this.refs.btnFirst = btnFirst
    this.refs.btnPrev = btnPrev
    this.refs.btnNext = btnNext
    this.refs.btnLast = btnLast
    this.refs.pageInput = pageInput
    this.refs.totalLabel = totalLabel

    // 缩放
    const zoom = g(this.el)
    const btnZoomOut = button("zoomOut", "缩小 (Ctrl+-)", "zoom-out", handler)
    const zoomSelect = new PpvSelect({
      options: ZOOM_PRESETS.map((p) => ({ value: p.value, label: p.label })),
      value: "auto",
      title: "缩放",
      className: "ppv-zoom-select",
      onChange: (value) => handler({ action: "zoom-select", payload: value }),
    })
    const zoomLabel = document.createElement("span")
    zoomLabel.className = "ppv-zoom-label"
    zoomLabel.textContent = ""
    const btnZoomIn = button("zoomIn", "放大 (Ctrl++)", "zoom-in", handler)
    const btnFitWidth = button("fitWidth", "适合页宽", "fit-width", handler)
    const btnFitPage = button("fitPage", "适合页面", "fit-page", handler)
    zoom.append(btnZoomOut, zoomSelect.el, zoomLabel, btnZoomIn, btnFitWidth, btnFitPage)
    this.refs.btnZoomOut = btnZoomOut
    this.refs.btnZoomIn = btnZoomIn
    this.refs.btnFitWidth = btnFitWidth
    this.refs.btnFitPage = btnFitPage
    this.refs.zoomSelect = zoomSelect
    this.refs.zoomLabel = zoomLabel

    // 标题（占满中间）
    const title = document.createElement("div")
    title.className = "ppv-title"
    this.el.appendChild(title)
    this.refs.title = title

    // 右侧：标绘、旋转、查找、打印、下载、全屏、主题
    const right = g(this.el)
    const btnMarks = button("editorInk", "标绘", "toggle-marks", handler)
    const btnRotateCcw = button("rotateCcw", "逆时针旋转 (Ctrl+Shift+R)", "rotate-ccw", handler)
    const btnRotateCw = button("rotateCw", "顺时针旋转 (Ctrl+R)", "rotate-cw", handler)
    const btnFind = button("search", "查找 (Ctrl+F)", "toggle-find", handler)
    const btnPrint = button("print", "打印 (Ctrl+P)", "print", handler)
    const btnDownload = button("download", "下载 (Ctrl+S)", "download", handler)
    const btnFullscreen = button("presentation", "全屏演示", "fullscreen", handler)
    const btnTheme = button("theme", "主题", "theme-select", handler)
    btnTheme.addEventListener("click", () => this.themeMenu.toggle())
    right.append(
      btnMarks,
      btnRotateCcw,
      btnRotateCw,
      btnFind,
      btnPrint,
      btnDownload,
      btnFullscreen,
      btnTheme,
    )
    this.refs.btnMarks = btnMarks
    this.refs.btnFind = btnFind
    this.refs.btnPrint = btnPrint
    this.refs.btnDownload = btnDownload
    this.refs.btnFullscreen = btnFullscreen
    this.refs.btnTheme = btnTheme
    this.themeMenu = new ThemeMenu(handler, btnTheme, onAccent)
  }

  /** 主题切换菜单（挂载到插件根节点，由 PdfPreview 负责 append）。 */
  readonly themeMenu: ThemeMenu

  setTheme(theme: Theme): void {
    this.themeMenu.setActive(theme)
  }

  destroy(): void {
    this.themeMenu.destroy()
  }

  /** 文档就绪后启用导航/缩放控件。 */
  setEnabled(enabled: boolean): void {
    const r = this.refs
    for (const key of [
      "btnFirst",
      "btnPrev",
      "btnNext",
      "btnLast",
      "btnZoomIn",
      "btnZoomOut",
      "btnFitWidth",
      "btnFitPage",
      "btnFind",
      "btnPrint",
      "btnDownload",
    ] as const) {
      const el = r[key]
      if (el) el.disabled = !enabled
    }
    if (r.pageInput) r.pageInput.disabled = !enabled
    if (r.zoomSelect) r.zoomSelect.setEnabled(enabled)
  }

  setPage(current: number, total: number): void {
    if (this.refs.pageInput) this.refs.pageInput.value = String(current)
    if (this.refs.totalLabel) {
      this.refs.totalLabel.textContent = `/ ${total}`
    }
    const r = this.refs
    if (r.btnFirst) r.btnFirst.disabled = current <= 1
    if (r.btnPrev) r.btnPrev.disabled = current <= 1
    if (r.btnNext) r.btnNext.disabled = current >= total
    if (r.btnLast) r.btnLast.disabled = current >= total
  }

  setZoom(scale: number, presetValue: string | null): void {
    const select = this.refs.zoomSelect
    if (select) {
      // 优先预设值（auto / page-fit / page-width / page-actual）
      if (presetValue && ZOOM_PRESETS.some((p) => p.value === presetValue)) {
        select.setValue(presetValue)
      } else {
        // 匹配百分比档位（如 scale=1.5 → "1.5"），否则显示自定义百分比
        const pctScale = Math.round(scale * 100) / 100
        const exact = ZOOM_PRESETS.find(
          (p) => !isNaN(Number(p.value)) && Number(p.value) === pctScale,
        )
        if (exact) select.setValue(exact.value)
        else select.setLabel(`${Math.round(scale * 100)}%`)
      }
    }
    if (this.refs.zoomLabel) this.refs.zoomLabel.textContent = `${Math.round(scale * 100)}%`
  }

  setTitle(title: string): void {
    if (this.refs.title) this.refs.title.textContent = title
  }

  setFindActive(active: boolean): void {
    if (this.refs.btnFind) this.refs.btnFind.classList.toggle("active", active)
  }

  setThumbnailsActive(active: boolean): void {
    if (this.refs.btnThumbnails) this.refs.btnThumbnails.classList.toggle("active", active)
  }

  setMarksActive(active: boolean): void {
    if (this.refs.btnMarks) this.refs.btnMarks.classList.toggle("active", active)
  }

  setFullscreen(active: boolean): void {
    if (this.refs.btnFullscreen) this.refs.btnFullscreen.classList.toggle("active", active)
  }
}

/**
 * 查找栏：胶囊输入框（内嵌搜索图标与匹配计数）+ 上/下一个 + 设置（齿轮展开选项）+ 关闭。
 */
export class FindBar {
  readonly el: HTMLElement
  private readonly handler: ToolbarActionHandler
  private readonly input: HTMLInputElement
  private readonly countEl: HTMLElement
  private readonly wrapEl: HTMLElement
  private readonly caseSwitch: PpvSwitch
  private readonly highlightSwitch: PpvSwitch
  private readonly btnPrev: HTMLButtonElement
  private readonly btnNext: HTMLButtonElement
  private readonly settingsBtn: HTMLButtonElement
  private readonly settingsEl: HTMLElement
  private opened = false
  private settingsOpen = false
  private query = ""

  constructor(handler: ToolbarActionHandler) {
    this.handler = handler
    this.el = document.createElement("div")
    this.el.className = "ppv-findbar"
    this.el.hidden = true

    // ---- 胶囊输入框：放大镜 + 输入 + 计数 ----
    const wrap = document.createElement("div")
    wrap.className = "ppv-find-input-wrap"
    this.wrapEl = wrap

    const searchIcon = document.createElement("span")
    searchIcon.className = "ppv-findbar-search"
    searchIcon.innerHTML = icons.search

    const input = document.createElement("input")
    input.className = "ppv-find-input"
    input.type = "text"
    input.placeholder = "在文档中查找…"
    input.autocomplete = "off"
    input.spellcheck = false
    this.input = input

    const countEl = document.createElement("span")
    countEl.className = "ppv-find-count"
    this.countEl = countEl

    wrap.append(searchIcon, input, countEl)

    // 输入防抖（兼顾中文输入法组合态）
    let timer: number | undefined
    input.addEventListener("compositionstart", () => {
      window.clearTimeout(timer)
      this.composing = true
    })
    input.addEventListener("compositionend", () => {
      this.composing = false
      this.emitFind()
    })
    input.addEventListener("input", () => {
      window.clearTimeout(timer)
      if (this.composing) return
      timer = window.setTimeout(() => this.emitFind(), 120)
    })
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault()
        if (e.shiftKey) this.handler({ action: "find-prev" })
        else this.handler({ action: "find-next" })
      } else if (e.key === "Escape") {
        this.handler({ action: "find-close" })
      }
    })

    // ---- 操作按钮 ----
    const btnPrev = document.createElement("button")
    btnPrev.type = "button"
    btnPrev.className = "ppv-btn"
    btnPrev.title = "上一个匹配 (Shift+Enter)"
    btnPrev.innerHTML = icons.findPrev
    btnPrev.addEventListener("click", () => this.handler({ action: "find-prev" }))
    this.btnPrev = btnPrev

    const btnNext = document.createElement("button")
    btnNext.type = "button"
    btnNext.className = "ppv-btn"
    btnNext.title = "下一个匹配 (Enter)"
    btnNext.innerHTML = icons.findNext
    btnNext.addEventListener("click", () => this.handler({ action: "find-next" }))
    this.btnNext = btnNext

    const btnSettings = document.createElement("button")
    btnSettings.type = "button"
    btnSettings.className = "ppv-btn"
    btnSettings.title = "查找选项"
    btnSettings.innerHTML = icons.settings
    btnSettings.addEventListener("click", () => this.toggleSettings())
    this.settingsBtn = btnSettings

    const btnClose = document.createElement("button")
    btnClose.type = "button"
    btnClose.className = "ppv-btn"
    btnClose.title = "关闭查找 (Esc)"
    btnClose.innerHTML = icons.close
    btnClose.addEventListener("click", () => this.handler({ action: "find-close" }))

    // ---- 设置区：区分大小写 / 高亮全部（自实现开关） ----
    const settings = document.createElement("div")
    settings.className = "ppv-find-settings"
    this.settingsEl = settings

    this.caseSwitch = new PpvSwitch("区分大小写", false, () => this.emitFind())
    this.highlightSwitch = new PpvSwitch("高亮全部", true, () => this.emitFind())
    settings.append(this.caseSwitch.el, this.highlightSwitch.el)
    this.el.append(wrap, btnPrev, btnNext, btnSettings, btnClose, settings)
  }

  private composing = false

  private toggleSettings(): void {
    this.settingsOpen = !this.settingsOpen
    this.settingsBtn.classList.toggle("active", this.settingsOpen)
    this.settingsEl.classList.toggle("open", this.settingsOpen)
  }

  private emitFind(): void {
    const query = this.input.value
    if (!query) {
      this.handler({ action: "find-input", payload: { query: "" } })
      return
    }
    this.query = query
    this.handler({
      action: "find-input",
      payload: {
        query,
        caseSensitive: this.caseSwitch.checked,
        highlightAll: this.highlightSwitch.checked,
      },
    })
  }

  getQuery(): string {
    return this.query
  }

  open(): void {
    this.opened = true
    this.el.hidden = false
    this.el.classList.add("open")
    this.input.focus()
    this.input.select()
  }

  close(): void {
    this.opened = false
    this.el.hidden = true
    this.el.classList.remove("open")
    if (this.settingsOpen) this.toggleSettings()
  }

  isOpen(): boolean {
    return this.opened
  }

  clear(): void {
    this.input.value = ""
    this.query = ""
    this.setCount(0, 0, 0)
  }

  /**
   * 更新匹配计数显示。
   * state: 0=FOUND 1=NOT_FOUND 2=WRAPPED 3=PENDING
   */
  setCount(current: number, total: number, state: number): void {
    const el = this.countEl
    const notFound = state === 1 || (state === 2 && total === 0)
    el.classList.toggle("not-found", notFound)
    this.wrapEl.classList.toggle("not-found", notFound)
    if (state === 1) {
      el.textContent = "未找到"
    } else if (state === 2) {
      el.textContent = total > 0 ? `${current} / ${total}（已回绕）` : "未找到"
    } else if (state === 3) {
      el.textContent = "查找中…"
    } else if (total > 0) {
      el.textContent = `${current} / ${total}`
    } else {
      el.textContent = ""
    }
  }
}

/**
 * 底部状态栏：页码、缩放、文件名、大小、线性化标识。
 */
export class StatusBar {
  readonly el: HTMLElement
  private readonly pageEl: HTMLElement
  private readonly zoomEl: HTMLElement
  private readonly fileEl: HTMLElement
  private readonly sizeEl: HTMLElement

  constructor() {
    this.el = document.createElement("div")
    this.el.className = "ppv-statusbar"

    this.pageEl = document.createElement("span")
    this.pageEl.className = "ppv-status-item"
    this.pageEl.textContent = "—"

    this.zoomEl = document.createElement("span")
    this.zoomEl.className = "ppv-status-item"

    const spacer = document.createElement("span")
    spacer.className = "ppv-spacer"

    this.fileEl = document.createElement("span")
    this.fileEl.className = "ppv-status-item"

    this.sizeEl = document.createElement("span")
    this.sizeEl.className = "ppv-status-item"

    this.el.append(this.pageEl, this.zoomEl, spacer, this.fileEl, this.sizeEl)
  }

  setPage(current: number, total: number): void {
    this.pageEl.textContent = `第 ${current} 页，共 ${total} 页`
  }

  setZoom(scale: number): void {
    this.zoomEl.textContent = `缩放 ${Math.round(scale * 100)}%`
  }

  setFile(name: string, size: number | null, linearized = false): void {
    const parts: string[] = [name || "document.pdf"]
    if (size != null && Number.isFinite(size) && size > 0) {
      parts.push(formatSize(size))
    }
    if (linearized) parts.push("Fast Web View")
    this.fileEl.textContent = parts.join(" · ")
    this.fileEl.title = parts.join("\n")
  }

  clear(): void {
    this.pageEl.textContent = "—"
    this.zoomEl.textContent = ""
    this.fileEl.textContent = ""
    this.sizeEl.textContent = ""
  }
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

/**
 * 主题切换菜单：预设主题列表（色点预览 + 勾选当前主题），点击外部自动关闭。
 */
export class ThemeMenu {
  readonly el: HTMLElement
  private readonly handler: ToolbarActionHandler
  private readonly anchor: HTMLElement
  private readonly items = new Map<Theme, HTMLButtonElement>()
  private accentPicker!: ColorPicker
  private onAccent?: (color: string) => void
  private open = false
  private readonly onOutside = (e: PointerEvent) => {
    if (!this.open) return
    const target = e.target as Node | null
    if (target && !this.el.contains(target) && !this.anchor.contains(target)) {
      this.close()
    }
  }

  constructor(
    handler: ToolbarActionHandler,
    anchor: HTMLElement,
    onAccent?: (color: string) => void,
  ) {
    this.handler = handler
    this.anchor = anchor
    this.el = document.createElement("div")
    this.el.className = "ppv-theme-menu"

    for (const theme of THEMES) {
      const item = document.createElement("button")
      item.type = "button"
      item.className = "ppv-theme-item"
      item.dataset.theme = theme.id
      const dot = document.createElement("span")
      dot.className = "ppv-theme-dot"
      dot.style.backgroundColor = theme.dot
      const label = document.createElement("span")
      label.className = "ppv-theme-label"
      label.textContent = theme.label
      const check = document.createElement("span")
      check.className = "ppv-theme-check"
      check.innerHTML = icons.close
      check.style.visibility = "hidden"
      item.append(dot, label, check)
      item.addEventListener("click", () => {
        this.handler({ action: "theme-select", payload: theme.id })
        this.close()
      })
      this.el.appendChild(item)
      this.items.set(theme.id, item)
    }

    // 自定义强调色
    this.onAccent = onAccent
    const customRow = document.createElement("div")
    customRow.className = "ppv-theme-custom"
    const customLabel = document.createElement("span")
    customLabel.textContent = "自定义强调色"
    this.accentPicker = new ColorPicker({
      value: "#0078d4",
      title: "选择强调色",
      onChange: (color) => onAccent?.(color),
    })
    customRow.append(customLabel, this.accentPicker.el)
    this.el.appendChild(customRow)

    document.addEventListener("pointerdown", this.onOutside)
  }

  toggle(): void {
    if (this.open) this.close()
    else this.openMenu()
  }

  openMenu(): void {
    this.open = true
    this.el.classList.add("open")
    this.anchor.classList.add("active")
  }

  close(): void {
    this.open = false
    this.el.classList.remove("open")
    this.anchor.classList.remove("active")
  }

  setActive(theme: Theme): void {
    for (const [id, item] of this.items) {
      const active = id === theme
      item.classList.toggle("active", active)
      const check = item.querySelector<HTMLElement>(".ppv-theme-check")
      if (check) check.style.visibility = active ? "visible" : "hidden"
    }
  }

  /** 同步自定义强调色到色块按钮（null 表示使用主题默认色）。 */
  setAccent(color: string | null): void {
    if (this.accentPicker) this.accentPicker.setColor(color ?? "#0078d4")
  }

  destroy(): void {
    document.removeEventListener("pointerdown", this.onOutside)
  }
}
