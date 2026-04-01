import React, { useEffect, useState } from 'react';
import { Box, Collapse, Divider, List, ListItemButton, ListItemIcon, ListItemText, Toolbar, Tooltip } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import {
    AccountBoxOutlined,
    AnalyticsOutlined,
    AssessmentOutlined,
    BarChartOutlined,
    BubbleChartOutlined,
    CalendarMonthOutlined,
    CrisisAlertOutlined,
    DashboardOutlined as DashboardIcon,
    ExpandLess,
    ExpandMore,
    FactCheckOutlined,
    FunctionsOutlined,
    GavelOutlined as GavelIcon,
    LogoutOutlined as LogoutIcon,
    NotificationsActiveOutlined,
    PaymentOutlined as PaymentIcon,
    PeopleOutlined as PeopleIcon,
    PriceChangeOutlined as PriceChangeIcon,
    QueryStatsOutlined,
    RequestQuoteOutlined,
    SettingsOutlined as SettingsIcon,
    ShieldOutlined as ShieldIcon,
    ShowChartOutlined,
    SourceOutlined,
    StackedLineChartOutlined,
    StorageOutlined,
    StyleOutlined,
    TimelineOutlined as TimelineIcon,
    TrendingUpOutlined,
    VerifiedUserOutlined,
    VpnKeyOutlined,
    LockOutlined,
} from '@mui/icons-material';
import { useTabContext } from '../contexts/TabContext';
import { getRouteConfig } from '../config/routes';
import { useAuth } from '../contexts/AuthContext';
import { getRequiredViewPermissionForRoute } from '../auth/permissionPrecheck';

interface SubMenuItem {
    text: string;
    path: string;
    icon: React.ReactElement;
    requiredPermission?: string;
}

interface MenuItem {
    text: string;
    icon: React.ReactElement;
    path?: string;
    subItems?: SubMenuItem[];
    requiredPermission?: string;
}

const menuItems: MenuItem[] = [
    { text: '交易总览', icon: <DashboardIcon />, path: '/dashboard' },
    {
        text: '客户管理',
        icon: <PeopleIcon />,
        subItems: [
            { text: '客户档案管理', path: '/customer/profiles', icon: <AccountBoxOutlined /> },
            { text: '零售合同管理', path: '/customer/retail-contracts', icon: <StyleOutlined /> },
            { text: '零售套餐管理', path: '/customer/retail-packages', icon: <StyleOutlined /> },
        ],
    },
    {
        text: '客户分析',
        icon: <ShowChartOutlined />,
        subItems: [
            { text: '总体负荷分析', path: '/load-forecast/overall-analysis', icon: <StackedLineChartOutlined /> },
            { text: '客户负荷分析', path: '/customer/load-analysis', icon: <ShowChartOutlined /> },
            { text: '用电特征分析', path: '/customer/load-characteristics', icon: <BubbleChartOutlined /> },
            { text: '客户收益分析', path: '/settlement/profit-analysis', icon: <AssessmentOutlined /> },
            { text: '意向客户诊断', path: '/customer/external-diagnosis', icon: <VerifiedUserOutlined /> },
        ],
    },
    {
        text: '价格分析',
        icon: <PriceChangeIcon />,
        subItems: [
            { text: '现货日内分析', path: '/price-analysis/spot-market', icon: <AnalyticsOutlined /> },
            { text: '现货趋势分析', path: '/price-analysis/spot-trend', icon: <TimelineIcon /> },
            { text: '中长期日内分析', path: '/price-analysis/mid-long-term', icon: <TrendingUpOutlined /> },
            { text: '中长期趋势分析', path: '/price-analysis/mid-long-trend', icon: <BarChartOutlined /> },
        ],
    },
    {
        text: '交易预测',
        icon: <QueryStatsOutlined />,
        subItems: [
            { text: '天气预测数据', path: '/basic-data/weather-data', icon: <AnalyticsOutlined /> },
            { text: '价格基础数据', path: '/price-forecast/baseline-data', icon: <StorageOutlined /> },
            { text: '日前价格预测', path: '/price-forecast/day-ahead', icon: <TrendingUpOutlined /> },
            { text: 'D-2价格预测', path: '/price-forecast/d-2', icon: <CrisisAlertOutlined /> },
            { text: '短期负荷预测', path: '/load-forecast/short-term', icon: <QueryStatsOutlined /> },
            { text: '中期负荷预测', path: '/load-forecast/long-term', icon: <CalendarMonthOutlined /> },
        ],
    },
    {
        text: '交易策略',
        icon: <GavelIcon />,
        subItems: [
            { text: '月度交易策略', path: '/trading-strategy/monthly', icon: <CalendarMonthOutlined /> },
            { text: '月内交易策略', path: '/trading-strategy/contract-curve', icon: <FunctionsOutlined /> },
            { text: '日前模拟交易', path: '/trading-strategy/day-ahead', icon: <TrendingUpOutlined /> },
        ],
    },
    {
        text: '交易复盘',
        icon: <ShieldIcon />,
        subItems: [
            { text: '月度交易复盘', path: '/trade-review/monthly-review', icon: <CalendarMonthOutlined /> },
            { text: '月内交易复盘', path: '/trade-review/monthly-trading-review', icon: <FunctionsOutlined /> },
            { text: '日前交易复盘', path: '/trade-review/spot-review', icon: <BarChartOutlined /> },
        ],
    },
    {
        text: '结算管理',
        icon: <PaymentIcon />,
        subItems: [
            { text: '日清结算总览', path: '/settlement/pre-settlement-overview', icon: <RequestQuoteOutlined /> },
            { text: '日清结算详情', path: '/settlement/pre-settlement-detail', icon: <FactCheckOutlined /> },
            { text: '月度结算总览', path: '/settlement/monthly-overview', icon: <AssessmentOutlined /> },
            { text: '月度结算详情', path: '/settlement/monthly-analysis', icon: <PaymentIcon /> },
        ],
    },
    {
        text: '基础数据',
        icon: <AssessmentOutlined />,
        subItems: [
            { text: '国网代理购电', path: '/basic-data/grid-price', icon: <PriceChangeIcon /> },
            { text: '时段电价分布', path: '/basic-data/tou-definition', icon: <StyleOutlined /> },
            { text: '负荷数据诊断', path: '/basic-data/load-validation', icon: <VerifiedUserOutlined /> },
            { text: '基础数据导入', path: '/basic-data/monthly-manual-data', icon: <PriceChangeIcon /> },
        ],
    },
    {
        text: '系统管理',
        icon: <SettingsIcon />,
        subItems: [
            { text: '用户与权限', path: '/system-settings/user-permissions', icon: <VpnKeyOutlined /> },
            { text: '数据下载监控', path: '/system-settings/data-access', icon: <SourceOutlined /> },
            { text: '告警与日志', path: '/system-settings/system-logs', icon: <NotificationsActiveOutlined /> },
        ],
    },
];

export const Sidebar: React.FC<{
    isMobile?: boolean;
    onItemClick?: () => void;
}> = ({ isMobile = false, onItemClick }) => {
    const location = useLocation();
    const navigate = useNavigate();
    const [open, setOpen] = useState<{ [key: string]: boolean }>({});
    const tabContext = useTabContext();
    const { hasPermission, logout } = useAuth();

    const getPathPermissionState = React.useCallback((path: string, requiredPermission?: string) => {
        const viewPermission = getRequiredViewPermissionForRoute(path);
        if (viewPermission && !hasPermission(viewPermission)) {
            return { disabled: true, tooltip: `无权限（需要 ${viewPermission}）` };
        }
        if (requiredPermission && !hasPermission(requiredPermission)) {
            return { disabled: true, tooltip: `无权限（需要 ${requiredPermission}）` };
        }
        return { disabled: false, tooltip: '' };
    }, [hasPermission]);

    const handleClick = (text: string) => {
        setOpen((prev) => ({ ...prev, [text]: !prev[text] }));
    };

    const handleMenuItemClick = (path: string) => {
        if (isMobile) {
            navigate(path);
            if (onItemClick) onItemClick();
            return;
        }

        if (tabContext) {
            const routeConfig = getRouteConfig(path);
            if (routeConfig) {
                const Component = routeConfig.component;
                tabContext.addTab({
                    key: path,
                    title: routeConfig.title,
                    path,
                    component: <Component />,
                });
            }
        }
        if (onItemClick) onItemClick();
    };

    const activePath = isMobile
        ? location.pathname
        : tabContext && tabContext.activeTabKey
            ? tabContext.activeTabKey
            : '';

    useEffect(() => {
        if (!activePath) return;
        menuItems.forEach((item) => {
            if (!item.subItems) return;
            const hasActiveSubItem = item.subItems.some((sub) => activePath.startsWith(sub.path));
            if (hasActiveSubItem) {
                setOpen((prev) => ({ ...prev, [item.text]: true }));
            }
        });
    }, [activePath]);

    const handleLogout = () => {
        logout();
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Toolbar />
            <Divider />
            <List component="nav" sx={{ flexGrow: 1, p: 1 }}>
                {menuItems.map((item) => {
                    if (item.subItems) {
                        const isOpen = open[item.text] || item.subItems.some((sub) => activePath.startsWith(sub.path));
                        return (
                            <div key={item.text}>
                                <ListItemButton onClick={() => handleClick(item.text)} sx={{ borderRadius: '8px' }}>
                                    <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
                                    <ListItemText primary={item.text} />
                                    {isOpen ? <ExpandLess /> : <ExpandMore />}
                                </ListItemButton>
                                <Collapse in={isOpen} timeout="auto" unmountOnExit>
                                    <List component="div" disablePadding>
                                        {item.subItems.map((subItem) => (
                                            (() => {
                                                const state = getPathPermissionState(subItem.path, subItem.requiredPermission);
                                                const content = (
                                                    <ListItemButton
                                                        key={subItem.text}
                                                        onClick={() => !state.disabled && handleMenuItemClick(subItem.path)}
                                                        selected={activePath === subItem.path}
                                                        disabled={state.disabled}
                                                        sx={{ pl: 4, borderRadius: '8px' }}
                                                    >
                                                        <ListItemIcon sx={{ minWidth: 40 }}>{subItem.icon}</ListItemIcon>
                                                        <ListItemText primary={subItem.text} />
                                                        {state.disabled && <LockOutlined fontSize="small" color="disabled" />}
                                                    </ListItemButton>
                                                );
                                                return state.disabled ? (
                                                    <Tooltip key={subItem.text} title={state.tooltip} placement="right">
                                                        <span>{content}</span>
                                                    </Tooltip>
                                                ) : content;
                                            })()
                                        ))}
                                    </List>
                                </Collapse>
                            </div>
                        );
                    }

                    const state = getPathPermissionState(item.path || '#', item.requiredPermission);
                    const content = (
                        <ListItemButton
                            key={item.text}
                            onClick={() => !state.disabled && handleMenuItemClick(item.path || '#')}
                            selected={activePath === item.path}
                            disabled={state.disabled}
                            sx={{ borderRadius: '8px' }}
                        >
                            <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
                            <ListItemText primary={item.text} />
                            {state.disabled && <LockOutlined fontSize="small" color="disabled" />}
                        </ListItemButton>
                    );
                    return state.disabled ? (
                        <Tooltip key={item.text} title={state.tooltip} placement="right">
                            <span>{content}</span>
                        </Tooltip>
                    ) : content;
                })}
            </List>
            <Divider />
            <List component="nav" sx={{ p: 1 }}>
                <ListItemButton onClick={handleLogout} sx={{ borderRadius: '8px' }}>
                    <ListItemIcon sx={{ minWidth: 40 }}>
                        <LogoutIcon />
                    </ListItemIcon>
                    <ListItemText primary="退出登录" />
                </ListItemButton>
            </List>
        </Box>
    );
};

