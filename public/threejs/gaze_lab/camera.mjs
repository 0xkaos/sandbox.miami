// Ask for camera access before negotiating image quality. In particular, do not
// require a frame-rate ceiling or facing mode during device discovery.
export async function openCamera(mediaDevices, { deviceId = '', isCurrent = () => true, onAttempt = () => {} } = {}) {
    async function request(video, description) {
        if (!isCurrent()) throw new DOMException('Camera request cancelled', 'AbortError');
        onAttempt(description);
        const stream = await mediaDevices.getUserMedia({ audio: false, video });
        if (!isCurrent()) {
            stream.getTracks().forEach(track => track.stop());
            throw new DOMException('Camera request cancelled', 'AbortError');
        }
        return stream;
    }
    try {
        return await request(deviceId ? { deviceId: { exact: deviceId } } : true,
            deviceId ? 'Selected camera; no video-format requirements' : 'Default camera; video: true');
    } catch (error) {
        // Respect an explicitly selected device and never retry a permission
        // denial. Some systems have a stale default despite exposing another camera.
        if (deviceId || !isCurrent() || !['NotFoundError', 'OverconstrainedError'].includes(error.name)) throw error;
        let devices;
        try { devices = await mediaDevices.enumerateDevices(); } catch { throw error; }
        const ids = [...new Set(devices.filter(device => device.kind === 'videoinput' && device.deviceId && device.deviceId !== 'default')
            .map(device => device.deviceId))];
        for (let i = 0; i < ids.length; i++) {
            try { return await request({ deviceId: { exact: ids[i] } }, `Available camera ${i + 1}; no video-format requirements`); }
            catch (nextError) {
                if (!isCurrent() || !['NotFoundError', 'OverconstrainedError'].includes(nextError.name)) throw nextError;
                error = nextError;
            }
        }
        throw error;
    }
}

export async function preferCameraQuality(track) {
    if (!track.applyConstraints) return;
    try {
        await track.applyConstraints({ width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } });
    } catch { /* A usable native stream is more important than a preferred format. */ }
}

export function cameraErrorMessage(error) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'Camera access was blocked by the browser or operating system. Check this site’s camera permission and system camera access, then try again.';
    if (error.name === 'NotFoundError') return 'The browser could not access a usable camera. A built-in camera can still be present. Check the laptop’s camera privacy switch and system/browser camera access, then try again.';
    if (error.name === 'OverconstrainedError') return 'The selected camera is unavailable to the browser. Choose Default camera or another device, then try again.';
    if (error.name === 'NotReadableError' || error.name === 'AbortError') return 'The browser found a camera but could not open it. Close other camera apps and check system camera access. For a locked LifeCam, the USB reset command is in the help below.';
    return error.message || 'Could not start the camera. Stop and try again.';
}

export async function cameraDiagnostics({ error, mediaDevices, permissions, policy, request, stage, secure }) {
    // These are observations, not gates: browsers may hide device lists and may
    // not implement the camera Permissions API. Neither should prevent a request.
    const [devices, permission] = await Promise.allSettled([
        Promise.resolve().then(() => mediaDevices?.enumerateDevices?.()),
        Promise.resolve().then(() => permissions?.query?.({ name: 'camera' })),
    ]);
    let allowed = 'Not reported by this browser';
    try { if (policy?.allowsFeature) allowed = policy.allowsFeature('camera') ? 'Allowed' : 'Blocked by page policy'; } catch { /* Unsupported policy query. */ }
    const cameras = devices.status === 'fulfilled' && Array.isArray(devices.value)
        ? devices.value.filter(device => device.kind === 'videoinput') : null;
    return [
        ['Failed at', stage],
        ['Browser error', error.name || 'Error'],
        ['Browser message', error.message || 'No additional message'],
        ...(error.constraint ? [['Rejected setting', error.constraint]] : []),
        ['Capture request', request || 'Not started'],
        ['Secure page', secure ? 'Yes' : 'No'],
        ['Page camera policy', allowed],
        ['Camera permission', permission.status === 'fulfilled' && permission.value?.state ? permission.value.state : 'Not reported by this browser'],
        ['Video devices exposed', cameras ? `${cameras.length}${cameras.some(camera => camera.label) ? ' · ' + cameras.map(camera => camera.label || 'Unnamed camera').join(', ') : ''}` : 'Device list unavailable'],
    ];
}
