/**
 * PdfPreview 冒烟测试：通过 Chrome DevTools Protocol 驱动无头浏览器，
 * 验证插件能真正加载并渲染 PDF，并检查控制台错误。
 * 用法：node scripts/smoke-test.mjs [url] [--find=关键词] [--select=选项值] [--shot=截图路径.png]
 */
/* global process, setTimeout, fetch, WebSocket, console, Buffer */
import { spawn } from "node:child_process"
import { writeFileSync } from "node:fs"
import { setTimeout as sleep } from "node:timers/promises"

const CHROME =
  process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const PORT = 9333
const PAGE_URL = process.argv[2] || "http://localhost:5179/"
const FIND_TERM = process.argv.find((a) => a.startsWith("--find="))?.slice(7)
const SELECT_VALUE = process.argv.find((a) => a.startsWith("--select="))?.slice(9)
const SHOT_PATH = process.argv.find((a) => a.startsWith("--shot="))?.slice(7)

let ws
let msgId = 0
const pending = new Map()
const consoleErrors = []
const exceptions = []

function send(method, params = {}) {
  const id = ++msgId
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error(`timeout: ${method}`))
      }
    }, 15000)
  })
}

async function evalJs(expression) {
  const res = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (res.exceptionDetails) {
    throw new Error(
      `eval failed: ${res.exceptionDetails.text} ${res.exceptionDetails.exception?.description ?? ""}`,
    )
  }
  return res.result?.value
}

async function waitFor(fn, timeoutMs, intervalMs = 300) {
  const start = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - start > timeoutMs) return null
    await sleep(intervalMs)
  }
}

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-crash-reporter",
    "--disable-breakpad",
    "--user-data-dir=/tmp/ppv-cdp",
    `--remote-debugging-port=${PORT}`,
    "about:blank",
  ],
  { stdio: "ignore" },
)

let failed = false
try {
  // 等待调试端点
  let targets = null
  for (let i = 0; i < 50 && !targets; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      targets = await res.json()
    } catch {
      await sleep(200)
    }
  }
  if (!targets) throw new Error("无法连接 Chrome DevTools")

  const page = targets.find((t) => t.type === "page")
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
    } else if (msg.method === "Runtime.consoleAPICalled") {
      if (msg.params.type === "error") {
        consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "))
      }
    } else if (msg.method === "Runtime.exceptionThrown") {
      exceptions.push(
        msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text,
      )
    }
  }
  ws.onerror = () => {}

  await send("Runtime.enable")
  await send("Page.enable")
  await send("Page.navigate", { url: PAGE_URL })

  // 若指定 --select=，先等首屏加载完成（模块就绪），再切到目标选项触发重新加载
  if (SELECT_VALUE) {
    await waitFor(
      () =>
        evalJs(`document.querySelector('#hint')?.textContent || ''`).then((t) => (t ? t : null)),
      30000,
    )
    const expectName = SELECT_VALUE.split("/").pop()
    await evalJs(
      `(() => { const s = document.querySelector('#urls'); s.value = ${JSON.stringify(SELECT_VALUE)}; s.dispatchEvent(new Event('change', {bubbles: true})) })()`,
    )
    const switched = await waitFor(
      () =>
        evalJs(`document.querySelector('#hint')?.textContent || ''`).then((t) =>
          t?.includes(expectName) ? t : null,
        ),
      30000,
    )
    if (!switched) {
      console.log(
        "SELECT-SWITCH-TIMEOUT, hint:",
        await evalJs(`document.querySelector('#hint')?.textContent`),
      )
    }
  }

  // 等待加载完成
  const loaded = await waitFor(
    () =>
      evalJs(`document.querySelector('#hint')?.textContent || ''`).then((t) =>
        t?.startsWith("已加载") ? t : null,
      ),
    30000,
  )
  if (!loaded) {
    const state = await evalJs(`JSON.stringify({
      overlay: document.querySelector('.ppv-overlay')?.className,
      overlayText: document.querySelector('.ppv-overlay')?.textContent?.trim().slice(0, 120),
      hint: document.querySelector('#hint')?.textContent,
    })`)
    console.log("LOAD-TIMEOUT state:", state)
    failed = true
  } else {
    console.log("LOADED:", loaded)
  }

  // 等待首屏页面渲染
  const pages = await waitFor(
    () => evalJs(`document.querySelectorAll('.page').length`).then((n) => (n > 0 ? n : null)),
    20000,
  )
  console.log("PAGE DIVS:", pages ?? 0)

  const canvases = await waitFor(
    () =>
      evalJs(
        `Array.from(document.querySelectorAll('.page canvas')).filter(c => c.width > 0 && c.height > 0).length`,
      ).then((n) => (n > 0 ? n : null)),
    20000,
  )
  console.log("RENDERED CANVASES:", canvases ?? 0)

  const textLayers = await evalJs(`document.querySelectorAll('.textLayer').length`)
  console.log("TEXT LAYERS:", textLayers)

  const thumbs = await evalJs(`document.querySelectorAll('.ppv-thumb').length`)
  console.log("THUMBNAILS:", thumbs)

  const zoomLabel = await evalJs(`document.querySelector('.ppv-zoom-label')?.textContent`)
  const pageInput = await evalJs(`document.querySelector('.ppv-page-input')?.value`)
  console.log("ZOOM LABEL:", zoomLabel, "| PAGE INPUT:", pageInput)

  // 截图（可选，用于视觉验收）
  if (SHOT_PATH) {
    const shot = await send("Page.captureScreenshot", { format: "png" })
    writeFileSync(SHOT_PATH, Buffer.from(shot.data, "base64"))
    console.log("SCREENSHOT:", SHOT_PATH)
  }

  // 交互测试：下一页
  await evalJs(`document.querySelector('button[title="下一页 (↓)"]').click()`)
  await sleep(800)
  const pageAfterNext = await evalJs(`document.querySelector('.ppv-page-input')?.value`)
  console.log("PAGE AFTER NEXT:", pageAfterNext)

  // 交互测试：缩放（下拉值为十进制倍率，如 1.5 = 150%）
  await evalJs(
    `(() => { const s = document.querySelector('.ppv-zoom-select'); s.value = '1.5'; s.dispatchEvent(new Event('change', {bubbles: true})) })()`,
  )
  await sleep(1200)
  const zoomAfter = await evalJs(`document.querySelector('.ppv-zoom-label')?.textContent`)
  console.log("ZOOM AFTER SET 150%:", zoomAfter)

  // 查找测试（若指定关键词）
  if (FIND_TERM) {
    await evalJs(`document.querySelector('button[title="查找 (Ctrl+F)"]').click()`)
    await sleep(300)
    await evalJs(
      `(() => { const i = document.querySelector('.ppv-find-input'); i.value = ${JSON.stringify(FIND_TERM)}; i.dispatchEvent(new Event('input', {bubbles: true})) })()`,
    )
    const findCount = await waitFor(
      () =>
        evalJs(`document.querySelector('.ppv-find-count')?.textContent`).then((t) =>
          t && t !== "" && t !== "查找中…" ? t : null,
        ),
      15000,
    )
    console.log("FIND COUNT:", findCount)
    const highlights = await evalJs(`document.querySelectorAll('.textLayer .highlight').length`)
    console.log("FIND HIGHLIGHTS:", highlights)
  }

  // 旋转测试
  await evalJs(`document.querySelector('button[title="顺时针旋转 (Ctrl+R)"]').click()`)
  await sleep(1200)
  const rotated = await evalJs(
    `document.querySelector('.ppv-root .page')?.style.transform ? 'inline-transform' : 'rotation-change'`,
  )
  console.log("ROTATE CLICKED:", rotated)

  // ================= 标绘层测试 =================
  // 1. 打开标绘面板
  await evalJs(`document.querySelector('button[title="标绘"]').click()`)
  await sleep(300)
  const panelOpen = await evalJs(`!document.querySelector('.ppv-mark-panel').hidden`)

  // 1.5 pen 专项：绘制中不应出现“轨迹末端连回起点”的直线。
  //     画 L 形轨迹（水平后向下），若存在回连直线会穿过 (200,140) 检测点。
  await evalJs(`document.querySelector('.ppv-mark-panel button[data-tool="pen"]').click()`)
  await sleep(200)
  const penReturnLine = await evalJs(`(() => {
    const c = document.querySelector('.ppv-mark-canvas');
    if (!c) return -1;
    const r = c.getBoundingClientRect();
    const fire = (type, x, y) => c.dispatchEvent(new PointerEvent(type, {
      bubbles: true, pointerId: 2, isPrimary: true, pointerType: 'mouse',
      clientX: r.left + x, clientY: r.top + y,
    }));
    fire('pointerdown', 120, 120);
    for (let x = 140; x <= 280; x += 20) fire('pointermove', x, 120);
    fire('pointermove', 280, 160);
    // pointerup 之前读取画布，检测 (200,140) 邻域是否有回连直线像素
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let maxAlpha = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const px = 200 + dx, py = 140 + dy;
        if (px < 0 || py < 0 || px >= c.width || py >= c.height) continue;
        const idx = (py * c.width + px) * 4 + 3;
        maxAlpha = Math.max(maxAlpha, d[idx]);
      }
    }
    fire('pointerup', 280, 160);
    return maxAlpha;
  })()`)
  await evalJs(`window.__ppvPreview.clearMarks()`)
  await sleep(200)
  console.log(`PEN NO-RETURN-LINE (expect 0): ${penReturnLine}`)

  // 1.6 水墨笔测试：绘制水平线，验证类型、墨迹像素、笔锋收窄（起收 < 中段）
  await evalJs(`document.querySelector('.ppv-mark-panel button[data-tool="ink"]').click()`)
  await sleep(200)
  const inkResult = await evalJs(`(() => {
    const c = document.querySelector('.ppv-mark-canvas');
    const r = c.getBoundingClientRect();
    const fire = (type, x, y) => c.dispatchEvent(new PointerEvent(type, {
      bubbles: true, pointerId: 4, isPrimary: true, pointerType: 'mouse',
      clientX: r.left + x, clientY: r.top + y,
    }));
    fire('pointerdown', 150, 200);
    // 8px 步长模拟真实鼠标高频移动（20px 步长会被速度因子压成快笔）
    for (let x = 158; x <= 450; x += 8) fire('pointermove', x, 200);
    const ctx = c.getContext('2d');
    const snap = () => ctx.getImageData(0, 0, c.width, c.height).data;
    // 松手前（预览态）与松手后（提交态）快照：必须逐像素一致，
    // 否则说明毛边/晕染随机层在提交瞬间重新生成（用户可见的“边缘淡色图案”）
    const before = snap();
    fire('pointerup', 450, 200);
    const after = snap();
    let renderDiff = 0;
    for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) renderDiff++;
    const marks = window.__ppvPreview.getMarks();
    const m = marks[marks.length - 1] || {};
    const d = snap();
    let pixels = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 10) pixels++;
    // 笔锋：x=165（起笔附近）、x=300（中段）、x=435（收笔附近）三列的主墨高度
    // 阈值取 alpha>150 排除淡墨晕染层，只统计主墨，才能看出笔锋收窄
    const colHeight = (x) => {
      let h = 0;
      for (let y = 150; y <= 250; y++) {
        const idx = (y * c.width + x) * 4 + 3;
        if (d[idx] > 150) h++;
      }
      return h;
    };
    // 边缘干净度：笔画带（y 188~212）之外的任何淡色像素（alpha>10）都应不存在
    // ——松手后边缘若残留淡色毛边/碎斑，该计数会明显大于 0
    let stray = 0;
    for (let y = 150; y <= 250; y++) {
      if (y >= 188 && y <= 212) continue;
      for (let x = 130; x <= 470; x++) {
        const a = d[(y * c.width + x) * 4 + 3];
        if (a > 10) stray++;
      }
    }
    return JSON.stringify({ type: m.type, points: m.points?.length ?? 0, pixels, head: colHeight(165), mid: colHeight(300), tail: colHeight(435), stray, renderDiff });
  })()`)
  await evalJs(`window.__ppvPreview.clearMarks()`)
  await sleep(200)
  console.log(`INK BRUSH: ${inkResult}`)

  // 1.7 水性笔测试：半透明圆头标记 + 自定义宽度（输入 12px 验证生效）
  await evalJs(`document.querySelector('.ppv-mark-panel button[data-tool="marker"]').click()`)
  await sleep(200)
  const markerResult = await evalJs(`(() => {
    const c = document.querySelector('.ppv-mark-canvas');
    const r = c.getBoundingClientRect();
    const fire = (type, x, y) => c.dispatchEvent(new PointerEvent(type, {
      bubbles: true, pointerId: 5, isPrimary: true, pointerType: 'mouse',
      clientX: r.left + x, clientY: r.top + y,
    }));
    // 将自定义宽度设为 12
    const wi = document.querySelector('.ppv-mark-width-input');
    wi.value = '12';
    wi.dispatchEvent(new Event('input', { bubbles: true }));
    fire('pointerdown', 150, 260);
    for (let x = 158; x <= 450; x += 8) fire('pointermove', x, 260);
    fire('pointerup', 450, 260);
    const marks = window.__ppvPreview.getMarks();
    const m = marks[marks.length - 1] || {};
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    // 笔画中心线（y=260）列的 alpha 应约为 0.5（半透明，下层文字可见），而非 1.0
    let lineAlpha = 0;
    for (let y = 250; y <= 270; y++) {
      const a = d[(y * c.width + 300) * 4 + 3];
      if (a > lineAlpha) lineAlpha = a;
    }
    // 自定义宽度 12px（scale≈0.87 时 12/scale ≈ 13.8 页坐标 ≈ 12 CSS px）→ 列高约 10~14px
    let colH = 0;
    for (let y = 230; y <= 290; y++) {
      if (d[(y * c.width + 300) * 4 + 3] > 20) colH++;
    }
    const widthInputValue = wi.value;
    return JSON.stringify({ type: m.type, points: m.points?.length ?? 0, lineAlpha, colH, widthInputValue });
  })()`)
  await evalJs(`window.__ppvPreview.clearMarks()`)
  await sleep(200)
  console.log(`MARKER PEN: ${markerResult}`)

  // 2. 选择直线工具
  await evalJs(`document.querySelector('.ppv-mark-panel button[data-tool="line"]').click()`)
  await sleep(200)
  // 3. 在第一页画布上模拟拖拽画一条线
  const drawResult = await evalJs(`(() => {
    const c = document.querySelector('.ppv-mark-canvas');
    if (!c) return 'no-canvas';
    const r = c.getBoundingClientRect();
    const fire = (type, x, y) => c.dispatchEvent(new PointerEvent(type, {
      bubbles: true, pointerId: 1, isPrimary: true, pointerType: 'mouse',
      clientX: r.left + x, clientY: r.top + y,
    }));
    fire('pointerdown', 120, 120);
    fire('pointermove', 260, 200);
    fire('pointerup', 260, 200);
    return 'drawn';
  })()`)
  await sleep(400)
  const marksAfterDraw = await evalJs(`window.__ppvPreview.getMarks().length`)
  const markPixels = await evalJs(`(() => {
    const c = document.querySelector('.ppv-mark-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++;
    return n;
  })()`)
  const layersCount = await evalJs(`document.querySelectorAll('.ppv-mark-canvas').length`)
  console.log(
    `MARKS: panel=${panelOpen} draw=${drawResult} marks=${marksAfterDraw} pixels=${markPixels} layers=${layersCount}`,
  )
  // 3. 撤销 / 重做
  await evalJs(`document.querySelector('.ppv-mark-panel button[title^="撤销"]').click()`)
  await sleep(300)
  const marksAfterUndo = await evalJs(`window.__ppvPreview.getMarks().length`)
  await evalJs(`document.querySelector('.ppv-mark-panel button[title^="重做"]').click()`)
  await sleep(300)
  const marksAfterRedo = await evalJs(`window.__ppvPreview.getMarks().length`)
  console.log(`MARKS UNDO/REDO: undo=${marksAfterUndo} redo=${marksAfterRedo}`)
  // 4. 导出/导入 JSON
  const json = await evalJs(`window.__ppvPreview.exportMarks()`)
  const importBad = await evalJs(`window.__ppvPreview.importMarks('not-a-json')`)
  const importOk = await evalJs(`window.__ppvPreview.importMarks(${JSON.stringify(json)})`)
  const marksAfterImport = await evalJs(`window.__ppvPreview.getMarks().length`)
  console.log(
    `MARKS JSON: len=${json.length} badJson=${importBad} import=${importOk} afterImport=${marksAfterImport}`,
  )
  // 5. 关闭面板
  await evalJs(`document.querySelector('button[title="标绘"]').click()`)
  await sleep(200)
  const panelClosed = await evalJs(`document.querySelector('.ppv-mark-panel').hidden`)
  console.log(`MARKS PANEL CLOSED: ${panelClosed}`)

  // ================= 主题切换测试 =================
  // 1. 打开主题菜单
  await evalJs(`document.querySelector('button[title="主题"]').click()`)
  await sleep(250)
  const themeMenu = await evalJs(`(() => {
    const m = document.querySelector('.ppv-theme-menu');
    return {
      open: m.classList.contains('open'),
      items: m.querySelectorAll('.ppv-theme-item').length,
      labels: [...m.querySelectorAll('.ppv-theme-label')].map(e => e.textContent).join(','),
      active: m.querySelector('.ppv-theme-item.active')?.dataset.theme ?? 'none',
    };
  })()`)
  console.log(`THEME MENU:`, JSON.stringify(themeMenu))

  // 2. 切到深色：验证 data-theme、工具栏背景、页面背景
  await evalJs(`document.querySelector('.ppv-theme-item[data-theme="dark"]').click()`)
  await sleep(300)
  const darkCheck = await evalJs(`(() => {
    const root = document.querySelector('.ppv-root');
    return {
      theme: root.dataset.theme,
      toolbarBg: getComputedStyle(document.querySelector('.ppv-toolbar')).backgroundColor,
      appBg: getComputedStyle(document.querySelector('.ppv-viewer-container')).backgroundColor,
      stored: localStorage.getItem('pdf-preview:theme'),
    };
  })()`)
  console.log(`THEME DARK:`, JSON.stringify(darkCheck))

  // 3. API 切换：森林绿 + 事件
  await evalJs(`window.__ppvPreview.setTheme('green')`)
  await sleep(250)
  const greenCheck = await evalJs(`document.querySelector('.ppv-root').dataset.theme`)
  // 4. 持久化 + 菜单勾选同步
  await evalJs(`document.querySelector('button[title="主题"]').click()`)
  await sleep(200)
  const menuSync = await evalJs(
    `document.querySelector('.ppv-theme-item[data-theme="green"]').classList.contains('active')`,
  )
  await evalJs(`document.querySelector('.ppv-theme-item[data-theme="light"]').click()`)
  await sleep(250)
  const backToLight = await evalJs(`document.querySelector('.ppv-root').dataset.theme`)
  console.log(
    `THEME GREEN/LIGHT: green=${greenCheck} menuSync=${menuSync} back=${backToLight} stored=${darkCheck.stored}`,
  )

  // 缩略图画布渲染
  const thumbCanvases = await waitFor(
    () =>
      evalJs(
        `Array.from(document.querySelectorAll('.ppv-thumb canvas')).filter(c => c.width > 0 && c.height > 0).length`,
      ).then((n) => (n > 0 ? n : null)),
    15000,
  )
  console.log("THUMBNAIL CANVASES:", thumbCanvases ?? 0)

  // 大文件测试：跳到第 300 页附近，验证懒渲染（画布数量保持有界）与页码同步
  const totalPages = await evalJs(`document.querySelector('.ppv-page-total')?.textContent || ''`)
  const renderedBefore = await evalJs(
    `Array.from(document.querySelectorAll('.page canvas')).filter(c => c.width > 0).length`,
  )
  await evalJs(`(() => {
    const c = document.querySelector('.ppv-viewer-container');
    const pages = document.querySelectorAll('.page');
    const p = pages[299];
    if (p) c.scrollTop = p.offsetTop - 80;
  })()`)
  await sleep(3000)
  const pageAfterScroll = await evalJs(`document.querySelector('.ppv-page-input')?.value`)
  const renderedAfter = await evalJs(
    `Array.from(document.querySelectorAll('.page canvas')).filter(c => c.width > 0).length`,
  )
  console.log(
    `SCROLL TEST (total=${totalPages}): before=${renderedBefore} after=${renderedAfter} page=${pageAfterScroll}`,
  )

  // 打印：点击打印按钮 → 应创建隐藏 iframe 并逐页渲染
  await evalJs(`document.querySelector('button[title="打印 (Ctrl+P)"]').click()`)
  const printState = await waitFor(
    () =>
      evalJs(`(() => {
      const iframe = [...document.querySelectorAll('iframe')].find(f => f.style.visibility === 'hidden');
      if (!iframe) return null;
      const doc = iframe.contentDocument;
      if (!doc) return 'iframe-no-doc';
      const canvases = doc.querySelectorAll('.ppv-print-page canvas');
      const rendered = [...canvases].filter(c => c.width > 0).length;
      return canvases.length + '/' + rendered;
    })()`).then((v) => (v && v !== "iframe-no-doc" && !v.endsWith("/0") ? v : null)),
    20000,
  )
  console.log("PRINT IFRAME (total/rendered):", printState ?? "none")
  await sleep(2500) // 等 afterprint 清理
} catch (err) {
  console.error("TEST ERROR:", err.message)
  failed = true
} finally {
  if (ws) ws.close()
  chrome.kill()
}

console.log("CONSOLE ERRORS:", consoleErrors.length ? consoleErrors : "none")
console.log("EXCEPTIONS:", exceptions.length ? exceptions : "none")
process.exit(failed || consoleErrors.length > 0 ? 1 : 0)
