# Phase 2 PRD: Real-Time Webcam Expression Tracking for MiiTuber

**Author:** Mohammed (with AI assistance)
**Date:** June 2026
**Status:** Draft
**Phase:** 2 of N

---

## 1. Product Summary and Goals

MiiTuber is a local desktop VTuber app that lets users animate a Mii avatar using their webcam. Phase 1 delivered static avatar rendering: import an `.ffsd` file, fetch a PNG from the local FFL renderer, display it. Phase 2 brings the avatar to life.

**Goals for Phase 2:**

1. Capture the user's face via webcam in real-time (all processing stays local).
2. Track facial expressions and head pose using MediaPipe Face Landmarker (runs in the browser, no server round-trips).
3. Render the Mii as a 3D glTF model in Three.js, swapping expression variants to match the user's face.
4. Rotate the 3D head to follow the user's head pose (pitch, yaw, roll).
5. Hit a smooth 60fps render loop with expression updates at webcam framerate (~30fps).

**Non-goals for Phase 2:** lip-sync to audio, body tracking, multi-avatar, streaming integration. See Section 9.

---

## 2. User Stories and User Flow

### User Stories

| # | As a... | I want to... | So that... |
|---|---------|-------------|------------|
| 1 | User | Start webcam tracking with one click | My Mii avatar starts mirroring my face |
| 2 | User | See my Mii smile when I smile | The avatar feels alive and responsive |
| 3 | User | Tilt my head and see the Mii follow | Head tracking makes it feel natural |
| 4 | User | Stop tracking and return to static mode | I can pause without closing the app |
| 5 | User | Know my webcam feed stays local | I feel safe using the app |

### User Flow

```
1. User launches MiiTuber (Tauri app).
2. User imports an .ffsd avatar file (Phase 1 flow, already done).
3. App fetches the .glb model from localhost:5000 with all expression variants.
4. Three.js scene loads and renders the Mii in 3D (static, expression 0).
5. User clicks "Start Tracking" button.
6. Browser requests webcam permission (navigator.mediaDevices.getUserMedia).
7. MediaPipe Face Landmarker initializes and begins processing frames.
8. Each frame: landmarks + blendshapes → expression mapper → Three.js material swap.
9. The Mii's expression and head rotation update in real-time.
10. User clicks "Stop Tracking" — webcam stream stops, avatar returns to neutral.
```

---

## 3. Technical Architecture

### System Diagram

```
+------------------------------------------------------------------+
|  Tauri Webview (Browser Context)                                  |
|                                                                   |
|  +-------------+     +---------------------+     +--------------+ |
|  |   Webcam    |---->| MediaPipe Face      |---->| Expression   | |
|  | getUserMedia |     | Landmarker (WASM)   |     | Mapper       | |
|  |  ~30fps     |     | - 52 blendshapes    |     | (TS module)  | |
|  +-------------+     | - 468 landmarks     |     +------+-------+ |
|                       | - face transform    |            |         |
|                       +---------------------+            v         |
|                                                  +--------------+  |
|  +--------------+                                | Three.js     |  |
|  | Tauri Rust   |                                | Scene        |  |
|  | Backend      |                                | - GLTFLoader |  |
|  | (commands)   |                                | - Material   |  |
|  +--------------+                                |   variant    |  |
|        |                                         |   swapping   |  |
|        | invoke("get_avatar_data")               | - Head rotate|  |
|        v                                         | - 60fps loop |  |
|  +--------------+                                +--------------+  |
|  | FFL Renderer |                                       |          |
|  | localhost    |-----> .glb with KHR_materials_variants|          |
|  | :5000        |       (all 19 expressions baked in)   |          |
|  +--------------+                                       v          |
|                                                  +--------------+  |
|                                                  | <canvas>     |  |
|                                                  | (user sees   |  |
|                                                  |  animated    |  |
|                                                  |  Mii here)   |  |
|                                                  +--------------+  |
+------------------------------------------------------------------+
```

### Data Flow Per Frame

```
Webcam frame (30fps)
  │
  ▼
MediaPipe Face Landmarker
  │
  ├─► 52 blendshape coefficients (0.0 - 1.0 each)
  ├─► facialTransformationMatrixes (4x4 matrix → pitch/yaw/roll)
  │
  ▼
Expression Mapper (pure function, no side effects)
  │
  ├─► expressionIndex: number (0-18)
  ├─► headRotation: { pitch: number, yaw: number, roll: number }
  │
  ▼
Three.js Scene (60fps render loop)
  │
  ├─► Swap active material variant on mask primitive
  ├─► Apply smoothed head rotation to model node
  │
  ▼
Canvas output (user sees animated Mii)
```

### Key Architectural Decisions

1. **MediaPipe runs in the webview, not Rust.** It uses WASM+WebGL internally and needs canvas/video element access. Shipping it through Tauri's Rust layer would add complexity for no benefit.

2. **Three.js renders the 3D model, not the FFL renderer.** The renderer exports a static `.glb`. All real-time animation (expression swapping, head rotation) happens client-side in Three.js. We do NOT call the renderer every frame.

3. **Expression switching uses material variants, not morph targets.** FFL bakes each expression as a different face-mask texture. We swap materials, not blend vertex positions. This means expressions are discrete (no blending between "half smile"), but it matches how Miis actually work on Nintendo hardware.

4. **One `.glb` fetch per session.** We request all needed expressions in a single `.glb` call at startup. No per-frame network requests.

---

## 4. Implementation Phases (Milestones)

Break the work into small, testable increments. Each milestone produces something you can see working.

### Milestone 1: Three.js Scene with Static glTF Model
**Goal:** Replace the Phase 1 static PNG with a 3D model you can orbit around.

- Fetch `.glb` from `localhost:5000/miis/image.glb?data=<hex>&expression=0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18`
- Load it with Three.js GLTFLoader
- Set up PerspectiveCamera, WebGLRenderer, ambient + directional lights
- Render the model with expression 0 (normal)
- Add orbit controls for debugging (remove later or keep as optional)
- **Testable:** You see a 3D Mii head in the app that you can rotate with your mouse.

### Milestone 2: Manual Expression Switching
**Goal:** Prove material variant swapping works before adding the webcam.

- Add a dropdown or button row for all 19 expressions
- On selection, swap the active material variant on the mask mesh
- **Testable:** Click "smile" and the Mii smiles. Click "surprise" and the Mii looks surprised.

### Milestone 3: Webcam + MediaPipe Setup
**Goal:** Get face tracking data flowing, displayed as debug output.

- Request webcam via `getUserMedia({ video: true })`
- Initialize MediaPipe Face Landmarker with `runningMode: "VIDEO"`
- Process frames in a loop, log blendshape values to a debug overlay
- Show a small webcam preview (for development only, hidden in production)
- **Testable:** You see your blendshape values changing as you make faces.

### Milestone 4: Expression Mapping
**Goal:** MediaPipe output drives the Mii's expression.

- Implement the `mapBlendshapesToExpression()` function (see Section 5.3)
- Wire it into the frame loop: MediaPipe output → mapper → variant swap
- Add hysteresis/smoothing to prevent flickering
- **Testable:** Smile at the camera and the Mii smiles back.

### Milestone 5: Head Tracking
**Goal:** The Mii's head follows yours.

- Extract pitch/yaw/roll from `facialTransformationMatrixes`
- Apply rotation to the Three.js model node with smoothing (lerp)
- Clamp rotation to reasonable ranges (e.g., +/-30 degrees)
- **Testable:** Tilt your head and the Mii tilts too.

### Milestone 6: Polish and UI
**Goal:** Production-quality user experience.

- Add Start/Stop Tracking button
- Remove debug overlays (or gate behind a dev flag)
- Handle edge cases: no camera, permission denied, face lost
- Green-screen / transparent background option for streaming
- Performance profiling and optimization pass
- **Testable:** Complete user flow works end to end.

---

## 5. Detailed Component Requirements

### 5.1 Three.js Scene Setup

**File:** `src/lib/scene.ts` (or similar)

The scene needs:

```typescript
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Scene basics
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });

// Lighting — match what looks good for Mii models
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(0, 1, 2);
scene.add(ambientLight, directionalLight);

// Camera position — Mii heads are roughly 1 unit tall, centered at origin
camera.position.set(0, 0, 2);
camera.lookAt(0, 0, 0);
```

**Loading the glTF and extracting variants:**

```typescript
const loader = new GLTFLoader();
const gltf = await loader.loadAsync(glbUrl);

scene.add(gltf.scene);

// The KHR_materials_variants extension stores variant info
// Three.js GLTFLoader parses this into gltf.userData.variants
// and provides functions to select them.

// Store variant mapping for later use
const variants: Map<number, string> = new Map();
// variants will be: 0 → "Expression_0", 1 → "Expression_1", etc.

// The GLTFLoader provides a selectVariant function via the extension
// See: https://threejs.org/examples/#webgl_loader_gltf_variants
```

**Important:** The `KHR_materials_variants` support in Three.js GLTFLoader requires using the extension's `selectVariant` utility. Reference the Three.js glTF variants example for the exact API. The mii-creator project at `C:\Users\thedr\OneDrive\Desktop\Coding Projects\mii-creator\src\class\3DScene.ts` already does this pattern.

**Render loop:**

```typescript
function animate() {
  requestAnimationFrame(animate);
  // Apply any pending expression/rotation updates
  renderer.render(scene, camera);
}
animate();
```

### 5.2 MediaPipe Face Landmarker Setup

**File:** `src/lib/faceTracker.ts`

```typescript
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

async function initFaceTracker(): Promise<FaceLandmarker> {
  const filesetResolver = await FilesetResolver.forVisionTasks(
    // Use CDN or bundle locally
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
  );

  const faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      delegate: "GPU"   // Use WebGL delegate for performance
    },
    runningMode: "VIDEO",
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
    numFaces: 1          // We only track one face
  });

  return faceLandmarker;
}
```

**Frame processing loop:**

```typescript
const video = document.createElement('video');
const stream = await navigator.mediaDevices.getUserMedia({
  video: { width: 640, height: 480, facingMode: "user" }
});
video.srcObject = stream;
await video.play();

function processFrame() {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    const results = faceLandmarker.detectForVideo(video, performance.now());

    if (results.faceBlendshapes && results.faceBlendshapes.length > 0) {
      const blendshapes = results.faceBlendshapes[0].categories;
      const matrix = results.facialTransformationMatrixes?.[0]?.data;

      // Pass to expression mapper
      const { expressionIndex, headRotation } = mapToExpression(blendshapes, matrix);

      // Update Three.js scene
      setExpression(expressionIndex);
      setHeadRotation(headRotation);
    }
  }
  requestAnimationFrame(processFrame);
}
processFrame();
```

**Performance note:** `detectForVideo` with GPU delegate typically runs in 5-15ms per frame on modern hardware. Combined with the Three.js render pass (~2-5ms), we have plenty of headroom for 30fps tracking + 60fps rendering.

### 5.3 Expression Mapper

**File:** `src/lib/expressionMapper.ts`

This is the core logic that converts raw MediaPipe blendshapes into an FFL expression index. It must be a pure function with no side effects, making it easy to test.

```typescript
/** FFL expression indices */
export enum FFLExpression {
  Normal           = 0,
  Smile            = 1,
  Anger            = 2,
  Sorrow           = 3,
  Surprise         = 4,
  Blink            = 5,
  OpenMouth        = 6,
  Happy            = 7,   // smile + open mouth
  AngerOpenMouth   = 8,
  SorrowOpenMouth  = 9,
  SurpriseOpenMouth= 10,
  BlinkOpenMouth   = 11,
  WinkLeft         = 12,
  WinkRight        = 13,
  WinkLeftOpenMouth  = 14,
  WinkRightOpenMouth = 15,
  Like             = 16,
  LikeWinkRight    = 17,
  Frustrated       = 18,
}

export interface HeadRotation {
  pitch: number;  // nodding (look up/down), degrees
  yaw: number;    // turning (look left/right), degrees
  roll: number;   // tilting (ear to shoulder), degrees
}

export interface ExpressionResult {
  expressionIndex: number;
  headRotation: HeadRotation;
}

/**
 * Maps MediaPipe blendshape scores to an FFL expression index.
 *
 * Strategy: Check conditions in priority order. More specific/compound
 * expressions take priority over simpler ones.
 */
export function mapToExpression(
  blendshapes: { categoryName: string; score: number }[],
  transformMatrix?: Float32Array
): ExpressionResult {
  // Build a lookup map for quick access
  const bs = new Map<string, number>();
  for (const { categoryName, score } of blendshapes) {
    bs.set(categoryName, score);
  }

  // Helper
  const get = (name: string): number => bs.get(name) ?? 0;

  // --- Detect individual conditions ---
  const mouthOpen    = get("jawOpen") > 0.4;
  const smiling      = (get("mouthSmileLeft") + get("mouthSmileRight")) / 2 > 0.5;
  const bothEyesBlink = get("eyeBlinkLeft") > 0.6 && get("eyeBlinkRight") > 0.6;
  const leftWink     = get("eyeBlinkLeft") > 0.6 && get("eyeBlinkRight") < 0.3;
  const rightWink    = get("eyeBlinkRight") > 0.6 && get("eyeBlinkLeft") < 0.3;
  const angry        = (get("browDownLeft") + get("browDownRight")) / 2 > 0.5;
  const sad          = get("browInnerUp") > 0.5 && !angry;
  const surprised    = (get("eyeWideLeft") + get("eyeWideRight")) / 2 > 0.5;

  // --- Pick expression (priority order, most specific first) ---
  let expression = FFLExpression.Normal;

  if (bothEyesBlink && mouthOpen)        expression = FFLExpression.BlinkOpenMouth;
  else if (bothEyesBlink)                expression = FFLExpression.Blink;
  else if (leftWink && mouthOpen)        expression = FFLExpression.WinkLeftOpenMouth;
  else if (rightWink && mouthOpen)       expression = FFLExpression.WinkRightOpenMouth;
  else if (leftWink)                     expression = FFLExpression.WinkLeft;
  else if (rightWink)                    expression = FFLExpression.WinkRight;
  else if (surprised && mouthOpen)       expression = FFLExpression.SurpriseOpenMouth;
  else if (surprised)                    expression = FFLExpression.Surprise;
  else if (angry && mouthOpen)           expression = FFLExpression.AngerOpenMouth;
  else if (angry)                        expression = FFLExpression.Anger;
  else if (sad && mouthOpen)             expression = FFLExpression.SorrowOpenMouth;
  else if (sad)                          expression = FFLExpression.Sorrow;
  else if (smiling && mouthOpen)         expression = FFLExpression.Happy;
  else if (smiling)                      expression = FFLExpression.Smile;
  else if (mouthOpen)                    expression = FFLExpression.OpenMouth;

  // --- Head rotation ---
  const headRotation = extractHeadRotation(transformMatrix);

  return { expressionIndex: expression, headRotation };
}
```

**Extracting head rotation from the transformation matrix:**

```typescript
function extractHeadRotation(matrix?: Float32Array): HeadRotation {
  if (!matrix || matrix.length < 16) {
    return { pitch: 0, yaw: 0, roll: 0 };
  }

  // The facialTransformationMatrixes output is a 4x4 column-major matrix.
  // We can extract euler angles from the rotation component.
  // Using Three.js utilities:
  const m = new THREE.Matrix4().fromArray(matrix);
  const euler = new THREE.Euler().setFromRotationMatrix(m, 'XYZ');

  return {
    pitch: THREE.MathUtils.radToDeg(euler.x),
    yaw:   THREE.MathUtils.radToDeg(euler.y),
    roll:  THREE.MathUtils.radToDeg(euler.z),
  };
}
```

### 5.4 Expression Smoothing and Hysteresis

Raw expression mapping will flicker — the user hovers near a threshold and the expression toggles every frame. Two techniques prevent this:

**1. Hysteresis (different thresholds for entering vs. leaving a state):**

```typescript
// Instead of a single threshold:
//   smiling = score > 0.5
// Use two thresholds:
//   enter smile when score > 0.55  (slightly higher)
//   leave smile when score < 0.45  (slightly lower)

class HysteresisTracker {
  private active = false;
  constructor(
    private enterThreshold: number,
    private exitThreshold: number
  ) {}

  update(score: number): boolean {
    if (this.active && score < this.exitThreshold) this.active = false;
    if (!this.active && score > this.enterThreshold) this.active = true;
    return this.active;
  }
}
```

**2. Minimum hold time (stay in an expression for at least N ms):**

```typescript
const MIN_EXPRESSION_HOLD_MS = 100; // Don't switch faster than 10x/sec
let lastExpressionChange = 0;
let currentExpression = FFLExpression.Normal;

function getStableExpression(raw: FFLExpression): FFLExpression {
  const now = performance.now();
  if (raw !== currentExpression && now - lastExpressionChange > MIN_EXPRESSION_HOLD_MS) {
    currentExpression = raw;
    lastExpressionChange = now;
  }
  return currentExpression;
}
```

**3. Head rotation smoothing (lerp):**

```typescript
const SMOOTHING = 0.3; // 0 = no smoothing, 1 = frozen
let smoothedRotation = { pitch: 0, yaw: 0, roll: 0 };

function smoothHeadRotation(raw: HeadRotation): HeadRotation {
  smoothedRotation.pitch += (raw.pitch - smoothedRotation.pitch) * (1 - SMOOTHING);
  smoothedRotation.yaw   += (raw.yaw   - smoothedRotation.yaw)   * (1 - SMOOTHING);
  smoothedRotation.roll  += (raw.roll  - smoothedRotation.roll)  * (1 - SMOOTHING);
  return { ...smoothedRotation };
}
```

### 5.5 Material Variant Swapping in Three.js

The key Three.js operation is selecting a material variant. Here is how it works with `KHR_materials_variants`:

```typescript
// After loading the GLTF:
const parser = gltf.parser;
const variantsExtension = gltf.userData.variants; // Array of variant names

// variantsExtension example:
// ["Expression_0", "Expression_1", "Expression_2", ...]

// To select a variant, use the Three.js GLTFLoader variant utility:
import { KHRMaterialsVariants } from 'three/examples/jsm/loaders/gltf/extensions/KHR_materials_variants.js';

// The extension stores a selectVariant function:
function setExpression(index: number) {
  const variantName = `Expression_${index}`;
  // Use the functions stored by the extension on each mesh:
  gltf.scene.traverse((object) => {
    if (object.isMesh && object.userData.variantMaterials) {
      const variantMaterialMap = object.userData.variantMaterials;
      const variantIndex = variantsExtension.indexOf(variantName);
      if (variantIndex >= 0 && variantMaterialMap[variantIndex]) {
        object.material = variantMaterialMap[variantIndex].material;
      }
    }
  });
}
```

**Note:** The exact API depends on which version of Three.js you use. Check the [Three.js glTF variants example](https://threejs.org/examples/#webgl_loader_gltf_variants) for the current approach. The core idea is the same: each mesh that participates in variants has a map from variant index to material, and you assign the material you want.

Only the **mask primitive** (the face texture with eyes/mouth/eyebrows) participates in material variants. Other parts of the head (hair, face shape, nose) stay the same across all expressions.

### 5.6 UI Components

**Tracking Controls:**

```
+-------------------------------------------+
|  [Start Tracking]  [Stop Tracking]        |
|  Camera: Logitech C920   [v]              |
|  Status: Tracking (32 fps)                |
+-------------------------------------------+
|                                           |
|         [3D Mii Avatar Canvas]            |
|                                           |
+-------------------------------------------+
```

- **Start/Stop** toggle button.
- **Camera selector** dropdown (enumerate devices via `navigator.mediaDevices.enumerateDevices()`).
- **Status indicator** showing tracking FPS and whether a face is detected.
- **The webcam feed itself is NEVER shown to the user in production.** Only the avatar canvas is displayed.

**Debug Panel (dev mode only):**

- Small webcam preview with landmark overlay
- Blendshape bar chart showing all 52 values in real-time
- Current expression name and index
- Head rotation euler angles
- Frame timing breakdown (MediaPipe ms, render ms, total ms)

---

## 6. API Contract with the FFL Renderer

### Endpoint: Fetch glTF Model with Expression Variants

```
GET http://localhost:5000/miis/image.glb
```

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `data` | string (hex) | Yes | The avatar data in hex-encoded `.ffsd` format |
| `expression` | string | Yes | Comma-separated expression indices (0-18). Include all you need in one request. |
| `width` | int | No | Texture resolution width (default: 512) |
| `height` | int | No | Texture resolution height (default: 512) |

**Example request for all 19 expressions:**

```
GET http://localhost:5000/miis/image.glb?data=<hex>&expression=0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18
```

**Response:** Binary `.glb` file containing:
- Mii head geometry (shared across all expressions)
- 19 material variants using `KHR_materials_variants` extension
- Variant names: `"Expression_0"` through `"Expression_18"`
- Each variant has a different face-mask texture (different eye/mouth/eyebrow drawings)
- Other head parts (hair, face shape, nose) use a single material with no variants

**Error responses:**
- `400` — invalid `data` param or malformed expression list
- `500` — renderer internal error

### Endpoint: Static PNG (Phase 1, still available)

```
GET http://localhost:5000/miis/image.png?data=<hex>&expression=0&width=512&height=512
```

This endpoint remains available for thumbnails, previews, etc.

---

## 7. Performance Requirements

| Metric | Target | Notes |
|--------|--------|-------|
| Three.js render FPS | 60 fps | `requestAnimationFrame` loop |
| MediaPipe tracking FPS | 25-30 fps | Matches webcam framerate |
| Expression update latency | < 100ms | From face movement to avatar change |
| Head rotation latency | < 50ms | Smoothing adds ~1-2 frames |
| glTF initial load time | < 3 seconds | One-time cost at session start |
| Memory usage (JS heap) | < 300 MB | MediaPipe model + Three.js scene + textures |
| CPU usage (idle, tracking off) | < 5% | Render loop still runs but no MediaPipe |
| GPU usage (tracking on) | < 40% | MediaPipe GPU delegate + Three.js WebGL |

### Performance Budget Per Frame (at 30fps tracking)

```
Total budget: 33ms per frame

MediaPipe detectForVideo:  5-15ms (GPU delegate)
Expression mapper:          <1ms  (pure JS logic)
Material variant swap:      <1ms  (pointer assignment)
Head rotation lerp:         <1ms
Three.js render:            2-5ms
────────────────────────────────────
Headroom:                  11-24ms
```

### Optimization Strategies

1. **Use GPU delegate for MediaPipe.** The `delegate: "GPU"` option offloads landmark detection to WebGL, freeing the CPU.
2. **Don't re-traverse the scene every frame.** Cache the reference to the mask mesh and its variant materials during glTF load. Subsequent expression switches are a single `mesh.material = cachedMaterials[index]` assignment.
3. **Separate tracking and rendering loops.** Three.js renders at 60fps via `requestAnimationFrame`. MediaPipe runs at webcam framerate (~30fps). The render loop reads the latest expression/rotation state; it doesn't wait for MediaPipe.
4. **Throttle expression changes.** With the 100ms minimum hold time, we do at most 10 material swaps per second.

---

## 8. Privacy and Security Considerations

This section matters because the app uses the webcam.

1. **All face tracking is local.** MediaPipe runs entirely in the Tauri webview via WASM + WebGL. No video frames, landmarks, or blendshape data ever leave the device.

2. **The webcam feed is never displayed in production.** The `<video>` element used for MediaPipe input should be hidden (`display: none` or off-screen). Only the avatar canvas is visible.

3. **The webcam feed is never recorded or stored.** No frames are saved to disk. The video stream exists only in memory during tracking.

4. **Webcam access requires explicit user action.** Tracking only starts when the user clicks "Start Tracking." The browser's permission prompt gives the user a second confirmation.

5. **Stopping tracking kills the stream.** When the user clicks "Stop Tracking," call `stream.getTracks().forEach(t => t.stop())` to fully release the camera.

6. **No network requests during tracking.** The glTF model is fetched once at startup from `localhost:5000`. During the tracking loop, zero network requests are made. Facial data stays in JavaScript variables that are garbage-collected when tracking stops.

7. **Tauri CSP (Content Security Policy).** Configure `tauri.conf.json` to restrict network access:
   - Allow `connect-src` only to `http://localhost:5000` (the local FFL renderer) and the MediaPipe CDN (for model weights, one-time download).
   - Block all other outbound connections.

8. **MediaPipe model weights.** The face landmarker model (~5MB) is downloaded from Google's CDN on first use. Consider bundling it with the app to eliminate this external fetch entirely. If downloading, it's a one-time download cached by the browser.

---

## 9. Out of Scope for Phase 2

These are explicitly NOT part of this phase:

- **Audio lip sync** — mapping microphone input to mouth shapes
- **Body tracking** — only head/face for now
- **Multiple avatars** — one Mii at a time
- **Streaming integration** — OBS, Twitch, etc. (Phase 3 candidate: virtual camera or NDI output)
- **Avatar customization** — changing Mii features in-app (use external tools to generate `.ffsd`)
- **Morph target blending** — FFL uses discrete expression textures, not blendable morph targets. No in-between expressions.
- **Mobile / web deployment** — Tauri desktop only
- **Hand tracking / gesture recognition**
- **Background removal / virtual backgrounds** (but transparent canvas background IS in scope for later compositing)

---

## 10. Open Questions and Risks

### Open Questions

| # | Question | Impact | Notes |
|---|----------|--------|-------|
| 1 | Should we bundle the MediaPipe WASM + model files with the app, or fetch from CDN? | Affects app size (+~20MB) vs. first-run experience and offline capability | Bundling is better for privacy and reliability. CDN is simpler to start with. Start with CDN, migrate to bundled before release. |
| 2 | What camera resolution should we request? | 640x480 is standard and fast. Higher res (1280x720) may improve tracking accuracy at the cost of performance. | Start with 640x480. Make configurable. |
| 3 | Should expression mapping thresholds be user-configurable? | Different faces have different resting blendshape values. A "calibration" step could improve accuracy. | Start with fixed thresholds. Add calibration in a polish pass if needed. |
| 4 | How many expressions should we include in the glTF request? | All 19 maximizes flexibility but increases file size (~19 textures). | Measure the file size difference. If it's under 10MB total, request all 19. If much larger, consider a smaller set (0-11) for the common expressions. |
| 5 | Do we need Kalidokit, or is raw MediaPipe output sufficient? | Kalidokit simplifies landmark-to-rotation conversion, but it's an extra dependency and may be unmaintained. | Start without Kalidokit. MediaPipe's `outputFacialTransformationMatrixes` gives rotations directly. Only add Kalidokit if rotation extraction proves difficult. |
| 6 | How should the Three.js canvas interact with the rest of the Tauri UI? | Canvas can be full-window or a resizable panel. | Start with a single full-area canvas. Add layout flexibility later. |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| MediaPipe performance on low-end hardware | Medium | Users with integrated GPUs may see low tracking FPS | Add a "performance mode" that reduces camera resolution or tracking frequency. Show FPS counter so users know. |
| Expression flickering despite smoothing | Medium | Distracting rapid expression changes | Tune hysteresis thresholds and hold times. Allow user to adjust sensitivity. |
| Three.js `KHR_materials_variants` API changes between versions | Low | Code breaks on Three.js update | Pin Three.js version. Document which version was tested. |
| Large glTF file with all 19 expressions | Low | Slow initial load on spinning-disk HDDs | Show a loading indicator. Consider lazy-loading less-common expressions. |
| MediaPipe CDN unavailable (first run, no cache) | Low | App fails to initialize tracking | Bundle model files as a fallback, or show a clear error message with retry. |
| Webcam permission denied by OS-level settings | Medium | Tracking cannot start at all | Detect the error, show a helpful message pointing to system privacy settings. |

---

## Appendix A: MediaPipe Blendshape Names Reference

The 52 blendshapes output by MediaPipe Face Landmarker (ARKit-compatible names). The ones most relevant to FFL expression mapping are marked with **[used]**.

```
_neutral
browDownLeft          **[used]** → anger
browDownRight         **[used]** → anger
browInnerUp           **[used]** → sorrow
browOuterUpLeft
browOuterUpRight
cheekPuff
cheekSquintLeft
cheekSquintRight
eyeBlinkLeft          **[used]** → blink, wink
eyeBlinkRight         **[used]** → blink, wink
eyeLookDownLeft
eyeLookDownRight
eyeLookInLeft
eyeLookInRight
eyeLookOutLeft
eyeLookOutRight
eyeLookUpLeft
eyeLookUpRight
eyeSquintLeft
eyeSquintRight
eyeWideLeft           **[used]** → surprise
eyeWideRight          **[used]** → surprise
jawForward
jawLeft
jawOpen               **[used]** → open_mouth
jawRight
mouthClose
mouthDimpleLeft
mouthDimpleRight
mouthFrownLeft
mouthFrownRight
mouthFunnel
mouthLeft
mouthLowerDownLeft
mouthLowerDownRight
mouthPressLeft
mouthPressRight
mouthPucker
mouthRight
mouthRollLower
mouthRollUpper
mouthShrugLower
mouthShrugUpper
mouthSmileLeft        **[used]** → smile, happy
mouthSmileRight       **[used]** → smile, happy
mouthStretchLeft
mouthStretchRight
mouthUpperUpLeft
mouthUpperUpRight
noseSneerLeft
noseSneerRight
```

---

## Appendix B: File Structure (Suggested)

```
src/
├── lib/
│   ├── scene.ts              # Three.js scene setup, glTF loading, variant swapping
│   ├── faceTracker.ts        # MediaPipe initialization and frame processing
│   ├── expressionMapper.ts   # Pure function: blendshapes → FFL expression index
│   ├── smoothing.ts          # Hysteresis, hold time, lerp utilities
│   └── types.ts              # Shared types (FFLExpression enum, HeadRotation, etc.)
├── components/
│   ├── AvatarCanvas.vue/tsx  # Three.js canvas wrapper component
│   ├── TrackingControls.vue/tsx  # Start/stop, camera select, status
│   └── DebugPanel.vue/tsx    # Dev-only debug overlay
└── ...
```

---

## Appendix C: Quick-Start Checklist for Implementation

For the developer (or AI agent) picking this up:

- [ ] Install deps: `npm install three @mediapipe/tasks-vision`
- [ ] Verify the FFL renderer is running at `localhost:5000`
- [ ] Test the glTF endpoint manually: open `http://localhost:5000/miis/image.glb?data=<your_hex>&expression=0,1,2,3,4,5` in a glTF viewer
- [ ] Start with Milestone 1 (static 3D scene) and get it rendering before touching webcam code
- [ ] Work through milestones sequentially — each one builds on the previous
- [ ] Test expression mapping with the manual dropdown (Milestone 2) before connecting MediaPipe (Milestone 4)
- [ ] Profile with Chrome DevTools Performance tab to verify frame timing
