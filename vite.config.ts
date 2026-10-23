import { defineConfig } from "vite"

/**
 * 两种构建模式：
 *   pnpm build         → 库模式（默认）：输出 ESM + 样式 + sourcemap，供其他项目安装引用
 *   pnpm build:demo    → 演示页构建：输出到 dist-demo/（index.html + 资源）
 *
 * dev server 的代理配置两种模式共用；dev 本身只服务演示页，不受库构建配置影响。
 */

/** 库模式把 pdfjs-dist 交给宿主项目（peerDependency），避免 pdf.js 被重复打包。 */
const isExternalPdfjs = (id: string) =>
  (id === "pdfjs-dist" || id.startsWith("pdfjs-dist/")) && !id.endsWith(".css")

export default defineConfig(({ command, mode }) => {
  const server = {
    proxy: {
      "/pdfh5": {
        target: "http://www.gjtool.cn",
        changeOrigin: true,
      },
      "/api": {
        target: "https://dnf999.neocities.org",
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/api/, ""),
      },
    },
  }

  if (mode === "demo") {
    return {
      server,
      build: {
        outDir: "dist-demo",
        emptyOutDir: true,
      },
    }
  }

  return {
    server,
    // 库构建不要把演示页用的 public/（sample.pdf 等）拷进 npm 包
    publicDir: command === "build" ? false : undefined,
    build: {
      lib: {
        entry: "src/main.ts",
        name: "PdfPreview",
        formats: ["es"],
        fileName: () => "pdf-preview.js",
        cssFileName: "style",
      },
      rollupOptions: {
        external: isExternalPdfjs,
      },
      // 把 pdf_viewer.css 里引用的 svg/图片内联进样式，保证发布的 style.css 自包含
      assetsInlineLimit: 128 * 1024,
      target: "es2020",
      sourcemap: true,
    },
  }
})
