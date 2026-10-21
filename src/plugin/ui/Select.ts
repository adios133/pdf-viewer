/**
 * PpvSelect —— 自实现下拉选择器（替代原生 <select>，跨浏览器风格一致）。
 *   按钮 + 弹出菜单，支持键盘（Enter/Space 打开、Esc/方向键导航）与外部点击关闭。
 */

export interface SelectOption {
  value: string
  label: string
}

export interface PpvSelectOptions {
  options: SelectOption[]
  value: string
  onChange: (value: string) => void
  /** 按钮上的小图标（SVG 字符串，可选） */
  icon?: string
  title?: string
  className?: string
}

export class PpvSelect {
  readonly el: HTMLDivElement
  private readonly btn: HTMLButtonElement
  private readonly labelEl: HTMLSpanElement
  private readonly chevron: HTMLSpanElement
  private readonly menu: HTMLDivElement
  private readonly options: SelectOption[]
  private readonly onChange: (value: string) => void
  private readonly items = new Map<string, HTMLButtonElement>()
  private current = ""
  private open = false
  private disabled = false
  private readonly onOutside = (e: PointerEvent) => {
    if (!this.open) return
    const target = e.target as Node | null
    if (target && !this.el.contains(target)) this.close()
  }
  private readonly onKey = (e: KeyboardEvent) => {
    if (!this.open) return
    if (e.key === "Escape") {
      e.preventDefault()
      this.close()
      this.btn.focus()
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      const values = this.options.map((o) => o.value)
      const idx = values.indexOf(this.current)
      const next =
        e.key === "ArrowDown" ? Math.min(values.length - 1, idx + 1) : Math.max(0, idx - 1)
      this.select(values[next])
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      this.select(this.current)
    }
  }

  constructor(opts: PpvSelectOptions) {
    this.options = opts.options
    this.onChange = opts.onChange
    this.current = opts.value

    this.el = document.createElement("div")
    this.el.className = `ppv-select ${opts.className ?? ""}`.trim()

    const btn = document.createElement("button")
    btn.type = "button"
    btn.className = "ppv-select-btn"
    btn.title = opts.title ?? ""
    if (opts.icon) {
      const icon = document.createElement("span")
      icon.className = "ppv-select-icon"
      icon.innerHTML = opts.icon
      btn.appendChild(icon)
    }
    this.labelEl = document.createElement("span")
    this.labelEl.className = "ppv-select-label"
    this.chevron = document.createElement("span")
    this.chevron.className = "ppv-select-chevron"
    this.chevron.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>'
    btn.append(this.labelEl, this.chevron)
    btn.addEventListener("click", () => {
      if (this.disabled) return
      this.toggle()
    })
    btn.addEventListener("keydown", (e) => this.onKey(e))
    this.btn = btn

    this.menu = document.createElement("div")
    this.menu.className = "ppv-select-menu"
    for (const option of this.options) {
      const item = document.createElement("button")
      item.type = "button"
      item.className = "ppv-select-item"
      item.dataset.value = option.value
      item.textContent = option.label
      const check = document.createElement("span")
      check.className = "ppv-select-check"
      check.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4.5 4.5L19 7"/></svg>'
      item.appendChild(check)
      item.addEventListener("click", () => this.select(option.value))
      this.menu.appendChild(item)
      this.items.set(option.value, item)
    }

    this.el.append(btn, this.menu)
    document.addEventListener("pointerdown", this.onOutside)
    this.refresh()
  }

  get value(): string {
    return this.current
  }

  /** 程序化选中（不触发 onChange）。 */
  setValue(value: string): void {
    if (this.options.some((o) => o.value === value)) {
      this.current = value
      this.refresh()
    } else {
      this.setLabel(value)
    }
  }

  /** 显示自定义文本（如百分比如 "87%"），不改变选中项。 */
  setLabel(text: string): void {
    const opt = this.options.find((o) => o.value === this.current)
    this.labelEl.textContent = text || opt?.label || ""
  }

  setEnabled(enabled: boolean): void {
    this.disabled = !enabled
    this.btn.disabled = !enabled
    if (!enabled) this.close()
  }

  destroy(): void {
    this.close()
    document.removeEventListener("pointerdown", this.onOutside)
    this.el.remove()
  }

  private select(value: string): void {
    this.current = value
    this.refresh()
    this.close()
    this.onChange(value)
    this.btn.focus()
  }

  private toggle(): void {
    if (this.open) this.close()
    else this.openMenu()
  }

  private openMenu(): void {
    this.open = true
    this.el.classList.add("open")
  }

  private close(): void {
    this.open = false
    this.el.classList.remove("open")
  }

  private refresh(): void {
    const opt = this.options.find((o) => o.value === this.current)
    this.labelEl.textContent = opt?.label ?? this.current
    for (const [value, item] of this.items) {
      item.classList.toggle("active", value === this.current)
    }
  }
}
