import { defineConfig } from "vite"

export default defineConfig({
  server: {
    proxy: {
      "/pdfh5": {
        target: "http://www.gjtool.cn",
        changeOrigin: true,
      },
      "/api": {
        target: "https://dnf999.neocities.org",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
})
