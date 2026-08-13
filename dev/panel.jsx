// Dev-only DialKit panel.
//
// The card itself is deliberately vanilla — no framework, no build step, so a
// stranger scanning the QR downloads nothing but static files. DialKit's UI
// only ships as framework components, so the panel is a tiny React island
// that mounts alongside the card and mutates window.CARD_PARAMS. Nothing
// here is part of the production page.

import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { DialRoot, useDialKit } from 'dialkit';

/** Push a group's values onto the live params object and nudge the card. */
function useApply(values) {
  useEffect(() => {
    if (!window.CARD_PARAMS) return;
    Object.assign(window.CARD_PARAMS, values);
    // Geometry-affecting changes (cube size, framing) need re-applying rather
    // than waiting for a resize that may never come.
    window.dispatchEvent(new Event('card-params-changed'));
  }, [values]);
}

function Sculpture() {
  const p = useDialKit('Sculpture', {
    baseDepth: [0.34, 0, 1.5, 0.01],
    explodeDepth: [1.15, 0, 4, 0.01],
    cubeMin: [0.55, 0.05, 1.5, 0.01],
    cubeRange: [0.5, 0, 2, 0.01],
    Framing: {
      _collapsed: true,
      fitHeight: [0.72, 0.2, 1.4, 0.01],
      fitWidth: [0.92, 0.2, 1.6, 0.01],
      posY: [0.2, -0.4, 0.6, 0.01],
    },
    Lighting: {
      _collapsed: true,
      ambient: [1.35, 0, 4, 0.05],
      keyLight: [2.1, 0, 6, 0.05],
    },
  });
  useApply(p);
  return null;
}

function Motion() {
  const p = useDialKit('Motion', {
    // How hard you have to tilt before the relief fully bursts apart.
    explodeSensitivity: [0.85, 0.1, 2.5, 0.01],
    explodeDamping: [0.07, 0.01, 0.5, 0.01],
    damping: [0.08, 0.01, 0.5, 0.01],
    sway: [0.32, 0, 1.2, 0.01],
    idleBreath: [0.16, 0, 1, 0.01],
    Gyroscope: {
      _collapsed: true,
      gammaScale: [0.024, 0.002, 0.08, 0.001],
      betaScale: [0.014, 0.002, 0.08, 0.001],
    },
    overlayTilt: [7, 0, 20, 0.5],
  });
  useApply(p);
  return null;
}

function Badge() {
  const p = useDialKit('Foil badge', {
    foilTravel: [40, 0, 200, 1],
    grainTravel: [62, 0, 200, 1],
    sheenTravel: [86, 0, 260, 1],
    hueRange: [26, 0, 180, 1],
  });
  useApply(p);
  return null;
}

function Panel() {
  return (
    <>
      <Sculpture />
      <Motion />
      <Badge />
      <DialRoot />
    </>
  );
}

const host = document.createElement('div');
host.id = 'dev-panel';
document.body.appendChild(host);
createRoot(host).render(<Panel />);
