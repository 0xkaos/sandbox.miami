/* MediaPipe runs off the UI thread; frames are processed locally and discarded. */
importScripts('./vendor/mediapipe/vision_bundle.js');
let tracker, extractEyeFeatures;
self.onmessage = async ({ data }) => {
    try {
        if (data.type === 'init') {
            ({ extractEyeFeatures } = await import('./gaze-math.mjs?v=1'));
            const files = await Vision.FilesetResolver.forVisionTasks('./vendor/mediapipe/wasm');
            tracker = await Vision.FaceLandmarker.createFromOptions(files, {
                baseOptions: { modelAssetPath: './vendor/mediapipe/face_landmarker.task', delegate: 'CPU' },
                runningMode: 'VIDEO', numFaces: 1,
                minFaceDetectionConfidence: 0.6, minFacePresenceConfidence: 0.6, minTrackingConfidence: 0.6,
            });
            self.postMessage({ type: 'ready' });
        } else if (data.type === 'frame') {
            const started = performance.now();
            try {
                const results = tracker.detectForVideo(data.frame, data.timestamp);
                const sample = extractEyeFeatures(results.faceLandmarks[0], data.frame.width, data.frame.height);
                self.postMessage({ type: 'sample', sample, timestamp: data.timestamp, elapsed: performance.now() - started });
            } finally { data.frame.close(); }
        }
    } catch (error) {
        self.postMessage({ type: 'error', message: error.message || String(error) });
    }
};
