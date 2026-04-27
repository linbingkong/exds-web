const DEVICE_ID_KEY = 'auth_device_id';

function ensureDeviceId(): string {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) {
        return existing;
    }
    const next = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_ID_KEY, next);
    return next;
}

export function getDeviceFingerprint(): string {
    const deviceId = ensureDeviceId();
    return `v2|${deviceId}`.slice(0, 255);
}
