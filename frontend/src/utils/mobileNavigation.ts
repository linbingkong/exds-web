import { matchPath, NavigateFunction } from 'react-router-dom';

type MobileBackRule = {
    pattern: string;
    resolveFallback: (searchParams: URLSearchParams) => string;
};

const MOBILE_BACK_RULES: MobileBackRule[] = [
    { pattern: '/customer/profiles/create', resolveFallback: () => '/customer/profiles' },
    { pattern: '/customer/profiles/view/:customerId', resolveFallback: () => '/customer/profiles' },
    { pattern: '/customer/profiles/edit/:customerId', resolveFallback: () => '/customer/profiles' },
    { pattern: '/customer/profiles/copy/:customerId', resolveFallback: () => '/customer/profiles' },
    { pattern: '/customer/retail-contracts/create', resolveFallback: () => '/customer/retail-contracts' },
    { pattern: '/customer/retail-contracts/view/:contractId', resolveFallback: () => '/customer/retail-contracts' },
    { pattern: '/customer/retail-contracts/edit/:contractId', resolveFallback: () => '/customer/retail-contracts' },
    { pattern: '/customer/retail-packages/create', resolveFallback: () => '/customer/retail-packages' },
    { pattern: '/customer/retail-packages/view/:packageId', resolveFallback: () => '/customer/retail-packages' },
    { pattern: '/customer/retail-packages/edit/:packageId', resolveFallback: () => '/customer/retail-packages' },
    { pattern: '/customer/retail-packages/copy/:packageId', resolveFallback: () => '/customer/retail-packages' },
    { pattern: '/customer/load-characteristics/:customerId', resolveFallback: () => '/customer/load-characteristics' },
    { pattern: '/settlement/pre-settlement-detail', resolveFallback: () => '/settlement/pre-settlement-overview' },
    {
        pattern: '/settlement/customer-settlement-detail',
        resolveFallback: (searchParams) => {
            const date = searchParams.get('date');
            const version = searchParams.get('version');

            if (date && version) {
                return `/settlement/pre-settlement-detail?date=${encodeURIComponent(date)}&version=${encodeURIComponent(version)}`;
            }

            return '/settlement/pre-settlement-overview';
        },
    },
    { pattern: '/settlement/monthly-analysis', resolveFallback: () => '/settlement/monthly-overview' },
    {
        pattern: '/settlement/monthly-customer-detail',
        resolveFallback: (searchParams) => {
            const month = searchParams.get('month');
            return month
                ? `/settlement/monthly-analysis?month=${encodeURIComponent(month)}`
                : '/settlement/monthly-overview';
        },
    },
];

const getCurrentUrl = (pathname: string, search: string): string => `${pathname}${search}`;

export const getMobileBackFallback = (pathname: string, search = ''): string => {
    const searchParams = new URLSearchParams(search);

    for (const rule of MOBILE_BACK_RULES) {
        if (matchPath({ path: rule.pattern, end: true }, pathname)) {
            return rule.resolveFallback(searchParams);
        }
    }

    return '/dashboard';
};

export const getBrowserHistoryIndex = (): number | null => {
    if (typeof window === 'undefined') {
        return null;
    }

    const idx = window.history.state?.idx;
    return typeof idx === 'number' ? idx : null;
};

export const seedMobileBackHistory = (pathname: string, search = ''): boolean => {
    if (typeof window === 'undefined') {
        return false;
    }

    const historyState = window.history.state ?? {};
    const idx = typeof historyState.idx === 'number' ? historyState.idx : null;
    const currentUserState = historyState.usr ?? {};
    const currentUrl = getCurrentUrl(pathname, search);
    const fallbackUrl = getMobileBackFallback(pathname, search);

    if (idx !== 0 || currentUserState.__mobileBackSeeded || currentUrl === fallbackUrl) {
        return false;
    }

    window.history.replaceState(
        {
            ...historyState,
            usr: {
                ...currentUserState,
                __mobileBackSeedBase: true,
            },
        },
        '',
        fallbackUrl,
    );

    window.history.pushState(
        {
            ...historyState,
            idx: 1,
            usr: {
                ...currentUserState,
                __mobileBackSeeded: true,
            },
        },
        '',
        currentUrl,
    );

    return true;
};

export const navigateBackWithFallback = (
    navigate: NavigateFunction,
    pathname: string,
    search = '',
) => {
    const idx = getBrowserHistoryIndex();

    if (idx !== null && idx > 0) {
        navigate(-1);
        return;
    }

    navigate(getMobileBackFallback(pathname, search), { replace: true });
};
