/**
 * 工具栏图标：Lucide 图标库（https://lucide.dev，ISC License），
 * 24×24 线性风格，内联 SVG 随 currentColor 继承主题色。
 */

const svg = (inner: string): string =>
  `<svg class="ppv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`

export const icons = {
  /** folder-open */
  openFile: svg(
    `<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />`,
  ),
  /** layout-grid */
  viewThumbnail: svg(
    `<rect width="7" height="7" x="3" y="3" rx="1" /> <rect width="7" height="7" x="14" y="3" rx="1" /> <rect width="7" height="7" x="14" y="14" rx="1" /> <rect width="7" height="7" x="3" y="14" rx="1" />`,
  ),
  /** chevrons-left */
  firstPage: svg(`<path d="m11 17-5-5 5-5" /> <path d="m18 17-5-5 5-5" />`),
  /** chevron-left */
  pageUp: svg(`<path d="m15 18-6-6 6-6" />`),
  /** chevron-right */
  pageDown: svg(`<path d="m9 18 6-6-6-6" />`),
  /** chevrons-right */
  lastPage: svg(`<path d="m6 17 5-5-5-5" /> <path d="m13 17 5-5-5-5" />`),
  /** zoom-out */
  zoomOut: svg(
    `<circle cx="11" cy="11" r="8" /> <line x1="21" x2="16.65" y1="21" y2="16.65" /> <line x1="8" x2="14" y1="11" y2="11" />`,
  ),
  /** zoom-in */
  zoomIn: svg(
    `<circle cx="11" cy="11" r="8" /> <line x1="21" x2="16.65" y1="21" y2="16.65" /> <line x1="11" x2="11" y1="8" y2="14" /> <line x1="8" x2="14" y1="11" y2="11" />`,
  ),
  /** arrow-left-right */
  fitWidth: svg(
    `<path d="M8 3 4 7l4 4" /> <path d="M4 7h16" /> <path d="m16 21 4-4-4-4" /> <path d="M20 17H4" />`,
  ),
  /** scan */
  fitPage: svg(
    `<path d="M3 7V5a2 2 0 0 1 2-2h2" /> <path d="M17 3h2a2 2 0 0 1 2 2v2" /> <path d="M21 17v2a2 2 0 0 1-2 2h-2" /> <path d="M7 21H5a2 2 0 0 1-2-2v-2" />`,
  ),
  /** rotate-cw */
  rotateCw: svg(
    `<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /> <path d="M21 3v5h-5" />`,
  ),
  /** rotate-ccw */
  rotateCcw: svg(
    `<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /> <path d="M3 3v5h5" />`,
  ),
  /** search */
  search: svg(`<path d="m21 21-4.34-4.34" /> <circle cx="11" cy="11" r="8" />`),
  /** chevron-left */
  findPrev: svg(`<path d="m15 18-6-6 6-6" />`),
  /** chevron-right */
  findNext: svg(`<path d="m9 18 6-6-6-6" />`),
  /** printer */
  print: svg(
    `<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /> <path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6" /> <rect x="6" y="14" width="12" height="8" rx="1" />`,
  ),
  /** download */
  download: svg(
    `<path d="M12 15V3" /> <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /> <path d="m7 10 5 5 5-5" />`,
  ),
  /** maximize */
  presentation: svg(
    `<path d="M8 3H5a2 2 0 0 0-2 2v3" /> <path d="M21 8V5a2 2 0 0 0-2-2h-3" /> <path d="M3 16v3a2 2 0 0 0 2 2h3" /> <path d="M16 21h3a2 2 0 0 0 2-2v-3" />`,
  ),
  /** pencil */
  editorInk: svg(
    `<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /> <path d="m15 5 4 4" />`,
  ),
  /** palette */
  theme: svg(
    `<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" /> <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /> <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" /> <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" /> <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />`,
  ),
  /** sliders-horizontal */
  settings: svg(
    `<path d="M10 5H3" /> <path d="M12 19H3" /> <path d="M14 3v4" /> <path d="M16 17v4" /> <path d="M21 12h-9" /> <path d="M21 19h-5" /> <path d="M21 5h-7" /> <path d="M8 10v4" /> <path d="M8 12H3" />`,
  ),
  /** x */
  close: svg(`<path d="M18 6 6 18" /> <path d="m6 6 12 12" />`),
} as const

export type IconName = keyof typeof icons
