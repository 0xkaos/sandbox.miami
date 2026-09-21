# Gaze Field

Open `/threejs/gaze_lab/` over HTTPS or localhost. This sketch estimates where you look within the browser viewport using a regular webcam, guided calibration, and an independent accuracy check.

## Try it

1. Use a desktop browser, choose your webcam, and start the camera. The preview is mirrored; amber points mark the tracked irises. Camera access is requested only when you start it.
2. Choose full screen if desired **before** calibration. Sit comfortably with even front lighting and both eyes visible.
3. Start with **9 points / Linear**. Look at the amber target and keep your head comfortably still. Each point allows an initial settling period, then collects about 1.5 seconds of valid eye samples. Blinks and missing faces pause collection.
4. Run **Check accuracy**. Follow six new targets. These samples never train the mapping. Lower median error means better accuracy; lower jitter means a steadier estimate. The field shows each target, its median estimate, and the sample spread.
5. Compare **5 points** (center and corners) with **17 points** (additional interior coverage), or switch to **Curved** mapping and check again. Earlier measurements remain visible for comparison during this page session.
6. Hide the controls to explore the full field. Display smoothing changes the dot and trail only; scores always use raw estimates. Stop camera releases the stream and tracker.

Results are measured in **CSS pixels** and as a percentage of the viewport diagonal. They are not degrees of visual angle or a confidence percentage. Jitter is the median distance of each sample from its target's median estimate. The 90th-percentile error includes off-screen predictions without clamping. Points with a lost face or a large head movement cannot complete until tracking recovers; these are conditional measurements on valid tracked frames, not an overall camera availability score.

Accuracy is experimental and depends on camera position, eye image resolution, lighting, glasses, and head stability. An iris landmark detector is not itself a screen-gaze estimator. This sketch learns that relationship from your calibration. Expect to test broad areas first; there is no promised pixel accuracy. Recalibrate after moving the camera or chair. Resizing the viewport, changing fullscreen, or restarting the camera clears calibration. Leaving the tab cancels an in-progress calibration/check.

## Microsoft LifeCam recovery

Close other apps or tabs using the webcam, stop the camera here, then retry. For the LifeCam that needs a Linux USB reset, run this in your terminal:

```bash
sudo usbreset 045e:0811
```

Then start the camera again. The page displays permission, missing-device, busy-device, and tracker-load errors. It cannot perform an OS-level USB reset.

## Built-in laptop cameras and missing prompts

Starting the default camera first requests `getUserMedia({ audio: false, video: true })`, without resolution, facing-mode, or frame-rate restrictions. After video opens, the sketch requests its preferred quality using optional `ideal` settings; a rejected preference leaves the working native stream in use. If the default device cannot be found but the browser exposes other cameras, the sketch tries those explicit devices. An explicitly selected camera is respected, and permission denials are never retried automatically.

An error before a prompt does not establish that the laptop has no camera. Open **Camera details** below the error to see the browser's actual error, failed startup stage, permission state (when supported), and exposed camera list. This is only a local diagnostic readout; a pre-permission device list can be incomplete and is never used to block starting the camera.

If web-based Zoom works in the same browser, compare which camera it uses and check the camera permission specifically for `sandbox.miami`. Close Zoom before retrying. For laptops with both color and infrared cameras, select the color camera. On Windows, system camera access also includes access for desktop apps such as browsers. See the [browser API's error definitions](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#exceptions) and [Microsoft's camera troubleshooting](https://support.microsoft.com/en-us/windows/hardware/camera/camera-doesn-t-work-in-windows).

## Implementation

- Google's [MediaPipe Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js), `@mediapipe/tasks-vision` **1.0.1**, runs on the CPU in a dedicated worker. Camera frames are transferred one at a time, processed locally, and discarded. The preview and canvas stay responsive during inference.
- Features use each iris relative to its eye corners, with eye-roll compensation in image pixel coordinates, plus head angle, position, and scale. A standardized ridge regression maps them to normalized viewport coordinates. The curved option adds quadratic eye-position terms.
- Calibration discards transient feature outliers and balances the weight of each target. Validation does not trim bad predictions or update regression coefficients. Gaze never comes from the mouse cursor.
- There is no server, upload, analytics, face identification, recording, or browser-storage persistence. Models, samples, and comparison history exist only in page memory. Closing the page releases the camera.
- Runtime, SIMD/non-SIMD WASM binaries, and the face model are pinned in `vendor/mediapipe/`. No external requests are needed, including under the site's `Cross-Origin-Embedder-Policy: require-corp`. The initial model/runtime download is roughly 15 MB before transport compression; the browser can cache these static files. Every individual asset is below Cloudflare Pages' 25 MiB limit.
- The visualization uses a 2D canvas because target and error coordinates need to match screen pixels directly.

## Checks

```bash
node --test scripts/test-gaze-lab.mjs scripts/test-gaze-camera.mjs
npm run build
```

The numeric tests cover independent eye movement, stationary-head regression, nonlinear mapping, blinks/outliers, held-out targets, raw off-screen error, and head-motion limits. Browser verification uses the real local model with a face image and a simulated camera, plus synthetic gaze samples for the calibration workflow. Those checks establish that the software runs; they do not measure a person's webcam gaze accuracy.

See [third-party sources and licenses](THIRD_PARTY.md).
