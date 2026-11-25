// Starts MindAR and hands back what main.js draws with. This is the heavy part of the
// page (three.js plus TensorFlow.js inside the MindAR build), so main.js imports it
// lazily and the start screen shows up first.
import * as THREE from 'three';
import { MindARThree } from 'mindar-image-three';

let active = null; // stops the instance in use, so it can be halted even while starting

export function stopAR() {
  active?.();
  active = null;
}

export async function startAR({ container, targetSrc, tracking = {}, onFound, onLost }) {
  const mindar = new MindARThree({
    container,
    imageTargetSrc: targetSrc,
    maxTrack: 1,
    uiLoading: 'no',
    uiScanning: 'no',
    uiError: 'no',
    // MindAR falls back to its defaults only for null, not for undefined.
    warmupTolerance: tracking.warmupTolerance ?? null,
    missTolerance: tracking.missTolerance ?? null,
    filterMinCF: tracking.filterMinCF ?? null,
    filterBeta: tracking.filterBeta ?? null,
  });
  // MindAR renders at the full device pixel ratio, which is wasted effort on a photo.
  mindar.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  // Only used for HTML anchored to the target, which this page does its own way.
  mindar.cssRenderer.domElement.style.display = 'none';

  active = () => {
    mindar.renderer.setAnimationLoop(null);
    mindar.controller?.dispose();
    mindar.video?.srcObject?.getTracks().forEach((track) => track.stop());
    mindar.video?.remove();
    mindar.renderer.dispose();
    mindar.renderer.domElement.remove();
  };

  try {
    await mindar.start();
  } catch (error) {
    stopAR();
    throw error;
  }

  // The anchor's origin is the centre of the print. Its width is 1 and its height is the
  // aspect ratio, in units of the compiled target.
  const [width, height] = mindar.controller.markerDimensions[0];
  const anchor = mindar.addAnchor(0);
  anchor.onTargetFound = onFound;
  anchor.onTargetLost = onLost;

  const local = new THREE.Vector3();
  const view = new THREE.Vector3();
  const projected = new THREE.Vector3();

  // Maps a point of the print to page pixels. u and v run from 0 to 1 across the print,
  // starting at its top-left corner. Call it after rendering, when the matrices are current.
  function toScreen(u, v, out = {}) {
    local.set(u - 0.5, (0.5 - v) * (height / width), 0);
    anchor.group.localToWorld(local);
    view.copy(local).applyMatrix4(mindar.camera.matrixWorldInverse);
    projected.copy(local).project(mindar.camera);
    out.x = (projected.x * 0.5 + 0.5) * container.clientWidth;
    out.y = (-projected.y * 0.5 + 0.5) * container.clientHeight;
    out.behind = view.z > 0; // the camera looks down -z
    return out;
  }

  return {
    anchor,
    renderer: mindar.renderer,
    scene: mindar.scene,
    camera: mindar.camera,
    aspect: height / width,
    toScreen,
    stop: stopAR,
  };
}
