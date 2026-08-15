/**
 * 标绘层（MarkLayer）
 *
 * 在每一页 PDF 上叠加一个透明矢量图层，支持：
 *   - 画笔 / 直线 / 箭头 / 矩形 / 椭圆 / 多边形 / 折线 / 文字
 *   - 选择：点击命中、拖动移动、Delete 删除
 *   - 撤销 / 重做 / 清空 / 导出 / 导入（JSON）
 *   - 数据存储于“原始页面坐标”（rotation=0、scale=1），
 *     绘制时经 pdf.js viewport 变换映射，缩放/旋转/翻页自动跟随。
 */

export type MarkTool =
  "select" | "pen" | "line" | "arrow" | "rect" | "ellipse" | "polygon" | "polyline" | "text"

export interface MarkPoint {
  x: number
  y: number
}

export interface MarkStyle {
  /** 颜色 #RRGGBB */
  color: string
  /** 视觉线宽（CSS px，缩放后保持不变） */
  lineWidth: number
  /** 是否填充（矩形/椭圆/多边形） */
  fill: boolean
  /** 文字字号（CSS px） */
  fontSize: number
}

export interface Mark {
  id: string
  pageNumber: number
  type: MarkType
  /** 原始页面坐标（未旋转、scale=1） */
  points: MarkPoint[]
  /** 文字工具的内容 */
  text?: string
  style: MarkStyle
  createdAt: number
}

export type MarkType = Exclude<MarkTool, "select">

export interface MarkLayerOptions {
  /** 获取 pdf.js PDFViewer 实例（用于读取页面 viewport） */
  getViewer: () => {
    getPageView: (
      index: number,
    ) => { viewport: { transform: number[]; scale: number }; div: HTMLElement } | null
    pagesCount?: number
  } | null
  onMarksChange?: (marks: Mark[]) => void
}

interface LayerEntry {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  pageDiv: HTMLElement
  ro: ResizeObserver
  mo: MutationObserver
}

type HistoryEntry =
  | { op: "add"; mark: Mark }
  | { op: "delete"; mark: Mark; index: number }
  | { op: "clear"; removed: Mark[] }
  | { op: "import"; prev: Mark[]; next: Mark[] }
  | { op: "move"; id: string; prev: MarkPoint[]; next: MarkPoint[] }

const HIT_TOLERANCE_CSS = 6

export class MarkLayerManager {
  private readonly options: MarkLayerOptions
  private readonly layers = new Map<number, LayerEntry>()
  private marks: Mark[] = []
  private history: HistoryEntry[] = []
  private redoStack: HistoryEntry[] = []

  private tool: MarkTool = "select"
  private style: MarkStyle = { color: "#d93025", lineWidth: 2, fill: true, fontSize: 16 }
  private active = false

  // 绘制会话状态
  private session: {
    pageNumber: number
    points: MarkPoint[]
    preview: MarkPoint | null
    lastPoint: MarkPoint | null
    moving: { mark: Mark; startPoints: MarkPoint[]; startPointer: MarkPoint } | null
  } | null = null

  private selectedId: string | null = null
  private idSeq = 0

  private readonly keydownHandler = (e: KeyboardEvent) => this.onKeyDown(e)

  constructor(options: MarkLayerOptions) {
    this.options = options
    document.addEventListener("keydown", this.keydownHandler)
  }

  // ================= 公共 API =================

  /** 进入/退出标绘模式（面板开关联动）。 */
  setActive(active: boolean): void {
    this.active = active
    this.cancelSession()
    if (!active) this.selectedId = null
    for (const layer of this.layers.values()) {
      layer.canvas.style.pointerEvents = active ? "auto" : "none"
      layer.canvas.style.cursor = active ? this.cursorFor(this.tool) : "default"
    }
    if (active) this.redrawAll()
  }

  isActive(): boolean {
    return this.active
  }

  setTool(tool: MarkTool): void {
    if (!this.active) return
    this.tool = tool
    this.selectedId = null
    this.cancelSession()
    for (const layer of this.layers.values()) {
      layer.canvas.style.cursor = this.cursorFor(tool)
    }
  }

  getTool(): MarkTool {
    return this.tool
  }

  setStyle(partial: Partial<MarkStyle>): void {
    Object.assign(this.style, partial)
    if (this.session) this.redrawPage(this.session.pageNumber)
  }

  getStyle(): MarkStyle {
    return { ...this.style }
  }

  /** 页面渲染完成（或尺寸/旋转变化）后同步图层。 */
  onPageRendered(pageNumber: number): void {
    this.ensureLayer(pageNumber)
  }

  getMarks(): Mark[] {
    return this.marks.map((m) => structuredClone(m))
  }

  /** 整体替换标绘数据（导入用）。 */
  setMarks(marks: Mark[]): void {
    if (!Array.isArray(marks)) return
    this.cancelSession()
    this.selectedId = null
    const next = marks.map((m) => structuredClone(m))
    this.history.push({ op: "import", prev: this.marks, next })
    this.redoStack = []
    this.marks = next
    this.redrawAll()
    this.emitChange()
  }

  clearMarks(pageNumber?: number): void {
    if (!this.marks.length) return
    let removed: Mark[]
    if (pageNumber === undefined) {
      removed = this.marks
      this.marks = []
    } else {
      removed = this.marks.filter((m) => m.pageNumber === pageNumber)
      if (!removed.length) return
      this.marks = this.marks.filter((m) => m.pageNumber !== pageNumber)
    }
    this.history.push({ op: "clear", removed })
    this.redoStack = []
    this.selectedId = null
    this.redrawAll()
    this.emitChange()
  }

  deleteSelected(): void {
    if (!this.selectedId) return
    const index = this.marks.findIndex((m) => m.id === this.selectedId)
    if (index < 0) return
    const [mark] = this.marks.splice(index, 1)
    this.history.push({ op: "delete", mark, index })
    this.redoStack = []
    this.selectedId = null
    this.redrawAll()
    this.emitChange()
  }

  undo(): void {
    const entry = this.history.pop()
    if (!entry) return
    this.applyHistory(entry, false)
    this.redoStack.push(entry)
    this.redrawAll()
    this.emitChange()
  }

  redo(): void {
    const entry = this.redoStack.pop()
    if (!entry) return
    this.applyHistory(entry, true)
    this.history.push(entry)
    this.redrawAll()
    this.emitChange()
  }

  canUndo(): boolean {
    return this.history.length > 0
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /** 导出 JSON 字符串。 */
  exportJson(): string {
    return JSON.stringify({ version: 1, marks: this.marks }, null, 2)
  }

  /** 从 JSON 字符串导入（校验后整体替换）。 */
  importJson(json: string): boolean {
    try {
      const data = JSON.parse(json)
      const marks: Mark[] = Array.isArray(data) ? data : data?.marks
      if (!Array.isArray(marks)) return false
      this.setMarks(marks)
      return true
    } catch {
      return false
    }
  }

  /** 文档切换时调用：销毁所有图层并清空数据。 */
  reset(): void {
    this.cancelSession()
    for (const layer of this.layers.values()) {
      layer.ro.disconnect()
      layer.mo.disconnect()
      layer.canvas.remove()
    }
    this.layers.clear()
    this.marks = []
    this.history = []
    this.redoStack = []
    this.selectedId = null
    this.emitChange()
  }

  destroy(): void {
    document.removeEventListener("keydown", this.keydownHandler)
    this.reset()
  }

  // ================= 图层管理 =================

  private getViewer() {
    return this.options.getViewer()
  }

  private pageView(pageNumber: number) {
    const viewer = this.getViewer()
    return viewer?.getPageView(pageNumber - 1) ?? null
  }

  private ensureLayer(pageNumber: number): LayerEntry | null {
    const existing = this.layers.get(pageNumber)
    if (existing) return existing

    const pageView = this.pageView(pageNumber)
    const pageDiv = pageView?.div
    if (!pageDiv) return null

    const canvas = document.createElement("canvas")
    canvas.className = "ppv-mark-canvas"
    canvas.style.pointerEvents = this.active ? "auto" : "none"
    canvas.style.cursor = this.active ? this.cursorFor(this.tool) : "default"
    canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e, pageNumber))
    canvas.addEventListener("pointermove", (e) => this.onPointerMove(e, pageNumber))
    canvas.addEventListener("pointerup", (e) => this.onPointerUp(e, pageNumber))
    canvas.addEventListener("pointercancel", () => this.onPointerUp(null, pageNumber))
    canvas.addEventListener("dblclick", (e: MouseEvent) => this.onDblClick(e, pageNumber))
    canvas.addEventListener("contextmenu", (e) => {
      if (this.active) e.preventDefault()
    })
    pageDiv.appendChild(canvas)

    const ctx = canvas.getContext("2d")!
    const ro = new ResizeObserver(() => this.syncLayer(layer))
    ro.observe(pageDiv)
    // pdf.js 重建页面结构（reset）时可能移除我们的 canvas，自动补回
    const mo = new MutationObserver(() => {
      if (!pageDiv.contains(canvas) && !canvas.isConnected) {
        pageDiv.appendChild(canvas)
        this.syncLayer(layer)
      }
    })
    mo.observe(pageDiv, { childList: true })

    const layer: LayerEntry = { canvas, ctx, pageDiv, ro, mo }
    this.layers.set(pageNumber, layer)
    this.syncLayer(layer)
    return layer
  }

  private syncLayer(layer: LayerEntry): void {
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.round(layer.pageDiv.clientWidth * dpr))
    const h = Math.max(1, Math.round(layer.pageDiv.clientHeight * dpr))
    if (layer.canvas.width !== w || layer.canvas.height !== h) {
      layer.canvas.width = w
      layer.canvas.height = h
    }
    const pageNumber = this.pageNumberOf(layer)
    if (pageNumber !== null) this.redrawPage(pageNumber)
  }

  private pageNumberOf(layer: LayerEntry): number | null {
    for (const [num, l] of this.layers) {
      if (l === layer) return num
    }
    return null
  }

  // ================= 绘制 =================

  private redrawAll(): void {
    for (const pageNumber of this.layers.keys()) {
      this.redrawPage(pageNumber)
    }
  }

  private redrawPage(pageNumber: number): void {
    const layer = this.layers.get(pageNumber)
    if (!layer) return
    const { ctx, canvas } = layer
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const pageView = this.pageView(pageNumber)
    const vp = pageView?.viewport
    if (!vp) return
    const t = vp.transform
    ctx.setTransform(t[0] * dpr, t[1] * dpr, t[2] * dpr, t[3] * dpr, t[4] * dpr, t[5] * dpr)
    const scaleX = Math.hypot(t[0], t[1])

    for (const mark of this.marks) {
      if (mark.pageNumber !== pageNumber) continue
      this.drawMark(ctx, mark, scaleX, mark.id === this.selectedId)
    }

    // 绘制中的预览
    const session = this.session
    if (session && session.pageNumber === pageNumber && session.points.length > 0) {
      // pen 的点已实时采样进 session.points，preview 只用于直线/矩形等拖拽式工具
      const points =
        this.tool === "pen"
          ? session.points
          : session.preview
            ? [...session.points, session.preview]
            : session.points
      this.drawPreview(ctx, points, scaleX)
    }
  }

  private drawMark(
    ctx: CanvasRenderingContext2D,
    mark: Mark,
    scaleX: number,
    selected: boolean,
  ): void {
    ctx.save()
    ctx.strokeStyle = mark.style.color
    ctx.fillStyle = mark.style.color
    ctx.lineWidth = mark.style.lineWidth / scaleX
    ctx.lineJoin = "round"
    ctx.lineCap = "round"

    if (mark.type === "text" && mark.text) {
      const fontSize = (mark.style.fontSize || 16) / scaleX
      ctx.font = `${fontSize}px "Google Sans", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif`
      ctx.textBaseline = "top"
      ctx.fillText(mark.text, mark.points[0].x, mark.points[0].y)
    } else if (mark.type === "rect" || mark.type === "ellipse") {
      const [p1, p2] = mark.points
      const x = Math.min(p1.x, p2.x)
      const y = Math.min(p1.y, p2.y)
      const w = Math.abs(p2.x - p1.x)
      const h = Math.abs(p2.y - p1.y)
      ctx.beginPath()
      if (mark.type === "rect") ctx.rect(x, y, w, h)
      else ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
      if (mark.style.fill) {
        ctx.globalAlpha = 0.25
        ctx.fill()
        ctx.globalAlpha = 1
      }
      ctx.stroke()
    } else {
      // pen / line / arrow / polygon / polyline
      const pts = mark.points
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
      if (mark.type === "polygon") {
        ctx.closePath()
        if (mark.style.fill) {
          ctx.globalAlpha = 0.25
          ctx.fill()
          ctx.globalAlpha = 1
        }
      }
      ctx.stroke()
      if (mark.type === "arrow" && pts.length >= 2) {
        this.drawArrowHead(ctx, pts[pts.length - 2], pts[pts.length - 1], scaleX)
      }
    }

    if (selected) {
      ctx.strokeStyle = "#1a73e8"
      ctx.lineWidth = 1.5 / scaleX
      ctx.setLineDash([4 / scaleX, 3 / scaleX])
      const b = this.boundsOf(mark)
      if (b) {
        ctx.strokeRect(b.x - 3 / scaleX, b.y - 3 / scaleX, b.w + 6 / scaleX, b.h + 6 / scaleX)
      }
    }
    ctx.restore()
  }

  private drawArrowHead(
    ctx: CanvasRenderingContext2D,
    from: MarkPoint,
    to: MarkPoint,
    scaleX: number,
  ): void {
    const angle = Math.atan2(to.y - from.y, to.x - from.x)
    const len = Math.max(8, ctx.lineWidth * 3) / scaleX
    ctx.beginPath()
    ctx.moveTo(to.x, to.y)
    ctx.lineTo(
      to.x - len * Math.cos(angle - Math.PI / 6),
      to.y - len * Math.sin(angle - Math.PI / 6),
    )
    ctx.moveTo(to.x, to.y)
    ctx.lineTo(
      to.x - len * Math.cos(angle + Math.PI / 6),
      to.y - len * Math.sin(angle + Math.PI / 6),
    )
    ctx.stroke()
  }

  private drawPreview(ctx: CanvasRenderingContext2D, points: MarkPoint[], scaleX: number): void {
    ctx.save()
    ctx.strokeStyle = this.style.color
    ctx.fillStyle = this.style.color
    ctx.lineWidth = this.style.lineWidth / scaleX
    ctx.lineJoin = "round"
    ctx.lineCap = "round"
    ctx.globalAlpha = 0.85

    const tool = this.tool
    if (tool === "rect" || tool === "ellipse") {
      const [p1, p2] = points
      const x = Math.min(p1.x, p2.x)
      const y = Math.min(p1.y, p2.y)
      const w = Math.abs(p2.x - p1.x)
      const h = Math.abs(p2.y - p1.y)
      ctx.beginPath()
      if (tool === "rect") ctx.rect(x, y, w, h)
      else ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
      if (this.style.fill) {
        ctx.globalAlpha = 0.25
        ctx.fill()
        ctx.globalAlpha = 0.85
      }
      ctx.stroke()
    } else if (tool === "polygon" || tool === "polyline" || tool === "pen") {
      ctx.beginPath()
      ctx.moveTo(points[0].x, points[0].y)
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
      ctx.stroke()
    } else if (tool === "line" || tool === "arrow") {
      ctx.beginPath()
      ctx.moveTo(points[0].x, points[0].y)
      ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y)
      ctx.stroke()
      if (tool === "arrow") this.drawArrowHead(ctx, points[0], points[points.length - 1], scaleX)
    }
    ctx.restore()
  }

  private boundsOf(mark: Mark): { x: number; y: number; w: number; h: number } | null {
    if (!mark.points.length) return null
    let x1 = Infinity,
      y1 = Infinity,
      x2 = -Infinity,
      y2 = -Infinity
    for (const p of mark.points) {
      x1 = Math.min(x1, p.x)
      y1 = Math.min(y1, p.y)
      x2 = Math.max(x2, p.x)
      y2 = Math.max(y2, p.y)
    }
    if (mark.text) {
      x2 += (mark.style.fontSize || 16) * 0.6
      y2 += mark.style.fontSize || 16
    }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
  }

  // ================= 交互 =================

  private cursorFor(tool: MarkTool): string {
    switch (tool) {
      case "select":
        return "default"
      case "text":
        return "text"
      default:
        return "crosshair"
    }
  }

  private toPagePoint(e: PointerEvent, pageNumber: number): MarkPoint {
    const pageView = this.pageView(pageNumber)
    const canvas = this.layers.get(pageNumber)?.canvas
    const vp = pageView?.viewport
    if (!vp || !canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const cssX = e.clientX - rect.left
    const cssY = e.clientY - rect.top
    // 页坐标 = 逆 viewport 变换 × CSS 坐标
    const t = vp.transform
    const det = t[0] * t[3] - t[1] * t[2]
    if (det === 0) return { x: cssX, y: cssY }
    const inv = [
      t[3] / det,
      -t[1] / det,
      -t[2] / det,
      t[0] / det,
      (t[2] * t[5] - t[3] * t[4]) / det,
      (t[1] * t[4] - t[0] * t[5]) / det,
    ]
    return {
      x: inv[0] * cssX + inv[2] * cssY + inv[4],
      y: inv[1] * cssX + inv[3] * cssY + inv[5],
    }
  }

  private onPointerDown(e: PointerEvent, pageNumber: number): void {
    if (!this.active) return
    e.preventDefault()
    const canvas = this.layers.get(pageNumber)?.canvas
    try {
      canvas?.setPointerCapture(e.pointerId)
    } catch {
      // 合成事件/指针已释放时忽略（绘制仍可继续，仅失去移出画布后的捕获）
    }
    const p = this.toPagePoint(e, pageNumber)

    if (this.tool === "select") {
      const hit = this.hitTest(p, pageNumber)
      if (hit) {
        this.selectedId = hit.id
        this.session = {
          pageNumber,
          points: [],
          preview: null,
          lastPoint: null,
          moving: { mark: hit, startPoints: hit.points.map((q) => ({ ...q })), startPointer: p },
        }
      } else {
        this.selectedId = null
      }
      this.redrawPage(pageNumber)
      return
    }

    this.selectedId = null
    if (this.tool === "text") {
      const text = window.prompt("输入标注文字：")
      if (text && text.trim()) {
        this.addMark(pageNumber, "text", [p], { text: text.trim() })
      }
      return
    }

    if (!this.session || this.session.pageNumber !== pageNumber || this.session.moving) {
      this.session = { pageNumber, points: [p], preview: p, lastPoint: p, moving: null }
    } else if (this.tool === "polygon" || this.tool === "polyline") {
      // 连续加点；双击由 onDblClick 结束
      this.session.points.push(p)
    }
    this.redrawPage(pageNumber)
  }

  private onPointerMove(e: PointerEvent, pageNumber: number): void {
    if (!this.active || !this.session || this.session.pageNumber !== pageNumber) return
    e.preventDefault()
    const p = this.toPagePoint(e, pageNumber)

    if (this.session.moving) {
      const { mark, startPoints, startPointer } = this.session.moving
      const dx = p.x - startPointer.x
      const dy = p.y - startPointer.y
      mark.points = startPoints.map((q) => ({ x: q.x + dx, y: q.y + dy }))
      this.redrawPage(pageNumber)
      return
    }

    const tool = this.tool
    if (tool === "pen") {
      const last = this.session.lastPoint
      const s = this.session.points
      const scaleX = this.scaleXOf(pageNumber)
      const minDist = Math.max(0.5, 1.5 / scaleX)
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= minDist) {
        s.push(p)
        this.session.lastPoint = p
      }
    } else if (tool !== "select" && tool !== "text") {
      this.session.preview = p
    }
    this.redrawPage(pageNumber)
  }

  private onPointerUp(e: PointerEvent | null, pageNumber: number): void {
    if (!this.active || !this.session || this.session.pageNumber !== pageNumber) return

    if (this.session.moving) {
      // 移动结束：提交历史
      if (e) {
        const { mark, startPoints } = this.session.moving
        this.history.push({
          op: "move",
          id: mark.id,
          prev: startPoints,
          next: mark.points.map((q) => ({ ...q })),
        })
        this.redoStack = []
      } else {
        // pointercancel：还原位置
        const { mark, startPoints } = this.session.moving
        mark.points = startPoints
      }
      this.session = null
      this.redrawPage(pageNumber)
      this.emitChange()
      return
    }

    if (e) {
      this.session.preview = this.toPagePoint(e, pageNumber)
    } else {
      // pointercancel：放弃本次绘制
      this.session = null
      this.redrawPage(pageNumber)
      return
    }

    const tool = this.tool
    const session = this.session
    const pts = session.preview ? [...session.points, session.preview] : [...session.points]

    if (tool === "pen") {
      if (session.points.length >= 2) this.addMark(pageNumber, "pen", session.points)
      this.session = null
    } else if (tool === "line" || tool === "arrow") {
      if (pts.length >= 2) this.addMark(pageNumber, tool, [pts[0], pts[pts.length - 1]])
      this.session = null
    } else if (tool === "rect" || tool === "ellipse") {
      if (
        pts.length >= 2 &&
        Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) > 2 / this.scaleXOf(pageNumber)
      ) {
        this.addMark(pageNumber, tool, [pts[0], pts[1]])
      }
      this.session = null
    }
    // polygon / polyline：等待双击完成或 Esc 取消
    this.redrawPage(pageNumber)
  }

  private onDblClick(e: MouseEvent, pageNumber: number): void {
    if (!this.active) return
    const session = this.session
    if (!session || session.pageNumber !== pageNumber || session.moving) return
    e.preventDefault()
    // 双击的第二次 down 已把结束点压入 points，去掉后即为最终顶点
    const pts = session.points.slice(0, -1)
    if (this.tool === "polygon" && pts.length >= 3) {
      this.addMark(pageNumber, "polygon", pts)
      this.session = null
    } else if (this.tool === "polyline" && pts.length >= 2) {
      this.addMark(pageNumber, "polyline", pts)
      this.session = null
    } else {
      return
    }
    this.redrawPage(pageNumber)
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (!this.active) return
    const target = e.target as HTMLElement | null
    if (
      target &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
    ) {
      return
    }
    if (e.key === "Escape") {
      this.cancelSession()
      this.selectedId = null
      this.redrawAll()
    } else if (e.key === "Delete" || e.key === "Backspace") {
      if (this.selectedId) {
        e.preventDefault()
        this.deleteSelected()
      }
    }
  }

  private cancelSession(): void {
    if (this.session) {
      const pageNumber = this.session.pageNumber
      this.session = null
      this.redrawPage(pageNumber)
    }
  }

  private scaleXOf(pageNumber: number): number {
    const vp = this.pageView(pageNumber)?.viewport
    return vp ? Math.hypot(vp.transform[0], vp.transform[1]) : 1
  }

  // ================= 数据 =================

  private addMark(
    pageNumber: number,
    type: MarkType,
    points: MarkPoint[],
    extra?: Partial<Mark>,
  ): void {
    if (!points.length) return
    const mark: Mark = {
      id: `m${++this.idSeq}-${Date.now().toString(36)}`,
      pageNumber,
      type,
      points: points.map((p) => ({ x: p.x, y: p.y })),
      style: { ...this.style },
      createdAt: Date.now(),
      ...extra,
    }
    this.marks.push(mark)
    this.history.push({ op: "add", mark })
    this.redoStack = []
    this.redrawPage(pageNumber)
    this.emitChange()
  }

  private hitTest(p: MarkPoint, pageNumber: number): Mark | null {
    const scaleX = this.scaleXOf(pageNumber)
    const tol = HIT_TOLERANCE_CSS / scaleX
    const candidates = this.marks.filter((m) => m.pageNumber === pageNumber)
    // 倒序：后画的在上面
    for (let i = candidates.length - 1; i >= 0; i--) {
      const mark = candidates[i]
      if (this.pointInMark(p, mark, tol)) return mark
    }
    return null
  }

  private pointInMark(p: MarkPoint, mark: Mark, tol: number): boolean {
    const pts = mark.points
    if (mark.type === "text") {
      const [o] = pts
      const fs = (mark.style.fontSize || 16) / this.scaleXOf(mark.pageNumber)
      return Math.abs(p.x - o.x) <= tol + fs * 3 && Math.abs(p.y - o.y) <= tol + fs
    }
    if (mark.type === "rect") {
      const x = Math.min(pts[0].x, pts[1].x) - tol
      const y = Math.min(pts[0].y, pts[1].y) - tol
      const w = Math.abs(pts[1].x - pts[0].x) + tol * 2
      const h = Math.abs(pts[1].y - pts[0].y) + tol * 2
      return p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h
    }
    if (mark.type === "ellipse") {
      const cx = (pts[0].x + pts[1].x) / 2
      const cy = (pts[0].y + pts[1].y) / 2
      const rx = Math.abs(pts[1].x - pts[0].x) / 2 + tol
      const ry = Math.abs(pts[1].y - pts[0].y) / 2 + tol
      if (rx <= 0 || ry <= 0) return false
      return ((p.x - cx) / rx) ** 2 + ((p.y - cy) / ry) ** 2 <= 1
    }
    if (mark.type === "polygon") {
      if (this.pointInPolygon(p, pts)) return true
    }
    // 线段距离判定（pen/line/arrow/polygon/polyline）
    for (let i = 0; i < pts.length - 1; i++) {
      if (this.distToSegment(p, pts[i], pts[i + 1]) <= tol) return true
    }
    return false
  }

  private pointInPolygon(p: MarkPoint, pts: MarkPoint[]): boolean {
    let inside = false
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x,
        yi = pts[i].y
      const xj = pts[j].x,
        yj = pts[j].y
      if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) {
        inside = !inside
      }
    }
    return inside
  }

  private distToSegment(p: MarkPoint, a: MarkPoint, b: MarkPoint): number {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
    t = Math.max(0, Math.min(1, t))
    const qx = a.x + t * dx
    const qy = a.y + t * dy
    return Math.hypot(p.x - qx, p.y - qy)
  }

  private applyHistory(entry: HistoryEntry, forward: boolean): void {
    switch (entry.op) {
      case "add": {
        if (forward) {
          if (!this.marks.some((m) => m.id === entry.mark.id)) {
            this.marks.push(structuredClone(entry.mark))
          }
        } else {
          const idx = this.marks.findIndex((m) => m.id === entry.mark.id)
          if (idx >= 0) this.marks.splice(idx, 1)
        }
        break
      }
      case "delete": {
        if (forward) {
          this.marks.splice(
            Math.min(entry.index, this.marks.length),
            0,
            structuredClone(entry.mark),
          )
        } else {
          const idx = this.marks.findIndex((m) => m.id === entry.mark.id)
          if (idx >= 0) this.marks.splice(idx, 1)
        }
        break
      }
      case "clear": {
        if (forward) {
          const removedIds = new Set(entry.removed.map((m) => m.id))
          this.marks = this.marks.filter((m) => !removedIds.has(m.id))
        } else {
          const keptIds = new Set(this.marks.map((m) => m.id))
          this.marks = [...entry.removed.filter((m) => !keptIds.has(m.id)), ...this.marks]
        }
        break
      }
      case "import": {
        this.marks = forward ? entry.next : entry.prev
        break
      }
      case "move": {
        const mark = this.marks.find((m) => m.id === entry.id)
        if (mark) {
          mark.points = forward
            ? entry.next.map((q) => ({ ...q }))
            : entry.prev.map((q) => ({ ...q }))
        }
        break
      }
    }
  }

  private emitChange(): void {
    this.options.onMarksChange?.(this.getMarks())
  }
}
