// ─────────────────────────────────────────────────────────
// Joe Parker-Rees — digital business card
//
// A full-bleed point-cloud head that responds to the phone's gyroscope, with
// a drag fallback everywhere the gyroscope isn't available.
//
// The sculpture loads from models/face.glb. If that file isn't there, it
// falls back to a procedural head so the page is never broken — drop the
// scan in and it takes over on the next load.
// ─────────────────────────────────────────────────────────

import * as THREE from 'three';
// vendor/ mirrors three's own examples/jsm layout — GLTFLoader reaches
// sideways for '../utils/BufferGeometryUtils.js', so the folders have to stay
// siblings.
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { MeshSurfaceSampler } from './vendor/math/MeshSurfaceSampler.js';
import * as BufferGeometryUtils from './vendor/utils/BufferGeometryUtils.js';

const canvas = document.getElementById('head-canvas');
const hint = document.getElementById('hint');
const motionBtn = document.getElementById('motion-btn');
const hapticSwitch = document.getElementById('haptic-switch');

const badge = document.getElementById('badge');
const foil = badge?.querySelector('.badge__foil');
const grain = badge?.querySelector('.badge__grain');
const sheen = badge?.querySelector('.badge__sheen');

const FOREGROUND = 0x00220a;
// Dense enough that the near surface reads as a solid form rather than a grey
// wash — at full-bleed size, a sparse cloud just looks like paper texture.
// Points are cheap; this is not the bottleneck.
const POINT_COUNT = 120000;

// Nominal model dimensions, in world units. The loaded scan is normalised to
// these so the framing maths below holds whatever the scan's own scale is.
const HEAD_W = 1.44;
const HEAD_H = 2.06;

// Tilting should feel like moving around a fixed object rather than turning a
// turntable. If it reads backwards on device, flip these.
const GAMMA_SIGN = -1;
const BETA_SIGN = -1;

// If the scan loads in facing the wrong way, adjust these (radians).
const MODEL_ROTATION = { x: 0, y: 0, z: 0 };

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
// Driven by the same tilt values as the sculpture, so the seal and the head
// read as one physical object rather than two effects sharing a screen.

// Travel in px per radian. Each layer moves at a different rate: the parallax
// between the colour bands, the grating and the specular is most of what
// sells this as foil rather than as a sliding gradient.
const FOIL_TRAVEL = 40;
const GRAIN_TRAVEL = 62;
const SHEEN_TRAVEL = 86;

let lastGlint = NaN;

function updateBadge(rotX, rotY) {
  if (!foil) return;

  // Negative: a reflection slides opposite to the way you tip the object.
  const x = -rotY;
  const y = -rotX;

  // The hue filter forces a repaint, so skip frames that wouldn't show a
  // visible change — matters when idle, and when reduced motion holds it still.
  if (Math.abs(x - lastGlint) < 0.0015) return;
  lastGlint = x;

  foil.style.transform = `translate3d(${x * FOIL_TRAVEL}px, ${y * FOIL_TRAVEL}px, 0)`;
  grain.style.transform = `translate3d(${x * GRAIN_TRAVEL}px, ${y * GRAIN_TRAVEL}px, 0)`;
  sheen.style.transform = `translate3d(${x * SHEEN_TRAVEL}px, ${y * SHEEN_TRAVEL}px, 0)`;
  // Real foil shifts colour with viewing angle; it doesn't only slide.
  foil.style.filter = `hue-rotate(${x * 46}deg)`;
}

// ── Procedural fallback head ─────────────────────────────

const gaussian = (v, mu, sigma) => Math.exp(-((v - mu) ** 2) / (2 * sigma * sigma));

/** Deform a point on the unit sphere into a head-ish silhouette. */
function shapeHead(x, y, z) {
  let px = x * 0.72;
  let py = y * 1.0;
  let pz = z * 0.8;

  if (y < 0) {
    const t = Math.pow(-y, 1.5);
    const taper = 1 - 0.45 * t;
    px *= taper;
    pz *= taper * 0.92;
    py -= 0.06 * t;
  }

  if (y > 0.75) py -= (y - 0.75) * 0.35;

  const front = Math.max(0, z);
  const back = Math.max(0, -z);

  pz -= front * front * 0.14;
  pz -= back * back * 0.1;

  pz += gaussian(x, 0, 0.2) * gaussian(y, -0.04, 0.26) * front * 0.17;
  pz += gaussian(x, 0, 0.34) * gaussian(y, 0.26, 0.1) * front * 0.07;
  const socket = (gaussian(x, 0.26, 0.12) + gaussian(x, -0.26, 0.12)) * gaussian(y, 0.1, 0.11);
  pz -= socket * front * 0.09;

  return [px, py, pz];
}

function buildProceduralHead(count = POINT_COUNT) {
  const positions = new Float32Array(count * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const [px, py, pz] = shapeHead(Math.cos(theta) * radius, y, Math.sin(theta) * radius);

    const j = 0.012;
    positions[i * 3] = px + (Math.random() - 0.5) * j;
    positions[i * 3 + 1] = py + (Math.random() - 0.5) * j;
    positions[i * 3 + 2] = pz + (Math.random() - 0.5) * j;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geometry;
}

// ── Real scan ────────────────────────────────────────────

/**
 * Load models/face.glb and sample its surface into an even point cloud.
 *
 * Sampling by triangle area rather than reusing the mesh's own vertices
 * matters: scan meshes are unevenly tessellated, so raw vertices clump in
 * high-detail regions and leave flat areas bare.
 */
async function loadScanGeometry() {
  const gltf = await new GLTFLoader().loadAsync('models/face.glb');

  const geometries = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((child) => {
    if (!child.isMesh || !child.geometry?.attributes?.position) return;
    // Strip to positions only so meshes with differing attribute sets still
    // merge, and bake the node transform in since we're discarding the tree.
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', child.geometry.attributes.position.clone());
    if (child.geometry.index) g.setIndex(child.geometry.index.clone());
    g.applyMatrix4(child.matrixWorld);
    geometries.push(g.toNonIndexed());
  });

  if (!geometries.length) throw new Error('face.glb contains no meshes');

  const merged =
    geometries.length === 1 ? geometries[0] : BufferGeometryUtils.mergeGeometries(geometries);

  // Normalise: centre on the origin and scale to the nominal head height, so
  // the framing maths doesn't depend on how the scan was exported.
  merged.computeBoundingBox();
  const box = merged.boundingBox;
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  merged.translate(-centre.x, -centre.y, -centre.z);
  merged.scale(HEAD_H / size.y, HEAD_H / size.y, HEAD_H / size.y);

  const sampler = new MeshSurfaceSampler(new THREE.Mesh(merged)).build();
  const positions = new Float32Array(POINT_COUNT * 3);
  const p = new THREE.Vector3();
  for (let i = 0; i < POINT_COUNT; i++) {
    sampler.sample(p);
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;
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
    // World units, not pixels — the shader converts to device pixels via
    // uScale, which tracks the drawing-buffer height.
    uSize: { value: 0.028 },
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
      // Steep falloff: the back of the skull should nearly vanish so the
      // front surface reads cleanly instead of showing through itself.
      float depthWeight = pow(vFade, 2.2);
      gl_FragColor = vec4(uColor, edge * mix(0.04, 1.0, depthWeight));
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

const head = new THREE.Points(buildProceduralHead(), material);
head.rotation.set(MODEL_ROTATION.x, MODEL_ROTATION.y, MODEL_ROTATION.z);
scene.add(head);

// Base rotation the tilt is applied on top of, so a scan that needs
// reorienting doesn't fight the interaction.
const baseRotation = { x: MODEL_ROTATION.x, y: MODEL_ROTATION.y };

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (!w || !h) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2); // capped: this sits in a hand for hours
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  // gl_PointSize is in device pixels, so this tracks the drawing buffer
  // rather than the CSS box — otherwise points halve on a 2x screen.
  material.uniforms.uScale.value = h * dpr * 0.5;

  // Full bleed: fill the width on a phone (so the sculpture runs off both
  // edges) but fall back to fitting by height on wide screens, where filling
  // the width would blow the head up to nothing but a cheek.
  const visibleH = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const visibleW = visibleH * camera.aspect;
  head.scale.setScalar(Math.min((visibleH * 0.82) / HEAD_H, (visibleW * 1.08) / HEAD_W));

  // Sit the sculpture high: it crops off the top edge (which is what makes it
  // read as full bleed) and leaves the lower third clear for the type.
  head.position.y = visibleH * 0.22;
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
resize();

// Swap in the scan once it's decoded. Failure is expected and fine — it just
// means the file isn't there yet.
loadScanGeometry()
  .then((geometry) => {
    head.geometry.dispose();
    head.geometry = geometry;
    resize();
  })
  .catch(() => {
    console.info('[card] models/face.glb not loaded — using the procedural head.');
  });

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

  // Baseline off the first reading so the head doesn't snap to whatever angle
  // the phone happened to be held at.
  if (!baseline) baseline = { beta: e.beta, gamma: e.gamma };

  tilt.targetY = clamp(GAMMA_SIGN * (e.gamma - baseline.gamma) * 0.024, -1.1, 1.1);
  tilt.targetX = clamp(BETA_SIGN * (e.beta - baseline.beta) * 0.014, -0.45, 0.45);
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
let wasFacing = true;
const clock = new THREE.Clock();

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

  const rotY = tilt.y + sway;
  const rotX = tilt.x + nod;

  head.rotation.y = baseRotation.y + rotY;
  head.rotation.x = baseRotation.x + rotX;

  updateBadge(rotX, rotY);

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
const tabs = [...document.querySelectorAll('.qr__switch button')];

const CAPTIONS = {
  'qr-url.svg': 'Scan to open this card',
  'qr-vcard.svg': 'Scan to save my details — works with no signal',
};

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    qrImg.src = tab.dataset.qr;
    qrImg.alt = tab.dataset.label;
    qrCaption.textContent = CAPTIONS[tab.dataset.qr] ?? '';
    haptic(10);
  });
});

document.querySelector('.email')?.addEventListener('click', () => haptic(10));
