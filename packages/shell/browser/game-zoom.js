// Fit the KanColle game canvas to the tab, or show it at 1:1 device pixels, by setting the tab's
// page zoom. Works on any page that embeds the game (DMM, KC3's frame modes) because it measures
// the rendered 1200x720 canvas instead of relying on page layout.
//
// In the canvas's own frame, rect size × devicePixelRatio is the canvas's size in device pixels,
// including page zoom, the display's scale and any CSS zoom on ancestor frames (e.g. KC3's game
// scale setting). That size is proportional to page zoom, so the target zoom follows directly.

const MEASURE_CANVAS = `(() => {
  const canvas = [...document.querySelectorAll('canvas')].find((c) => c.width === 1200 && c.height === 720)
  if (!canvas) return null
  const r = canvas.getBoundingClientRect()
  if (!r.width || !r.height) return null
  return { width: r.width, height: r.height, top: r.top, intrinsicWidth: canvas.width, dpr: devicePixelRatio }
})()`

// Viewport of the top page, and where the frame holding the game starts (e.g. below a header)
const measureTop = (frameName) => `(() => {
  const frames = [...document.querySelectorAll('iframe')]
  const frame = frames.find((f) => ${JSON.stringify(frameName)} && f.name === ${JSON.stringify(frameName)}) ||
    frames.sort((a, b) => b.offsetWidth * b.offsetHeight - a.offsetWidth * a.offsetHeight)[0]
  return {
    frameTop: frame ? frame.getBoundingClientRect().top : 0,
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
    dpr: devicePixelRatio,
  }
})()`

const MIN_ZOOM = 0.25
const MAX_ZOOM = 5

// All lengths in device pixels. Returns the new page zoom, rounded down to 0.001 so a fitted
// game never overflows into a scrollbar.
function computeGameZoom({
  mode,
  zoom,
  canvasWidth,
  canvasHeight,
  intrinsicWidth,
  offsetTop,
  viewWidth,
  viewHeight,
}) {
  const scale =
    mode === 'pixel'
      ? intrinsicWidth / canvasWidth
      : Math.min(viewWidth / canvasWidth, viewHeight / (offsetTop + canvasHeight))
  return Math.floor(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * scale)) * 1000) / 1000
}

async function zoomGameTab(webContents, mode) {
  const main = webContents.mainFrame
  let found = null
  for (const frame of main.framesInSubtree) {
    try {
      const canvas = await frame.executeJavaScript(MEASURE_CANVAS)
      if (canvas) {
        found = { frame, canvas }
        break
      }
    } catch {
      // frames can navigate or be torn down while we look
    }
  }
  if (!found) return { applied: false, reason: 'no game canvas in this tab' }

  const { frame, canvas } = found
  // the top-level iframe that contains the canvas frame, to find how far down the page it starts
  let topChild = frame
  while (topChild.parent && topChild.parent.frameTreeNodeId !== main.frameTreeNodeId)
    topChild = topChild.parent
  const inMainFrame = frame.frameTreeNodeId === main.frameTreeNodeId
  const top = await main.executeJavaScript(measureTop(inMainFrame ? '' : topChild.name))

  const zoom = webContents.getZoomFactor()
  const newZoom = computeGameZoom({
    mode,
    zoom,
    canvasWidth: canvas.width * canvas.dpr,
    canvasHeight: canvas.height * canvas.dpr,
    intrinsicWidth: canvas.intrinsicWidth,
    // nested frames inside the top-level one are assumed to start at its top edge
    offsetTop: Math.max(0, inMainFrame ? canvas.top * canvas.dpr : top.frameTop * top.dpr),
    viewWidth: top.width * top.dpr,
    viewHeight: top.height * top.dpr,
  })
  webContents.setZoomFactor(newZoom)
  return { applied: true, mode, zoom, newZoom }
}

module.exports = { computeGameZoom, zoomGameTab }
