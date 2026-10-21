/**
 * 标绘工具面板（Material 风格浮层）：
 *   工具行 / 样式行（颜色、线宽、填充）/ 操作行（撤销、重做、删除、清空、导出、导入）。
 */
import { markIconSvg } from "./markIcons"
import { ColorPicker } from "../ui/ColorPicker"
import { PpvSwitch } from "../ui/Switch"
import type { MarkTool, MarkStyle } from "./marks"

export interface MarkPanelHandlers {
  onToolChange: (tool: MarkTool) => void
  onStyleChange: (style: Partial<MarkStyle>) => void
  onUndo: () => void
  onRedo: () => void
  onDelete: () => void
  onClear: () => void
  onExport: () => void
  onImport: () => void
}

const TOOLS: Array<{ tool: MarkTool; title: string }> = [
  { tool: "select", title: "选择 / 移动 (V)" },
  { tool: "pen", title: "画笔 (P)" },
  { tool: "ink", title: "水墨笔 (K)" },
  { tool: "marker", title: "水性笔 (M)" },
  { tool: "line", title: "直线 (L)" },
  { tool: "arrow", title: "箭头 (A)" },
  { tool: "rect", title: "矩形 (R)" },
  { tool: "ellipse", title: "椭圆 (O)" },
  { tool: "polygon", title: "多边形 (G)" },
  { tool: "polyline", title: "折线 (N)" },
  { tool: "text", title: "文字 (T)" },
]

const COLORS = [
  "#d93025", // 红
  "#f29900", // 橙
  "#f9ab00", // 黄
  "#188038", // 绿
  "#12a4af", // 青
  "#1a73e8", // 蓝
  "#7b1fa2", // 紫
  "#202124", // 黑
]

const WIDTHS = [1, 2, 3, 4, 6]

export class MarkPanel {
  readonly el: HTMLElement
  private readonly handlers: MarkPanelHandlers
  private tool = "select" as MarkTool
  private toolButtons = new Map<MarkTool, HTMLButtonElement>()
  private readonly undoBtn: HTMLButtonElement
  private readonly redoBtn: HTMLButtonElement
  private readonly deleteBtn: HTMLButtonElement
  private readonly clearBtn: HTMLButtonElement
  private readonly widthBtns = new Map<number, HTMLButtonElement>()
  private readonly widthInput: HTMLInputElement
  private readonly fillSwitch: PpvSwitch
  private readonly colorPicker: ColorPicker
  private readonly colorSwatches = new Map<string, HTMLButtonElement>()
  private open = false

  constructor(handlers: MarkPanelHandlers) {
    this.handlers = handlers
    this.el = document.createElement("div")
    this.el.className = "ppv-mark-panel"
    this.el.hidden = true

    // ---- 工具行 ----
    const toolRow = document.createElement("div")
    toolRow.className = "ppv-mark-row"
    for (const { tool, title } of TOOLS) {
      const btn = document.createElement("button")
      btn.type = "button"
      btn.className = "ppv-mark-btn"
      btn.title = title
      btn.dataset.tool = tool
      btn.innerHTML = markIconSvg(tool)
      btn.addEventListener("click", () => this.selectTool(tool))
      toolRow.appendChild(btn)
      this.toolButtons.set(tool, btn)
    }
    this.el.appendChild(toolRow)

    // ---- 样式行 ----
    const styleRow = document.createElement("div")
    styleRow.className = "ppv-mark-row ppv-mark-style-row"

    const colorBox = document.createElement("div")
    colorBox.className = "ppv-mark-colors"
    for (const color of COLORS) {
      const sw = document.createElement("button")
      sw.type = "button"
      sw.className = "ppv-mark-swatch"
      sw.style.backgroundColor = color
      sw.title = color
      sw.dataset.color = color
      sw.addEventListener("click", () => this.setColor(color))
      colorBox.appendChild(sw)
      this.colorSwatches.set(color, sw)
    }
    // 自实现取色器（替代原生 color input）
    this.colorPicker = new ColorPicker({
      value: "#d93025",
      title: "自定义颜色",
      onChange: (color) => this.setColor(color),
    })
    colorBox.appendChild(this.colorPicker.el)

    const widthBox = document.createElement("div")
    widthBox.className = "ppv-mark-widths"
    for (const w of WIDTHS) {
      const btn = document.createElement("button")
      btn.type = "button"
      btn.className = "ppv-mark-width"
      btn.title = `${w}px`
      btn.dataset.width = String(w)
      const dot = document.createElement("span")
      dot.style.width = `${Math.min(16, 2 + w * 2)}px`
      dot.style.height = `${Math.min(16, 2 + w * 2)}px`
      btn.appendChild(dot)
      btn.addEventListener("click", () => this.setWidth(w))
      widthBox.appendChild(btn)
      this.widthBtns.set(w, btn)
    }

    // 自定义宽度输入（1~64，任意值）
    const widthInput = document.createElement("input")
    widthInput.type = "number"
    widthInput.className = "ppv-mark-width-input"
    widthInput.min = "1"
    widthInput.max = "64"
    widthInput.step = "1"
    widthInput.title = "自定义笔宽 (1-64)"
    widthInput.value = "2"
    widthInput.addEventListener("input", () => {
      const v = Number(widthInput.value)
      if (!Number.isFinite(v)) return
      const clamped = Math.round(Math.min(64, Math.max(1, v)))
      this.applyStyleLocal({ lineWidth: clamped })
      this.handlers.onStyleChange({ lineWidth: clamped })
    })
    widthInput.addEventListener("blur", () => {
      const v = Number(widthInput.value)
      const clamped = Number.isFinite(v) ? Math.min(64, Math.max(1, Math.round(v))) : 2
      widthInput.value = String(clamped)
    })
    this.widthInput = widthInput
    widthBox.appendChild(widthInput)

    // 填充开关（自实现）
    this.fillSwitch = new PpvSwitch("填充", true, (checked) =>
      this.handlers.onStyleChange({ fill: checked }),
    )
    this.fillSwitch.el.classList.add("ppv-mark-fill")

    styleRow.append(colorBox, widthBox, this.fillSwitch.el)
    this.el.appendChild(styleRow)

    // ---- 操作行 ----
    const actionRow = document.createElement("div")
    actionRow.className = "ppv-mark-row ppv-mark-action-row"
    const mkBtn = (
      title: string,
      icon: "undo" | "redo" | "trash" | "clear" | "export" | "import",
      onClick: () => void,
    ) => {
      const btn = document.createElement("button")
      btn.type = "button"
      btn.className = "ppv-mark-btn"
      btn.title = title
      btn.innerHTML = markIconSvg(icon)
      btn.addEventListener("click", onClick)
      return btn
    }
    const undoBtn = mkBtn("撤销 (Ctrl+Z)", "undo", () => this.handlers.onUndo())
    const redoBtn = mkBtn("重做 (Ctrl+Y)", "redo", () => this.handlers.onRedo())
    const deleteBtn = mkBtn("删除选中 (Del)", "trash", () => this.handlers.onDelete())
    const clearBtn = mkBtn("清空全部", "clear", () => this.handlers.onClear())
    const exportBtn = mkBtn("导出 JSON", "export", () => this.handlers.onExport())
    const importBtn = mkBtn("导入 JSON", "import", () => this.handlers.onImport())
    this.undoBtn = undoBtn
    this.redoBtn = redoBtn
    this.deleteBtn = deleteBtn
    this.clearBtn = clearBtn
    actionRow.append(undoBtn, redoBtn, deleteBtn, clearBtn, exportBtn, importBtn)
    this.el.appendChild(actionRow)

    this.selectTool("select")
    this.setStyle({ color: "#d93025", lineWidth: 2, fill: true })
  }

  openPanel(): void {
    this.open = true
    this.el.hidden = false
  }

  closePanel(): void {
    this.open = false
    this.el.hidden = true
  }

  isOpen(): boolean {
    return this.open
  }

  selectTool(tool: MarkTool): void {
    this.tool = tool
    for (const [name, btn] of this.toolButtons) {
      btn.classList.toggle("active", name === tool)
    }
    this.handlers.onToolChange(tool)
  }

  getTool(): MarkTool {
    return this.tool
  }

  /** 更新面板控件状态（色板高亮、宽度档位/输入框、填充开关）。 */
  setStyle(style: Partial<MarkStyle>): void {
    if (style.color) {
      for (const [color, sw] of this.colorSwatches) {
        sw.classList.toggle("active", color === style.color)
      }
      this.colorPicker.setColor(style.color)
    }
    if (style.lineWidth !== undefined) {
      for (const [w, btn] of this.widthBtns) {
        btn.classList.toggle("active", w === style.lineWidth)
      }
      this.widthInput.value = String(style.lineWidth)
    }
    if (style.fill !== undefined) {
      this.fillSwitch.setChecked(style.fill)
    }
  }

  /** 本地立即刷新控件状态（不依赖外部回推），再通知宿主。 */
  private applyStyleLocal(style: Partial<MarkStyle>): void {
    if (style.color) {
      for (const [color, sw] of this.colorSwatches) {
        sw.classList.toggle("active", color === style.color)
      }
      this.colorPicker.setColor(style.color)
    }
    if (style.lineWidth !== undefined) {
      for (const [w, btn] of this.widthBtns) {
        btn.classList.toggle("active", w === style.lineWidth)
      }
      this.widthInput.value = String(style.lineWidth)
    }
    if (style.fill !== undefined) {
      this.fillSwitch.setChecked(style.fill)
    }
    this.handlers.onStyleChange(style)
  }

  private setColor(color: string): void {
    this.applyStyleLocal({ color })
  }

  private setWidth(width: number): void {
    this.applyStyleLocal({ lineWidth: width })
  }

  setHistoryState(canUndo: boolean, canRedo: boolean, hasSelection: boolean): void {
    this.undoBtn.disabled = !canUndo
    this.redoBtn.disabled = !canRedo
    this.deleteBtn.disabled = !hasSelection
  }
}
