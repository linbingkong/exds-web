import React, { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import { jwtDecode } from 'jwt-decode';
import apiClient from '../api/client';
import {
    AUTH_STORAGE_KEYS,
    clearPermissionSnapshot,
    writePermissionSnapshot,
} from '../auth/permissionPrecheck';

// ===== 类型定义 =====
interface JwtPayload {
    sub: string;
    exp: number;
    sid?: string;
}

interface UserInfo {
    username: string;
    display_name?: string;
    email?: string;
    roles: string[];
    permissions: string[];
    is_super_admin: boolean;
    can_view_real_customer_name: boolean;
    idle_timeout_minutes: number;
}

interface AuthContextType {
    isAuthenticated: boolean;
    username: string | null;
    displayName: string | null;
    email: string | null;
    roles: string[];
    permissions: string[];
    isSuperAdmin: boolean;
    canViewRealCustomerName: boolean;
    hasPermission: (code: string) => boolean;
    isPermissionLoaded: boolean;
    login: (token: string) => void;
    logout: (reason?: string) => Promise<void>;
    reloadUserInfo: () => Promise<void>;
}

// ===== 工具函数 =====
const AUTH_TOKEN_KEY = AUTH_STORAGE_KEYS.token;

function getToken(): string | null {
    return localStorage.getItem(AUTH_TOKEN_KEY);
}

function removeToken(): void {
    localStorage.removeItem(AUTH_TOKEN_KEY);
}

function decodeToken(token: string): JwtPayload | null {
    try {
        return jwtDecode<JwtPayload>(token);
    } catch {
        return null;
    }
}

async function notifyServerLogout(token: string): Promise<void> {
    try {
        await fetch('/api/v1/auth/logout', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
    } catch {
        // best effort
    }
}

// ===== Context =====
const AuthContext = createContext<AuthContextType>({
    isAuthenticated: false,
    username: null,
    displayName: null,
    email: null,
    roles: [],
    permissions: [],
    isSuperAdmin: false,
    canViewRealCustomerName: false,
    hasPermission: () => false,
    isPermissionLoaded: false,
    login: () => { },
    logout: async () => { },
    reloadUserInfo: async () => { },
});

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
    const [username, setUsername] = useState<string | null>(null);
    const [displayName, setDisplayName] = useState<string | null>(null);
    const [email, setEmail] = useState<string | null>(null);
    const [roles, setRoles] = useState<string[]>([]);
    const [permissions, setPermissions] = useState<string[]>([]);
    const [isSuperAdmin, setIsSuperAdmin] = useState<boolean>(false);
    const [canViewRealCustomerName, setCanViewRealCustomerName] = useState<boolean>(false);
    const [isPermissionLoaded, setIsPermissionLoaded] = useState<boolean>(false);

    // 空闲超时相关
    const [idleTimeoutMinutes, setIdleTimeoutMinutes] = useState<number>(30);
    const [showIdleWarning, setShowIdleWarning] = useState<boolean>(false);
    const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const sessionProbeRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const WARNING_BEFORE_SECONDS = 120; // 提前 2 分钟警告

    // ===== 登出 =====
    const logout = useCallback(async (reason?: string) => {
        const token = getToken();
        if (token) {
            await notifyServerLogout(token);
        }
        removeToken();
        localStorage.removeItem(AUTH_STORAGE_KEYS.challengeToken);
        clearPermissionSnapshot();
        setIsAuthenticated(false);
        setUsername(null);
        setDisplayName(null);
        setEmail(null);
        setRoles([]);
        setPermissions([]);
        setIsSuperAdmin(false);
        setCanViewRealCustomerName(false);
        setIsPermissionLoaded(false);
        setShowIdleWarning(false);
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
        const redirect = reason ? `/login?reason=${encodeURIComponent(reason)}` : '/login';
        window.location.replace(redirect);
    }, []);

    // ===== 权限加载 =====
    const loadUserPermissions = useCallback(async () => {
        try {
            const res = await apiClient.get<UserInfo>('/api/v1/auth/me');
            const info = res.data;
            setDisplayName(info.display_name || info.username);
            setEmail(info.email || null);
            setRoles(info.roles);
            setPermissions(info.permissions);
            setIsSuperAdmin(info.is_super_admin);
            setCanViewRealCustomerName(info.can_view_real_customer_name);
            setIdleTimeoutMinutes(info.idle_timeout_minutes || 30);
            writePermissionSnapshot({
                permissions: info.permissions || [],
                isSuperAdmin: info.is_super_admin || false,
            });
        } catch (e) {
            console.warn('权限加载失败，使用空权限集', e);
            clearPermissionSnapshot();
        } finally {
            setIsPermissionLoaded(true);
        }
    }, []);

    const hasPermission = useCallback(
        (code: string): boolean => {
            if (isSuperAdmin) return true;
            return permissions.includes(code);
        },
        [isSuperAdmin, permissions]
    );

    // ===== 空闲超时计时器 =====
    const resetIdleTimer = useCallback(() => {
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
        setShowIdleWarning(false);

        const totalMs = idleTimeoutMinutes * 60 * 1000;
        const warningMs = totalMs - WARNING_BEFORE_SECONDS * 1000;

        if (warningMs > 0) {
            warningTimerRef.current = setTimeout(() => {
                setShowIdleWarning(true);
            }, warningMs);
        }

        idleTimerRef.current = setTimeout(() => {
            void logout('idle_timeout');
        }, totalMs);
    }, [idleTimeoutMinutes, logout]);

    // ===== 登录 =====
    const login = useCallback(async (token: string) => {
        localStorage.setItem(AUTH_TOKEN_KEY, token);
        const decoded = decodeToken(token);
        if (!decoded) {
            removeToken();
            clearPermissionSnapshot();
            return;
        }
        setUsername(decoded.sub);
        setIsAuthenticated(true);
        await loadUserPermissions();
    }, [loadUserPermissions]);

    // ===== 初始化：检查本地 token =====
    useEffect(() => {
        const token = getToken();
        if (!token) return;
        const decoded = decodeToken(token);
        if (!decoded || decoded.exp * 1000 < Date.now()) {
            removeToken();
            clearPermissionSnapshot();
            return;
        }
        setUsername(decoded.sub);
        setIsAuthenticated(true);
        loadUserPermissions();

        // JWT 绝对过期兜底
        const remainingMs = decoded.exp * 1000 - Date.now();
        const expTimer = setTimeout(() => { void logout('token_expired'); }, remainingMs);
        return () => clearTimeout(expTimer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);  // 仅在挂载时执行一次

    // ===== 空闲事件监听 =====
    useEffect(() => {
        if (!isAuthenticated) return;
        const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
        const handler = () => resetIdleTimer();
        events.forEach(evt => window.addEventListener(evt, handler, { passive: true }));
        resetIdleTimer(); // 登录后立即启动
        return () => {
            events.forEach(evt => window.removeEventListener(evt, handler));
            if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
            if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
        };
    }, [isAuthenticated, resetIdleTimer]);

    // ===== 会话有效性探测（用于“被踢下线”快速生效） =====
    useEffect(() => {
        if (!isAuthenticated) {
            if (sessionProbeRef.current) {
                clearInterval(sessionProbeRef.current);
                sessionProbeRef.current = null;
            }
            return;
        }

        const probe = async () => {
            try {
                await apiClient.get('/api/v1/auth/me');
            } catch {
                // 401 将由 apiClient 拦截器统一处理并跳转登录页
            }
        };

        probe();
        sessionProbeRef.current = setInterval(probe, 20000);

        return () => {
            if (sessionProbeRef.current) {
                clearInterval(sessionProbeRef.current);
                sessionProbeRef.current = null;
            }
        };
    }, [isAuthenticated]);

    // ===== 空闲警告弹窗 =====
    const IdleWarningDialog = showIdleWarning ? (
        <div
            style={{
                position: 'fixed', inset: 0, zIndex: 9999,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: 'rgba(0,0,0,0.5)',
            }}
        >
            <div
                style={{
                    background: '#fff', borderRadius: 8, padding: '32px 40px',
                    minWidth: 320, boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
                    textAlign: 'center',
                }}
            >
                <div style={{ fontSize: 40, marginBottom: 12 }}>⏱️</div>
                <h3 style={{ margin: '0 0 8px', color: '#333' }}>即将自动退出</h3>
                <p style={{ color: '#666', marginBottom: 24 }}>
                    检测到您已长时间无操作。<br />
                    如需继续使用，请点击下方按钮。
                </p>
                <button
                    onClick={() => { setShowIdleWarning(false); resetIdleTimer(); }}
                    style={{
                        background: '#1976d2', color: '#fff', border: 'none',
                        borderRadius: 6, padding: '10px 28px', fontSize: 15,
                        cursor: 'pointer', marginRight: 12,
                    }}
                >
                    继续使用
                </button>
                <button
                    onClick={() => logout('user_idle_choice')}
                    style={{
                        background: '#fff', color: '#666', border: '1px solid #ccc',
                        borderRadius: 6, padding: '10px 28px', fontSize: 15,
                        cursor: 'pointer',
                    }}
                >
                    退出登录
                </button>
            </div>
        </div>
    ) : null;

    return (
        <AuthContext.Provider
            value={{
                isAuthenticated,
                username,
                displayName,
                email,
                roles,
                permissions,
                isSuperAdmin,
                canViewRealCustomerName,
                hasPermission,
                isPermissionLoaded,
                login,
                logout,
                reloadUserInfo: loadUserPermissions,
            }}
        >
            {children}
            {IdleWarningDialog}
        </AuthContext.Provider>
    );
};

export function useAuth(): AuthContextType {
    return useContext(AuthContext);
}

export default AuthContext;
