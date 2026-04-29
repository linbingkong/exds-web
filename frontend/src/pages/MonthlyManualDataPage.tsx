import React, { useState } from 'react';
import { Box, Typography, Tabs, Tab, useTheme, useMediaQuery } from '@mui/material';
import RetailSettlementPriceTab from './tabs/RetailSettlementPriceTab';
import MechanismEnergyTab from './tabs/MechanismEnergyTab';
import CustomerMonthlyEnergyTab from './tabs/CustomerMonthlyEnergyTab';
import FreqCompFeeTab from './tabs/FreqCompFeeTab';

const MonthlyManualDataPage: React.FC = () => {
    const theme = useTheme();
    const isTablet = useMediaQuery(theme.breakpoints.down('md'));
    const [currentTab, setCurrentTab] = useState(0);

    const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
        setCurrentTab(newValue);
    };

    return (
        <Box>
            {/* 移动端面包屑标题 */}
            {isTablet && (
                <Typography
                    variant="subtitle1"
                    sx={{ mb: 2, fontWeight: 'bold', color: 'text.primary' }}
                >
                    基础数据 / 基础数据导入
                </Typography>
            )}

            <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
                <Tabs value={currentTab} onChange={handleTabChange} variant="scrollable" scrollButtons="auto">
                    <Tab label="零售结算价格" />
                    <Tab label="机制电量分配" />
                    <Tab label="客户结算月度电量" />
                    <Tab label="调频补偿费用" />
                </Tabs>
            </Box>

            {/* 标签页内容 */}
            <Box hidden={currentTab !== 0}>
                {currentTab === 0 && <RetailSettlementPriceTab />}
            </Box>
            <Box hidden={currentTab !== 1}>
                {currentTab === 1 && <MechanismEnergyTab />}
            </Box>
            <Box hidden={currentTab !== 2}>
                {currentTab === 2 && <CustomerMonthlyEnergyTab />}
            </Box>
            <Box hidden={currentTab !== 3}>
                {currentTab === 3 && <FreqCompFeeTab />}
            </Box>
        </Box>
    );
};

export default MonthlyManualDataPage;
