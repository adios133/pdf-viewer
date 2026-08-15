/**
 * 工具栏图标：自绘 Material 线条风格（24×24，stroke 随 currentColor），
 * 与标绘面板图标风格统一，随主题色变化。
 */

const svg = (inner: string): string =>
  `<svg class="ppv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`

export const icons = {
  /** 打开文件 */
  openFile: svg(
    `<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>`,
  ),
  /** 缩略图侧栏 */
  viewThumbnail: svg(
    `<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>`,
  ),
  /** 第一页 */
  firstPage: svg(`<path d="M7 6v12"/><path d="m15 6-7 6 7 6"/>`),
  /** 上一页 */
  pageUp: svg(`<path d="m15 6-6 6 6 6"/>`),
  /** 下一页 */
  pageDown: svg(`<path d="m9 6 6 6-6 6"/>`),
  /** 最后一页 */
  lastPage: svg(`<path d="M17 6v12"/><path d="m9 6 7 6-7 6"/>`),
  /** 缩小 */
  zoomOut: svg(`<circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4.5 4.5"/><path d="M8 11h6"/>`),
  /** 放大 */
  zoomIn: svg(
    `<circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4.5 4.5"/><path d="M11 8v6M8 11h6"/>`,
  ),
  /** 适合页宽 */
  fitWidth: svg(`<path d="M3 12h18"/><path d="m7 8-4 4 4 4"/><path d="m17 8 4 4-4 4"/>`),
  /** 适合页面 */
  fitPage: svg(
    `<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>`,
  ),
  /** 顺时针旋转 */
  rotateCw: svg(`<path d="M21 4v6h-6"/><path d="M19.5 15a9 9 0 1 1-2.1-9.4L21 10"/>`),
  /** 逆时针旋转 */
  rotateCcw: svg(`<path d="M3 4v6h6"/><path d="M4.5 15a9 9 0 1 0 2.1-9.4L3 10"/>`),
  /** 查找 */
  search: svg(`<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>`),
  /** 上一个匹配 */
  findPrev: svg(`<path d="m15 18-6-6 6-6"/>`),
  /** 下一个匹配 */
  findNext: svg(`<path d="m9 18 6-6-6-6"/>`),
  /** 打印 */
  print: svg(
    `<path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/>`,
  ),
  /** 下载 */
  download: svg(
    `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>`,
  ),
  /** 全屏演示 */
  presentation: svg(
    `<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/>`,
  ),
  /** 标绘 */
  editorInk: svg(`<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>`),
  /** 关闭 */
  close: svg(`<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`),
} as const

export type IconName = keyof typeof icons
