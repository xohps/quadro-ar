// The plane that lies exactly over the print and plays the animation video.
//
// The video is invisible until it plays, so between loops the person sees the real print
// through the camera. Its first frame should be the printed image itself: the fade in is
// then just the picture coming to life, and the fade out a soft return to the still print.
import * as THREE from 'three';

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uVideo;
  uniform sampler2D uMask;
  uniform float uHasMask;
  uniform float uOpacity;
  uniform float uFeather;
  varying vec2 vUv;
  void main() {
    float alpha = uOpacity;
    // With a mask, white shows the video and black leaves the print visible.
    if (uHasMask > 0.5) alpha *= texture2D(uMask, vUv).r;
    if (uFeather > 0.0) {
      vec2 edge = min(vUv, 1.0 - vUv);
      alpha *= smoothstep(0.0, uFeather, min(edge.x, edge.y));
    }
    gl_FragColor = vec4(texture2D(uVideo, vUv).rgb, alpha);
  }
`;

export function createOverlay({ video, aspect, maskUrl, feather = 0, fade = 0.7, loopPause = 2, onBlocked }) {
  const uniforms = {
    uVideo: { value: null },
    uMask: { value: null },
    uHasMask: { value: 0 },
    uOpacity: { value: 0 },
    uFeather: { value: feather },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, aspect), material);
  uniforms.uVideo.value = new THREE.VideoTexture(video);

  if (maskUrl) {
    new THREE.TextureLoader().load(maskUrl, (mask) => {
      mask.minFilter = THREE.LinearFilter;
      uniforms.uMask.value = mask;
      uniforms.uHasMask.value = 1;
    });
  }

  let shown = false;
  let opacity = 0;
  let replayIn = 0; // seconds until the video starts over after ending

  const play = () => video.play().catch(() => {
    // The browser refused to play without a tap. Stay invisible rather than flash black.
    shown = false;
    onBlocked?.();
  });

  video.addEventListener('ended', () => {
    replayIn = fade + loopPause;
  });

  function update(dt) {
    // Nothing is drawn before a frame exists, or the plane would come up black.
    const ready = video.readyState >= 2 && !video.ended;
    const target = shown && ready ? 1 : 0;
    opacity += Math.sign(target - opacity) * Math.min(Math.abs(target - opacity), fade > 0 ? dt / fade : 1);
    uniforms.uOpacity.value = opacity;

    if (replayIn > 0) {
      replayIn -= dt;
      if (replayIn <= 0 && shown) {
        video.currentTime = 0;
        play();
      }
    }
  }

  return {
    mesh,
    // Called every time the print is found; the video restarts from its first frame.
    start() {
      shown = true;
      replayIn = 0;
      video.currentTime = 0;
      play();
    },
    stop() {
      shown = false;
      replayIn = 0;
      opacity = 0;
      video.pause();
    },
    update,
    get opacity() {
      return opacity;
    },
    get masked() {
      return uniforms.uHasMask.value === 1;
    },
  };
}
