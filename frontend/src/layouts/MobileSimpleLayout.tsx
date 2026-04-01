import React, { useState } from 'react';
import {
    Box,
    AppBar,
    Toolbar,
    Typography,
    Drawer,
    IconButton,
    Menu,
    MenuItem,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    Alert,
    Button,
} from '@mui/material';
import InsightsIcon from '@mui/icons-material/Insights';
import MenuIcon from '@mui/icons-material/Menu';
import CloseIcon from '@mui/icons-material/Close';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import LockResetIcon from '@mui/icons-material/LockReset';
import LogoutIcon from '@mui/icons-material/Logout';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
import { useTabContext } from '../contexts/TabContext';
import { routeConfigs } from '../config/routes';
import { useAuth } from '../contexts/AuthContext';
import { changeMyPassword, updateMyProfile } from '../api/authManagement';

const drawerWidth = 260;

/**
 * 移动端单页布局组件
 * 支持TabContext动态Tab渲染（与桌面端一致）
 */
export const MobileSimpleLayout: React.FC = () => {
    const [mobileOpen, setMobileOpen] = useState(false);
    const { openTabs, activeTabKey, removeTab } = useTabContext();
    const location = useLocation();
    const navigate = useNavigate();
    const { username, displayName, email, logout, reloadUserInfo } = useAuth();
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const [profileOpen, setProfileOpen] = useState(false);
    const [passwordOpen, setPasswordOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [profileDraft, setProfileDraft] = useState({ display_name: '', email: '' });
    const [passwordDraft, setPasswordDraft] = useState({ old_password: '', new_password: '', confirm_password: '' });

    const handleDrawerToggle = () => {
        setMobileOpen(!mobileOpen);
    };

    // 获取当前激活的Tab
    const activeTab = openTabs.find(tab => tab.key === activeTabKey);

    // 根据路径获取页面标题（当没有激活Tab时）
    const getPageTitle = () => {
        if (activeTab) return activeTab.title;
        const currentPath = location.pathname;
        if (currentPath === '/' || currentPath === '') return '电力交易辅助分析系统';

        // 尝试匹配路由配置中的标题
        const config = routeConfigs.find(c => {
            const pattern = c.path.replace(/:\w+/g, '.*');
            return new RegExp(`^${pattern}$`).test(currentPath);
        });
        return config ? config.title : '交易系统';
    };

    // 关闭当前Tab或返回上一页
    const handleBack = () => {
        if (activeTabKey) {
            removeTab(activeTabKey);
        } else {
            navigate(-1);
        }
    };

    const isRoot = location.pathname === '/' || location.pathname === '';
    const showBackButton = activeTab || !isRoot;

    const handleAccountMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
        setAnchorEl(event.currentTarget);
    };

    const handleAccountMenuClose = () => {
        setAnchorEl(null);
    };

    const openProfileDialog = () => {
        setProfileDraft({
            display_name: displayName || '',
            email: email || '',
        });
        setError(null);
        setMessage(null);
        setProfileOpen(true);
        handleAccountMenuClose();
    };

    const openPasswordDialog = () => {
        setPasswordDraft({ old_password: '', new_password: '', confirm_password: '' });
        setError(null);
        setMessage(null);
        setPasswordOpen(true);
        handleAccountMenuClose();
    };

    const onSaveProfile = async () => {
        setSaving(true);
        setError(null);
        setMessage(null);
        try {
            await updateMyProfile({
                display_name: profileDraft.display_name.trim() || undefined,
                email: profileDraft.email.trim() || undefined,
            });
            await reloadUserInfo();
            setMessage('个人信息已更新');
            setProfileOpen(false);
        } catch (e: any) {
            setError(e?.response?.data?.detail || e?.message || '更新个人信息失败');
        } finally {
            setSaving(false);
        }
    };

    const onChangePassword = async () => {
        if (!passwordDraft.old_password || !passwordDraft.new_password) {
            setError('请输入完整密码信息');
            return;
        }
        if (passwordDraft.new_password !== passwordDraft.confirm_password) {
            setError('两次输入的新密码不一致');
            return;
        }
        setSaving(true);
        setError(null);
        setMessage(null);
        try {
            await changeMyPassword({
                old_password: passwordDraft.old_password,
                new_password: passwordDraft.new_password,
            });
            setMessage('密码修改成功，请重新登录。');
            setPasswordOpen(false);
            logout();
        } catch (e: any) {
            setError(e?.response?.data?.detail || e?.message || '修改密码失败');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Box sx={{ display: 'flex', bgcolor: 'background.default', minHeight: '100vh' }}>
            {/* 顶部工具栏 */}
            <AppBar
                position="fixed"
                sx={{
                    zIndex: (theme) => theme.zIndex.drawer + 1,
                    boxShadow: 'none',
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                }}
            >
                <Toolbar>
                    {showBackButton ? (
                        // 有Tab或不在首页时显示返回按钮
                        <IconButton
                            color="inherit"
                            edge="start"
                            onClick={handleBack}
                            sx={{ mr: 1 }}
                        >
                            <ArrowBackIcon />
                        </IconButton>
                    ) : (
                        // 首页且无Tab时显示菜单按钮
                        <IconButton
                            color="inherit"
                            aria-label="open drawer"
                            edge="start"
                            onClick={handleDrawerToggle}
                            sx={{ mr: 2, display: { sm: 'none' } }}
                        >
                            <MenuIcon />
                        </IconButton>
                    )}
                    <InsightsIcon sx={{ mr: 1.5 }} />
                    <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1, fontSize: '1.1rem', fontWeight: 700 }}>
                        {getPageTitle()}
                    </Typography>
                    {activeTab && (
                        <IconButton color="inherit" onClick={handleBack} sx={{ mr: 0.5 }}>
                            <CloseIcon />
                        </IconButton>
                    )}
                    <IconButton color="inherit" onClick={handleAccountMenuOpen}>
                        <AccountCircleIcon />
                    </IconButton>
                </Toolbar>
            </AppBar>
            <Menu
                anchorEl={anchorEl}
                open={Boolean(anchorEl)}
                onClose={handleAccountMenuClose}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
                <MenuItem onClick={openProfileDialog}>
                    <PersonOutlineIcon sx={{ mr: 1, fontSize: 20 }} />
                    编辑个人信息
                </MenuItem>
                <MenuItem onClick={openPasswordDialog}>
                    <LockResetIcon sx={{ mr: 1, fontSize: 20 }} />
                    修改密码
                </MenuItem>
                <MenuItem onClick={() => { handleAccountMenuClose(); logout(); }}>
                    <LogoutIcon sx={{ mr: 1, fontSize: 20 }} />
                    退出系统
                </MenuItem>
            </Menu>

            {/* 侧边栏 */}
            <Box
                component="nav"
                sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}
            >
                {/* 移动端抽屉 */}
                <Drawer
                    variant="temporary"
                    open={mobileOpen}
                    onClose={handleDrawerToggle}
                    ModalProps={{ keepMounted: true }}
                    sx={{
                        display: { xs: 'block', sm: 'none' },
                        '& .MuiDrawer-paper': {
                            boxSizing: 'border-box',
                            width: drawerWidth,
                            borderRight: 'none',
                        },
                    }}
                >
                    <Sidebar isMobile={true} onItemClick={handleDrawerToggle} />
                </Drawer>
                {/* 桌面端抽屉 */}
                <Drawer
                    variant="permanent"
                    sx={{
                        display: { xs: 'none', sm: 'block' },
                        '& .MuiDrawer-paper': {
                            boxSizing: 'border-box',
                            width: drawerWidth,
                            borderRight: 'none',
                        },
                    }}
                    open
                >
                    <Sidebar isMobile={true} onItemClick={handleDrawerToggle} />
                </Drawer>
            </Box>

            {/* 主内容区 */}
            <Box
                component="main"
                sx={{
                    flexGrow: 1,
                    p: activeTab ? 0 : 3,  // Tab页面时无padding，让组件自己控制
                    width: { sm: `calc(100% - ${drawerWidth}px)` },
                }}
            >
                <Toolbar />
                {/* 如果有激活的Tab，显示Tab内容；否则显示路由内容 */}
                {activeTab ? (
                    <Box sx={{ p: 1 }}>
                        {activeTab.component}
                    </Box>
                ) : (
                    <Outlet />
                )}
                {error && (
                    <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError(null)}>
                        {error}
                    </Alert>
                )}
                {message && (
                    <Alert severity="success" sx={{ mt: 1 }} onClose={() => setMessage(null)}>
                        {message}
                    </Alert>
                )}
            </Box>

            <Dialog open={profileOpen} onClose={() => setProfileOpen(false)} fullWidth maxWidth="xs">
                <DialogTitle>编辑个人信息</DialogTitle>
                <DialogContent>
                    <TextField
                        fullWidth
                        margin="dense"
                        label="账户名称"
                        value={username || ''}
                        InputProps={{ readOnly: true }}
                    />
                    <TextField
                        fullWidth
                        margin="dense"
                        label="显示名称"
                        value={profileDraft.display_name}
                        onChange={(e) => setProfileDraft((s) => ({ ...s, display_name: e.target.value }))}
                    />
                    <TextField
                        fullWidth
                        margin="dense"
                        label="邮箱"
                        value={profileDraft.email}
                        onChange={(e) => setProfileDraft((s) => ({ ...s, email: e.target.value }))}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setProfileOpen(false)}>取消</Button>
                    <Button onClick={onSaveProfile} disabled={saving} variant="contained">保存</Button>
                </DialogActions>
            </Dialog>

            <Dialog open={passwordOpen} onClose={() => setPasswordOpen(false)} fullWidth maxWidth="xs">
                <DialogTitle>修改密码</DialogTitle>
                <DialogContent>
                    <TextField
                        fullWidth
                        margin="dense"
                        label="账户名称"
                        value={username || ''}
                        InputProps={{ readOnly: true }}
                    />
                    <TextField
                        fullWidth
                        margin="dense"
                        label="旧密码"
                        type="password"
                        value={passwordDraft.old_password}
                        onChange={(e) => setPasswordDraft((s) => ({ ...s, old_password: e.target.value }))}
                    />
                    <TextField
                        fullWidth
                        margin="dense"
                        label="新密码"
                        type="password"
                        value={passwordDraft.new_password}
                        onChange={(e) => setPasswordDraft((s) => ({ ...s, new_password: e.target.value }))}
                    />
                    <TextField
                        fullWidth
                        margin="dense"
                        label="确认新密码"
                        type="password"
                        value={passwordDraft.confirm_password}
                        onChange={(e) => setPasswordDraft((s) => ({ ...s, confirm_password: e.target.value }))}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setPasswordOpen(false)}>取消</Button>
                    <Button onClick={onChangePassword} disabled={saving} variant="contained">确认修改</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};
