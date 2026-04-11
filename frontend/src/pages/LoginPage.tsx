import React, { useEffect, useState } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import {
    Container,
    Box,
    TextField,
    Button,
    Typography,
    Paper,
    Alert,
    CircularProgress,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
    Link,
} from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import { login } from '../api/client'; // 导入真实的login API
import { AxiosError } from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { AUTH_STORAGE_KEYS } from '../auth/permissionPrecheck';
import LoginEmailVerifyDialog from '../components/auth/LoginEmailVerifyDialog';
import { getSecurityStatus } from '../api/securityAuth';

const LoginPage: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { login: authLogin, isAuthenticated, isPermissionLoaded } = useAuth(); // 使用 AuthContext 的 login 方法
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [showConflictDialog, setShowConflictDialog] = useState(false);
    const [showLoginVerifyDialog, setShowLoginVerifyDialog] = useState(false);

    useEffect(() => {
        const search = new URLSearchParams(location.search);
        const reason = search.get('reason');
        if (reason === 'kicked') {
            setError('当前账号已在其他设备登录，您已被下线，请重新登录');
        } else if (reason === 'idle_timeout') {
            setError('会话因长时间无操作已超时，请重新登录');
        } else if (reason === 'token_expired' || reason === 'session_expired') {
            setError('登录状态已失效，请重新登录');
        }
    }, [location.search]);

    useEffect(() => {
        const search = new URLSearchParams(location.search);
        const reason = search.get('reason');
        const shouldStayOnLogin = ['kicked', 'idle_timeout', 'token_expired', 'session_expired'].includes(reason || '');
        if (isAuthenticated && isPermissionLoaded && !shouldStayOnLogin) {
            navigate('/', { replace: true });
        }
    }, [isAuthenticated, isPermissionLoaded, location.search, navigate]);

    useEffect(() => {
        if (isAuthenticated) {
            return;
        }

        const challengeToken = localStorage.getItem(AUTH_STORAGE_KEYS.challengeToken);
        if (!challengeToken) {
            return;
        }

        const restoreChallenge = async () => {
            try {
                const status = await getSecurityStatus(challengeToken);
                const onlyLoginEmailVerify = status.required_actions.length > 0
                    && status.required_actions.every((item) => item === 'LOGIN_EMAIL_VERIFY');
                if (onlyLoginEmailVerify) {
                    setShowLoginVerifyDialog(true);
                } else {
                    navigate('/security-setup', { replace: true });
                }
            } catch {
                localStorage.removeItem(AUTH_STORAGE_KEYS.challengeToken);
            }
        };

        void restoreChallenge();
    }, [isAuthenticated, navigate]);

    const executeLogin = async (force = false) => {
        setError('');
        setLoading(true);

        if (!username || !password) {
            setError('请输入账户或邮箱，以及密码');
            setLoading(false);
            return;
        }

        try {
            const response = await login(username, password, force);
            if (response.data && response.data.access_token) {
                // 使用 AuthContext 的 login 方法，它会自动处理 token 保存和定时器
                localStorage.removeItem(AUTH_STORAGE_KEYS.challengeToken);
                await authLogin(response.data.access_token);
                navigate('/');
            } else if (response.status === 202 && response.data?.challenge_token) {
                localStorage.setItem(AUTH_STORAGE_KEYS.challengeToken, response.data.challenge_token);
                const requiredActions: string[] = Array.isArray(response.data?.required_actions)
                    ? response.data.required_actions
                    : [];
                const onlyLoginEmailVerify = requiredActions.length > 0
                    && requiredActions.every((item: string) => item === 'LOGIN_EMAIL_VERIFY');
                if (onlyLoginEmailVerify) {
                    setShowLoginVerifyDialog(true);
                } else {
                    navigate('/security-setup');
                }
            } else {
                throw new Error('Token not found in response');
            }
        } catch (err) {
            if (err instanceof AxiosError && err.response?.status === 401) {
                setError('账户/邮箱或密码错误');
            } else if (
                err instanceof AxiosError
                && (err.response?.status === 423
                    || (err.response?.status === 403 && err.response?.data?.detail?.code === 'ACCOUNT_LOCKED'))
            ) {
                const detail = err.response?.data?.detail;
                const detailMessage = typeof detail === 'object' ? detail?.message : '';
                const remainingSeconds = typeof detail === 'object' ? Number(detail?.remaining_seconds || 0) : 0;
                if (remainingSeconds > 0) {
                    const minutes = Math.ceil(remainingSeconds / 60);
                    setError(`账号已临时锁定，请约 ${minutes} 分钟后重试`);
                } else {
                    setError(detailMessage || '账号已临时锁定，请稍后重试');
                }
            } else if (err instanceof AxiosError && err.response?.status === 429) {
                const detail = err.response?.data?.detail;
                const detailText = typeof detail === 'string' ? detail : '';
                const match = detailText.match(/(\d+)\s*per\s*1\s*minute/i);
                if (match) {
                    setError(`登录过于频繁（每分钟最多 ${match[1]} 次），请稍后再试`);
                } else {
                    setError('登录过于频繁，请 1 分钟后重试');
                }
            } else if (err instanceof AxiosError && err.response?.status === 409) {
                setShowConflictDialog(true);
                return;
            } else {
                setError('登录失败，请检查您的凭据或网络连接');
            }
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleLogin = async (event: React.FormEvent) => {
        event.preventDefault();
        await executeLogin(false);
    };

    const handleForceLogin = async () => {
        setShowConflictDialog(false);
        await executeLogin(true);
    };

    return (
        <Container component="main" maxWidth="xs">
            <Paper elevation={6} sx={{ marginTop: 8, padding: 4, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <LockOutlinedIcon sx={{ fontSize: 40, mb: 1 }} color="primary" />
                <Typography component="h1" variant="h5">
                    电力交易辅助分析系统
                </Typography>
                <Typography component="h2" variant="subtitle1" sx={{ mb: 2 }}>
                    用户登录
                </Typography>
                <Box component="form" onSubmit={handleLogin} noValidate sx={{ mt: 1, width: '100%' }}>
                    <Box sx={{ display: 'flex', alignItems: 'flex-end', mb: 2 }}>
                        <PersonOutlineIcon sx={{ color: 'action.active', mr: 1, my: 0.5 }} />
                        <TextField
                            margin="normal"
                            required
                            fullWidth
                            id="username"
                            label="账户或邮箱"
                            name="username"
                            autoComplete="username"
                            autoFocus
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            disabled={loading}
                        />
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'flex-end', mb: 2 }}>
                         <LockOutlinedIcon sx={{ color: 'action.active', mr: 1, my: 0.5 }} />
                         <TextField
                            margin="normal"
                            required
                            fullWidth
                            name="password"
                            label="密码"
                            type="password"
                            id="password"
                            autoComplete="current-password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            disabled={loading}
                        />
                    </Box>
                    
                    {error && <Alert severity="error" sx={{ width: '100%', mb: 2 }}>{error}</Alert>}
                    
                    <Button
                        type="submit"
                        fullWidth
                        variant="contained"
                        sx={{ mt: 3, mb: 2 }}
                        disabled={loading}
                    >
                        {loading ? <CircularProgress size={24} color="inherit" /> : '登 录'}
                    </Button>
                    <Box sx={{ textAlign: 'right' }}>
                        <Link component={RouterLink} to="/forgot-password" underline="hover">
                            忘记密码
                        </Link>
                    </Box>
                </Box>
            </Paper>
            <Dialog open={showConflictDialog} onClose={() => setShowConflictDialog(false)}>
                <DialogTitle>检测到在线会话</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        当前账号已在其他会话登录。继续登录将踢下线旧会话，是否继续？
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowConflictDialog(false)} disabled={loading}>取消</Button>
                    <Button onClick={handleForceLogin} variant="contained" disabled={loading}>继续并踢下线</Button>
                </DialogActions>
            </Dialog>
            <LoginEmailVerifyDialog
                open={showLoginVerifyDialog}
                challengeToken={localStorage.getItem(AUTH_STORAGE_KEYS.challengeToken) || ''}
                onClose={() => setShowLoginVerifyDialog(false)}
                onNeedSecuritySetup={() => {
                    setShowLoginVerifyDialog(false);
                    navigate('/security-setup', { replace: true });
                }}
            />
        </Container>
    );
};

export default LoginPage;
