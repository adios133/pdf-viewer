/** 标绘层图标（内联 SVG，Material 线条风格，颜色跟随 currentColor）。 */

export const markIcons = {
  select: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3 L5 16 L9.5 12.5 L12.5 20.5 L15 19.5 L12 11.5 L17 11.5 Z"/></svg>`,
  pen: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20 L4 16 L16 4 L20 8 L8 20 Z"/><path d="M13.5 6.5 L17.5 10.5"/></svg>`,
  line: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 19 L19 5"/></svg>`,
  arrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19 L19 5"/><path d="M10.5 5 L19 5 L19 13.5"/></svg>`,
  rect: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="5" width="14" height="14" rx="1"/></svg>`,
  ellipse: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="12" rx="9" ry="6"/></svg>`,
  polygon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 4 L20 10 L17 20 L7 20 L4 10 Z"/></svg>`,
  polyline: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18 L10 8 L14 13 L20 5"/></svg>`,
  text: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 5 H19 M12 5 V19 M12 19 H8.5 M12 19 H15.5"/></svg>`,
  undo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6 L4 10 L8 14"/><path d="M4 10 H15 A5 5 0 0 1 15 20 H11"/></svg>`,
  redo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 6 L20 10 L16 14"/><path d="M20 10 H9 A5 5 0 0 0 9 20 H13"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7 H19 M10 7 V5 H14 V7 M7 7 L8 19 H16 L17 7 M10 11 V15 M14 11 V15"/></svg>`,
  clear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5 L19 19 M19 5 L5 19"/></svg>`,
  /** 导出：箭头向上离开托盘（输出文件） */
  export: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4"/><path d="m7 9 5-5 5 5"/><path d="M5 19h14"/></svg>`,
  /** 导入：箭头向下落入托盘（读入文件） */
  import: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 19h14"/></svg>`,
} as const

export type MarkIconName = keyof typeof markIcons

export function markIconSvg(name: MarkIconName): string {
  return markIcons[name]
}
