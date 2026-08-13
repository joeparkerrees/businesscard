// ─────────────────────────────────────────────────────────
// Joe Parker-Rees — digital business card
//
// A cube relief of a portrait that responds to the phone's gyroscope, with a
// drag fallback everywhere the gyroscope isn't available.
//
// Adapted from the p5 sketch that drew one box() per pixel inside a nested
// loop — up to 10,000 draw calls a frame, which is why it ran at 24fps and
// needed Safari-specific tuning. Here the same idea is one InstancedMesh: a
// single draw call, with the tilt-driven explosion riding on the instance
// matrices rather than on per-box immediate-mode state.
//
// The heights come from relief.png, baked by scripts/gen-relief.py — RGB is
// height, alpha is the subject mask.
// ─────────────────────────────────────────────────────────

import * as THREE from 'three';

const canvas = document.getElementById('head-canvas');
const hint = document.getElementById('hint');
const motionBtn = document.getElementById('motion-btn');
const hapticSwitch = document.getElementById('haptic-switch');
const cardEl = document.getElementById('card');
const sculptWindow = document.getElementById('sculpt-window');

const badge = document.getElementById('badge');
const foil = badge?.querySelector('.badge__foil');
const grain = badge?.querySelector('.badge__grain');
const sheen = badge?.querySelector('.badge__sheen');

const CUBE_COLOR = 0x00220a;
const SCULPT_WIDTH = 2.35; // world units across the full grid

// Every tunable in one object so the dev panel can drive them live. The
// defaults here are what ships; dev/ mutates this and nothing else.
// See dev/README.md.
export const params = {
  // Relief. baseDepth is how far the brightest cell sits in front of the
  // darkest at rest; explodeDepth is how much further a full tilt pushes it.
  // The p5 original drove explosion off mouse distance from centre — on a
  // phone the honest equivalent is how far you've tilted.
  baseDepth: 0.34,
  explodeDepth: 1.15,
  explodeSensitivity: 0.85,
  explodeDamping: 0.07,
  // Cube size as a fraction of cell size: min, plus this much more at full
  // brightness. The size difference keeps the relief legible head-on.
  cubeMin: 0.55,
  cubeRange: 0.5,
  // Framing, as fractions of the visible frustum.
  fitHeight: 0.94,
  fitWidth: 0.86,
  posY: 0.02,
  // Input.
  damping: 0.08,
  gammaScale: 0.024,
  betaScale: 0.014,
  sway: 0.32,
  breath: 0.3,
  breathRate: 0.62,
  // Lighting.
  ambient: 0.85,
  keyLight: 3.1,
  // Overlay parallax, in degrees at full deflection.
  overlayTilt: 7,
  // Foil badge. foilSpin is degrees of colour-wheel rotation per radian of
  // tilt; the others are layer travel in px per radian.
  foilSpin: 130,
  foilPeriod: 6, // seconds per full turn, matching .cta-border

  grainTravel: 62,
  sheenTravel: 86,
};

if (typeof window !== 'undefined') window.CARD_PARAMS = params;

// The sculpture leans against the phone's rotation rather than with it, which
// is what makes it read as sitting in the card rather than painted on it.
// Flip these to swap the direction.
const GAMMA_SIGN = 1;
const BETA_SIGN = 1;

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Haptics ──────────────────────────────────────────────

let lastHaptic = 0;

/**
 * Fire a short haptic tick.
 *
 * Android and desktop Chrome implement navigator.vibrate. iOS Safari does
 * not, and offers no haptics API at all — the only lever a web page has is
 * that toggling a `switch` checkbox produces system haptic feedback on
 * iOS 17.4+. That's a workaround riding on a UI control, not an API, so it
 * may stop working; the page degrades silently to no haptics if it does.
 */
function haptic(ms = 10) {
  const now = performance.now();
  if (now - lastHaptic < 60) return; // never machine-gun
  lastHaptic = now;

  if (typeof navigator.vibrate === 'function') {
    navigator.vibrate(ms);
    return;
  }
  hapticSwitch?.click();
}

// ── Foil badge ───────────────────────────────────────────
//
// Driven by the same tilt values as the sculpture, so the seal and the relief
// read as one physical object rather than two effects sharing a screen.

// Each layer moves at a different rate: the parallax between the colour
// bands, the grating and the specular is most of what sells this as foil
// rather than as a sliding gradient.

let lastGlint = NaN;

function updateBadge(rotX, rotY, time) {
  if (!foil) return;

  // Negative: a reflection slides opposite to the way you tip the object.
  const x = -rotY;
  const y = -rotX;

  // The wheel turns on its own as well as with tilt, matching .cta-border on
  // the site, which spins continuously at 6s. Tilt offsets that sweep rather
  // than being the only thing driving it.
  const drift = reduceMotion ? 0 : (time * 360) / params.foilPeriod;
  foil.style.setProperty('--foil-angle', `${drift + x * params.foilSpin}deg`);

  if (Math.abs(x - lastGlint) < 0.0008) return;
  lastGlint = x;
  grain.style.transform = `translate3d(${x * params.grainTravel}px, ${y * params.grainTravel}px, 0)`;
  sheen.style.transform = `translate3d(${x * params.sheenTravel}px, ${y * params.sheenTravel}px, 0)`;
}

// ── Relief data ──────────────────────────────────────────

/** Read relief.png into a flat list of filled cells with their heights. */
async function loadRelief(src = 'relief.png') {
  const img = new Image();
  img.decoding = 'async';
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });

  const grid = img.naturalWidth;
  const scratch = document.createElement('canvas');
  scratch.width = grid;
  scratch.height = img.naturalHeight;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, scratch.width, scratch.height);

  const cells = [];
  for (let row = 0; row < scratch.height; row++) {
    for (let col = 0; col < grid; col++) {
      const i = (row * grid + col) * 4;
      if (data[i + 3] < 8) continue; // masked-out background
      cells.push({ col, row, height: data[i] / 255 });
    }
  }
  return { grid, rows: scratch.height, cells };
}

// ── Scene ────────────────────────────────────────────────

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setClearAlpha(0);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
camera.position.z = 5.0;

// Cubes need shading to read as cubes rather than as a flat silhouette. Dark
// green on light stock has little tonal room, so the key is strong and the
// ambient low: the difference between a lit and an unlit face is the only
// thing carrying the relief.
const ambientLight = new THREE.AmbientLight(0xffffff, params.ambient);
scene.add(ambientLight);
const key = new THREE.DirectionalLight(0xffffff, params.keyLight);
key.position.set(-0.6, 0.9, 1.2);
scene.add(key);

const sculpture = new THREE.Group();
scene.add(sculpture);

let mesh = null;
let cells = [];
let cellSize = 0;
// The grid follows the portrait's aspect, so height is not width.
let sculptW = 0;
let sculptH = 0;
const dummy = new THREE.Object3D();

function buildSculpture(relief) {
  cells = relief.cells;
  cellSize = SCULPT_WIDTH / relief.grid;
  sculptW = SCULPT_WIDTH;
  sculptH = cellSize * relief.rows;

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshLambertMaterial({ color: CUBE_COLOR });
  mesh = new THREE.InstancedMesh(geometry, material, cells.length);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  // Cache each cell's resting position so the per-frame update only has to
  // move it along z.
  for (const cell of cells) {
    cell.x = (cell.col - relief.grid / 2 + 0.5) * cellSize;
    cell.y = (relief.rows / 2 - cell.row - 0.5) * cellSize;
    // Brighter cells sit slightly larger as well as further forward — the
    // size difference is what keeps the relief legible head-on, before any
    // tilt has pushed it into depth.
    cell.size = cellSize * (params.cubeMin + cell.height * params.cubeRange);
  }

  sculpture.add(mesh);
  applyExplosion(0);
}

/** Push every cube along z by its height. 0 = flat relief, 1 = fully burst. */
function applyExplosion(amount) {
  if (!mesh) return;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const z = (cell.height - 0.5) * params.baseDepth + cell.height * params.explodeDepth * amount;
    cell.size = cellSize * (params.cubeMin + cell.height * params.cubeRange);
    dummy.position.set(cell.x, cell.y, z);
    dummy.scale.setScalar(cell.size);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

function resize() {
  // Sized to the window element, not the viewport: the relief lives in a
  // recess in the card now, not behind the whole page.
  const w = sculptWindow.clientWidth;
  const h = sculptWindow.clientHeight;
  if (!w || !h) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2); // capped: this sits in a hand for hours
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  const visibleH = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const visibleW = visibleH * camera.aspect;
  if (sculptW) {
    sculpture.scale.setScalar(Math.min((visibleH * params.fitHeight) / sculptH, (visibleW * params.fitWidth) / sculptW));
  }

  sculpture.position.y = visibleH * params.posY;
}

new ResizeObserver(resize).observe(sculptWindow);
window.addEventListener('orientationchange', resize);
resize();

loadRelief()
  .then((relief) => {
    buildSculpture(relief);
    resize();
  })
  .catch((err) => console.error('[card]', err.message));

// ── Input ────────────────────────────────────────────────

const tilt = { targetX: 0, targetY: 0, x: 0, y: 0 };
let engaged = false;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function engage() {
  if (engaged) return;
  engaged = true;
  hint.dataset.state = 'active';
}

// Gyroscope ------------------------------------------------

let baseline = null;
let sawOrientationEvent = false;

function onOrientation(e) {
  if (e.beta === null || e.gamma === null) return;
  sawOrientationEvent = true;

  // Baseline off the first reading so the sculpture doesn't snap to whatever
  // angle the phone happened to be held at.
  if (!baseline) baseline = { beta: e.beta, gamma: e.gamma };

  tilt.targetY = clamp(GAMMA_SIGN * (e.gamma - baseline.gamma) * params.gammaScale, -1.1, 1.1);
  tilt.targetX = clamp(BETA_SIGN * (e.beta - baseline.beta) * params.betaScale, -0.45, 0.45);
  engage();
}

function startOrientation() {
  window.addEventListener('deviceorientation', onOrientation);
  // Some browsers accept the listener and then never fire it. If nothing
  // arrives, leave the drag fallback in place rather than showing a sculpture
  // that ignores the phone.
  setTimeout(() => {
    if (!sawOrientationEvent) {
      window.removeEventListener('deviceorientation', onOrientation);
      hint.textContent = 'Drag to look around';
    }
  }, 1500);
}

const needsPermission =
  typeof DeviceOrientationEvent !== 'undefined' &&
  typeof DeviceOrientationEvent.requestPermission === 'function';

if (needsPermission) {
  // iOS 13+: requestPermission() only works from inside a user gesture, so it
  // has to hang off a tap rather than fire on load.
  motionBtn.hidden = false;
  hint.hidden = true;
  motionBtn.addEventListener('click', async () => {
    try {
      const result = await DeviceOrientationEvent.requestPermission();
      if (result === 'granted') {
        haptic(18);
        startOrientation();
      } else {
        hint.textContent = 'Drag to look around';
      }
    } catch {
      hint.textContent = 'Drag to look around';
    }
    motionBtn.hidden = true;
    hint.hidden = false;
  });
} else if (typeof DeviceOrientationEvent !== 'undefined') {
  startOrientation();
}

// Drag ------------------------------------------------------

let dragging = false;
let last = { x: 0, y: 0 };

cardEl.addEventListener('pointerdown', (e) => {
  dragging = true;
  last = { x: e.clientX, y: e.clientY };
  cardEl.setPointerCapture(e.pointerId);
});

cardEl.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  tilt.targetY = clamp(tilt.targetY + (e.clientX - last.x) * 0.008, -1.4, 1.4);
  tilt.targetX = clamp(tilt.targetX + (e.clientY - last.y) * 0.005, -0.5, 0.5);
  last = { x: e.clientX, y: e.clientY };
  engage();
});

const endDrag = (e) => {
  dragging = false;
  if (e.pointerId !== undefined && cardEl.hasPointerCapture?.(e.pointerId)) {
    cardEl.releasePointerCapture(e.pointerId);
  }
};
cardEl.addEventListener('pointerup', endDrag);
cardEl.addEventListener('pointercancel', endDrag);

// ── Card tilt ────────────────────────────────────────────
//
// The card tilts as one plane, with its contents at different depths (set in
// CSS via translateZ). Small angles: this is a card catching the light, not a
// carousel.

function updateCard(rotX, rotY) {
  if (!cardEl || reduceMotion) return;
  const ry = clamp(rotY * params.overlayTilt, -14, 14);
  const rx = clamp(-rotX * params.overlayTilt, -12, 12);
  cardEl.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
}

// ── Loop ─────────────────────────────────────────────────

let idleAmount = 1; // 1 = fully idle sway, 0 = fully user-driven
let running = true;
let explosion = 0;
let appliedExplosion = -1;
let wasFacing = true;
let paramsDirty = false;
const clock = new THREE.Clock();

// The dev panel fires this after mutating params so geometry-affecting
// changes (cube size, framing) get re-applied rather than waiting for a
// resize that may never come.
window.addEventListener('card-params-changed', () => { paramsDirty = true; });

document.addEventListener('visibilitychange', () => {
  running = !document.hidden;
  if (running) {
    clock.getDelta(); // discard the gap so the sway doesn't jump
    requestAnimationFrame(frame);
  }
});

function frame() {
  if (!running) return;
  requestAnimationFrame(frame);

  const t = clock.getElapsedTime();

  // Ease the idle sway out once the user takes over, rather than cutting it.
  if (engaged) idleAmount += (0 - idleAmount) * 0.04;
  const sway = reduceMotion ? 0 : Math.sin(t * 0.45) * params.sway * idleAmount;
  const nod = reduceMotion ? 0 : Math.sin(t * 0.31) * 0.05 * idleAmount;

  tilt.x += (tilt.targetX - tilt.x) * params.damping;
  tilt.y += (tilt.targetY - tilt.y) * params.damping;

  const rotY = tilt.y + sway;
  const rotX = tilt.x + nod;

  sculpture.rotation.y = rotY;
  sculpture.rotation.x = rotX;

  // How far you've tilted is how far it bursts apart. Idle keeps a slow
  // breath in it so the relief is never completely inert.
  // Always breathing, not only while idle — a still relief reads as a flat
  // image, and this is the cue that it has depth and responds.
  const breath = reduceMotion ? 0 : (0.5 + 0.5 * Math.sin(t * params.breathRate)) * params.breath;
  const target = Math.min(1, Math.hypot(tilt.x, tilt.y) / params.explodeSensitivity) + breath;
  explosion += (target - explosion) * params.explodeDamping;

  ambientLight.intensity = params.ambient;
  key.intensity = params.keyLight;
  if (paramsDirty) { resize(); paramsDirty = false; appliedExplosion = -1; }

  // Rewriting 7k instance matrices is the one genuinely expensive thing here,
  // so skip it when the change wouldn't be visible.
  if (Math.abs(explosion - appliedExplosion) > 0.0025) {
    applyExplosion(explosion);
    appliedExplosion = explosion;
  }

  updateBadge(rotX, rotY, t);
  updateCard(rotX, rotY);

  // A detent as the face swings back through front-on, so the sculpture feels
  // like it has a resting position rather than being weightless.
  const facing = Math.abs(tilt.y) < 0.05;
  if (engaged && facing && !wasFacing) haptic(8);
  wasFacing = facing;

  renderer.render(scene, camera);
}

frame();

// ── QR switch ────────────────────────────────────────────

const qrImg = document.getElementById('qr-img');
const qrCaption = document.getElementById('qr-caption');
const switchEl = document.getElementById('qr-switch');
const tabs = [...document.querySelectorAll('.switch button')];

const CAPTIONS = {
  'qr-url.svg': 'Scan to open this card',
  'qr-vcard.svg': 'Scan to save my details — works with no signal',
};

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    switchEl.dataset.active = String(index);
    qrImg.src = tab.dataset.qr;
    qrImg.alt = tab.dataset.label;
    qrCaption.textContent = CAPTIONS[tab.dataset.qr] ?? '';
    haptic(10);
  });
});

document.querySelector('.email')?.addEventListener('click', () => haptic(10));
