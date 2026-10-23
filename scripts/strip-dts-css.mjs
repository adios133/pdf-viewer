/* global console, URL */
/**
 * tsc 生成声明文件时会保留源码里的 CSS 副作用 import（`import "./style.css"`），
 * 宿主项目如果没声明 `*.css` 模块，引入类型时会报 `Cannot find module './style.css'`。
 *
 * 库模式下的样式由宿主显式引入（`import "pdf-preview-plugin/style.css"`），
 * 因此这里在 build:types 之后把这些 CSS import 从 .d.ts 里去掉。
 */
import { readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const TYPES_DIR = fileURLToPath(new URL("../dist/types", import.meta.url))
const CSS_IMPORT = /^import\s+["'][^"']+\.css["'];?[ \t]*\r?\n/gm

let changed = 0

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(path)
    } else if (entry.name.endsWith(".d.ts")) {
      const source = await readFile(path, "utf8")
      const next = source.replace(CSS_IMPORT, "")
      if (next !== source) {
        await writeFile(path, next.replace(/\n{3,}/g, "\n\n"))
        changed++
      }
    }
  }
}

await walk(TYPES_DIR)
console.log(`[strip-dts-css] cleaned ${changed} declaration file(s)`)
