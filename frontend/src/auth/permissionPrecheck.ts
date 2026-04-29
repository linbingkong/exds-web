export interface PermissionSnapshot {
    permissions: string[];
    isSuperAdmin: boolean;
}

export const AUTH_STORAGE_KEYS = {
    token: 'token',
    challengeToken: 'security_challenge_token',
    permissions: 'auth_permissions',
    isSuperAdmin: 'auth_is_super_admin',
} as const;

interface MutationPermissionRule {
    methods: ReadonlyArray<'post' | 'put' | 'patch' | 'delete'>;
    pattern: RegExp;
    allPermissions: string[];
}

interface RoutePermissionRule {
    pattern: RegExp;
    viewPermission: string;
}

const modulePermission = (moduleCode: string, level: 'view' | 'edit'): string => `module:${moduleCode}:${level}`;

const ROUTE_PERMISSION_RULES: RoutePermissionRule[] = [
    { pattern: /^\/dashboard(\/.*)?$/, viewPermission: modulePermission('dashboard_overview', 'view') },
    { pattern: /^\/customer\/profiles(\/.*)?$/, viewPermission: modulePermission('customer_profiles', 'view') },
    { pattern: /^\/customer\/retail-contracts(\/.*)?$/, viewPermission: modulePermission('customer_retail_contracts', 'view') },
    { pattern: /^\/customer\/retail-packages(\/.*)?$/, viewPermission: modulePermission('customer_retail_packages', 'view') },
    { pattern: /^\/load-forecast\/overall-analysis(\/.*)?$/, viewPermission: modulePermission('analysis_overall_load', 'view') },
    { pattern: /^\/customer\/load-analysis(\/.*)?$/, viewPermission: modulePermission('analysis_customer_load', 'view') },
    { pattern: /^\/customer\/load-characteristics(\/.*)?$/, viewPermission: modulePermission('analysis_load_characteristics', 'view') },
    { pattern: /^\/settlement\/profit-analysis(\/.*)?$/, viewPermission: modulePermission('analysis_customer_profit', 'view') },
    { pattern: /^\/customer\/external-diagnosis(\/.*)?$/, viewPermission: modulePermission('analysis_intent_customer_diagnosis', 'view') },
    { pattern: /^\/price-analysis\/spot-market(\/.*)?$/, viewPermission: modulePermission('price_spot_intraday', 'view') },
    { pattern: /^\/price-analysis\/spot-trend(\/.*)?$/, viewPermission: modulePermission('price_spot_trend', 'view') },
    { pattern: /^\/price-analysis\/mid-long-term(\/.*)?$/, viewPermission: modulePermission('price_midlong_intraday', 'view') },
    { pattern: /^\/price-analysis\/mid-long-trend(\/.*)?$/, viewPermission: modulePermission('price_midlong_trend', 'view') },
    { pattern: /^\/basic-data\/weather-data(\/.*)?$/, viewPermission: modulePermission('forecast_weather_data', 'view') },
    { pattern: /^\/price-forecast\/baseline-data(\/.*)?$/, viewPermission: modulePermission('forecast_price_baseline', 'view') },
    { pattern: /^\/price-forecast\/day-ahead(\/.*)?$/, viewPermission: modulePermission('forecast_dayahead_price', 'view') },
    { pattern: /^\/price-forecast\/monthly(\/.*)?$/, viewPermission: modulePermission('forecast_dayahead_price', 'view') },
    { pattern: /^\/price-forecast\/d-2(\/.*)?$/, viewPermission: modulePermission('forecast_d2_price', 'view') },
    { pattern: /^\/load-forecast\/short-term(\/.*)?$/, viewPermission: modulePermission('forecast_short_term_load', 'view') },
    { pattern: /^\/load-forecast\/accuracy-analysis(\/.*)?$/, viewPermission: modulePermission('forecast_short_term_load', 'view') },
    { pattern: /^\/load-forecast\/long-term(\/.*)?$/, viewPermission: modulePermission('forecast_mid_term_load', 'view') },
    { pattern: /^\/strategy\/rolling-match-quotes(\/.*)?$/, viewPermission: modulePermission('rolling_match_quotes', 'view') },
    { pattern: /^\/trading-strategy\/monthly(\/.*)?$/, viewPermission: modulePermission('strategy_monthly', 'view') },
    { pattern: /^\/trading-strategy\/contract-curve(\/.*)?$/, viewPermission: modulePermission('strategy_intra_month', 'view') },
    { pattern: /^\/trading-strategy\/d-2(\/.*)?$/, viewPermission: modulePermission('strategy_dayahead', 'view') },
    { pattern: /^\/trading-strategy\/day-ahead(\/.*)?$/, viewPermission: modulePermission('strategy_dayahead', 'view') },
    { pattern: /^\/trade-review\/monthly-review(\/.*)?$/, viewPermission: modulePermission('review_monthly', 'view') },
    { pattern: /^\/trade-review\/monthly-trading-review(\/.*)?$/, viewPermission: modulePermission('review_intra_month', 'view') },
    { pattern: /^\/trade-review\/spot-review(\/.*)?$/, viewPermission: modulePermission('review_dayahead', 'view') },
    { pattern: /^\/settlement\/pre-settlement-overview(\/.*)?$/, viewPermission: modulePermission('settlement_daily_overview', 'view') },
    { pattern: /^\/settlement\/pre-settlement-detail(\/.*)?$/, viewPermission: modulePermission('settlement_daily_detail', 'view') },
    { pattern: /^\/settlement\/customer-settlement-detail(\/.*)?$/, viewPermission: modulePermission('settlement_daily_detail', 'view') },
    { pattern: /^\/settlement\/monthly-overview(\/.*)?$/, viewPermission: modulePermission('settlement_monthly_overview', 'view') },
    { pattern: /^\/settlement\/monthly-analysis(\/.*)?$/, viewPermission: modulePermission('settlement_monthly_detail', 'view') },
    { pattern: /^\/settlement\/monthly-customer-detail(\/.*)?$/, viewPermission: modulePermission('settlement_monthly_detail', 'view') },
    { pattern: /^\/energy-storage\/freq-regulation-market(\/.*)?$/, viewPermission: modulePermission('freq_regulation_market', 'view') },
    { pattern: /^\/basic-data\/grid-price(\/.*)?$/, viewPermission: modulePermission('basic_sgcc_price', 'view') },
    { pattern: /^\/basic-data\/tou-definition(\/.*)?$/, viewPermission: modulePermission('basic_tou_definition', 'view') },
    { pattern: /^\/basic-data\/load-validation(\/.*)?$/, viewPermission: modulePermission('basic_load_validation', 'view') },
    { pattern: /^\/basic-data\/monthly-manual-data(\/.*)?$/, viewPermission: modulePermission('basic_monthly_manual_import', 'view') },
    { pattern: /^\/system-settings\/user-permissions(\/.*)?$/, viewPermission: modulePermission('system_user_auth', 'view') },
    { pattern: /^\/system-settings\/model-parameters(\/.*)?$/, viewPermission: modulePermission('system_user_auth', 'view') },
    { pattern: /^\/system-settings\/data-access(\/.*)?$/, viewPermission: modulePermission('system_data_access', 'view') },
    { pattern: /^\/system-settings\/system-logs(\/.*)?$/, viewPermission: modulePermission('system_logs', 'view') },
];

const MUTATION_PERMISSION_RULES: MutationPermissionRule[] = [
    { methods: ['post', 'put', 'patch', 'delete'], pattern: /^\/api\/v1\/auth\/(roles|users)(\/.*)?$/, allPermissions: ['system:auth:manage'] },
    { methods: ['put'], pattern: /^\/api\/v1\/auth\/me\/profile$/, allPermissions: [modulePermission('dashboard_overview', 'view')] },
    { methods: ['put'], pattern: /^\/api\/v1\/auth\/me\/password$/, allPermissions: [modulePermission('dashboard_overview', 'view')] },

    { methods: ['post'], pattern: /^\/api\/v1\/customers$/, allPermissions: [modulePermission('customer_profiles', 'edit')] },
    { methods: ['post'], pattern: /^\/api\/v1\/customers\/sync$/, allPermissions: [modulePermission('customer_profiles', 'edit')] },
    { methods: ['put', 'patch'], pattern: /^\/api\/v1\/customers\/[^/]+$/, allPermissions: [modulePermission('customer_profiles', 'edit')] },
    { methods: ['delete'], pattern: /^\/api\/v1\/customers\/[^/]+$/, allPermissions: [modulePermission('customer_profiles', 'edit'), 'customer:profile:delete'] },
    { methods: ['post', 'put', 'patch', 'delete'], pattern: /^\/api\/v1\/customers\/[^/]+\/accounts(\/.*)?$/, allPermissions: [modulePermission('customer_profiles', 'edit')] },
    { methods: ['post', 'put', 'patch', 'delete'], pattern: /^\/api\/v1\/customers\/meters\/[^/]+\/sync-update$/, allPermissions: [modulePermission('customer_profiles', 'edit')] },
    { methods: ['post'], pattern: /^\/api\/v1\/customers\/[^/]+\/(sign-contract|cancel-contract|activate|suspend|resume|terminate)$/, allPermissions: [modulePermission('customer_profiles', 'edit')] },
    { methods: ['post', 'put', 'patch', 'delete'], pattern: /^\/api\/v1\/customers\/customer-tags(\/.*)?$/, allPermissions: [modulePermission('customer_profiles', 'edit')] },
    { methods: ['post', 'put', 'patch', 'delete'], pattern: /^\/api\/v1\/customer-tags(\/.*)?$/, allPermissions: [modulePermission('customer_profiles', 'edit')] },

    { methods: ['post'], pattern: /^\/api\/v1\/retail-contracts$/, allPermissions: [modulePermission('customer_retail_contracts', 'edit')] },
    { methods: ['post'], pattern: /^\/api\/v1\/retail-contracts\/(import|import-create|upload-pdfs|parse-pdf)$/, allPermissions: [modulePermission('customer_retail_contracts', 'edit')] },
    { methods: ['put', 'patch'], pattern: /^\/api\/v1\/retail-contracts\/[^/]+$/, allPermissions: [modulePermission('customer_retail_contracts', 'edit')] },
    { methods: ['delete'], pattern: /^\/api\/v1\/retail-contracts\/[^/]+$/, allPermissions: [modulePermission('customer_retail_contracts', 'edit'), 'customer:contract:delete'] },
    { methods: ['post'], pattern: /^\/api\/v1\/retail-contracts\/[^/]+\/upload-pdf$/, allPermissions: [modulePermission('customer_retail_contracts', 'edit')] },

    { methods: ['post'], pattern: /^\/api\/v1\/retail-packages\/validate-price-ratio$/, allPermissions: [modulePermission('customer_retail_packages', 'edit')] },
    { methods: ['post'], pattern: /^\/api\/v1\/retail-packages$/, allPermissions: [modulePermission('customer_retail_packages', 'edit')] },
    { methods: ['post'], pattern: /^\/api\/v1\/retail-packages\/[^/]+\/copy$/, allPermissions: [modulePermission('customer_retail_packages', 'edit')] },
    { methods: ['put', 'patch'], pattern: /^\/api\/v1\/retail-packages\/[^/]+$/, allPermissions: [modulePermission('customer_retail_packages', 'edit')] },
    { methods: ['post'], pattern: /^\/api\/v1\/retail-packages\/[^/]+\/(activate|archive)$/, allPermissions: [modulePermission('customer_retail_packages', 'edit')] },
    { methods: ['delete'], pattern: /^\/api\/v1\/retail-packages\/[^/]+$/, allPermissions: [modulePermission('customer_retail_packages', 'edit'), 'customer:package:delete'] },

    { methods: ['post'], pattern: /^\/api\/v1\/manual-adjustment\/(save|reset)$/, allPermissions: [modulePermission('forecast_short_term_load', 'edit')] },
    { methods: ['post'], pattern: /^\/api\/v1\/bid\/trade-sources\/manual$/, allPermissions: [modulePermission('strategy_dayahead', 'edit')] },
    { methods: ['post'], pattern: /^\/api\/v1\/bid\/trade-sources\/auto$/, allPermissions: [modulePermission('strategy_dayahead', 'edit')] },
    { methods: ['put', 'patch'], pattern: /^\/api\/v1\/bid\/trade-sources\/[^/]+$/, allPermissions: [modulePermission('strategy_dayahead', 'edit')] },
    { methods: ['post'], pattern: /^\/api\/v1\/bid\/trade-sources\/[^/]+\/status$/, allPermissions: [modulePermission('strategy_dayahead', 'edit')] },
    { methods: ['delete'], pattern: /^\/api\/v1\/bid\/trade-sources\/[^/]+$/, allPermissions: [modulePermission('strategy_dayahead', 'edit')] },
    { methods: ['post'], pattern: /^\/api\/v1\/bid\/simulations\/manual-save$/, allPermissions: [modulePermission('strategy_dayahead', 'edit')] },
    { methods: ['post'], pattern: /^\/api\/v1\/bid\/simulations\/manual-reset$/, allPermissions: [modulePermission('strategy_dayahead', 'edit')] },
    { methods: ['post'], pattern: /^\/api\/v1\/price-forecast\/trigger$/, allPermissions: [modulePermission('forecast_dayahead_price', 'edit')] },
    { methods: ['post'], pattern: /^\/api\/v1\/trade-review\/monthly-recalculate$/, allPermissions: [modulePermission('review_monthly', 'edit')] },
    { methods: ['post', 'put', 'patch', 'delete'], pattern: /^\/api\/v1\/weather\/locations(\/.*)?$/, allPermissions: [modulePermission('forecast_weather_data', 'edit')] },
    { methods: ['post'], pattern: /^\/api\/v1\/forecast-base-data\/curves$/, allPermissions: [modulePermission('forecast_price_baseline', 'edit')] },

    { methods: ['post'], pattern: /^\/api\/v1\/customer-analysis\/[^/]+\/ai-diagnose$/, allPermissions: [modulePermission('analysis_customer_load', 'edit')] },
    { methods: ['post', 'delete'], pattern: /^\/api\/v1\/customer-analysis\/[^/]+\/tags(\/.*)?$/, allPermissions: [modulePermission('analysis_customer_load', 'edit')] },
    { methods: ['post'], pattern: /^\/api\/v1\/intent-customer-diagnosis\/(preview|import)(\/.*)?$/, allPermissions: [modulePermission('analysis_intent_customer_diagnosis', 'edit')] },
    { methods: ['post'], pattern: /^\/api\/v1\/intent-customer-diagnosis\/customers\/[^/]+\/wholesale-simulation$/, allPermissions: [modulePermission('analysis_intent_customer_diagnosis', 'edit')] },
    { methods: ['post'], pattern: /^\/api\/v1\/intent-customer-diagnosis\/customers\/[^/]+\/retail-simulation$/, allPermissions: [modulePermission('analysis_intent_customer_diagnosis', 'edit')] },
    { methods: ['delete'], pattern: /^\/api\/v1\/intent-customer-diagnosis\/customers\/[^/]+$/, allPermissions: [modulePermission('analysis_intent_customer_diagnosis', 'edit')] },
    { methods: ['delete'], pattern: /^\/api\/v1\/intent-customer-diagnosis\/customers\/[^/]+\/retail-simulation\/packages\/[^/]+$/, allPermissions: [modulePermission('analysis_intent_customer_diagnosis', 'edit')] },
    { methods: ['post'], pattern: /^\/api\/v1\/load-characteristics\/alerts\/[^/]+\/acknowledge$/, allPermissions: [modulePermission('analysis_load_characteristics', 'edit')] },
    { methods: ['post'], pattern: /^\/api\/v1\/load-characteristics\/analyze\/batch\/all$/, allPermissions: [modulePermission('analysis_load_characteristics', 'edit')] },

    { methods: ['post'], pattern: /^\/api\/import$/, allPermissions: [modulePermission('basic_monthly_manual_import', 'edit')] },
    { methods: ['post'], pattern: /^\/api\/v1\/prices\/sgcc\/import$/, allPermissions: [modulePermission('basic_sgcc_price', 'edit')] },
    { methods: ['post', 'delete'], pattern: /^\/api\/v1\/prices\/retail-settlement(\/.*)?$/, allPermissions: [modulePermission('basic_monthly_manual_import', 'edit')] },
    { methods: ['post'], pattern: /^\/api\/v1\/load-data\/import\/(meter|mp)$/, allPermissions: [modulePermission('basic_monthly_manual_import', 'edit')] },
    { methods: ['post'], pattern: /^\/api\/v1\/load-data\/reaggregate$/, allPermissions: [modulePermission('basic_monthly_manual_import', 'edit'), 'load:data:reaggregate'] },
    { methods: ['post'], pattern: /^\/api\/v1\/load-data\/(calibration\/preview|calibration\/calculate|calibration\/apply|calibration\/details)$/, allPermissions: [modulePermission('basic_monthly_manual_import', 'edit')] },
    { methods: ['post'], pattern: /^\/api\/v1\/load-data\/diagnose$/, allPermissions: [modulePermission('basic_load_validation', 'edit')] },
    { methods: ['post'], pattern: /^\/api\/v1\/(mechanism-energy|customer-energy|wholesale-monthly-settlement)\/import$/, allPermissions: [modulePermission('basic_monthly_manual_import', 'edit')] },
    { methods: ['delete'], pattern: /^\/api\/v1\/customer-energy\/[^/]+$/, allPermissions: [modulePermission('basic_monthly_manual_import', 'edit')] },

    {
        methods: ['post'],
        pattern: /^\/api\/v1\/(settlement\/calculate|retail-settlement\/calculate)$/,
        allPermissions: [modulePermission('settlement_daily_overview', 'edit'), 'settlement:recalc:execute'],
    },
    {
        methods: ['post'],
        pattern: /^\/api\/v1\/retail-settlement\/monthly-calc$/,
        allPermissions: [modulePermission('settlement_monthly_detail', 'edit'), 'settlement:recalc:execute'],
    },

    { methods: ['post'], pattern: /^\/api\/v1\/system\/alerts\/[^/]+\/resolve$/, allPermissions: [modulePermission('system_logs', 'edit')] },
    { methods: ['post'], pattern: /^\/api\/v1\/rpa\/tasks\/[^/]+\/[^/]+\/retry$/, allPermissions: [modulePermission('system_data_access', 'edit')] },
];

const EXCLUDED_PATH_PATTERNS: RegExp[] = [
    /^\/api\/v1\/token$/,
    /^\/api\/v1\/auth\/me$/,
];

function stripQueryAndHash(url: string): string {
    const qIndex = url.indexOf('?');
    const hIndex = url.indexOf('#');
    const end = qIndex === -1 ? (hIndex === -1 ? url.length : hIndex) : (hIndex === -1 ? qIndex : Math.min(qIndex, hIndex));
    return url.slice(0, end);
}

export function normalizeRequestPath(url?: string): string {
    if (!url) return '';
    try {
        if (url.startsWith('http://') || url.startsWith('https://')) {
            return new URL(url).pathname;
        }
    } catch {
        // fallback below
    }
    return stripQueryAndHash(url);
}

export function getRequiredPermissionsForMutation(method: string, path: string): string[] {
    const normalizedMethod = method.toLowerCase() as 'post' | 'put' | 'patch' | 'delete' | string;
    if (!['post', 'put', 'patch', 'delete'].includes(normalizedMethod)) {
        return [];
    }
    if (!path || EXCLUDED_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
        return [];
    }

    const matchedRule = MUTATION_PERMISSION_RULES.find(
        (rule) => rule.methods.includes(normalizedMethod as 'post' | 'put' | 'patch' | 'delete') && rule.pattern.test(path)
    );
    return matchedRule?.allPermissions ?? [];
}

export function getRequiredViewPermissionForRoute(path: string): string | null {
    if (!path) {
        return null;
    }
    const routePath = normalizeRequestPath(path);
    const matchedRule = ROUTE_PERMISSION_RULES.find((rule) => rule.pattern.test(routePath));
    return matchedRule?.viewPermission ?? null;
}

export function readPermissionSnapshot(): PermissionSnapshot {
    const permissionsText = localStorage.getItem(AUTH_STORAGE_KEYS.permissions);
    const isSuperAdminText = localStorage.getItem(AUTH_STORAGE_KEYS.isSuperAdmin);

    let permissions: string[] = [];
    try {
        const parsed = permissionsText ? JSON.parse(permissionsText) : [];
        permissions = Array.isArray(parsed) ? parsed.filter((code): code is string => typeof code === 'string') : [];
    } catch {
        permissions = [];
    }

    return {
        permissions,
        isSuperAdmin: isSuperAdminText === '1',
    };
}

export function writePermissionSnapshot(snapshot: PermissionSnapshot): void {
    localStorage.setItem(AUTH_STORAGE_KEYS.permissions, JSON.stringify(snapshot.permissions || []));
    localStorage.setItem(AUTH_STORAGE_KEYS.isSuperAdmin, snapshot.isSuperAdmin ? '1' : '0');
}

export function clearPermissionSnapshot(): void {
    localStorage.removeItem(AUTH_STORAGE_KEYS.permissions);
    localStorage.removeItem(AUTH_STORAGE_KEYS.isSuperAdmin);
}

export function hasPermission(permissionCode: string): boolean {
    const snapshot = readPermissionSnapshot();
    return snapshot.isSuperAdmin || snapshot.permissions.includes(permissionCode);
}

export function hasAllPermissions(permissionCodes: string[]): boolean {
    if (permissionCodes.length === 0) {
        return true;
    }
    const snapshot = readPermissionSnapshot();
    if (snapshot.isSuperAdmin) {
        return true;
    }
    return permissionCodes.every((code) => snapshot.permissions.includes(code));
}

