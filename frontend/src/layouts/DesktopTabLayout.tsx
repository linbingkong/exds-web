import React, { useState, useEffect } from 'react';
import {
    Box,
    AppBar,
    Toolbar,
    Typography,
    Drawer,
    IconButton,
    Tabs,
    Tab,
    Menu,
    MenuItem,
    Divider,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    Alert,
    Button,
    Tooltip,
} from '@mui/material';
import InsightsIcon from '@mui/icons-material/Insights';
import MenuIcon from '@mui/icons-material/Menu';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import CloseIcon from '@mui/icons-material/Close';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import LogoutIcon from '@mui/icons-material/Logout';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import LockResetIcon from '@mui/icons-material/LockReset';
import { Sidebar } from '../components/Sidebar';
import { getRouteConfig } from '../config/routes';
import { PINNED_TAB_PATHS, useTabContext } from '../contexts/TabContext';
import { useAuth } from '../contexts/AuthContext';
import { changeMyPassword, updateMyProfile } from '../api/authManagement';

const drawerWidth = 260;
const sidebarStorageKey = 'exds:desktop-sidebar-collapsed';
const FULL_BLEED_TAB_PATHS = ['/dashboard', '/trading-strategy/day-ahead'];

export const DesktopTabLayout: React.FC = () => {
    const [mobileOpen, setMobileOpen] = useState(false);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const { openTabs, activeTabKey, setActiveTab, removeTab, addTab } = useTabContext();
    const [currentDateTime, setCurrentDateTime] = useState(new Date());
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const { username, displayName, email, logout, reloadUserInfo, hasPermission, isPermissionLoaded } = useAuth();
    const [profileOpen, setProfileOpen] = useState(false);
    const [passwordOpen, setPasswordOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [profileDraft, setProfileDraft] = useState({ display_name: '', email: '' });
    const [passwordDraft, setPasswordDraft] = useState({ old_password: '', new_password: '', confirm_password: '' });

    // 实时更新日期时间
    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentDateTime(new Date());
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        const savedState = localStorage.getItem(sidebarStorageKey);
        if (savedState === null) {
            return;
        }
        try {
            setSidebarCollapsed(JSON.parse(savedState));
        } catch (loadError) {
            console.error('读取侧边栏折叠状态失败:', loadError);
        }
    }, []);

    useEffect(() => {
        localStorage.setItem(sidebarStorageKey, JSON.stringify(sidebarCollapsed));
    }, [sidebarCollapsed]);

    useEffect(() => {
        if (!isPermissionLoaded || !hasPermission('module:dashboard_overview:view')) {
            return;
        }
        if (openTabs.some((tab) => tab.key === '/dashboard')) {
            if (!activeTabKey) {
                setActiveTab('/dashboard');
            }
            return;
        }
        const routeConfig = getRouteConfig('/dashboard');
        if (!routeConfig) {
            return;
        }
        const Component = routeConfig.component;
        addTab({
            key: '/dashboard',
            title: routeConfig.title,
            path: '/dashboard',
            component: <Component />,
        });
    }, [activeTabKey, addTab, hasPermission, isPermissionLoaded, openTabs, setActiveTab]);

    // 格式化日期时间显示
    const formatDateTime = (date: Date) => {
        const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const weekday = weekdays[date.getDay()];
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day} ${weekday} ${hours}:${minutes}`;
    };

    const handleDrawerToggle = () => {
        setMobileOpen(!mobileOpen);
    };

    const handleSidebarToggle = () => {
        setSidebarCollapsed((prev) => !prev);
    };

    const handleTabChange = (_event: React.SyntheticEvent, newValue: string) => {
        setActiveTab(newValue);
    };

    const handleTabClose = (event: React.MouseEvent, tabKey: string) => {
        event.stopPropagation();
        removeTab(tabKey);
    };

    const handleAccountMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
        setAnchorEl(event.currentTarget);
    };

    const handleAccountMenuClose = () => {
        setAnchorEl(null);
    };

    const handleLogout = () => {
        handleAccountMenuClose();
        logout();
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

    const currentDrawerWidth = sidebarCollapsed ? 0 : drawerWidth;

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
                    <IconButton
                        color="inherit"
                        aria-label="open drawer"
                        edge="start"
                        onClick={handleDrawerToggle}
                        sx={{ mr: 2, display: { sm: 'none' } }}
                    >
                        <MenuIcon />
                    </IconButton>
                    <InsightsIcon sx={{ mr: 1.5 }} />
                    <Typography variant="h6" noWrap component="div">
                        电力交易辅助分析系统
                    </Typography>
                    <Tooltip title={sidebarCollapsed ? '展开菜单' : '折叠菜单'}>
                        <IconButton
                            color="inherit"
                            onClick={handleSidebarToggle}
                            sx={{ ml: 1, display: { xs: 'none', md: 'inline-flex' } }}
                            aria-label={sidebarCollapsed ? '展开菜单' : '折叠菜单'}
                        >
                            {sidebarCollapsed ? <MenuIcon /> : <ChevronLeftIcon />}
                        </IconButton>
                    </Tooltip>

                    {/* 右侧工具栏（仅桌面端显示） */}
                    <Box sx={{ flexGrow: 1 }} />
                    <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 3 }}>
                        {/* 日期时间 */}
                        <Typography variant="body2" sx={{ color: 'inherit' }}>
                            {formatDateTime(currentDateTime)}
                        </Typography>

                        {/* 账号菜单 */}
                        <Box
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.5,
                                cursor: 'pointer',
                                '&:hover': {
                                    opacity: 0.8,
                                },
                            }}
                            onClick={handleAccountMenuOpen}
                        >
                            <AccountCircleIcon />
                            <Typography variant="body2">{displayName || username || '未登录'}</Typography>
                        </Box>
                    </Box>

                    {/* 账号下拉菜单 */}
                    <Menu
                        anchorEl={anchorEl}
                        open={Boolean(anchorEl)}
                        onClose={handleAccountMenuClose}
                        anchorOrigin={{
                            vertical: 'bottom',
                            horizontal: 'right',
                        }}
                        transformOrigin={{
                            vertical: 'top',
                            horizontal: 'right',
                        }}
                    >
                        <MenuItem onClick={openProfileDialog}>
                            <PersonOutlineIcon sx={{ mr: 1, fontSize: 20 }} />
                            编辑个人信息
                        </MenuItem>
                        <MenuItem onClick={openPasswordDialog}>
                            <LockResetIcon sx={{ mr: 1, fontSize: 20 }} />
                            修改密码
                        </MenuItem>
                        <Divider />
                        <MenuItem onClick={handleLogout}>
                            <LogoutIcon sx={{ mr: 1, fontSize: 20 }} />
                            退出系统
                        </MenuItem>
                    </Menu>
                </Toolbar>
            </AppBar>

            {/* 侧边栏 */}
            <Box
                component="nav"
                sx={{
                    width: { md: currentDrawerWidth },
                    flexShrink: 0,
                    transition: 'width 0.3s ease-in-out',
                }}
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
                    <Sidebar />
                </Drawer>
                {/* 桌面端抽屉 */}
                <Drawer
                    variant="permanent"
                    sx={{
                        display: { xs: 'none', md: 'block' },
                        '& .MuiDrawer-paper': {
                            boxSizing: 'border-box',
                            width: currentDrawerWidth,
                            transition: 'width 0.3s ease-in-out',
                            overflowX: 'hidden',
                            borderRight: sidebarCollapsed ? 'none' : '1px solid',
                            borderColor: 'divider',
                            '& > *': {
                                visibility: sidebarCollapsed ? 'hidden' : 'visible',
                            },
                        },
                    }}
                    open
                >
                    <Sidebar />
                </Drawer>
            </Box>

            {/* 主内容区 */}
            <Box
                component="main"
                sx={{
                    flexGrow: 1,
                    width: { md: `calc(100% - ${currentDrawerWidth}px)` },
                    transition: 'width 0.3s ease-in-out',
                    display: 'flex',
                    flexDirection: 'column',
                }}
            >
                <Toolbar />

                {/* 页签栏 */}
                {openTabs.length > 0 && (
                    <Box
                        sx={{
                            borderBottom: 1,
                            borderColor: 'divider',
                            bgcolor: 'background.paper',
                        }}
                    >
                        <Tabs
                            value={activeTabKey}
                            onChange={handleTabChange}
                            variant="scrollable"
                            scrollButtons="auto"
                            sx={{
                                minHeight: 48,
                                '& .MuiTab-root': {
                                    minHeight: 48,
                                    textTransform: 'none',
                                },
                            }}
                        >
                            {openTabs.map((tab) => (
                                <Tab
                                    key={tab.key}
                                    value={tab.key}
                                    label={
                                        <Box
                                            sx={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 1,
                                            }}
                                        >
                                            <span>{tab.title}</span>
                                            {!PINNED_TAB_PATHS.includes(tab.key) && (
                                                <IconButton
                                                    component="span"
                                                    size="small"
                                                    onClick={(e) => handleTabClose(e, tab.key)}
                                                    sx={{
                                                        padding: '2px',
                                                        '&:hover': {
                                                            bgcolor: 'action.hover',
                                                        },
                                                    }}
                                                >
                                                    <CloseIcon fontSize="small" />
                                                </IconButton>
                                            )}
                                        </Box>
                                    }
                                />
                            ))}
                        </Tabs>
                    </Box>
                )}

                {error && (
                    <Alert severity="error" sx={{ m: 2 }} onClose={() => setError(null)}>
                        {error}
                    </Alert>
                )}
                {message && (
                    <Alert severity="success" sx={{ mx: 2, mt: error ? 0 : 2 }} onClose={() => setMessage(null)}>
                        {message}
                    </Alert>
                )}

                {/* 页签内容区 */}
                <Box
                    sx={{
                        flexGrow: 1,
                        p: FULL_BLEED_TAB_PATHS.includes(activeTabKey || '') ? 0 : 3,
                        overflow: FULL_BLEED_TAB_PATHS.includes(activeTabKey || '') ? 'hidden' : 'auto',
                        minHeight: 0,
                        display: FULL_BLEED_TAB_PATHS.includes(activeTabKey || '') ? 'flex' : 'block',
                    }}
                >
                    {openTabs.length === 0 ? (
                        <Box
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                height: '100%',
                                color: 'text.secondary',
                            }}
                        >
                            <Typography variant="h6">
                                请从左侧菜单选择要打开的页面
                            </Typography>
                        </Box>
                    ) : (
                        openTabs.map((tab) => (
                            <Box
                                key={tab.key}
                                sx={{
                                    display: activeTabKey === tab.key ? 'flex' : 'none',
                                    flexDirection: 'column',
                                    height: FULL_BLEED_TAB_PATHS.includes(tab.key) ? '100%' : 'auto',
                                    minHeight: 0,
                                    width: '100%',
                                }}
                            >
                                {tab.component}
                            </Box>
                        ))
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
        </Box>
    );
};
