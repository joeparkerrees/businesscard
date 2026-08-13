// ─────────────────────────────────────────────────────────
// Joe Parker-Rees — digital business card
//
// A point-cloud head that responds to the phone's gyroscope, with a
// drag fallback for everything the gyroscope isn't available on.
//
// The head is currently procedural (see buildHeadGeometry). Swapping in a
// real scan means replacing that one function with something that returns a
// BufferGeometry of positions — nothing else here needs to change.
// ─────────────────────────────────────────────────────────

import * as THREE from './vendor/three.module.min.js';

const canvas = document.getElementById('head-canvas');
const stage = document.getElementById('stage');
const hint = document.getElementById('hint');
const motionBtn = document.getElementById('motion-btn');

const FOREGROUND = 0x00220a;

// Tilting the phone should feel like moving around a fixed object rather than
// turning a turntable. If it reads backwards on device, flip this to 1.
const GAMMA_SIGN = -1;
const BETA_SIGN = -1;

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Geometry ─────────────────────────────────────────────

const gaussian = (v, mu, sigma) => Math.exp(-((v - mu) ** 2) / (2 * sigma * sigma));

/**
 * Deform a point on the unit sphere into a head-ish silhouette.
 *
 * This is a placeholder standing in for a real scan, but it's deliberately
 * built as a displacement of an evenly-sampled sphere — the same shape the
 * scan data will take — so the render path is the one we'll actually ship.
 */
function shapeHead(x, y, z) {
  // Base ellipsoid: taller than wide, a little deeper than wide.
  let px = x * 0.72;
  let py = y * 1.0;
  let pz = z * 0.8;

  // Taper the cranium into a jaw below the equator, and lengthen the chin.
  if (y < 0) {
    const t = Math.pow(-y, 1.5);
    const taper = 1 - 0.45 * t;
    px *= taper;
    pz *= taper * 0.92;
    py -= 0.06 * t;
  }

  // Flatten the crown so the top doesn't read as a ball.
  if (y > 0.75) py -= (y - 0.75) * 0.35;

  const front = Math.max(0, z);
  const back = Math.max(0, -z);

  // Flatten the face plane so features sit on something rather than bulge.
  pz -= front * front * 0.14;
  // ...and extend the back of the skull for a human profile.
  pz -= back * back * 0.1;

  // Nose: bump on the centreline. Kept soft and wide — a tighter gaussian
  // reads as a thorn stuck to the surface rather than as a feature.
  pz += gaussian(x, 0, 0.2) * gaussian(y, -0.04, 0.26) * front * 0.17;
  // Brow: broader and shallower, sitting above it.
  pz += gaussian(x, 0, 0.34) * gaussian(y, 0.26, 0.1) * front * 0.07;
  // Eye sockets: paired dents either side of the nose.
  const socket = (gaussian(x, 0.26, 0.12) + gaussian(x, -0.26, 0.12)) * gaussian(y, 0.1, 0.11);
  pz -= socket * front * 0.09;

  return [px, py, pz];
}

function buildHeadGeometry(count = 16000) {
  const positions = new Float32Array(count * 3);
  // Fibonacci sphere: even coverage without the pole clustering you get from
  // naive lat/long sampling.
  const golden = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const [px, py, pz] = shapeHead(Math.cos(theta) * radius, y, Math.sin(theta) * radius);

    // A little jitter off the surface so the cloud reads as organic rather
    // than as a mathematically perfect shell.
    const j = 0.012;
    positions[i * 3] = px + (Math.random() - 0.5) * j;
    positions[i * 3 + 1] = py + (Math.random() - 0.5) * j;
    positions[i * 3 + 2] = pz + (Math.random() - 0.5) * j;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geometry;
}

// ── Material ─────────────────────────────────────────────
//
// Dark points on a near-white page, so depth is carried by density and fade
// rather than by lighting — a lit mesh on this background reads as muddy.

const material = new THREE.ShaderMaterial({
  uniforms: {
    uColor: { value: new THREE.Color(FOREGROUND) },
    // World units, not pixels — the vertex shader converts to device pixels
    // via uScale, which tracks the drawing-buffer height.
    uSize: { value: 0.025 },
    uScale: { value: 300 },
    uNear: { value: 4.0 },
    uFar: { value: 6.1 },
  },
  vertexShader: /* glsl */ `
    uniform float uSize;
    uniform float uScale;
    uniform float uNear;
    uniform float uFar;
    varying float vFade;

    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      float depth = -mv.z;
      gl_PointSize = uSize * (uScale / depth);
      vFade = 1.0 - smoothstep(uNear, uFar, depth);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    varying float vFade;

    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float d = dot(c, c);
      if (d > 0.25) discard;
      float edge = smoothstep(0.25, 0.14, d);
      gl_FragColor = vec4(uColor, edge * mix(0.10, 0.95, vFade));
    }
  `,
  transparent: true,
  depthWrite: false,
});

// ── Scene ────────────────────────────────────────────────

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setClearAlpha(0);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
camera.position.z = 5.0;

const head = new THREE.Points(buildHeadGeometry(24000), material);
scene.add(head);

function resize() {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2); // capped: this runs in someone's hand for hours
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // gl_PointSize is in device pixels, so this tracks the drawing buffer
  // rather than the CSS box — otherwise points halve on a 2x screen.
  material.uniforms.uScale.value = h * dpr * 0.5;
}

new ResizeObserver(resize).observe(stage);
resize();

// ── Input ────────────────────────────────────────────────

const tilt = { targetX: 0, targetY: 0, x: 0, y: 0 };
let engaged = false; // true once the user has tilted or dragged

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

  // Baseline off the first reading so the head doesn't snap to whatever
  // angle the phone happened to be held at.
  if (!baseline) baseline = { beta: e.beta, gamma: e.gamma };

  tilt.targetY = clamp(GAMMA_SIGN * (e.gamma - baseline.gamma) * 0.024, -1.1, 1.1);
  tilt.targetX = clamp(BETA_SIGN * (e.beta - baseline.beta) * 0.014, -0.45, 0.45);
  engage();
}

function startOrientation() {
  window.addEventListener('deviceorientation', onOrientation);
  // Some browsers accept the listener and then never fire it. If nothing
  // arrives, leave the drag fallback in place rather than showing a
  // sculpture that ignores the phone.
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
      if (result === 'granted') startOrientation();
      else hint.textContent = 'Drag to look around';
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

canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  last = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  tilt.targetY = clamp(tilt.targetY + (e.clientX - last.x) * 0.008, -1.4, 1.4);
  tilt.targetX = clamp(tilt.targetX + (e.clientY - last.y) * 0.005, -0.5, 0.5);
  last = { x: e.clientX, y: e.clientY };
  engage();
});

const endDrag = (e) => {
  dragging = false;
  if (e.pointerId !== undefined && canvas.hasPointerCapture?.(e.pointerId)) {
    canvas.releasePointerCapture(e.pointerId);
  }
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// ── Loop ─────────────────────────────────────────────────

let idleAmount = 1; // 1 = fully idle sway, 0 = fully user-driven
let running = true;
const clock = new THREE.Clock();

// Pause when the page is hidden — this sits open in someone's hand all day.
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
  const sway = reduceMotion ? 0 : Math.sin(t * 0.45) * 0.4 * idleAmount;
  const nod = reduceMotion ? 0 : Math.sin(t * 0.31) * 0.06 * idleAmount;

  tilt.x += (tilt.targetX - tilt.x) * 0.08;
  tilt.y += (tilt.targetY - tilt.y) * 0.08;

  head.rotation.y = tilt.y + sway;
  head.rotation.x = tilt.x + nod;

  renderer.render(scene, camera);
}

frame();

// ── QR switch ────────────────────────────────────────────

const qrImg = document.getElementById('qr-img');
const tabs = [...document.querySelectorAll('.qr__switch button')];

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    qrImg.src = tab.dataset.qr;
    qrImg.alt = tab.dataset.label;
  });
});
