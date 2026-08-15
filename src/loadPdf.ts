import { getDocument, GlobalWorkerOptions } from "pdfjs-dist"
import type { DocumentInitParameters } from "pdfjs-dist/types/src/display/api"
import PDfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url"

GlobalWorkerOptions.workerSrc = PDfWorkerUrl

/** 仅加载 PDF 文档（不渲染）。用于需要自行控制渲染的场合。 */
export async function loadPdf(src: DocumentInitParameters) {
  try {
    return await getDocument(src).promise
  } catch {
    return null
  }
}
