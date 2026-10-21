/**
 * PpvSwitch —— 自实现开关（替代原生 checkbox，Material 风格滑动开关）。
 */

export class PpvSwitch {
  readonly el: HTMLButtonElement
  private checkedValue: boolean
  private readonly onChange: (checked: boolean) => void

  constructor(label: string, checked: boolean, onChange: (checked: boolean) => void) {
    this.checkedValue = checked
    this.onChange = onChange

    this.el = document.createElement("button")
    this.el.type = "button"
    this.el.className = "ppv-switch"
    this.el.setAttribute("role", "switch")

    const track = document.createElement("span")
    track.className = "ppv-switch-track"
    const thumb = document.createElement("span")
    thumb.className = "ppv-switch-thumb"
    track.appendChild(thumb)

    const labelEl = document.createElement("span")
    labelEl.className = "ppv-switch-label"
    labelEl.textContent = label

    this.el.append(track, labelEl)
    this.el.addEventListener("click", () => this.toggle())
    this.el.addEventListener("keydown", (e) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault()
        this.toggle()
      }
    })
    this.refresh()
  }

  get checked(): boolean {
    return this.checkedValue
  }

  setChecked(checked: boolean): void {
    this.checkedValue = checked
    this.refresh()
  }

  private toggle(): void {
    this.checkedValue = !this.checkedValue
    this.refresh()
    this.onChange(this.checkedValue)
  }

  private refresh(): void {
    this.el.setAttribute("aria-checked", String(this.checkedValue))
  }
}
