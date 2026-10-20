'use strict';
// Microsoft Graph 로 멘션 대상의 표시 이름 조회 (datadog-teams 와 같은 Azure AD 앱)
const TOKEN_ENDPOINT = 'https://login.microsoftonline.com/d4ffc887-d88d-41cc-bf6a-6bb47ec0f3ca/oauth2/v2.0/token';
const GRAPH_USERS = 'https://graph.microsoft.com/v1.0/users';
const CLIENT_ID = '17645b26-29bc-4d9d-8733-58901cf04bc0';
const TOKEN_REFRESH_MARGIN_MS = 60 * 1000;

let cachedToken = null;
let tokenExpiresAt = 0;

const getAccessToken = async () => {
    const secret = process.env.AZURE_CLIENT_SECRET;
    if (!secret) throw new Error('AZURE_CLIENT_SECRET 환경변수가 없습니다.');
    if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

    const response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: secret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
    });
    if (!response.ok) throw new Error(`토큰 요청 실패: ${response.status}`);
    const data = await response.json();
    cachedToken = data.access_token;
    tokenExpiresAt = Date.now() + data.expires_in * 1000 - TOKEN_REFRESH_MARGIN_MS;
    return cachedToken;
};

/**
 * 표시 이름을 채운 목록 반환. 조회 실패 시 이메일을 이름으로 사용 (알람은 멘션 이름만 덜 예쁠 뿐 계속 전송)
 * @param {Array<{ type: string, upn: string }>} people
 * @returns {Promise<Array<{ type: string, upn: string, name: string }>>}
 */
const resolveDisplayNames = async (people) => {
    const targets = (Array.isArray(people) ? people : []).filter((p) => typeof p?.upn === 'string' && p.upn);
    if (!targets.length) return [];
    let token;
    try {
        token = await getAccessToken();
    } catch (err) {
        console.error('Graph 토큰 실패, 이메일로 멘션:', err.message);
        return targets.map((p) => ({ ...p, name: p.upn }));
    }
    return Promise.all(targets.map(async (p) => {
        try {
            const response = await fetch(`${GRAPH_USERS}/${encodeURIComponent(p.upn)}?$select=displayName,userPrincipalName`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const user = await response.json();
            return { ...p, upn: user.userPrincipalName || p.upn, name: user.displayName || p.upn };
        } catch (err) {
            console.error(`사용자 조회 실패(${p.upn}), 이메일로 멘션:`, err.message);
            return { ...p, name: p.upn };
        }
    }));
};

module.exports = { resolveDisplayNames };
