/**
 * 演示页面：挂载 PdfPreview 插件，支持切换远程/本地 PDF。
 */
import { PdfPreview } from "./main"
import { PpvSelect } from "./plugin/ui/Select"

const mount = document.querySelector<HTMLElement>("#app")!
const urlSlot = document.querySelector<HTMLElement>("#urlSlot")!
const hint = document.querySelector<HTMLElement>("#hint")!
const openBtn = document.querySelector<HTMLButtonElement>("#openBtn")!
const fileInput = document.querySelector<HTMLInputElement>("#fileInput")!

const DEMO_DOCS = [
  { value: "/sample.pdf", label: "本地示例 sample.pdf（6 页）" },
  { value: "/large.pdf", label: "本地大文件 large.pdf（500 页）" },
  { value: "/pdfh5/git.pdf", label: "远程：git.pdf (gjtool.cn)" },
  { value: "/api/测试.pdf", label: "远程：测试.pdf (neocities)" },
]

let preview: PdfPreview | null = null

async function mountPreview(url?: string) {
  preview?.destroy()
  preview = new PdfPreview({
    container: mount,
    url,
    initialScale: "auto",
    showThumbnails: true,
    onLoad: (info) => {
      hint.textContent = `已加载：${info.filename} · ${info.numPages} 页`
    },
    onError: (err) => {
      hint.textContent = `加载失败：${err.message}`
    },
    onProgress: ({ percent }) => {
      if (percent > 0 && percent < 100) {
        hint.textContent = `加载中… ${percent}%`
      }
    },
  })
  // 调试/测试钩子
  ;(window as unknown as { __ppvPreview: PdfPreview }).__ppvPreview = preview
  await preview.load()
}

const urlSelect = new PpvSelect({
  options: DEMO_DOCS,
  value: DEMO_DOCS[0].value,
  title: "选择文档",
  onChange: (value) => {
    void mountPreview(value).catch(() => {})
  },
})
urlSlot.appendChild(urlSelect.el)

openBtn.addEventListener("click", () => fileInput.click())

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0]
  if (!file) return
  preview?.destroy()
  preview = new PdfPreview({
    container: mount,
    file,
    showThumbnails: true,
    onLoad: (info) => {
      hint.textContent = `已加载：${file.name} · ${info.numPages} 页`
    },
    onError: (err) => {
      hint.textContent = `加载失败：${err.message}`
    },
  })
  ;(window as unknown as { __ppvPreview: PdfPreview }).__ppvPreview = preview
  void preview.load().catch(() => {})
})

void mountPreview(DEMO_DOCS[0].value).catch(() => {})
