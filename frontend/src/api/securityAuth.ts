import apiClient from './client';

export interface SecurityStatus {
    username: string;
    display_name?: string;
    email?: string;
    email_verified: boolean;
    email_mfa_enabled?: boolean;
    required_actions: string[];
}

export interface LoginChallengeResponse {
    challenge_token: string;
    required_actions: string[];
    token_type: 'challenge';
}

export async function getSecurityStatus(challengeToken: string): Promise<SecurityStatus> {
    const res = await apiClient.post<SecurityStatus>('/api/v1/auth/security/status', {
        challenge_token: challengeToken,
    });
    return res.data;
}

export async function changeRequiredPassword(challengeToken: string, newPassword: string): Promise<SecurityStatus & { message: string }> {
    const res = await apiClient.post<SecurityStatus & { message: string }>('/api/v1/auth/security/change-password', {
        challenge_token: challengeToken,
        new_password: newPassword,
    });
    return res.data;
}

export async function bindSecurityEmail(challengeToken: string, email: string): Promise<SecurityStatus & { message: string }> {
    const res = await apiClient.post<SecurityStatus & { message: string }>('/api/v1/auth/security/bind-email', {
        challenge_token: challengeToken,
        email,
    });
    return res.data;
}

export async function verifySecurityEmail(challengeToken: string, code: string): Promise<SecurityStatus & { message: string }> {
    const res = await apiClient.post<SecurityStatus & { message: string }>('/api/v1/auth/security/verify-email', {
        challenge_token: challengeToken,
        code,
    });
    return res.data;
}

export async function resendLoginEmailCode(challengeToken: string): Promise<SecurityStatus & { message: string }> {
    const res = await apiClient.post<SecurityStatus & { message: string }>('/api/v1/auth/security/send-login-email-code', {
        challenge_token: challengeToken,
    });
    return res.data;
}

export async function completeSecuritySetup(challengeToken: string, force = false): Promise<{ access_token: string; token_type: string }> {
    const res = await apiClient.post<{ access_token: string; token_type: string }>('/api/v1/auth/security/complete', {
        challenge_token: challengeToken,
        force,
    });
    return res.data;
}
