import React, { useEffect, useMemo, useState } from 'react';
import { AxiosError } from 'axios';
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Paper,
    Stack,
    TextField,
    Typography,
} from '@mui/material';
import {
    completeSecuritySetup,
    getSecurityStatus,
    resendLoginEmailCode,
    verifySecurityEmail,
} from '../../api/securityAuth';
import { AUTH_STORAGE_KEYS } from '../../auth/permissionPrecheck';
import { useAuth } from '../../contexts/AuthContext';

interface LoginEmailVerifyDialogProps {
    open: boolean;
    challengeToken: string;
    onClose: () => void;
    onNeedSecuritySetup?: () => void;
}

const LoginEmailVerifyDialog: React.FC<LoginEmailVerifyDialogProps> = ({
    open,
    challengeToken,
    onClose,
    onNeedSecuritySetup,
}) => {
    const { login: authLogin } = useAuth();
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [code, setCode] = useState('');
    const [showConflictDialog, setShowConflictDialog] = useState(false);
    const [status, setStatus] = useState<{ username?: string; display_name?: string; email?: string; required_actions: string[] } | null>(null);

    const onlyLoginEmailVerify = useMemo(
        () => Boolean(status) && status!.required_actions.every((item) => item === 'LOGIN_EMAIL_VERIFY'),
        [status],
    );

    useEffect(() => {
        if (!open || !challengeToken) {
            return;
        }

        const load = async () => {
            setLoading(true);
            setError('');
            try {
                const nextStatus = await getSecurityStatus(challengeToken);
                setStatus(nextStatus);
                if (!nextStatus.required_actions.includes('LOGIN_EMAIL_VERIFY')) {
                    onNeedSecuritySetup?.();
                }
            } catch (err) {
                const detail = err instanceof AxiosError ? err.response?.data?.detail : '';
                setError(typeof detail === 'string' ? detail : '安全验证会话已失效，请重新登录');
            } finally {
                setLoading(false);
            }
        };

        void load();
    }, [challengeToken, onNeedSecuritySetup, open]);

    const applyError = (err: unknown, fallback: string) => {
        const detail = err instanceof AxiosError ? err.response?.data?.detail : '';
        setError(typeof detail === 'string' ? detail : fallback);
    };

    const finishLogin = async (force = false) => {
        setSaving(true);
        setError('');
        try {
            const result = await completeSecuritySetup(challengeToken, force);
            localStorage.removeItem(AUTH_STORAGE_KEYS.challengeToken);
            await authLogin(result.access_token);
            onClose();
        } catch (err) {
            if (err instanceof AxiosError && err.response?.status === 409) {
                setShowConflictDialog(true);
                return;
            }

            const detail = err instanceof AxiosError ? err.response?.data?.detail : '';
            if (typeof detail === 'object' && detail && 'required_actions' in detail) {
                onNeedSecuritySetup?.();
            } else {
                applyError(err, '完成登录失败');
            }
        } finally {
            setSaving(false);
        }
    };

    const handleVerify = async () => {
        if (!code.trim()) {
            setError('请输入邮箱验证码');
            return;
        }

        setSaving(true);
        setError('');
        try {
            const result = await verifySecurityEmail(challengeToken, code.trim());
            setStatus(result);
            setMessage(result.message);
            setCode('');
            if (!result.required_actions.includes('LOGIN_EMAIL_VERIFY')) {
                await finishLogin(false);
            }
        } catch (err) {
            applyError(err, '邮箱验证失败');
        } finally {
            setSaving(false);
        }
    };

    const handleResend = async () => {
        setSaving(true);
        setError('');
        try {
            const result = await resendLoginEmailCode(challengeToken);
            setStatus(result);
            setMessage(result.message);
        } catch (err) {
            applyError(err, '验证码发送失败');
        } finally {
            setSaving(false);
        }
    };

    const handleClose = () => {
        if (saving) {
            return;
        }
        localStorage.removeItem(AUTH_STORAGE_KEYS.challengeToken);
        setCode('');
        setStatus(null);
        setError('');
        setMessage('');
        onClose();
    };

    return (
        <>
            <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
                <DialogContent sx={{ pt: 3 }}>
                    <Paper elevation={0} sx={{ p: 1, bgcolor: 'transparent' }}>
                        <Stack spacing={2}>
                            <Box>
                                <Typography variant="h5">新设备邮件验证</Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                                    当前登录设备尚未被信任，请完成邮箱验证码校验后进入系统。
                                </Typography>
                            </Box>

                            {loading ? (
                                <Box display="flex" justifyContent="center" py={4}>
                                    <CircularProgress />
                                </Box>
                            ) : (
                                <>
                                    {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
                                    {message && <Alert severity="success" onClose={() => setMessage('')}>{message}</Alert>}

                                    {status && (
                                        <Alert severity="info">
                                            当前用户：{status.display_name || status.username}
                                            {status.email ? `，验证邮箱：${status.email}` : ''}
                                        </Alert>
                                    )}

                                    {status && !onlyLoginEmailVerify && (
                                        <Alert severity="warning">
                                            当前挑战包含其他安全动作，正在切换到首次登录安全设置流程。
                                        </Alert>
                                    )}

                                    {status && onlyLoginEmailVerify && (
                                        <Stack spacing={2}>
                                            <TextField
                                                label="邮箱验证码"
                                                value={code}
                                                onChange={(e) => setCode(e.target.value)}
                                                fullWidth
                                            />
                                            <Typography variant="caption" color="text.secondary">
                                                验证成功后，当前设备会自动加入已信任设备列表。
                                            </Typography>
                                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                                                <Button variant="outlined" onClick={handleResend} disabled={saving}>
                                                    重新发送验证码
                                                </Button>
                                                <Button variant="contained" onClick={handleVerify} disabled={saving}>
                                                    验证并进入系统
                                                </Button>
                                            </Stack>
                                        </Stack>
                                    )}
                                </>
                            )}
                        </Stack>
                    </Paper>
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 3 }}>
                    <Button onClick={handleClose} disabled={saving}>返回登录页</Button>
                </DialogActions>
            </Dialog>

            <Dialog open={showConflictDialog} onClose={() => setShowConflictDialog(false)}>
                <DialogTitle>检测到在线会话</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" color="text.secondary">
                        当前账号已在其他会话登录。继续进入系统将踢下线旧会话，是否继续？
                    </Typography>
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
        </>
    );
};

export default LoginEmailVerifyDialog;
