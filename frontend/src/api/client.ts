import axios from 'axios';
import {
    AUTH_STORAGE_KEYS,
    getRequiredPermissionsForMutation,
    hasAllPermissions,
    normalizeRequestPath,
} from '../auth/permissionPrecheck';
import { getDeviceFingerprint } from '../auth/deviceFingerprint';

const apiClient = axios.create({
    baseURL: process.env.REACT_APP_API_BASE_URL || '',
    headers: {
        'Content-Type': 'application/json',
    },
    paramsSerializer: (params) => {
        const searchParams = new URLSearchParams();
        for (const key in params) {
            const value = params[key];
            if (Array.isArray(value)) {
                value.forEach((v) => searchParams.append(key, v));
            } else if (value !== undefined && value !== null) {
                searchParams.append(key, value.toString());
            }
        }
        return searchParams.toString();
    },
});

apiClient.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem(AUTH_STORAGE_KEYS.token);
        if (token) {
            config.headers = config.headers || {};
            config.headers.Authorization = `Bearer ${token}`;
        }

        const requestPath = normalizeRequestPath(config.url);
        const requestMethod = (config.method || 'get').toLowerCase();
        const requiredPermissions = getRequiredPermissionsForMutation(requestMethod, requestPath);

        if (requiredPermissions.length > 0 && !hasAllPermissions(requiredPermissions)) {
            const message = `无权限执行该操作，缺少权限：${requiredPermissions.join(', ')}`;
            const precheckError = {
                __permission_precheck: true,
                message,
                response: {
                    status: 403,
                    data: { detail: message },
                },
                config,
            };
            alert(message);
            return Promise.reject(precheckError);
        }

        return config;
    },
    (error) => Promise.reject(error)
);

apiClient.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error?.__permission_precheck) {
            return Promise.reject(error);
        }

        if (error.response) {
            const requestPath = normalizeRequestPath(error.config?.url || '');
            const requestMethod = (error.config?.method || 'get').toLowerCase();
            const isLogin401 = error.response.status === 401
                && requestMethod === 'post'
                && requestPath === '/api/v1/token';
            if (error.response.status === 401) {
                if (isLogin401) {
                    return Promise.reject(error);
                }
                console.warn('收到 401 响应，会话已失效');
                localStorage.removeItem(AUTH_STORAGE_KEYS.token);
                localStorage.removeItem(AUTH_STORAGE_KEYS.permissions);
                localStorage.removeItem(AUTH_STORAGE_KEYS.isSuperAdmin);
                const detail = error.response.data?.detail;
                const detailText = typeof detail === 'string' ? detail.toLowerCase() : '';
                const isKicked =
                    detailText.includes('replaced by a newer login')
                    || detailText.includes('newer login')
                    || detailText.includes('session replaced')
                    || detailText.includes('kicked');
                const isIdleTimeout =
                    detailText.includes('due to inactivity')
                    || detailText.includes('idle_timeout')
                    || detailText.includes('inactive');
                const reason = isKicked ? 'kicked' : (isIdleTimeout ? 'idle_timeout' : 'session_expired');
                window.location.href = `/login?reason=${reason}`;
            } else if (error.response.status === 403) {
                console.warn('访问被拒绝，无相应权限：', error.response.data);
                alert(error.response.data?.detail || '您没有权限执行此操作');
            }
        }
        return Promise.reject(error);
    }
);

export const login = (username: string, password: string, force = false) => {
    const params = new URLSearchParams();
    params.append('username', username);
    params.append('password', password);

    return apiClient.post('/api/v1/token', params, {
        params: force ? { force: true } : undefined,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Device-Fingerprint': getDeviceFingerprint(),
        },
    });
};

export const getStats = (dataType: string) => {
    return apiClient.get(`/api/stats/${dataType}`);
};

export const uploadFile = (dataType: string, file: File) => {
    const formData = new FormData();
    formData.append('data_type', dataType);
    formData.append('file', file);

    return apiClient.post('/api/import', formData, {
        headers: {
            'Content-Type': 'multipart/form-data',
        },
    });
};

export default apiClient;
