/**
 * TextInput —— 自实现文本标注输入弹窗（替代 window.prompt）。
 *   跟随点击位置浮动显示，Material 风格卡片，Enter 确认 / Shift+Enter 换行 / Esc 取消，
 *   点击外部取消。挂载在插件根节点内（fixed 定位），自动继承主题变量。
 */

export interface TextInputOptions {
  /** 点击位置（viewport 坐标，clientX/clientY） */
  x: number
  y: number
  /** 文字颜色（标注颜色，同时用于输入文字预览） */
  color: string
  /** 确认回调（已 trim，非空） */
  onSubmit: (text: string) => void
  /** 取消回调 */
  onCancel?: () => void
}

const POPUP_WIDTH = 270
const MARGIN = 8

export class TextInput {
  readonly el: HTMLDivElement
  private readonly field: HTMLTextAreaElement
  private readonly opts: TextInputOptions
  private readonly onOutside = (e: PointerEvent) => {
    if (!this.el.contains(e.target as Node)) this.cancel()
  }
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      this.cancel()
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      e.stopPropagation()
      this.submit()
    }
  }
  private closed = false
  private armTimer: number | null = null

  constructor(opts: TextInputOptions) {
    this.opts = opts
    this.el = document.createElement("div")
    this.el.className = "ppv-text-input"
    this.el.style.width = `${POPUP_WIDTH}px`

    // 定位：始终紧贴点击点——优先右/下展开，边界不足时左/上翻转，
    // 保证弹窗不会远离点击位置（文字标注将出现在点击处）。
    const vw = window.innerWidth
    const vh = window.innerHeight
    const left =
      opts.x + POPUP_WIDTH + MARGIN > vw
        ? Math.max(MARGIN, opts.x - POPUP_WIDTH)
        : Math.max(MARGIN, opts.x)
    const estimatedHeight = 130
    const top =
      opts.y + estimatedHeight + MARGIN > vh
        ? Math.max(MARGIN, opts.y - estimatedHeight - MARGIN)
        : opts.y + 10
    this.el.style.left = `${left}px`
    this.el.style.top = `${top}px`

    // 输入区
    this.field = document.createElement("textarea")
    this.field.className = "ppv-text-input-field"
    this.field.placeholder = "输入标注文字…（Enter 确认，Shift+Enter 换行）"
    this.field.rows = 2
    this.field.spellcheck = false
    this.field.style.color = opts.color
    this.field.addEventListener("keydown", (e) => this.onKey(e))
    this.el.appendChild(this.field)

    // 操作行
    const actions = document.createElement("div")
    actions.className = "ppv-text-input-actions"
    const cancelBtn = document.createElement("button")
    cancelBtn.type = "button"
    cancelBtn.className = "ppv-overlay-btn secondary"
    cancelBtn.textContent = "取消"
    cancelBtn.addEventListener("click", () => this.cancel())
    const okBtn = document.createElement("button")
    okBtn.type = "button"
    okBtn.className = "ppv-overlay-btn"
    okBtn.textContent = "确定"
    okBtn.addEventListener("click", () => this.submit())
    actions.append(cancelBtn, okBtn)
    this.el.appendChild(actions)

    // 延迟注册外部点击监听：本弹窗在 canvas 的 pointerdown 处理中创建，
    // 若立即注册，同一事件的冒泡会立刻触发 onOutside 把弹窗取消掉。
    this.armTimer = window.setTimeout(() => {
      this.armTimer = null
      document.addEventListener("pointerdown", this.onOutside)
    }, 0)

    // 自动聚焦并选中已有内容
    requestAnimationFrame(() => {
      this.field.focus()
      this.field.select()
    })
  }

  /** 关闭并移除（不触发回调）。 */
  destroy(): void {
    if (this.closed) return
    this.closed = true
    if (this.armTimer !== null) {
      window.clearTimeout(this.armTimer)
      this.armTimer = null
    }
    document.removeEventListener("pointerdown", this.onOutside)
    this.el.remove()
  }

  private submit(): void {
    const text = this.field.value.trim()
    this.destroy()
    if (text) this.opts.onSubmit(text)
  }

  private cancel(): void {
    this.destroy()
    this.opts.onCancel?.()
  }
}
