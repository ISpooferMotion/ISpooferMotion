import { Button, Spinner } from '@codycon/ism-library';
import { invoke } from '@tauri-apps/api/core';
import { AnimatePresence, motion } from 'framer-motion';
import { Clapperboard, Pause, Play, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

import { useConfig } from '../contexts/ConfigContext';
import { cn } from '../utils/cn';
import {
  parseAnimationXml,
  type RobloxAnimationClip,
  type RobloxPose,
} from '../utils/robloxAnimParser';
import { detectRigType, getBones, type RigBone, type RigType } from '../utils/robloxRig';

interface AnimationPreviewProps {
  assetId: string;
  assetName?: string;
  onClose: () => void;
}

function disposeMaterial(material: THREE.Material) {
  // make sure we don't leak memory when the preview modal closes
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) {
      value.dispose();
    }
  }
  material.dispose();
}

function disposeObject3D(root: THREE.Object3D) {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry?.dispose();
    const { material } = child;
    if (Array.isArray(material)) {
      material.forEach(disposeMaterial);
    } else if (material) {
      disposeMaterial(material);
    }
  });
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

// trying to accurately mimic roblox's internal easing styles
// not perfect but gets the job done for the previewer
function applyEasing(t: number, style: number, dir: number): number {
  t = Math.max(0, Math.min(1, t));
  const ease = (fn: (x: number) => number) => {
    if (dir === 0) return fn(t);
    if (dir === 1) return 1 - fn(1 - t);
    return t < 0.5 ? fn(t * 2) / 2 : 1 - fn((1 - t) * 2) / 2;
  };
  switch (style) {
    case 1:
      return t < 1 ? 0 : 1;
    case 3:
      return ease((x) => x * x * x);
    case 6:
      return ease((x) => x * x);
    default:
      return t;
  }
}

function flattenPoses(poses: RobloxPose[]): Map<string, RobloxPose> {
  // flattens the nested pose tree into a map so we can look up bones instantly by name
  // much faster than traversing the tree every single frame
  const map = new Map<string, RobloxPose>();
  const walk = (list: RobloxPose[]) => {
    for (const p of list) {
      map.set(p.name, p);
      walk(p.children);
    }
  };
  walk(poses);
  return map;
}

// hoist three.js math objects to prevent garbage collection thrashing in the hot render loop
const _tempMat1 = new THREE.Matrix4();
const _tempMat2 = new THREE.Matrix4();
const _transformMat = new THREE.Matrix4();
const _tempPos = new THREE.Vector3();
const _tempScale = new THREE.Vector3(1, 1, 1);
const _qA = new THREE.Quaternion();
const _qB = new THREE.Quaternion();
const _c0Mat = new THREE.Matrix4();
const _c1Mat = new THREE.Matrix4();

const cframeToMatrix4InPlace = (cf: number[], target: THREE.Matrix4) =>
  target.set(
    cf[3],
    cf[4],
    cf[5],
    cf[0],
    cf[6],
    cf[7],
    cf[8],
    cf[1],
    cf[9],
    cf[10],
    cf[11],
    cf[2],
    0,
    0,
    0,
    1,
  );

const toMat4InPlace = (r: number[], target: THREE.Matrix4) =>
  target.set(r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, 0, 0, 0, 1);

export default function AnimationPreview({ assetId, assetName, onClose }: AnimationPreviewProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const { config } = useConfig();
  const cookie = config.spoofing.cookie || undefined;

  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [detectedRig, setDetectedRig] = useState<RigType>('R15');
  const [rigOverride, setRigOverride] = useState<RigType | null>(null);
  const rigType: RigType = rigOverride ?? detectedRig;
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [duration, setDuration] = useState(0);
  const [kfCount, setKfCount] = useState(0);
  const [keyframeTimes, setKeyframeTimes] = useState<number[]>([]);

  const timeDisplayRef = useRef<HTMLSpanElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const scrubBarRef = useRef<HTMLDivElement>(null);
  const isScrubbing = useRef(false);

  const clipRef = useRef<RobloxAnimationClip | null>(null);
  const playingRef = useRef(true);
  const speedRef = useRef(1);
  const currentTimeRef = useRef(0);
  const rigBonesRef = useRef<RigBone[]>([]);
  const boneObjectsRef = useRef<Map<string, THREE.Object3D>>(new Map());
  const rafRef = useRef(0);
  const durationRef = useRef(0);
  const flattenedPoseCacheRef = useRef<WeakMap<RobloxPose[], Map<string, RobloxPose>>>(
    new WeakMap(),
  );

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');

    (async () => {
      try {
        let activeCookie = cookie;
        // if they don't have a cookie set in config, try to auto-detect one as a fallback
        // we need this to view private animations
        if (!activeCookie) {
          try {
            const detected = await invoke('get_cookie_from_auto_detect', {
              userId: null,
            });
            if (detected && typeof detected === 'string') {
              activeCookie = detected;
            }
          } catch (e) {
            console.warn('Failed to auto-detect cookie', e);
          }
        }

        const xml = await invoke<string | null>('fetch_animation_xml', {
          assetId,
          cookie: activeCookie ?? null,
        });
        if (cancelled) return;

        if (!xml) {
          setErrorMsg(
            activeCookie
              ? 'Could not load this animation. It might be deleted or unsupported.'
              : 'Private animation. Please add your cookie in the Spoofing config to view this.',
          );
          setStatus('error');
          return;
        }

        const parsed = parseAnimationXml(xml);
        if (cancelled) return;

        if (!parsed || parsed.keyframes.length === 0) {
          setErrorMsg('Could not parse animation keyframes. The format may be unsupported.');
          setStatus('error');
          return;
        }

        const allPoseNames = new Set<string>();
        for (const kf of parsed.keyframes) {
          const walkPoses = (ps: RobloxPose[]) => {
            for (const p of ps) {
              allPoseNames.add(p.name);
              walkPoses(p.children);
            }
          };
          walkPoses(kf.poses);
        }

        const uniqueTimes = new Set<number>();
        for (const kf of parsed.keyframes) uniqueTimes.add(kf.time);
        setKeyframeTimes(Array.from(uniqueTimes).sort((a, b) => a - b));

        // try to figure out if this is R6 or R15 based on the bone names present
        const rig = detectRigType(allPoseNames);
        setDetectedRig(rig);

        flattenedPoseCacheRef.current = new WeakMap();
        clipRef.current = parsed;
        durationRef.current = parsed.duration;

        setDuration(parsed.duration);
        setKfCount(parsed.keyframes.length);
        setStatus('ready');
      } catch (e) {
        if (!cancelled) {
          setErrorMsg(String(e));
          setStatus('error');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [assetId, cookie]);

  const getFlattenedPoses = useCallback((poses: RobloxPose[]) => {
    const cached = flattenedPoseCacheRef.current.get(poses);
    if (cached) return cached;

    const flattened = flattenPoses(poses);
    flattenedPoseCacheRef.current.set(poses, flattened);
    return flattened;
  }, []);

  const applyAnimation = useCallback(
    (t: number) => {
      const c = clipRef.current;
      if (!c || c.keyframes.length === 0) return;

      const dur = c.duration;
      if (dur <= 0) return;
      const wt = ((t % dur) + dur) % dur;

      const kfs = c.keyframes;
      let kfA = kfs[0],
        kfB = kfs[0];

      // find which two keyframes we are currently sitting between
      for (let i = 0; i < kfs.length - 1; i++) {
        if (kfs[i].time <= wt && kfs[i + 1].time >= wt) {
          kfA = kfs[i];
          kfB = kfs[i + 1];
          break;
        }
      }

      const span = kfB.time - kfA.time;
      const raw = span > 0 ? (wt - kfA.time) / span : 0;
      const posesA = getFlattenedPoses(kfA.poses);
      const posesB = getFlattenedPoses(kfB.poses);

      for (const bone of rigBonesRef.current) {
        const obj = boneObjectsRef.current.get(bone.name);
        if (!obj) continue;
        const pa = posesA.get(bone.name);
        const pb = posesB.get(bone.name);

        _transformMat.identity();

        if (pa && pb) {
          // both keyframes have this bone, so we interpolate between them
          const pose = pa || pb!;
          const alpha = applyEasing(raw, pose.easingStyle, pose.easingDirection);
          _tempPos.set(
            lerp(pa.position[0], pb.position[0], alpha),
            lerp(pa.position[1], pb.position[1], alpha),
            lerp(pa.position[2], pb.position[2], alpha),
          );
          toMat4InPlace(pa.rotation, _tempMat1);
          _qA.setFromRotationMatrix(_tempMat1);
          toMat4InPlace(pb.rotation, _tempMat2);
          _qB.setFromRotationMatrix(_tempMat2);
          _qA.slerp(_qB, alpha);
          _transformMat.compose(_tempPos, _qA, _tempScale);
        } else if (pa || pb) {
          const p = pa || pb!;
          _tempPos.set(p.position[0], p.position[1], p.position[2]);
          toMat4InPlace(p.rotation, _tempMat1);
          _qA.setFromRotationMatrix(_tempMat1);
          _transformMat.compose(_tempPos, _qA, _tempScale);
        }

        cframeToMatrix4InPlace(bone.c0, _c0Mat);
        cframeToMatrix4InPlace(bone.c1, _c1Mat);
        _c1Mat.invert();
        _c0Mat.multiply(_transformMat).multiply(_c1Mat);

        obj.matrix.copy(_c0Mat);
      }
    },
    [getFlattenedPoses],
  );

  useEffect(() => {
    if (status !== 'ready' || !mountRef.current) return;

    let cancelled = false;

    const container = mountRef.current;
    const W = container.clientWidth || 560;
    const H = container.clientHeight || 340;

    // basic three.js setup
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    const grid = new THREE.GridHelper(16, 16, 0x333333, 0x222222);
    grid.position.y = -3.0;
    scene.add(grid);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(50, 50),
      new THREE.ShadowMaterial({ opacity: 0.4 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -3.0;
    floor.receiveShadow = true;
    scene.add(floor);

    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 200);

    camera.position.set(0, 2.5, -12);
    camera.lookAt(0, 2.5, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 2.5, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 4;
    controls.maxDistance = 30;
    controls.update();

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 10, 7);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 50;
    dirLight.shadow.camera.left = -10;
    dirLight.shadow.camera.right = 10;
    dirLight.shadow.camera.top = 10;
    dirLight.shadow.camera.bottom = -10;
    dirLight.shadow.bias = -0.001;
    scene.add(dirLight);

    const backLight = new THREE.DirectionalLight(0xffffff, 0.3);
    backLight.position.set(-5, 5, -7);
    scene.add(backLight);

    const bones = getBones(rigType);
    rigBonesRef.current = bones;
    const objects = new Map<string, THREE.Object3D>();
    boneObjectsRef.current = objects;

    for (const bone of bones) {
      const obj = new THREE.Object3D();
      obj.name = bone.name;
      obj.matrixAutoUpdate = false;

      cframeToMatrix4InPlace(bone.c0, _c0Mat);
      cframeToMatrix4InPlace(bone.c1, _c1Mat);
      obj.matrix.copy(_c0Mat.multiply(_c1Mat.invert()));

      objects.set(bone.name, obj);
    }

    const materials = {
      Head: new THREE.MeshStandardMaterial({ color: 0xe3c16f, roughness: 0.6 }),
      Torso: new THREE.MeshStandardMaterial({
        color: 0x0d69ac,
        roughness: 0.6,
      }),
      Arm: new THREE.MeshStandardMaterial({ color: 0xfcc734, roughness: 0.6 }),
      Leg: new THREE.MeshStandardMaterial({ color: 0x4b974b, roughness: 0.6 }),
      Default: new THREE.MeshStandardMaterial({
        color: 0xa3a3a3,
        roughness: 0.6,
      }),
    };

    const getMaterialForBone = (boneName: string) => {
      if (boneName.includes('Head')) return materials.Head;
      if (boneName.includes('Torso')) return materials.Torso;
      if (boneName.includes('Arm') || boneName.includes('Hand')) return materials.Arm;
      if (boneName.includes('Leg') || boneName.includes('Foot')) return materials.Leg;
      return materials.Default;
    };

    for (const bone of bones) {
      const obj = objects.get(bone.name)!;
      if (bone.parent) {
        objects.get(bone.parent)?.add(obj);
      } else {
        scene.add(obj);
      }

      if (bone.name !== 'HumanoidRootPart') {
        const mat = getMaterialForBone(bone.name);

        if (bone.name === 'Head') {
          // load the actual head obj model so it doesn't just look like a generic block
          const headFile = rigType === 'R6' ? '/headr6.obj' : '/headr15.obj';
          const loader = new OBJLoader();
          loader.load(headFile, (loadedObj) => {
            if (cancelled || !mountRef.current) {
              disposeObject3D(loadedObj);
              return;
            }

            const tempBox = new THREE.Box3().setFromObject(loadedObj);
            const headSize = new THREE.Vector3();
            tempBox.getSize(headSize);
            const headCenter = new THREE.Vector3();
            tempBox.getCenter(headCenter);

            loadedObj.traverse((child) => {
              if ((child as THREE.Mesh).isMesh) {
                const m = child as THREE.Mesh;
                m.geometry.computeBoundingBox();
                const box = m.geometry.boundingBox;
                if (box) {
                  const center = new THREE.Vector3();
                  box.getCenter(center);
                  m.geometry.translate(-center.x, -center.y, -center.z);
                  m.material = mat;
                  m.castShadow = true;
                  m.receiveShadow = true;
                }
              }
            });

            obj.add(loadedObj);

            const faceSize = Math.min(headSize.x, headSize.y) * 0.85;
            const faceGeo = new THREE.PlaneGeometry(faceSize, faceSize);
            const faceTex = new THREE.TextureLoader().load('/face.png');
            faceTex.colorSpace = THREE.SRGBColorSpace;
            const faceMat = new THREE.MeshBasicMaterial({
              map: faceTex,
              transparent: true,
              depthWrite: false,
              side: THREE.DoubleSide,
              polygonOffset: true,
              polygonOffsetFactor: -1,
            });
            const faceMesh = new THREE.Mesh(faceGeo, faceMat);

            faceMesh.position.set(0, 0, -(headSize.z / 2) - 0.005);
            obj.add(faceMesh);
          });
        } else {
          // fallback for other body parts, just use a nice rounded box
          const boxGeo = new RoundedBoxGeometry(bone.size[0], bone.size[1], bone.size[2], 2, 0.1);
          const mesh = new THREE.Mesh(boxGeo, mat);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          obj.add(mesh);
        }
      }
    }

    const timer = new THREE.Timer();
    let resizeFrame = 0;

    const ro = new ResizeObserver(() => {
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = 0;
        if (cancelled || !mountRef.current) return;
        const W2 = mountRef.current.clientWidth;
        const H2 = mountRef.current.clientHeight;
        if (W2 === 0 || H2 === 0) return;
        renderer.setSize(W2, H2);
        camera.aspect = W2 / H2;
        camera.updateProjectionMatrix();
      });
    });
    ro.observe(container);

    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      timer.update();
      const accumulatedTime = timer.getDelta();

      if (!isScrubbing.current && playingRef.current) {
        currentTimeRef.current += accumulatedTime * speedRef.current;
      }

      applyAnimation(currentTimeRef.current);
      controls.update();
      renderer.render(scene, camera);

      const dur = durationRef.current;
      if (dur > 0) {
        const wt = ((currentTimeRef.current % dur) + dur) % dur;
        const pct = (wt / dur) * 100;
        if (progressBarRef.current) progressBarRef.current.style.width = `${pct}%`;
        if (timeDisplayRef.current)
          timeDisplayRef.current.textContent = `${wt.toFixed(2)}s / ${dur.toFixed(2)}s`;
      }
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelled = true;
      ro.disconnect();
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
      cancelAnimationFrame(rafRef.current);
      disposeObject3D(scene);
      Object.values(materials).forEach(disposeMaterial);
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      floor.geometry.dispose();
      floor.material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      controls.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, [status, rigType]);

  const speedOptions = [0.25, 0.5, 1, 2] as const;

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onClose}
      className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-md flex items-center justify-center p-6 pointer-events-auto"
    >
      <motion.div
        initial={{ scale: 0.95, y: 12, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.95, y: 12, opacity: 0 }}
        transition={{ type: 'spring', damping: 30, stiffness: 350 }}
        onClick={(e) => e.stopPropagation()}
        className="relative flex flex-col bg-bg-surface border border-border-subtle rounded-[var(--radius-lg)] shadow-floating overflow-hidden"
        style={{
          width: 600,
          maxWidth: 'calc(100vw - 48px)',
          height: 500,
          maxHeight: 'calc(100vh - 48px)',
        }}
      >
        {}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle bg-bg-elevated shrink-0">
          <Clapperboard size={15} className="text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-text-primary truncate">
              {assetName || 'Animation'}
              <span className="ml-2 text-[11px] font-mono text-text-muted">#{assetId}</span>
            </p>
            {status === 'ready' && (
              <div className="flex items-center gap-2 mt-0.5">
                <button
                  onClick={() =>
                    setRigOverride((r) => {
                      if (!r) return detectedRig === 'R15' ? 'R6' : 'R15';
                      return r === 'R15' ? 'R6' : 'R15';
                    })
                  }
                  className="px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase border border-border-subtle hover:border-primary hover:text-primary transition-colors text-text-muted"
                  title="Toggle Rig Type"
                >
                  {rigType}
                </button>
                <p className="text-[10px] text-text-muted">{kfCount} keyframes</p>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-base rounded-[var(--radius-md)] transition-colors shrink-0"
          >
            <X size={15} />
          </button>
        </div>

        {}
        <div className="relative flex-1 overflow-hidden bg-bg-base">
          <div ref={mountRef} className="w-full h-full" />

          <AnimatePresence>
            {status === 'loading' && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bg-base"
              >
                <Spinner size="lg" />
                <p className="text-[13px] text-text-muted font-medium">Fetching animation…</p>
              </motion.div>
            )}

            {status === 'error' && (
              <motion.div
                key="error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 bg-bg-base"
              >
                <p className="text-[12px] text-text-muted text-center max-w-[320px] leading-relaxed">
                  {errorMsg}
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {status === 'ready' && (
            <>
              <p className="absolute bottom-3 right-3 text-[10px] text-text-muted opacity-40 select-none pointer-events-none">
                Drag to orbit · Scroll to zoom
              </p>
            </>
          )}
        </div>

        {}
        {status === 'ready' && (
          <div className="shrink-0 px-4 py-3 bg-bg-elevated border-t border-border-subtle flex flex-col gap-2.5">
            {}
            <div
              className="relative w-full h-1.5 bg-bg-base rounded-full cursor-pointer select-none"
              ref={scrubBarRef}
              onPointerDown={(e) => {
                // drag timeline to scrub through animation manually
                isScrubbing.current = true;
                e.currentTarget.setPointerCapture(e.pointerId);
                const rect = e.currentTarget.getBoundingClientRect();
                const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                currentTimeRef.current = pct * durationRef.current;
              }}
              onPointerMove={(e) => {
                if (!isScrubbing.current) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                currentTimeRef.current = pct * durationRef.current;
              }}
              onPointerUp={(e) => {
                isScrubbing.current = false;
                e.currentTarget.releasePointerCapture(e.pointerId);
              }}
            >
              {}
              {duration > 0 &&
                keyframeTimes.map((t, i) => (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 w-[1px] bg-border-subtle/40 z-0 pointer-events-none"
                    style={{ left: `${(t / duration) * 100}%` }}
                  />
                ))}
              {}
              <div
                ref={progressBarRef}
                className="absolute top-0 left-0 bottom-0 bg-primary rounded-full z-10 pointer-events-none"
                style={{ width: '0%', transition: 'none' }}
              />
            </div>

            {}
            <div className="flex items-center gap-2">
              <Button
                isIconOnly
                size="sm"
                variant="flat"
                className="h-7 w-7 min-w-7"
                onClick={() => setPlaying((p) => !p)}
              >
                {playing ? <Pause size={13} /> : <Play size={13} fill="currentColor" />}
              </Button>

              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                className="h-7 w-7 min-w-7"
                onClick={() => {
                  currentTimeRef.current = 0;
                }}
              >
                <RotateCcw size={12} />
              </Button>

              {}
              <span ref={timeDisplayRef} className="text-[11px] font-mono text-text-muted ml-1">
                0.00s / {duration.toFixed(2)}s
              </span>

              <div className="ml-auto flex items-center gap-1">
                <span className="text-[10px] text-text-muted mr-1 uppercase tracking-wide">
                  Speed
                </span>
                {speedOptions.map((s) => (
                  <button
                    key={s}
                    onClick={() => setSpeed(s)}
                    className={cn(
                      'px-2 py-0.5 rounded text-[11px] font-semibold transition-colors',
                      speed === s
                        ? 'bg-primary text-white'
                        : 'text-text-muted hover:text-text-primary hover:bg-bg-base',
                    )}
                  >
                    {s}×
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>,
    document.body,
  );
}
