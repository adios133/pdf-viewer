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
  | "select"
  | "pen"
  | "ink"
  | "marker"
  | "line"
  | "arrow"
  | "rect"
  | "ellipse"
  | "polygon"
  | "polyline"
  | "text"

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
      // pen/ink 的点已实时采样进 session.points，preview 只用于直线/矩形等拖拽式工具
      const isFreehand = this.tool === "pen" || this.tool === "ink" || this.tool === "marker"
      const points = isFreehand
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
    } else if (mark.type === "ink") {
      this.drawInk(ctx, mark.points, mark.style, scaleX)
    } else if (mark.type === "marker") {
      this.drawMarker(ctx, mark.points, mark.style, scaleX)
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

  /**
   * 水墨笔渲染：
   *   1. 路径 Catmull-Rom 平滑 + 高密度细分；
   *   2. 沿路径逐点计算宽度（钟形笔锋 + 速度因子），生成左右轮廓多边形**一次填充**，
   *      边缘连续平滑（避免逐段描边产生台阶锯齿）；
   *   3. 淡墨晕染层用同轮廓外扩填充，端头加半圆帽；
   *   4. 毛边纹理收敛在笔画**内部**（不超出轮廓），只做浓淡肌理，不外露毛刺。
   * 随机种子只由点几何派生：预览、提交、缩放旋转重绘完全一致。
   */
  private drawInk(
    ctx: CanvasRenderingContext2D,
    points: MarkPoint[],
    style: MarkStyle,
    scaleX: number,
  ): void {
    if (points.length < 2) return
    // 高密度细分，保证轮廓多边形平滑
    const smooth = smoothInkPoints(points, 4)
    const n = smooth.length
    if (n < 2) return

    const base = (style.lineWidth * 2.0) / scaleX
    const rnd = seededRandom(inkSeedOf(points))

    // ---- 逐点：半宽 + 法向 ----
    const halfW = new Array<number>(n)
    const normals = new Array<{ x: number; y: number }>(n)
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1)
      const bell = Math.sin(Math.PI * (0.06 + 0.9 * t))
      const cur = smooth[i]
      const next = smooth[Math.min(n - 1, i + 1)]
      const speed = this.inkSpeedFactor(cur, next, scaleX, base)
      const w = base * (0.34 + 0.66 * Math.pow(bell, 1.1)) * speed
      halfW[i] = w / 2
      const prev = smooth[Math.max(0, i - 1)]
      const dx = next.x - prev.x
      const dy = next.y - prev.y
      const len = Math.hypot(dx, dy)
      normals[i] = len > 0 ? { x: -dy / len, y: dx / len } : { x: 0, y: 0 }
    }

    ctx.save()
    ctx.fillStyle = style.color

    // 轮廓填充：widen 为相对半宽的外扩倍数
    const fillOutline = (widen: number, alpha: number) => {
      ctx.globalAlpha = alpha
      ctx.beginPath()
      // 左侧轮廓（起点 → 终点）
      for (let i = 0; i < n; i++) {
        const p = smooth[i]
        const nrm = normals[i]
        const w = Math.max(0.25, halfW[i] * widen)
        const x = p.x + nrm.x * w
        const y = p.y + nrm.y * w
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      // 右侧轮廓（终点 → 起点）
      for (let i = n - 1; i >= 0; i--) {
        const p = smooth[i]
        const nrm = normals[i]
        const w = Math.max(0.25, halfW[i] * widen)
        ctx.lineTo(p.x - nrm.x * w, p.y - nrm.y * w)
      }
      ctx.closePath()
      ctx.fill()
      // 两端半圆帽，收笔圆润
      for (const i of [0, n - 1]) {
        const p = smooth[i]
        const w = Math.max(0.25, halfW[i] * widen)
        ctx.beginPath()
        ctx.arc(p.x, p.y, w, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // ---- 1. 淡墨晕染层（外扩、平滑轮廓） ----
    fillOutline(2.4, 0.07)

    // ---- 2. 主墨层（一次填充，边缘平滑） ----
    fillOutline(1, 0.94)

    // ---- 3. 内部纹理：沿中线轻微起伏的浓淡细线（始终在笔画内部） ----
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    for (let s = 0; s < 2; s++) {
      const jitterAmp = base * (0.12 + rnd() * 0.12)
      const phase = rnd() * Math.PI * 2
      ctx.globalAlpha = 0.2
      ctx.lineWidth = Math.max(0.3, base * 0.1)
      ctx.beginPath()
      for (let i = 0; i < n; i++) {
        const p = smooth[i]
        const nrm = normals[i]
        const t = i / (n - 1)
        const fade = Math.sin(Math.PI * t)
        // 偏移限制在笔画内部（半宽的 55% 以内）
        const raw = (Math.sin(phase + t * 9) * 0.7 + (rnd() * 2 - 1) * 0.3) * jitterAmp * fade
        const off = Math.max(-halfW[i] * 0.55, Math.min(halfW[i] * 0.55, raw))
        const x = p.x + nrm.x * off
        const y = p.y + nrm.y * off
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    ctx.restore()
  }

  /**
   * 速度因子：段长越短（移动越慢）笔画越粗越浓。
   * 参考长度取基础宽度，退化为稳定值。
   */
  private inkSpeedFactor(a: MarkPoint, b: MarkPoint, scaleX: number, base: number): number {
    // 段长越短（移动越慢）笔画越粗；参考段长按 2~8 CSS px 的真实采样步长设计
    const dCss = Math.hypot(b.x - a.x, b.y - a.y) * scaleX
    void base
    return clamp(1.3 - (dCss - 2) / 26, 0.6, 1.3)
  }

  /**
   * 水性笔渲染：半透明、圆头、均匀宽度的书写笔触（适合划重点/圈注/笔记）。
   * 单层半透明描边，同一笔画内部不叠加变深，不同笔画重叠处自然加深；
   * 宽度直接使用用户设定的 lineWidth（视觉 CSS px），支持 1~64 自定义。
   */
  private drawMarker(
    ctx: CanvasRenderingContext2D,
    points: MarkPoint[],
    style: MarkStyle,
    scaleX: number,
  ): void {
    const width = Math.max(0.5, style.lineWidth / scaleX)
    ctx.save()
    ctx.strokeStyle = style.color
    ctx.fillStyle = style.color
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.globalAlpha = 0.5

    if (points.length < 2) {
      // 点按：画一个圆点
      const p = points[0]
      ctx.beginPath()
      ctx.arc(p.x, p.y, width / 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
      return
    }

    // 轻平滑（细分 2），保持书写笔迹流畅但不拖沓
    const smooth = smoothInkPoints(points, 2)
    ctx.lineWidth = width
    ctx.beginPath()
    ctx.moveTo(smooth[0].x, smooth[0].y)
    for (let i = 1; i < smooth.length; i++) ctx.lineTo(smooth[i].x, smooth[i].y)
    ctx.stroke()
    ctx.restore()
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
    if (tool === "ink") {
      // 水墨笔实时预览（与最终渲染一致，种子固定保证稳定）
      this.drawInk(ctx, points, this.style, scaleX)
    } else if (tool === "marker") {
      // 水性笔实时预览
      this.drawMarker(ctx, points, this.style, scaleX)
    } else if (tool === "rect" || tool === "ellipse") {
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
    if (tool === "pen" || tool === "ink" || tool === "marker") {
      const last = this.session.lastPoint
      const s = this.session.points
      const scaleX = this.scaleXOf(pageNumber)
      // 水墨笔采样更密一些，笔触更顺滑
      const minDist = Math.max(0.5, (tool === "ink" ? 1.1 : 1.5) / scaleX)
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

    if (tool === "pen" || tool === "ink" || tool === "marker") {
      if (session.points.length >= 2) this.addMark(pageNumber, tool, session.points)
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
    // 线段距离判定（pen/ink/line/arrow/polygon/polyline）
    // 水墨笔笔画更粗，命中容差按线宽放宽
    const segTol =
      mark.type === "ink" || mark.type === "marker"
        ? Math.max(tol, (mark.style.lineWidth * 0.9) / this.scaleXOf(mark.pageNumber))
        : tol
    for (let i = 0; i < pts.length - 1; i++) {
      if (this.distToSegment(p, pts[i], pts[i + 1]) <= segTol) return true
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

// ================= 水墨笔工具函数 =================

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** 由笔画点序列生成确定性种子：只依赖几何，预览与提交渲染完全一致。 */
function inkSeedOf(points: MarkPoint[]): number {
  let h = 2166136261
  for (const p of points) {
    h ^= Math.round(p.x * 100)
    h = Math.imul(h, 16777619)
    h ^= Math.round(p.y * 100)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** mulberry32 伪随机数生成器：同一种子序列完全一致。 */
function seededRandom(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function catmullRom(
  p0: MarkPoint,
  p1: MarkPoint,
  p2: MarkPoint,
  p3: MarkPoint,
  t: number,
): MarkPoint {
  const t2 = t * t
  const t3 = t2 * t
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
  return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) }
}

/** Catmull-Rom 平滑并在每段内细分（用于水墨笔的顺滑笔触）。 */
function smoothInkPoints(points: MarkPoint[], subdiv: number): MarkPoint[] {
  if (points.length < 2) return points.slice()
  const out: MarkPoint[] = [points[0]]
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[Math.min(points.length - 1, i + 2)]
    for (let s = 1; s <= subdiv; s++) {
      out.push(catmullRom(p0, p1, p2, p3, s / (subdiv + 1)))
    }
  }
  out.push(points[points.length - 1])
  return out
}
