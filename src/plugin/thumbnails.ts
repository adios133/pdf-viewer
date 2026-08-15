import type { PDFDocumentProxy } from "pdfjs-dist"

interface RenderTask {
  promise: Promise<void>
  cancel: () => void
}

interface ThumbItem {
  pageNumber: number
  div: HTMLElement
  canvas: HTMLCanvasElement
  label: HTMLElement
  spinner: HTMLElement
  task: RenderTask | null
  rendered: boolean
}

/** 缩略图目标宽度（CSS px）。 */
const THUMB_WIDTH = 140
/** 同时渲染的缩略图数量上限（控制 worker 与内存压力）。 */
const MAX_CONCURRENT = 2

/**
 * 缩略图侧栏：懒渲染 + 视口缓冲 + 渲染取消 + 并发上限。
 * 适合大文件：只渲染接近可视区域的缩略图，滚出视口即取消并释放画布。
 */
export class ThumbnailSidebar {
  readonly el: HTMLElement

  private doc: PDFDocumentProxy | null = null
  private labels: Array<string | null> | null = null
  private rotation = 0
  private items: ThumbItem[] = []
  private queue: ThumbItem[] = []
  private activeCount = 0
  private observer: IntersectionObserver | null = null
  private selected: number | null = null
  private destroyed = false

  constructor(private readonly onSelect: (pageNumber: number) => void) {
    this.el = document.createElement("div")
    this.el.className = "ppv-thumbnails"
    this.observer = new IntersectionObserver((entries) => this.onIntersect(entries), {
      root: this.el,
      rootMargin: "600px 0px",
      threshold: 0.01,
    })
  }

  setDocument(doc: PDFDocumentProxy): void {
    this.destroyItems()
    this.doc = doc
    this.items = []
    this.queue = []
    this.labels = null

    for (let i = 1; i <= doc.numPages; i++) {
      const item = this.createItem(i)
      this.items.push(item)
      this.el.appendChild(item.div)
      this.observer?.observe(item.div)
    }
  }

  setPageLabels(labels: Array<string | null> | null): void {
    this.labels = labels
    for (const item of this.items) {
      const label = labels?.[item.pageNumber - 1] ?? null
      item.label.textContent = label ?? String(item.pageNumber)
      item.label.hidden = !label
    }
  }

  setRotation(rotation: number): void {
    if (rotation === this.rotation) return
    this.rotation = rotation
    for (const item of this.items) {
      this.unrender(item, false)
    }
    // 旋转后 IntersectionObserver 不会为仍可见的项重新触发，手动重排可见项
    const rect = this.el.getBoundingClientRect()
    for (const item of this.items) {
      if (this.isNearViewport(item.div, rect)) this.queue.push(item)
    }
    this.flushQueue()
  }

  /** 高亮当前页，并滚动到可视区域。 */
  highlight(pageNumber: number): void {
    this.selected = pageNumber
    for (const item of this.items) {
      item.div.classList.toggle("selected", item.pageNumber === pageNumber)
    }
    const item = this.items[pageNumber - 1]
    if (item) {
      item.div.scrollIntoView({ block: "nearest" })
    }
  }

  clear(): void {
    this.destroyItems()
  }

  destroy(): void {
    this.destroyed = true
    this.observer?.disconnect()
    this.observer = null
    this.destroyItems()
  }

  // ---------------- 内部 ----------------

  private destroyItems(): void {
    for (const item of this.items) {
      item.task?.cancel()
      item.div.remove()
    }
    this.items = []
    this.queue = []
    this.activeCount = 0
  }

  private createItem(pageNumber: number): ThumbItem {
    const div = document.createElement("div")
    div.className = "ppv-thumb"
    div.style.width = `${THUMB_WIDTH}px`
    div.dataset.page = String(pageNumber)
    div.title = `第 ${pageNumber} 页`
    div.addEventListener("click", () => this.onSelect(pageNumber))

    const spinner = document.createElement("div")
    spinner.className = "ppv-thumb-spinner"
    const spinnerDot = document.createElement("div")
    spinnerDot.className = "ppv-spinner"
    spinnerDot.style.width = "18px"
    spinnerDot.style.height = "18px"
    spinnerDot.style.borderWidth = "2px"
    spinner.appendChild(spinnerDot)

    const canvas = document.createElement("canvas")
    canvas.style.width = "100%"

    const label = document.createElement("span")
    label.className = "ppv-thumb-label"
    label.hidden = true

    div.append(spinner, canvas, label)
    return { pageNumber, div, canvas, label, spinner, task: null, rendered: false }
  }

  private onIntersect(entries: IntersectionObserverEntry[]): void {
    let changed = false
    for (const entry of entries) {
      const item = this.items[Number((entry.target as HTMLElement).dataset.page) - 1]
      if (!item) continue
      if (entry.isIntersecting) {
        if (!item.rendered && !item.task) {
          this.queue.push(item)
          changed = true
        }
      } else {
        this.unrender(item, true)
      }
    }
    if (changed) this.flushQueue()
  }

  private unrender(item: ThumbItem, cancel: boolean): void {
    if (cancel && item.task) {
      item.task.cancel()
      item.task = null
      this.activeCount = Math.max(0, this.activeCount - 1)
    }
    const idx = this.queue.indexOf(item)
    if (idx >= 0) this.queue.splice(idx, 1)
    item.rendered = false
    const ctx = item.canvas.getContext("2d")
    ctx?.clearRect(0, 0, item.canvas.width, item.canvas.height)
    item.canvas.width = 0
    item.canvas.height = 0
    item.spinner.style.display = "flex"
  }

  private flushQueue(): void {
    if (this.destroyed || !this.doc) return
    while (this.activeCount < MAX_CONCURRENT && this.queue.length > 0) {
      const item = this.queue.shift()!
      void this.renderItem(item)
    }
  }

  private async renderItem(item: ThumbItem): Promise<void> {
    const doc = this.doc
    if (!doc || this.destroyed || item.rendered) return
    this.activeCount++
    try {
      const page = await doc.getPage(item.pageNumber)
      if (this.destroyed || item.rendered) return
      const base = page.getViewport({ scale: 1, rotation: this.rotation })
      const scale = THUMB_WIDTH / base.width
      const viewport = page.getViewport({ scale, rotation: this.rotation })
      item.canvas.width = Math.max(1, Math.round(viewport.width))
      item.canvas.height = Math.max(1, Math.round(viewport.height))
      item.spinner.style.display = "flex"

      const renderTask = page.render({
        canvasContext: item.canvas.getContext("2d")!,
        viewport,
        canvas: item.canvas,
      })
      item.task = renderTask
      await renderTask.promise
      item.task = null
      if (this.destroyed) return
      item.rendered = true
      item.spinner.style.display = "none"
      // 释放该页在 worker 中的临时资源（若主视图正在渲染同一页会自动延迟）
      page.cleanup()
    } catch (err) {
      item.task = null
      if (isCancelled(err)) {
        // 取消渲染：仅当仍在视口附近时重新入队（滚动远离时不再渲染）
        if (!this.destroyed && !item.rendered && this.isInViewport(item.div)) {
          this.queue.push(item)
        }
      } else {
        item.spinner.style.display = "none"
        item.div.style.opacity = "0.35"
      }
    } finally {
      this.activeCount = Math.max(0, this.activeCount - 1)
      this.flushQueue()
    }
  }

  /** 判断元素是否在滚动容器视口（含缓冲带）内。 */
  private isNearViewport(el: HTMLElement, containerRect: DOMRect): boolean {
    const r = el.getBoundingClientRect()
    const margin = 600
    return r.bottom > containerRect.top - margin && r.top < containerRect.bottom + margin
  }

  private isInViewport(el: HTMLElement): boolean {
    return this.isNearViewport(el, this.el.getBoundingClientRect())
  }
}

function isCancelled(err: unknown): boolean {
  return err instanceof Error && err.name === "RenderingCancelledException"
}
