import React, { useEffect, useMemo, useState } from 'react';
import { AxiosError } from 'axios';
import { useNavigate } from 'react-router-dom';
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Container,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    Paper,
    Stack,
    Step,
    StepLabel,
    Stepper,
    TextField,
    Typography,
} from '@mui/material';
import {
    bindSecurityEmail,
    changeRequiredPassword,
    completeSecuritySetup,
    getSecurityStatus,
    verifySecurityEmail,
    type SecurityStatus,
} from '../api/securityAuth';
import { useAuth } from '../contexts/AuthContext';
import { AUTH_STORAGE_KEYS } from '../auth/permissionPrecheck';

const SecuritySetupPage: React.FC = () => {
    const navigate = useNavigate();
    const { login: authLogin } = useAuth();
    const challengeToken = localStorage.getItem(AUTH_STORAGE_KEYS.challengeToken) || '';

    const [status, setStatus] = useState<SecurityStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [email, setEmail] = useState('');
    const [code, setCode] = useState('');
    const [showConflictDialog, setShowConflictDialog] = useState(false);

    const steps = useMemo(() => ([
        { key: 'CHANGE_PASSWORD', label: '修改密码' },
        { key: 'BIND_EMAIL', label: '绑定邮箱' },
        { key: 'VERIFY_EMAIL', label: '验证邮箱' },
    ]), []);

    const activeStep = useMemo(() => {
        const requiredActions = status?.required_actions || [];
        const pendingKey = steps.find((item) => requiredActions.includes(item.key))?.key;
        return Math.max(0, steps.findIndex((item) => item.key === pendingKey));
    }, [status?.required_actions, steps]);

    useEffect(() => {
        if (!challengeToken) {
            navigate('/login', { replace: true });
            return;
        }

        const load = async () => {
            setLoading(true);
            try {
                const nextStatus = await getSecurityStatus(challengeToken);
                const onlyLoginEmailVerify = nextStatus.required_actions.length > 0
                    && nextStatus.required_actions.every((item) => item === 'LOGIN_EMAIL_VERIFY');
                if (onlyLoginEmailVerify) {
                    navigate('/login', { replace: true });
                    return;
                }
                setStatus(nextStatus);
                setEmail(nextStatus.email || '');
            } catch (err) {
                const detail = err instanceof AxiosError ? err.response?.data?.detail : '';
                setError(typeof detail === 'string' ? detail : '安全验证会话已失效，请重新登录');
                localStorage.removeItem(AUTH_STORAGE_KEYS.challengeToken);
                navigate('/login', { replace: true });
            } finally {
                setLoading(false);
            }
        };

        void load();
    }, [challengeToken, navigate]);

    const applyStatus = (nextStatus: SecurityStatus, nextMessage?: string) => {
        setStatus(nextStatus);
        setEmail(nextStatus.email || '');
        setMessage(nextMessage || '');
        setError('');
    };

    const handleChangePassword = async () => {
        if (!challengeToken) return;
        if (!password || !confirmPassword) {
            setError('请输入并确认新密码');
            return;
        }
        if (password !== confirmPassword) {
            setError('两次输入的新密码不一致');
            return;
        }

        setSaving(true);
        try {
            const result = await changeRequiredPassword(challengeToken, password);
            applyStatus(result, result.message);
            setPassword('');
            setConfirmPassword('');
        } catch (err) {
            const detail = err instanceof AxiosError ? err.response?.data?.detail : '';
            setError(typeof detail === 'string' ? detail : '密码修改失败');
        } finally {
            setSaving(false);
        }
    };

    const handleSendCode = async () => {
        if (!challengeToken) return;
        if (!email.trim()) {
            setError('请输入邮箱地址');
            return;
        }

        setSaving(true);
        try {
            const result = await bindSecurityEmail(challengeToken, email.trim());
            applyStatus(result, result.message);
        } catch (err) {
            const detail = err instanceof AxiosError ? err.response?.data?.detail : '';
            setError(typeof detail === 'string' ? detail : '验证码发送失败');
        } finally {
            setSaving(false);
        }
    };

    const handleVerifyCode = async () => {
        if (!challengeToken) return;
        if (!code.trim()) {
            setError('请输入邮箱验证码');
            return;
        }

        setSaving(true);
        try {
            const result = await verifySecurityEmail(challengeToken, code.trim());
            applyStatus(result, result.message);
            setCode('');
        } catch (err) {
            const detail = err instanceof AxiosError ? err.response?.data?.detail : '';
            setError(typeof detail === 'string' ? detail : '邮箱验证失败');
        } finally {
            setSaving(false);
        }
    };

    const finishLogin = async (force = false) => {
        if (!challengeToken) return;
        setSaving(true);
        try {
            const result = await completeSecuritySetup(challengeToken, force);
            localStorage.removeItem(AUTH_STORAGE_KEYS.challengeToken);
            await authLogin(result.access_token);
            navigate('/', { replace: true });
        } catch (err) {
            if (err instanceof AxiosError && err.response?.status === 409) {
                setShowConflictDialog(true);
                return;
            }
            const detail = err instanceof AxiosError ? err.response?.data?.detail : '';
            if (typeof detail === 'object' && detail && 'required_actions' in detail) {
                setError((detail as { message?: string }).message || '仍有未完成的安全动作');
                try {
                    const latestStatus = await getSecurityStatus(challengeToken);
                    setStatus(latestStatus);
                } catch {
                    localStorage.removeItem(AUTH_STORAGE_KEYS.challengeToken);
                    navigate('/login', { replace: true });
                }
            } else {
                setError(typeof detail === 'string' ? detail : '完成登录失败');
            }
        } finally {
            setSaving(false);
        }
    };

    const handleBackToLogin = () => {
        localStorage.removeItem(AUTH_STORAGE_KEYS.challengeToken);
        navigate('/login', { replace: true });
    };

    if (loading) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Container maxWidth="sm" sx={{ py: 6 }}>
            <Paper elevation={4} sx={{ p: 4 }}>
                <Stack spacing={2}>
                    <Box>
                        <Typography variant="h5">首次登录安全设置</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                            请先完成当前登录所需的安全校验，完成后系统才会签发正式登录会话。
                        </Typography>
                    </Box>

                    <Stepper activeStep={activeStep} alternativeLabel>
                        {steps.map((item) => (
                            <Step
                                key={item.key}
                                completed={!status?.required_actions.includes(item.key)}
                            >
                                <StepLabel>{item.label}</StepLabel>
                            </Step>
                        ))}
                    </Stepper>

                    {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
                    {message && <Alert severity="success" onClose={() => setMessage('')}>{message}</Alert>}

                    <Alert severity="info">
                        当前用户：{status?.display_name || status?.username}
                        {status?.email ? `，当前邮箱：${status.email}` : '，当前尚未绑定邮箱'}
                    </Alert>

                    {status?.required_actions.includes('CHANGE_PASSWORD') && (
                        <Stack spacing={2}>
                            <Typography variant="subtitle1">1. 修改密码</Typography>
                            <TextField
                                label="新密码"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                autoComplete="new-password"
                                fullWidth
                            />
                            <TextField
                                label="确认新密码"
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                autoComplete="new-password"
                                fullWidth
                            />
                            <Typography variant="caption" color="text.secondary">
                                密码长度至少 8 位，且需满足大写字母、小写字母、数字、特殊字符四类中的至少三类。
                            </Typography>
                            <Button variant="contained" onClick={handleChangePassword} disabled={saving}>
                                保存新密码
                            </Button>
                        </Stack>
                    )}

                    {!status?.required_actions.includes('CHANGE_PASSWORD') && (
                        <Alert severity="success">密码修改已完成</Alert>
                    )}

                    {!status?.required_actions.includes('CHANGE_PASSWORD')
                        && (status?.required_actions.includes('BIND_EMAIL') || status?.required_actions.includes('VERIFY_EMAIL')) && (
                        <Stack spacing={2}>
                            <Typography variant="subtitle1">2. 绑定并验证邮箱</Typography>
                            <TextField
                                label="邮箱"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                fullWidth
                            />
                            <Typography variant="caption" color="text.secondary">
                                邮箱绑定用于找回密码、消息订阅、设备认证等。
                            </Typography>
                            <Button variant="outlined" onClick={handleSendCode} disabled={saving}>
                                发送验证码
                            </Button>
                            <TextField
                                label="邮箱验证码"
                                value={code}
                                onChange={(e) => setCode(e.target.value)}
                                fullWidth
                            />
                            <Button variant="contained" onClick={handleVerifyCode} disabled={saving}>
                                验证邮箱
                            </Button>
                            <Typography variant="caption" color="text.secondary">
                                邮箱验证完成后，当前登录设备会在进入系统时自动设为已信任设备。
                            </Typography>
                        </Stack>
                    )}

                    {!status?.required_actions.includes('CHANGE_PASSWORD')
                        && !status?.required_actions.includes('BIND_EMAIL')
                        && !status?.required_actions.includes('VERIFY_EMAIL')
                        && (
                            <Alert severity="success">必做安全动作已全部完成，可以进入系统。</Alert>
                        )}

                    <Stack direction="row" spacing={1} justifyContent="space-between">
                        <Button onClick={handleBackToLogin} disabled={saving}>返回登录页</Button>
                        <Button
                            variant="contained"
                            onClick={() => void finishLogin(false)}
                            disabled={saving || Boolean(status?.required_actions.length)}
                        >
                            进入系统
                        </Button>
                    </Stack>
                </Stack>
            </Paper>

            <Dialog open={showConflictDialog} onClose={() => setShowConflictDialog(false)}>
                <DialogTitle>检测到在线会话</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        当前账号已在其他会话登录。继续进入系统将踢下线旧会话，是否继续？
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowConflictDialog(false)} disabled={saving}>取消</Button>
                    <Button
                        variant="contained"
                        onClick={() => {
                            setShowConflictDialog(false);
                            void finishLogin(true);
                        }}
                        disabled={saving}
                    >
                        继续并踢下线
                    </Button>
                </DialogActions>
            </Dialog>
        </Container>
    );
};

export default SecuritySetupPage;
