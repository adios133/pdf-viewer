/**
 * ColorPicker —— 自实现取色器（替代原生 <input type="color">）。
 *   触发按钮（当前色块）+ 弹出面板：常用色板网格 + HEX 输入。
 *   不依赖系统取色对话框，跨浏览器一致。
 */

/** 弹层常用色板（5 列 × 4 行，覆盖笔记常用色）。 */
const PALETTE = [
  "#d93025",
  "#e8710a",
  "#f29900",
  "#f9ab00",
  "#e52592",
  "#188038",
  "#12a4af",
  "#1a73e8",
  "#7b1fa2",
  "#202124",
  "#ff8a80",
  "#ffb74d",
  "#ffe082",
  "#c5e1a5",
  "#80cbc4",
  "#90caf9",
  "#b39ddb",
  "#9e9e9e",
  "#5f6368",
  "#000000",
]

export interface ColorPickerOptions {
  /** 初始颜色 */
  value: string
  onChange: (color: string) => void
  /** 触发按钮标题 */
  title?: string
}

export class ColorPicker {
  readonly el: HTMLDivElement
  private readonly trigger: HTMLButtonElement
  private readonly pop: HTMLDivElement
  private readonly hexInput: HTMLInputElement
  private readonly preview: HTMLSpanElement
  private readonly gridButtons = new Map<string, HTMLButtonElement>()
  private readonly onChange: (color: string) => void
  private current: string
  private open = false
  private readonly onOutside = (e: PointerEvent) => {
    if (!this.open) return
    const target = e.target as Node | null
    if (target && !this.el.contains(target)) this.close()
  }
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.open) {
      e.preventDefault()
      this.close()
    }
  }

  constructor(opts: ColorPickerOptions) {
    this.onChange = opts.onChange
    this.current = opts.value

    this.el = document.createElement("div")
    this.el.className = "ppv-colorpicker"

    // 触发按钮：圆形色块
    this.trigger = document.createElement("button")
    this.trigger.type = "button"
    this.trigger.className = "ppv-colorpicker-trigger"
    this.trigger.title = opts.title ?? "自定义颜色"
    this.trigger.addEventListener("click", () => this.toggle())
    this.el.appendChild(this.trigger)

    // 弹层
    this.pop = document.createElement("div")
    this.pop.className = "ppv-colorpicker-pop"

    const grid = document.createElement("div")
    grid.className = "ppv-colorpicker-grid"
    for (const color of PALETTE) {
      const sw = document.createElement("button")
      sw.type = "button"
      sw.className = "ppv-colorpicker-swatch"
      sw.style.backgroundColor = color
      sw.title = color
      sw.dataset.color = color
      sw.addEventListener("click", () => {
        this.apply(color)
      })
      grid.appendChild(sw)
      this.gridButtons.set(color, sw)
    }
    this.pop.appendChild(grid)

    const hexRow = document.createElement("div")
    hexRow.className = "ppv-colorpicker-hex-row"
    this.preview = document.createElement("span")
    this.preview.className = "ppv-colorpicker-preview"
    this.hexInput = document.createElement("input")
    this.hexInput.type = "text"
    this.hexInput.className = "ppv-colorpicker-hex"
    this.hexInput.placeholder = "HEX 如 #1a73e8"
    this.hexInput.spellcheck = false
    this.hexInput.autocomplete = "off"
    this.hexInput.addEventListener("input", () => this.applyHex(this.hexInput.value))
    this.hexInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault()
        this.close()
      }
    })
    hexRow.append(this.preview, this.hexInput)
    this.pop.appendChild(hexRow)

    this.el.appendChild(this.pop)
    document.addEventListener("pointerdown", this.onOutside)
    document.addEventListener("keydown", this.onKey)
    this.refresh()
  }

  get value(): string {
    return this.current
  }

  /** 程序化更新颜色（不触发 onChange）。 */
  setColor(color: string): void {
    this.current = color
    this.refresh()
  }

  destroy(): void {
    document.removeEventListener("pointerdown", this.onOutside)
    document.removeEventListener("keydown", this.onKey)
    this.el.remove()
  }

  private toggle(): void {
    if (this.open) this.close()
    else {
      this.open = true
      this.el.classList.add("open")
      this.hexInput.value = this.current
      this.hexInput.focus()
      this.hexInput.select()
    }
  }

  private close(): void {
    this.open = false
    this.el.classList.remove("open")
  }

  private apply(color: string): void {
    this.current = color
    this.refresh()
    this.onChange(color)
  }

  private applyHex(raw: string): void {
    const color = normalizeHex(raw)
    this.preview.style.backgroundColor = color ?? "transparent"
    if (color) {
      this.current = color
      this.refresh()
      this.onChange(color)
    }
  }

  private refresh(): void {
    this.trigger.style.backgroundColor = this.current
    for (const [color, sw] of this.gridButtons) {
      sw.classList.toggle("active", color.toLowerCase() === this.current.toLowerCase())
    }
    this.preview.style.backgroundColor = this.current
    // 触发按钮在预设色板上时加描边提示
    this.trigger.classList.toggle(
      "on-palette",
      PALETTE.some((c) => c.toLowerCase() === this.current.toLowerCase()),
    )
  }
}

/** 归一化 HEX：#rgb / #rrggbb / 无 # 前缀 → #rrggbb；非法返回 null。 */
function normalizeHex(raw: string): string | null {
  let hex = raw.trim().replace(/^#/, "")
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("")
  }
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null
  return `#${hex.toLowerCase()}`
}
