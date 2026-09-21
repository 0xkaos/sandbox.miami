import { clamp, calibrationPoints, validationPoints, cleanSamples, fitGaze, predictGaze, headMoved, validationReport } from './gaze-math.mjs?v=1';
import { openCamera, preferCameraQuality, cameraErrorMessage, cameraDiagnostics } from './camera.mjs?v=1';

const $ = id => document.getElementById(id);
const canvas = $('field'), ctx = canvas.getContext('2d');
const video = $('video'), eyeCanvas = $('eyes'), eyeCtx = eyeCanvas.getContext('2d');
let width = innerWidth, height = innerHeight, pixelRatio = 1;
let stream = null, worker = null, workerReady = false, busy = false, starting = false, session = 0;
let rejectWorkerLoad = null, lastVideoTime = -1, lastSent = 0, lastReceived = 0, lastValidAt = 0;
let recentSample = null, model = null, training = [], routine = null, report = null;
let raw = null, smooth = null, lastPrediction = 0, trail = [], frameTimes = [], checks = [];
let calibrationCount = 0, lastQuality = '';

function notice(message = '') {
    $('notice').textContent = message;
    $('notice').hidden = !message;
}

function quality(message, good = false) {
    if (message !== lastQuality) { $('quality').textContent = message; lastQuality = message; }
    $('quality').classList.toggle('good', good);
}

function controls() {
    const active = !!stream || starting;
    $('cameraToggle').textContent = active ? 'Stop camera' : 'Start camera';
    $('camera').disabled = active;
    $('calibrate').disabled = !workerReady || !!routine;
    $('calibrate').textContent = model ? 'Recalibrate gaze' : 'Calibrate gaze';
    $('validate').disabled = !model || !!routine;
    $('mapping').disabled = !!routine;
    $('points').disabled = !!routine;
    $('preview').hidden = !stream || !$('showPreview').checked;
    $('intro').hidden = active || !!model;
    $('exploreHint').hidden = !active;
    $('exploreText').textContent = model ? 'Your estimated gaze · cyan' : 'Calibrate to reveal your gaze';
    $('cameraState').textContent = starting ? 'Starting…' : stream ? 'On' : 'Off';
    $('calibrationState').textContent = model ? `${calibrationCount} points` : 'Not set';
    $('panelToggle').hidden = !model;
    if (!model) {
        $('panel').hidden = false;
        $('panelToggle').textContent = 'Hide controls';
        $('panelToggle').setAttribute('aria-expanded', 'true');
    }
}

function clearReading() {
    raw = smooth = null;
    trail = [];
    lastPrediction = 0;
}

function clearReport() {
    report = null;
    $('error').textContent = '—';
    $('jitter').textContent = '—';
    $('validationState').textContent = 'Not measured';
    $('resultDetail').textContent = 'Six fresh targets, kept separate from calibration. Error is measured in screen pixels.';
}

function clearCalibration() {
    model = null;
    training = [];
    clearReading();
    clearReport();
    controls();
}

async function cameras() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
        const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
        const selected = $('camera').value;
        $('camera').replaceChildren(new Option('Default camera', ''));
        devices.filter(device => device.deviceId).forEach((device, i) => $('camera').add(new Option(device.label || `Camera ${i + 1}`, device.deviceId)));
        if (devices.some(device => device.deviceId === selected)) $('camera').value = selected;
    } catch { /* Camera access may be denied until the user chooses Start. */ }
}

async function showCameraDiagnostics(error, stage, request) {
    const token = session;
    const rows = await cameraDiagnostics({ error, stage, request, secure: isSecureContext,
        mediaDevices: navigator.mediaDevices, permissions: navigator.permissions,
        policy: document.permissionsPolicy || document.featurePolicy });
    if (token !== session) return;
    $('cameraDetails').replaceChildren();
    for (const [label, value] of rows) {
        const term = document.createElement('dt'), description = document.createElement('dd');
        term.textContent = label;
        description.textContent = value;
        $('cameraDetails').append(term, description);
    }
    $('cameraDiagnostics').hidden = false;
}

function loadTracker(token) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const trackerWorker = new Worker(new URL('./tracker.js?v=1', import.meta.url));
        worker = trackerWorker;
        const timeout = setTimeout(() => fail(new Error('The eye tracker took too long to load. Check your connection and try again.')), 60000);
        const fail = error => {
            if (settled) { fatal(error.message); return; }
            settled = true;
            clearTimeout(timeout);
            rejectWorkerLoad = null;
            reject(error);
        };
        rejectWorkerLoad = fail;
        trackerWorker.onerror = event => fail(new Error(`Eye tracker could not load. ${event.message || 'Reload and try again.'}`));
        trackerWorker.onmessage = ({ data }) => {
            if (token !== session) return;
            if (data.type === 'ready') {
                settled = true;
                clearTimeout(timeout);
                rejectWorkerLoad = null;
                workerReady = true;
                resolve();
            } else if (data.type === 'sample') {
                busy = false;
                lastReceived = performance.now();
                frameTimes.push(lastReceived);
                frameTimes = frameTimes.filter(time => lastReceived - time < 2000);
                $('fps').textContent = frameTimes.length > 2 ? `${Math.round((frameTimes.length - 1) * 1000 / (lastReceived - frameTimes[0]))} samples/s` : '…';
                consume(data.sample, data.timestamp);
            } else if (data.type === 'error') fail(new Error(`Eye tracker stopped: ${data.message}`));
        };
        trackerWorker.postMessage({ type: 'init' });
    });
}

async function startCamera() {
    if (!isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        notice('Camera access needs HTTPS or localhost in a browser with webcam support.');
        return;
    }
    if (!window.Worker || !window.OffscreenCanvas || !window.createImageBitmap) {
        notice('This experiment needs a browser with camera and offscreen canvas support. Try a current desktop Chrome or Edge.');
        return;
    }
    const token = ++session;
    starting = true;
    $('cameraDiagnostics').hidden = true;
    $('cameraDiagnostics').open = false;
    controls();
    notice('Allow webcam access when your browser asks.');
    let stage = 'Requesting camera access', request = '';
    try {
        const cameraId = $('camera').value;
        const acquired = await openCamera(navigator.mediaDevices, { deviceId: cameraId,
            isCurrent: () => token === session,
            onAttempt: description => { request = description; },
        });
        if (token !== session) { acquired.getTracks().forEach(track => track.stop()); return; }
        stream = acquired;
        video.srcObject = stream;
        stream.getVideoTracks()[0].addEventListener('ended', () => {
            if (token === session) fatal('The camera disconnected. Reconnect it, then start the camera again.');
        });
        controls();
        stage = 'Opening camera video';
        notice('Opening the camera…');
        let playbackTimeout;
        try {
            await Promise.race([video.play(), new Promise((_, reject) => {
                playbackTimeout = setTimeout(() => reject(new Error('The camera opened but no video arrived. Close other camera apps or reset the LifeCam, then retry.')), 12000);
            })]);
        } finally { clearTimeout(playbackTimeout); }
        if (token !== session) return;
        await preferCameraQuality(stream.getVideoTracks()[0]);
        if (token !== session) return;
        const settings = stream.getVideoTracks()[0].getSettings();
        $('resolution').textContent = `${settings.width || video.videoWidth} × ${settings.height || video.videoHeight}`;
        $('preview').style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
        await cameras();
        if (token !== session) return;
        stage = 'Loading the eye tracker';
        notice('Loading the eye tracker… The first load may take a moment.');
        await loadTracker(token);
        if (token !== session) return;
        starting = false;
        lastReceived = performance.now();
        notice('Look toward the screen. Once both eyes are visible, choose Calibrate gaze.');
        controls();
    } catch (error) {
        if (token !== session) return;
        stopCamera();
        notice(cameraErrorMessage(error));
        $('cameraHelp').open = true;
        await Promise.all([cameras(), showCameraDiagnostics(error, stage, request)]);
    }
}

function stopCamera() {
    session++;
    starting = false;
    finishRoutine();
    if (rejectWorkerLoad) rejectWorkerLoad(new DOMException('Camera stopped', 'AbortError'));
    worker?.terminate();
    worker = null;
    workerReady = busy = false;
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    video.srcObject = null;
    recentSample = null;
    lastValidAt = lastReceived = lastSent = 0;
    lastVideoTime = -1;
    frameTimes = [];
    eyeCtx.clearRect(0, 0, eyeCanvas.width, eyeCanvas.height);
    $('fps').textContent = '—';
    clearCalibration();
    quality('Camera off. Start it again to reconnect.');
    notice();
    controls();
}

function fatal(message) { stopCamera(); notice(message); }

async function sendFrame(now) {
    if (!workerReady || busy || document.hidden || !video.videoWidth || video.readyState < 2
        || video.currentTime === lastVideoTime || now - lastSent < 40) return;
    const token = session, destination = worker;
    busy = true;
    lastVideoTime = video.currentTime;
    lastSent = now;
    try {
        const frame = await createImageBitmap(video);
        if (token !== session) { frame.close(); return; }
        destination.postMessage({ type: 'frame', frame, timestamp: now }, [frame]);
    } catch (error) {
        if (token === session) fatal(`Could not read camera frames. Stop and restart the camera. ${error.message}`);
    }
}

function drawEyes(sample) {
    eyeCanvas.width = video.videoWidth;
    eyeCanvas.height = video.videoHeight;
    if (!sample.eyePoints) return;
    eyeCtx.strokeStyle = '#a8ebe0';
    eyeCtx.fillStyle = '#e7b788';
    eyeCtx.lineWidth = Math.max(1, video.videoWidth / 480);
    for (let eye = 0; eye < 2; eye++) {
        eyeCtx.beginPath();
        sample.eyePoints.slice(eye * 6, eye * 6 + 5).forEach(([x, y], i) => {
            if (!i) eyeCtx.moveTo(x * eyeCanvas.width, y * eyeCanvas.height);
            else eyeCtx.lineTo(x * eyeCanvas.width, y * eyeCanvas.height);
        });
        eyeCtx.stroke();
        const [x, y] = sample.eyePoints[eye * 6 + 5];
        eyeCtx.beginPath();
        eyeCtx.arc(x * eyeCanvas.width, y * eyeCanvas.height, eyeCanvas.width / 280, 0, Math.PI * 2);
        eyeCtx.fill();
    }
}

function consume(sample, timestamp) {
    recentSample = sample;
    drawEyes(sample);
    if (document.hidden) return;
    if (!sample.features) {
        quality(sample.reason);
        raw = smooth = null;
        if (routine) pauseTarget(sample.reason);
        return;
    }
    lastValidAt = performance.now();
    const reference = routine?.anchor || model?.pose;
    if (reference && headMoved(reference, sample.pose)) {
        const message = 'Head moved — return to your starting position';
        quality(message);
        raw = smooth = null;
        if (routine) pauseTarget(message);
        return;
    }
    quality('Both eyes visible', true);
    if (routine) { collect(sample, timestamp); return; }
    if (!model) return;
    const prediction = predictGaze(model, sample.features);
    if (!prediction.every(Number.isFinite)) return;
    raw = prediction;
    const delta = lastPrediction ? Math.min(250, timestamp - lastPrediction) : 1000;
    const duration = Number($('smoothing').value);
    const alpha = duration ? 1 - Math.exp(-delta / duration) : 1;
    smooth = smooth ? smooth.map((v, i) => v + (raw[i] - v) * alpha) : [...raw];
    lastPrediction = timestamp;
    trail.push({ point: [...smooth], time: performance.now() });
    trail = trail.filter(point => performance.now() - point.time < 2200);
    $('exploreText').textContent = raw.some(value => value < 0 || value > 1)
        ? 'Estimate outside the screen · consider recalibrating' : 'Your estimated gaze · cyan';
}

function startRoutine(type) {
    if (!workerReady || (type === 'validate' && !model)) return;
    if (!recentSample?.features || performance.now() - lastValidAt > 500) {
        notice('Bring both eyes into view before starting.');
        return;
    }
    if (type === 'validate' && headMoved(model.pose, recentSample.pose)) {
        notice('Return to the position you calibrated in, or recalibrate before checking accuracy.');
        return;
    }
    if (type === 'calibrate') { clearCalibration(); calibrationCount = Number($('points').value); }
    else { clearReport(); clearReading(); }
    routine = { type, points: type === 'calibrate' ? calibrationPoints(calibrationCount) : validationPoints(),
        index: 0, groups: [], samples: [], settled: 0, collected: 0, last: 0,
        anchor: type === 'validate' ? model.pose : recentSample.pose, started: performance.now(), width, height };
    document.body.classList.add('routine');
    window.scrollTo(0, 0);
    $('routineBar').hidden = $('target').hidden = false;
    notice();
    controls();
    placeTarget();
    $('cancel').focus({ preventScroll: true });
}

function placeTarget() {
    if (!routine) return;
    const [x, y] = routine.points[routine.index];
    $('target').style.left = `${x * width}px`;
    $('target').style.top = `${y * height}px`;
    $('target').style.setProperty('--progress', '0deg');
    $('targetNumber').textContent = routine.index + 1;
    $('target').setAttribute('aria-label', `Look at target ${routine.index + 1} of ${routine.points.length}`);
    $('routineTitle').textContent = `${routine.type === 'calibrate' ? 'Calibration' : 'Accuracy check'} · ${routine.index + 1} / ${routine.points.length}`;
    $('routineInstruction').textContent = 'Look at the dot; let your eyes settle.';
    $('routineBar').style.top = y > 0.65 ? '16px' : 'auto';
    $('routineBar').style.bottom = y > 0.65 ? 'auto' : '16px';
}

function pauseTarget(reason) {
    routine.last = 0;
    routine.settled = 0;
    $('routineInstruction').textContent = `${reason}. Holding this point.`;
}

function collect(sample, timestamp) {
    const step = routine;
    const delta = step.last ? clamp(timestamp - step.last, 0, 100) : 0;
    step.last = timestamp;
    if (step.settled < 850) {
        step.settled += delta;
        $('routineInstruction').textContent = 'Look at the dot; let your eyes settle.';
        return;
    }
    step.collected += delta;
    step.samples.push({ features: sample.features, pose: sample.pose, target: step.points[step.index] });
    $('routineInstruction').textContent = 'Hold your gaze here…';
    const progress = Math.min(1, step.collected / 1500, step.samples.length / 20);
    $('target').style.setProperty('--progress', `${progress * 360}deg`);
    if (progress < 1) return;
    if (step.type === 'calibrate') {
        const usable = cleanSamples(step.samples);
        if (usable.length < 12) { cancelRoutine('Too few clear eye samples. Try again in steadier light.'); return; }
        // Equal weighting per target, even if camera frame rate varies.
        const balanced = Array.from({ length: 20 }, (_, i) => usable[Math.floor(i * usable.length / 20)]);
        training.push(...balanced);
    } else {
        // Validation counts every accepted sample, without trimming poor predictions.
        const predictions = step.samples.map(entry => predictGaze(model, entry.features));
        step.groups.push({ target: step.points[step.index], predictions });
    }
    step.index++;
    if (step.index === step.points.length) {
        try {
            if (step.type === 'calibrate') {
                model = fitGaze(training, $('mapping').value === 'curved');
                finishRoutine();
                notice('Calibration ready. Check accuracy at six new points, then explore the field.');
                $('validate').focus({ preventScroll: true });
            } else {
                report = validationReport(step.groups, step.width, step.height);
                finishRoutine();
                showReport();
                notice();
                $('validate').focus({ preventScroll: true });
            }
        } catch (error) { cancelRoutine(error.message); clearCalibration(); }
        controls();
        return;
    }
    step.samples = [];
    step.settled = step.collected = step.last = 0;
    step.started = performance.now();
    placeTarget();
}

function finishRoutine() {
    routine = null;
    document.body.classList.remove('routine');
    $('routineBar').hidden = $('target').hidden = true;
    controls();
}

function cancelRoutine(message = 'Cancelled. You can start again when ready.') {
    const wasCalibration = routine?.type === 'calibrate';
    finishRoutine();
    if (wasCalibration) clearCalibration();
    notice(message);
}

function showReport() {
    $('error').textContent = `${Math.round(report.error)} px`;
    $('jitter').textContent = `${Math.round(report.jitter)} px`;
    $('validationState').textContent = '6 targets';
    $('resultDetail').textContent = `${report.percent.toFixed(1)}% of the screen diagonal. 90% of samples within ${Math.round(report.p90)} px. ${report.samples} raw samples. Amber rings show targets; lines lead to median estimates.`;
    const entry = { points: calibrationCount, mapping: $('mapping').value, error: report.error, percent: report.percent, width, height };
    $('historyList').replaceChildren();
    checks.slice(-4).reverse().forEach(check => {
        const item = document.createElement('li'), name = document.createElement('span'), result = document.createElement('span');
        name.textContent = `${check.points} pt · ${check.mapping} · ${check.width}×${check.height}`;
        result.textContent = `${Math.round(check.error)} px`;
        item.append(name, result);
        $('historyList').append(item);
    });
    $('history').hidden = !checks.length;
    checks.push(entry);
}

function resize() {
    const changed = width !== innerWidth || height !== innerHeight;
    width = innerWidth; height = innerHeight;
    pixelRatio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    if (changed && (model || routine)) {
        finishRoutine();
        clearCalibration();
        notice('The screen size changed. Calibrate again for this layout.');
    }
}

function drawField(now) {
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = '#1c2a343f';
    ctx.lineWidth = 1;
    const spacing = 80;
    ctx.beginPath();
    for (let x = (width % spacing) / 2; x < width; x += spacing) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
    for (let y = (height % spacing) / 2; y < height; y += spacing) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
    ctx.stroke();
    if (routine) return;
    if (!model) {
        const x = width < 900 ? width * 0.5 : (width - 334) * 0.5, y = height * 0.5;
        ctx.strokeStyle = '#48767b0d';
        [110, 190, 290].forEach(r => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); });
        return;
    }
    if (report) for (const point of report.points) {
        const [tx, ty] = [point.target[0] * width, point.target[1] * height];
        const [gx, gy] = [point.center[0] * width, point.center[1] * height];
        ctx.strokeStyle = '#e7b78866';
        ctx.setLineDash([3, 5]);
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(gx, gy); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(tx, ty, 9, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#9ad8d566';
        point.predictions.forEach(([x, y]) => ctx.fillRect(x * width - 1, y * height - 1, 2, 2));
        ctx.beginPath(); ctx.arc(gx, gy, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#9eaaa9';
        ctx.font = '10px ui-monospace, monospace';
        ctx.fillText(`${Math.round(point.error)} px`, tx + 15, ty + 3);
    }
    if ($('trail').checked) {
        for (let i = 1; i < trail.length; i++) {
            const age = now - trail[i].time;
            if (age > 2200 || trail[i].time - trail[i - 1].time > 250) continue;
            ctx.strokeStyle = `rgba(154,216,213,${(1 - age / 2200) * 0.32})`;
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(trail[i - 1].point[0] * width, trail[i - 1].point[1] * height);
            ctx.lineTo(trail[i].point[0] * width, trail[i].point[1] * height); ctx.stroke();
        }
    }
    if (now - lastValidAt > 500 || now - lastReceived > 500) return;
    if ($('raw').checked && raw) {
        ctx.strokeStyle = '#e8ede68c'; ctx.lineWidth = 1;
        const x = raw[0] * width, y = raw[1] * height;
        ctx.beginPath(); ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y); ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5); ctx.stroke();
    }
    if (smooth) {
        const x = smooth[0] * width, y = smooth[1] * height;
        const glow = ctx.createRadialGradient(x, y, 2, x, y, 42);
        glow.addColorStop(0, '#9ad8d52b'); glow.addColorStop(1, '#9ad8d500');
        ctx.fillStyle = glow; ctx.fillRect(x - 42, y - 42, 84, 84);
        ctx.strokeStyle = '#9ad8d56b'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#b5efea'; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    }
}

function frame(now) {
    if (workerReady) {
        sendFrame(now);
        if (!document.hidden && now - lastReceived > 10000) fatal('Camera frames stopped arriving. Stop and start the camera to reconnect.');
        else if (now - lastReceived > 800) {
            quality('Waiting for camera frames…');
            if (routine) pauseTarget('Waiting for camera frames');
        }
    }
    if (routine && now - routine.started > 20000) cancelRoutine('This point could not get enough clear samples. Check the camera preview and try again.');
    drawField(now);
    requestAnimationFrame(frame);
}

$('cameraToggle').addEventListener('click', () => stream || starting ? stopCamera() : startCamera());
$('calibrate').addEventListener('click', () => startRoutine('calibrate'));
$('validate').addEventListener('click', () => startRoutine('validate'));
$('cancel').addEventListener('click', () => cancelRoutine());
$('showPreview').addEventListener('change', controls);
$('panelToggle').addEventListener('click', () => {
    $('panel').hidden = !$('panel').hidden;
    $('panelToggle').textContent = $('panel').hidden ? 'Show controls' : 'Hide controls';
    $('panelToggle').setAttribute('aria-expanded', String(!$('panel').hidden));
});
$('smoothing').addEventListener('input', () => { $('smoothingValue').textContent = `${$('smoothing').value} ms`; });
$('mapping').addEventListener('change', () => {
    if (!training.length || !model) return;
    try {
        model = fitGaze(training, $('mapping').value === 'curved');
        clearReading(); clearReport();
        notice('Mapping updated using your calibration. Run a fresh accuracy check to compare it.');
    } catch (error) { clearCalibration(); notice(error.message); }
});
$('fullscreen').addEventListener('click', async () => {
    try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
    } catch { notice('Full screen is unavailable here. You can calibrate in this window.'); }
});
document.addEventListener('fullscreenchange', () => { $('fullscreen').textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen'; });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && routine) cancelRoutine(); });
document.addEventListener('visibilitychange', () => {
    clearReading();
    lastReceived = performance.now();
    if (document.hidden && routine) cancelRoutine('The check was interrupted when you left the tab. Start again when ready.');
});
navigator.mediaDevices?.addEventListener('devicechange', cameras);
window.addEventListener('resize', resize);
window.addEventListener('pagehide', stopCamera);
resize(); cameras(); controls(); requestAnimationFrame(frame);
