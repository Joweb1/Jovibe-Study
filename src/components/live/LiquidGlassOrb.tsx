import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { LiveVoiceState } from './types';

interface LiquidGlassOrbProps {
  voiceState: LiveVoiceState;
  /** 0..1 simulated or real voice/audio energy level */
  audioLevel: number;
  isDark: boolean;
  onOrbTap?: () => void;
  className?: string;
}

// Reusable module-scope math objects (zero GC allocations inside render loop)
const _colorA = new THREE.Color();
const _colorB = new THREE.Color();
const _colorC = new THREE.Color();
const _colorRim = new THREE.Color();
const _haloColorA = new THREE.Color();
const _haloColorB = new THREE.Color();

// Compact 3D Ashima Simplex Noise shared across vertex & fragment shaders
const SIMPLEX_3D_GLSL = /* glsl */ `
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}

float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 1.0/7.0;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

float fluidField(vec3 p, float t, float freq, float inwardPull) {
  vec3 flow = p * freq + vec3(t * 0.24, -t * 0.19, t * 0.15);
  float n1 = snoise(flow);
  float n2 = snoise(flow * 1.95 - vec3(t * 0.31, t * 0.22, -t * 0.27) + n1 * 0.35);
  float radialWave = sin(length(p.xy) * 5.0 - t * 2.2) * inwardPull * 0.22;
  return n1 * 0.65 + n2 * 0.35 + radialWave;
}
`;

const CORE_VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform float uDistortion;
uniform float uFrequency;
uniform float uInwardPull;

varying vec3 vNormalDir;
varying vec3 vViewDir;
varying vec3 vLocalPos;
varying float vDisplacement;

${SIMPLEX_3D_GLSL}

void main() {
  vec3 dir = normalize(position);
  float disp = fluidField(dir, uTime, uFrequency, uInwardPull);
  vec3 displaced = position + dir * (disp * uDistortion);

  // Finite-difference normal recalculation for crisp liquid shading
  float eps = 0.035;
  vec3 tangent = normalize(abs(dir.y) < 0.9 ? cross(vec3(0.0, 1.0, 0.0), dir) : cross(vec3(1.0, 0.0, 0.0), dir));
  vec3 bitangent = normalize(cross(dir, tangent));

  vec3 pT = normalize(dir + tangent * eps);
  vec3 pB = normalize(dir + bitangent * eps);
  vec3 dT = pT * (length(position) + fluidField(pT, uTime, uFrequency, uInwardPull) * uDistortion);
  vec3 dB = pB * (length(position) + fluidField(pB, uTime, uFrequency, uInwardPull) * uDistortion);
  vec3 perturbedNormal = normalize(cross(dT - displaced, dB - displaced));
  if (dot(perturbedNormal, dir) < 0.0) perturbedNormal = -perturbedNormal;

  vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
  vNormalDir = normalize(mat3(modelMatrix) * perturbedNormal);
  vViewDir = normalize(cameraPosition - worldPos.xyz);
  vLocalPos = dir;
  vDisplacement = disp;

  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const CORE_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform float uEnergy;
uniform float uBrightness;
uniform float uDesaturate;
uniform float uIsDark;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
uniform vec3 uRimColor;

varying vec3 vNormalDir;
varying vec3 vViewDir;
varying vec3 vLocalPos;
varying float vDisplacement;

${SIMPLEX_3D_GLSL}

void main() {
  vec3 N = normalize(vNormalDir);
  vec3 V = normalize(vViewDir);
  float ndotv = clamp(dot(N, V), 0.0, 1.0);
  float fresnel = pow(1.0 - ndotv, 2.35);

  // Flowing internal fluid bands & caustic filaments
  float swirl1 = snoise(vLocalPos * 2.3 + vec3(uTime * 0.28, -uTime * 0.21, uTime * 0.18));
  float swirl2 = snoise(vLocalPos * 4.2 - vec3(uTime * 0.35, uTime * 0.27, -uTime * 0.22) + swirl1 * 0.55);
  float caustic = smoothstep(0.18, 0.85, abs(swirl2));
  float bandA = smoothstep(-0.65, 0.7, swirl1 + vDisplacement * 0.55);
  float bandB = smoothstep(-0.4, 0.85, swirl2 + vLocalPos.y * 0.45);

  // Blend translucent liquid colors
  vec3 baseLiquid = mix(uColorA, uColorB, bandA);
  baseLiquid = mix(baseLiquid, uColorC, bandB * 0.62);

  // Subsurface inner luminescence (stronger in center + along fluid ridges)
  float innerGlow = pow(ndotv, 1.35) * (0.55 + uEnergy * 0.55);
  vec3 subsurface = mix(uColorB, uRimColor, 0.55) * (innerGlow * 0.65 + caustic * (0.28 + uEnergy * 0.35));

  // Soft studio key + rim specular on the fluid core
  vec3 keyLightDir = normalize(vec3(0.45, 0.72, 0.62));
  vec3 halfVec = normalize(keyLightDir + V);
  float spec = pow(max(dot(N, halfVec), 0.0), 34.0) * (0.45 + uEnergy * 0.35);

  vec3 col = baseLiquid * (0.72 + innerGlow * 0.42) + subsurface + uRimColor * fresnel * (0.85 + uEnergy * 0.5) + vec3(1.0) * spec * 0.48;

  // Light mode keeps luminous pearl transparency; dark mode keeps rich atmospheric depth
  if (uIsDark < 0.5) {
    col = mix(col, vec3(0.96, 0.98, 1.0), 0.16 + fresnel * 0.22);
  }

  col *= uBrightness;

  // Desaturate softly when disconnected
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(luma), uDesaturate * 0.72);

  float alpha = mix(0.86, 0.96, fresnel);
  gl_FragColor = vec4(col, alpha);
}
`;

const VEIL_VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform float uDistortion;
uniform float uFrequency;

varying vec3 vNormalDir;
varying vec3 vViewDir;
varying float vWave;

${SIMPLEX_3D_GLSL}

void main() {
  vec3 dir = normalize(position);
  float w = snoise(dir * (uFrequency * 1.15) + vec3(-uTime * 0.24, uTime * 0.31, -uTime * 0.18));
  vec3 displaced = position + dir * (w * uDistortion * 1.15);

  vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
  vNormalDir = normalize(mat3(modelMatrix) * dir);
  vViewDir = normalize(cameraPosition - worldPos.xyz);
  vWave = w;

  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const VEIL_FRAGMENT_SHADER = /* glsl */ `
uniform float uEnergy;
uniform float uDesaturate;
uniform float uIsDark;
uniform vec3 uColorB;
uniform vec3 uColorC;

varying vec3 vNormalDir;
varying vec3 vViewDir;
varying float vWave;

void main() {
  vec3 N = normalize(vNormalDir);
  vec3 V = normalize(vViewDir);
  float fresnel = pow(1.0 - abs(dot(N, V)), 2.1);
  float ribbon = smoothstep(0.05, 0.72, abs(vWave));

  vec3 tint = mix(uColorB, uColorC, smoothstep(-0.6, 0.6, vWave));
  float luma = dot(tint, vec3(0.299, 0.587, 0.114));
  tint = mix(tint, vec3(luma), uDesaturate * 0.75);

  float baseOpacity = uIsDark > 0.5 ? 0.34 : 0.26;
  float alpha = fresnel * ribbon * (baseOpacity + uEnergy * 0.26) * (1.0 - uDesaturate * 0.55);

  gl_FragColor = vec4(tint * (1.1 + uEnergy * 0.35), clamp(alpha, 0.0, 0.65));
}
`;

const HALO_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const HALO_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform float uEnergy;
uniform float uDesaturate;
uniform float uIsDark;
uniform vec3 uHaloColorA;
uniform vec3 uHaloColorB;

varying vec2 vUv;

void main() {
  vec2 centered = (vUv - 0.5) * 2.0;
  float dist = length(centered);
  float angle = atan(centered.y, centered.x);

  float radial = exp(-dist * dist * (2.6 - uEnergy * 0.55));
  float ring = smoothstep(0.98, 0.2, dist);
  float angularMix = 0.5 + 0.5 * sin(angle * 2.0 + uTime * 0.45);

  vec3 glowCol = mix(uHaloColorA, uHaloColorB, angularMix);
  float luma = dot(glowCol, vec3(0.299, 0.587, 0.114));
  glowCol = mix(glowCol, vec3(luma), uDesaturate * 0.8);

  float intensity = uIsDark > 0.5
    ? (0.34 + uEnergy * 0.32)
    : (0.22 + uEnergy * 0.18);

  float alpha = radial * ring * intensity * (1.0 - uDesaturate * 0.65);
  gl_FragColor = vec4(glowCol, clamp(alpha, 0.0, 0.75));
}
`;

function detectSoftwareWebGL(): boolean {
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const rendererStr = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(rendererStr);
  } catch {
    return true;
  }
}

export const LiquidGlassOrb: React.FC<LiquidGlassOrbProps> = ({
  voiceState,
  audioLevel,
  isDark,
  onOrbTap,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ voiceState, audioLevel, isDark });
  const [webglUnavailable, setWebglUnavailable] = useState(false);

  stateRef.current = { voiceState, audioLevel, isDark };

  useEffect(() => {
    const mount = containerRef.current;
    if (!mount) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let renderer: THREE.WebGLRenderer;
    const isSoftwareGl = detectSoftwareWebGL();

    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglUnavailable(true);
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);

    const canvas = renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    mount.innerHTML = '';
    mount.appendChild(canvas);

    // Scene & Camera
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 30);
    camera.position.set(0, 0.04, 4.65);

    // Procedural Studio Environment Reflections (RoomEnvironment)
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.045).texture;
    scene.environment = envTex;
    pmremGenerator.dispose();

    // Balanced 3-Point Studio Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0xcbeeff, 0x3b2c68, 0.85);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xeef8ff, 1.55);
    keyLight.position.set(2.8, 3.6, 3.8);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x88c9ff, 1.35);
    rimLight.position.set(-3.2, -1.8, -2.6);
    scene.add(rimLight);

    const accentPointLight = new THREE.PointLight(0x52e0ff, 2.2, 8);
    accentPointLight.position.set(1.2, 1.1, 2.2);
    scene.add(accentPointLight);

    // Root 5-part procedural liquid-glass orb assembly
    const orbGroup = new THREE.Group();
    scene.add(orbGroup);

    // Layer 4 (background plane): Soft Volumetric Atmospheric Halo
    const haloGeo = new THREE.PlaneGeometry(5.1, 5.1);
    const haloUniforms = {
      uTime: { value: 0 },
      uEnergy: { value: 0.15 },
      uDesaturate: { value: 0 },
      uIsDark: { value: stateRef.current.isDark ? 1.0 : 0.0 },
      uHaloColorA: { value: new THREE.Color('#22d3ee') },
      uHaloColorB: { value: new THREE.Color('#818cf8') },
    };
    const haloMat = new THREE.ShaderMaterial({
      uniforms: haloUniforms,
      vertexShader: HALO_VERTEX_SHADER,
      fragmentShader: HALO_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    const haloMesh = new THREE.Mesh(haloGeo, haloMat);
    haloMesh.position.set(0, 0, -1.35);
    haloMesh.renderOrder = 0;
    scene.add(haloMesh);

    // Layer 5: Subtle Grounding Specular Caustic Mist beneath the orb
    const floorGeo = new THREE.PlaneGeometry(2.6, 1.0);
    const floorUniforms = {
      uTime: { value: 0 },
      uEnergy: { value: 0.15 },
      uDesaturate: { value: 0 },
      uIsDark: { value: stateRef.current.isDark ? 1.0 : 0.0 },
      uHaloColorA: { value: new THREE.Color('#38bdf8') },
      uHaloColorB: { value: new THREE.Color('#a78bfa') },
    };
    const floorMat = new THREE.ShaderMaterial({
      uniforms: floorUniforms,
      vertexShader: HALO_VERTEX_SHADER,
      fragmentShader: /* glsl */ `
        uniform float uEnergy;
        uniform float uDesaturate;
        uniform float uIsDark;
        uniform vec3 uHaloColorA;
        varying vec2 vUv;
        void main() {
          vec2 p = (vUv - 0.5) * 2.0;
          float d = length(vec2(p.x, p.y * 1.45));
          float falloff = exp(-d * d * 3.2);
          vec3 col = uIsDark > 0.5 ? uHaloColorA * 0.7 : vec3(0.42, 0.52, 0.68);
          float alpha = falloff * (uIsDark > 0.5 ? (0.14 + uEnergy * 0.12) : (0.11 + uEnergy * 0.06)) * (1.0 - uDesaturate * 0.5);
          gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.35));
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.position.set(0, -1.48, -0.2);
    floorMesh.renderOrder = 1;
    scene.add(floorMesh);

    // Layer 1: Luminous Internal Liquid Core
    const coreGeo = new THREE.IcosahedronGeometry(0.92, 5);
    const coreUniforms = {
      uTime: { value: 0 },
      uDistortion: { value: 0.11 },
      uFrequency: { value: 1.55 },
      uInwardPull: { value: 0.0 },
      uEnergy: { value: 0.15 },
      uBrightness: { value: 1.0 },
      uDesaturate: { value: 0.0 },
      uIsDark: { value: stateRef.current.isDark ? 1.0 : 0.0 },
      uColorA: { value: new THREE.Color('#0c4a6e') },
      uColorB: { value: new THREE.Color('#22d3ee') },
      uColorC: { value: new THREE.Color('#7c3aed') },
      uRimColor: { value: new THREE.Color('#a5f3fc') },
    };
    const coreMat = new THREE.ShaderMaterial({
      uniforms: coreUniforms,
      vertexShader: CORE_VERTEX_SHADER,
      fragmentShader: CORE_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: true,
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    coreMesh.renderOrder = 2;
    orbGroup.add(coreMesh);

    // Layer 3: Internal Suspended Fluid Veil (counter-rotating parallax membrane)
    const veilGeo = new THREE.IcosahedronGeometry(1.04, 4);
    const veilUniforms = {
      uTime: { value: 0 },
      uDistortion: { value: 0.09 },
      uFrequency: { value: 1.7 },
      uEnergy: { value: 0.15 },
      uDesaturate: { value: 0.0 },
      uIsDark: { value: stateRef.current.isDark ? 1.0 : 0.0 },
      uColorB: { value: new THREE.Color('#38bdf8') },
      uColorC: { value: new THREE.Color('#a78bfa') },
    };
    const veilMat = new THREE.ShaderMaterial({
      uniforms: veilUniforms,
      vertexShader: VEIL_VERTEX_SHADER,
      fragmentShader: VEIL_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    const veilMesh = new THREE.Mesh(veilGeo, veilMat);
    veilMesh.renderOrder = 3;
    orbGroup.add(veilMesh);

    // Layer 2: Outer Translucent Liquid-Glass Shell (MeshPhysicalMaterial + onBeforeCompile)
    const glassUniforms = {
      uGlassTime: { value: 0 },
      uGlassDistortion: { value: 0.075 },
      uGlassFrequency: { value: 1.45 },
      uGlassInward: { value: 0.0 },
    };

    const glassGeo = new THREE.IcosahedronGeometry(1.16, 5);
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(stateRef.current.isDark ? '#d8f6ff' : '#f4f9ff'),
      roughness: 0.06,
      metalness: 0.02,
      ior: 1.46,
      reflectivity: 0.92,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      iridescence: 0.72,
      iridescenceIOR: 1.32,
      iridescenceThicknessRange: [140, 420],
      envMapIntensity: stateRef.current.isDark ? 1.25 : 1.1,
      transmission: isSoftwareGl ? 0 : 0.68,
      thickness: isSoftwareGl ? 0 : 1.35,
      attenuationColor: new THREE.Color(stateRef.current.isDark ? '#38bdf8' : '#c7d2fe'),
      attenuationDistance: 2.4,
      transparent: true,
      opacity: isSoftwareGl ? 0.34 : 0.96,
      depthWrite: false,
    });

    glassMat.onBeforeCompile = (shader) => {
      shader.uniforms.uGlassTime = glassUniforms.uGlassTime;
      shader.uniforms.uGlassDistortion = glassUniforms.uGlassDistortion;
      shader.uniforms.uGlassFrequency = glassUniforms.uGlassFrequency;
      shader.uniforms.uGlassInward = glassUniforms.uGlassInward;

      shader.vertexShader =
        `uniform float uGlassTime;
uniform float uGlassDistortion;
uniform float uGlassFrequency;
uniform float uGlassInward;
${SIMPLEX_3D_GLSL}
` + shader.vertexShader;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <beginnormal_vertex>',
        `
        #include <beginnormal_vertex>
        vec3 gDir = normalize(position);
        float gEps = 0.04;
        vec3 gTan = normalize(abs(gDir.y) < 0.9 ? cross(vec3(0.0, 1.0, 0.0), gDir) : cross(vec3(1.0, 0.0, 0.0), gDir));
        vec3 gBitan = normalize(cross(gDir, gTan));
        float gDisp0 = fluidField(gDir, uGlassTime, uGlassFrequency, uGlassInward) * uGlassDistortion;
        vec3 gP0 = position + gDir * gDisp0;
        vec3 gPTDir = normalize(gDir + gTan * gEps);
        vec3 gPBDir = normalize(gDir + gBitan * gEps);
        vec3 gPT = gPTDir * (length(position) + fluidField(gPTDir, uGlassTime, uGlassFrequency, uGlassInward) * uGlassDistortion);
        vec3 gPB = gPBDir * (length(position) + fluidField(gPBDir, uGlassTime, uGlassFrequency, uGlassInward) * uGlassDistortion);
        vec3 gN = normalize(cross(gPT - gP0, gPB - gP0));
        if (dot(gN, gDir) < 0.0) gN = -gN;
        objectNormal = normalize(mix(objectNormal, gN, 0.85));
        `
      );

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        transformed = gP0;
        `
      );
    };

    const glassMesh = new THREE.Mesh(glassGeo, glassMat);
    glassMesh.renderOrder = 4;
    orbGroup.add(glassMesh);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Responsive ResizeObserver
    const updateSize = () => {
      if (!mount) return;
      const w = Math.max(1, mount.clientWidth);
      const h = Math.max(1, mount.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    updateSize();

    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(mount);

    // WebGL context loss safety
    let contextLost = false;
    const handleContextLost = (e: Event) => {
      e.preventDefault();
      contextLost = true;
    };
    const handleContextRestored = () => {
      contextLost = false;
    };
    canvas.addEventListener('webglcontextlost', handleContextLost);
    canvas.addEventListener('webglcontextrestored', handleContextRestored);

    // Smoothly damped animation state (ensures silky organic transitions between every state)
    const anim = {
      simTime: 0,
      speed: 0.65,
      scale: 1.0,
      distortion: 0.09,
      frequency: 1.5,
      inwardPull: 0.0,
      energy: 0.16,
      brightness: 1.0,
      desaturate: 0.0,
      spinY: 0.12,
      spinX: 0.04,
      darkFactor: stateRef.current.isDark ? 1.0 : 0.0,
      interruptRipple: 0.0,
      prevVoiceState: stateRef.current.voiceState,
    };

    let lastTimestamp = performance.now();
    let frameId = 0;
    let disposed = false;

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const status = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (status === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    };

    const tick = (now = performance.now()) => {
      if (disposed) return;

      const rawDt = Math.min(0.05, Math.max(0.001, (now - lastTimestamp) / 1000));
      lastTimestamp = now;
      const dt = prefersReducedMotion ? rawDt * 0.25 : rawDt;

      const { voiceState: currentVoice, audioLevel: levelInput, isDark: darkNow } = stateRef.current;

      // Detect entering interrupting state for a silky organic fluid transition wave
      if (currentVoice === 'interrupting' && anim.prevVoiceState !== 'interrupting') {
        anim.interruptRipple = 1.0;
      }
      anim.prevVoiceState = currentVoice;
      anim.interruptRipple = THREE.MathUtils.damp(anim.interruptRipple, 0.0, 3.8, dt);

      const wallSec = now * 0.001;
      // Gentle natural breathing wave
      const breath = Math.sin(wallSec * 1.45) * 0.5 + 0.5;

      // Natural conversational speech envelope (calm phrase cadence, never harsh visualizer spikes)
      const speechSyllable =
        0.52 +
        0.24 * Math.sin(wallSec * 5.2) +
        0.16 * Math.sin(wallSec * 8.1 + 1.3) +
        0.08 * Math.cos(wallSec * 2.4);
      const listeningCadence =
        0.55 +
        0.25 * Math.sin(wallSec * 4.1 + 0.6) +
        0.2 * Math.cos(wallSec * 6.7);

      const clampedLevel = Math.min(1, Math.max(0, levelInput));

      // Compute target parameters per voice interaction state
      let targetSpeed = 0.62;
      let targetScale = 0.985 + breath * 0.032;
      let targetDistortion = 0.082;
      let targetFrequency = 1.48;
      let targetInward = 0.0;
      let targetEnergy = 0.16 + breath * 0.08;
      let targetBrightness = darkNow ? 1.02 : 1.0;
      let targetDesaturate = 0.0;
      let targetSpinY = 0.12;
      let targetSpinX = 0.04;

      switch (currentVoice) {
        case 'idle':
          targetSpeed = 0.56;
          targetScale = 0.98 + breath * 0.034;
          targetDistortion = 0.075 + breath * 0.014;
          targetFrequency = 1.42;
          targetInward = 0.0;
          targetEnergy = 0.16 + breath * 0.08;
          targetBrightness = darkNow ? 1.0 : 0.99;
          targetSpinY = 0.11;
          targetSpinX = 0.035;
          break;

        case 'listening': {
          const liveAmp = clampedLevel * listeningCadence;
          targetSpeed = 0.85 + liveAmp * 0.72;
          targetScale = 1.01 + liveAmp * 0.11;
          targetDistortion = 0.095 + liveAmp * 0.085;
          targetFrequency = 1.65 + liveAmp * 0.52;
          targetInward = 0.08;
          targetEnergy = 0.34 + liveAmp * 0.58;
          targetBrightness = (darkNow ? 1.06 : 1.03) + liveAmp * 0.18;
          targetSpinY = 0.16 + liveAmp * 0.12;
          targetSpinX = 0.06;
          break;
        }

        case 'thinking': {
          const thinkPulse = Math.sin(wallSec * 2.1) * 0.5 + 0.5;
          targetSpeed = 0.74;
          targetScale = 0.935 + thinkPulse * 0.035;
          targetDistortion = 0.09 + thinkPulse * 0.035;
          targetFrequency = 1.85;
          targetInward = 0.68;
          targetEnergy = 0.32 + thinkPulse * 0.24;
          targetBrightness = darkNow ? 1.03 : 1.0;
          targetSpinY = 0.34;
          targetSpinX = 0.12;
          break;
        }

        case 'speaking': {
          const speakAmp = Math.max(0.22, clampedLevel) * speechSyllable;
          targetSpeed = 0.96 + speakAmp * 0.65;
          targetScale = 1.015 + speakAmp * 0.115;
          targetDistortion = 0.105 + speakAmp * 0.09;
          targetFrequency = 1.56 + speakAmp * 0.36;
          targetInward = -0.18;
          targetEnergy = 0.44 + speakAmp * 0.56;
          targetBrightness = (darkNow ? 1.12 : 1.05) + speakAmp * 0.2;
          targetSpinY = 0.22 + speakAmp * 0.14;
          targetSpinX = 0.08;
          break;
        }

        case 'interrupting': {
          const ripple = anim.interruptRipple;
          targetSpeed = 1.25;
          targetScale = 0.97 + (1.0 - ripple) * 0.08;
          targetDistortion = 0.13 + ripple * 0.05;
          targetFrequency = 1.95;
          targetInward = 0.42 * ripple;
          targetEnergy = 0.52 + ripple * 0.3;
          targetBrightness = darkNow ? 1.14 : 1.06;
          targetSpinY = 0.28;
          targetSpinX = 0.09;
          break;
        }

        case 'disconnected':
          targetSpeed = 0.16;
          targetScale = 0.935 + breath * 0.01;
          targetDistortion = 0.036;
          targetFrequency = 1.15;
          targetInward = 0.0;
          targetEnergy = 0.03;
          targetBrightness = darkNow ? 0.64 : 0.88;
          targetDesaturate = 0.92;
          targetSpinY = 0.03;
          targetSpinX = 0.01;
          break;
      }

      // Exponentially damp every visual uniform for fluid, organic state transitions
      const smoothRate = currentVoice === 'interrupting' ? 6.5 : 3.2;
      anim.speed = THREE.MathUtils.damp(anim.speed, targetSpeed, 3.0, dt);
      anim.scale = THREE.MathUtils.damp(anim.scale, targetScale, smoothRate, dt);
      anim.distortion = THREE.MathUtils.damp(anim.distortion, targetDistortion, smoothRate, dt);
      anim.frequency = THREE.MathUtils.damp(anim.frequency, targetFrequency, 2.6, dt);
      anim.inwardPull = THREE.MathUtils.damp(anim.inwardPull, targetInward, 3.0, dt);
      anim.energy = THREE.MathUtils.damp(anim.energy, targetEnergy, smoothRate, dt);
      anim.brightness = THREE.MathUtils.damp(anim.brightness, targetBrightness, 3.0, dt);
      anim.desaturate = THREE.MathUtils.damp(anim.desaturate, targetDesaturate, 2.4, dt);
      anim.spinY = THREE.MathUtils.damp(anim.spinY, targetSpinY, 2.4, dt);
      anim.spinX = THREE.MathUtils.damp(anim.spinX, targetSpinX, 2.4, dt);
      anim.darkFactor = THREE.MathUtils.damp(anim.darkFactor, darkNow ? 1.0 : 0.0, 3.6, dt);

      anim.simTime += dt * anim.speed;

      // Theme & state palette choreography (consistent identity across dark & light modes)
      if (darkNow) {
        if (currentVoice === 'thinking') {
          _colorA.set('#1e1b4b');
          _colorB.set('#38bdf8');
          _colorC.set('#8b5cf6');
          _colorRim.set('#c4b5fd');
          _haloColorA.set('#6366f1');
          _haloColorB.set('#22d3ee');
        } else if (currentVoice === 'speaking') {
          _colorA.set('#0b3b66');
          _colorB.set('#22d3ee');
          _colorC.set('#7c3aed');
          _colorRim.set('#a5f3fc');
          _haloColorA.set('#22d3ee');
          _haloColorB.set('#818cf8');
        } else {
          _colorA.set('#0c3b5e');
          _colorB.set('#06b6d4');
          _colorC.set('#6366f1');
          _colorRim.set('#99f6e4');
          _haloColorA.set('#0ea5e9');
          _haloColorB.set('#7c3aed');
        }
      } else {
        if (currentVoice === 'thinking') {
          _colorA.set('#c7d2fe');
          _colorB.set('#7dd3fc');
          _colorC.set('#a78bfa');
          _colorRim.set('#eef2ff');
          _haloColorA.set('#a5b4fc');
          _haloColorB.set('#7dd3fc');
        } else if (currentVoice === 'speaking') {
          _colorA.set('#bae6fd');
          _colorB.set('#38bdf8');
          _colorC.set('#a78bfa');
          _colorRim.set('#f0f9ff');
          _haloColorA.set('#67e8f9');
          _haloColorB.set('#c4b5fd');
        } else {
          _colorA.set('#cfe8f7');
          _colorB.set('#5eead4');
          _colorC.set('#93c5fd');
          _colorRim.set('#f8fafc');
          _haloColorA.set('#7dd3fc');
          _haloColorB.set('#c4b5fd');
        }
      }

      const colorLerp = 1 - Math.exp(-3.2 * dt);
      coreUniforms.uColorA.value.lerp(_colorA, colorLerp);
      coreUniforms.uColorB.value.lerp(_colorB, colorLerp);
      coreUniforms.uColorC.value.lerp(_colorC, colorLerp);
      coreUniforms.uRimColor.value.lerp(_colorRim, colorLerp);
      veilUniforms.uColorB.value.lerp(_colorB, colorLerp);
      veilUniforms.uColorC.value.lerp(_colorC, colorLerp);
      haloUniforms.uHaloColorA.value.lerp(_haloColorA, colorLerp);
      haloUniforms.uHaloColorB.value.lerp(_haloColorB, colorLerp);
      floorUniforms.uHaloColorA.value.lerp(_haloColorA, colorLerp);

      // Update uniforms
      coreUniforms.uTime.value = anim.simTime;
      coreUniforms.uDistortion.value = anim.distortion;
      coreUniforms.uFrequency.value = anim.frequency;
      coreUniforms.uInwardPull.value = anim.inwardPull;
      coreUniforms.uEnergy.value = anim.energy;
      coreUniforms.uBrightness.value = anim.brightness;
      coreUniforms.uDesaturate.value = anim.desaturate;
      coreUniforms.uIsDark.value = anim.darkFactor;

      veilUniforms.uTime.value = anim.simTime * 1.08;
      veilUniforms.uDistortion.value = anim.distortion * 0.92;
      veilUniforms.uFrequency.value = anim.frequency * 1.1;
      veilUniforms.uEnergy.value = anim.energy;
      veilUniforms.uDesaturate.value = anim.desaturate;
      veilUniforms.uIsDark.value = anim.darkFactor;

      glassUniforms.uGlassTime.value = anim.simTime * 0.94;
      glassUniforms.uGlassDistortion.value = anim.distortion * 0.68;
      glassUniforms.uGlassFrequency.value = anim.frequency * 0.92;
      glassUniforms.uGlassInward.value = anim.inwardPull * 0.7;

      glassMat.envMapIntensity = THREE.MathUtils.lerp(1.05, 1.32, anim.darkFactor) + anim.energy * 0.25;
      glassMat.color.lerp(darkNow ? _colorRim : _colorRim, colorLerp * 0.4);
      glassMat.opacity = isSoftwareGl
        ? THREE.MathUtils.lerp(0.32, 0.4, anim.energy)
        : 0.96;

      haloUniforms.uTime.value = anim.simTime;
      haloUniforms.uEnergy.value = anim.energy;
      haloUniforms.uDesaturate.value = anim.desaturate;
      haloUniforms.uIsDark.value = anim.darkFactor;

      floorUniforms.uEnergy.value = anim.energy;
      floorUniforms.uDesaturate.value = anim.desaturate;
      floorUniforms.uIsDark.value = anim.darkFactor;

      // Subtle dynamic lighting response
      accentPointLight.intensity = (darkNow ? 1.8 : 1.1) + anim.energy * 1.9;
      accentPointLight.color.lerp(_colorB, colorLerp);
      accentPointLight.position.x = Math.sin(anim.simTime * 0.7) * 1.5;
      accentPointLight.position.y = 0.8 + Math.cos(anim.simTime * 0.55) * 0.6;

      // Organic transforms
      orbGroup.scale.setScalar(anim.scale);
      orbGroup.position.y = Math.sin(wallSec * 0.95) * 0.045;
      coreMesh.rotation.y += dt * anim.spinY;
      coreMesh.rotation.x += dt * anim.spinX;
      veilMesh.rotation.y -= dt * (anim.spinY * 1.35);
      veilMesh.rotation.z += dt * (anim.spinX * 1.15);
      glassMesh.rotation.y += dt * (anim.spinY * 0.55);

      const haloScale = 0.96 + anim.energy * 0.22 + breath * 0.04;
      haloMesh.scale.setScalar(haloScale);

      if (!contextLost) {
        renderer.render(scene, camera);
      }

      if (isSoftwareGl) {
        afterDraw(() => tick(performance.now()));
      } else {
        frameId = window.requestAnimationFrame(tick);
      }
    };

    frameId = window.requestAnimationFrame(tick);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(frameId);
      resizeObserver.disconnect();
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);

      coreGeo.dispose();
      coreMat.dispose();
      veilGeo.dispose();
      veilMat.dispose();
      glassGeo.dispose();
      glassMat.dispose();
      haloGeo.dispose();
      haloMat.dispose();
      floorGeo.dispose();
      floorMat.dispose();
      envTex.dispose();
      renderer.dispose();
      if (canvas.parentElement === mount) {
        mount.removeChild(canvas);
      }
    };
  }, []);

  if (webglUnavailable) {
    // Graceful static/CSS liquid-glass fallback if WebGL is disabled
    return (
      <button
        type="button"
        onClick={onOrbTap}
        aria-label="Jovibe Live companion orb"
        className={`relative flex items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 cursor-pointer ${className}`}
      >
        <div
          className={`h-52 w-52 sm:h-64 sm:w-64 rounded-full transition-transform duration-500 ${
            voiceState === 'disconnected'
              ? 'bg-gradient-to-br from-zinc-400/30 via-zinc-500/20 to-zinc-700/30 scale-95'
              : isDark
              ? 'bg-gradient-to-br from-cyan-400/75 via-sky-500/65 to-violet-600/75 shadow-[0_0_90px_rgba(56,189,248,0.35)]'
              : 'bg-gradient-to-br from-sky-200 via-cyan-300/80 to-indigo-300/85 shadow-[0_20px_70px_rgba(56,189,248,0.28)]'
          }`}
        />
      </button>
    );
  }

  return (
    <div
      className={`relative select-none ${className}`}
      onClick={onOrbTap}
      role={onOrbTap ? 'button' : undefined}
      tabIndex={onOrbTap ? 0 : undefined}
      aria-label={
        voiceState === 'speaking'
          ? 'Jovibe Live orb — tap to interrupt and speak'
          : 'Jovibe Live companion orb'
      }
      onKeyDown={(e) => {
        if (onOrbTap && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOrbTap();
        }
      }}
    >
      <div
        ref={containerRef}
        className={`h-full w-full ${onOrbTap ? 'cursor-pointer' : ''}`}
      />
    </div>
  );
};
