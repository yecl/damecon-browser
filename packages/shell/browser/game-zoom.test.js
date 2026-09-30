// node packages/shell/browser/game-zoom.test.js
const assert = require('assert')
const { computeGameZoom } = require('./game-zoom')

// Retina (2x) at 100% page zoom: the 1200px canvas covers 2400 device px
const retina = {
  zoom: 1,
  canvasWidth: 2400,
  canvasHeight: 1440,
  intrinsicWidth: 1200,
  offsetTop: 0,
}
assert.strictEqual(
  computeGameZoom({ ...retina, mode: 'pixel', viewWidth: 3000, viewHeight: 1800 }),
  0.5,
)

// 1:1 is independent of how the page is zoomed right now or of KC3's CSS game scale
assert.strictEqual(
  computeGameZoom({
    mode: 'pixel',
    zoom: 0.8,
    canvasWidth: 2880,
    canvasHeight: 1728,
    intrinsicWidth: 1200,
    offsetTop: 0,
  }),
  0.333,
)

// fit: width-limited, height-limited, and a header above the game
assert.strictEqual(
  computeGameZoom({ ...retina, mode: 'fit', viewWidth: 3600, viewHeight: 4000 }),
  1.5,
)
assert.strictEqual(
  computeGameZoom({ ...retina, mode: 'fit', viewWidth: 4000, viewHeight: 1080 }),
  0.75,
)
assert.strictEqual(
  computeGameZoom({ ...retina, offsetTop: 360, mode: 'fit', viewWidth: 4000, viewHeight: 1800 }),
  1,
)

// rounds down, so the fitted game never overflows
assert.strictEqual(
  computeGameZoom({ ...retina, mode: 'fit', viewWidth: 2399, viewHeight: 4000 }),
  0.999,
)
// clamped
assert.strictEqual(
  computeGameZoom({ ...retina, mode: 'fit', viewWidth: 100, viewHeight: 100 }),
  0.25,
)

console.log('game-zoom ok')
