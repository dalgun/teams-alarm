'use strict';

const jsonResponse = (status, data) => ({ ok: status < 300, status, json: async () => data });
const USERS = { 'a@x.com': { displayName: '이현진(CMS/ALM) - 이마트팀', userPrincipalName: 'a@x.com' } };

const loadGraph = (fetchImpl) => {
    jest.resetModules();
    global.fetch = jest.fn(fetchImpl);
    return require('../graph');
};

const graphFetch = async (url) => {
    if (url.includes('/oauth2/')) return jsonResponse(200, { access_token: 't', expires_in: 3600 });
    const upn = decodeURIComponent(url.split('/users/')[1].split('?')[0]);
    return USERS[upn] ? jsonResponse(200, USERS[upn]) : jsonResponse(404, {});
};

beforeEach(() => {
    process.env.AZURE_CLIENT_SECRET = 'secret';
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

test('Graph 표시 이름으로 채우고, 못 찾은 사람은 이메일을 이름으로 쓴다', async () => {
    const { resolveDisplayNames } = loadGraph(graphFetch);

    const result = await resolveDisplayNames([{ type: 'assignee', upn: 'a@x.com' }, { type: 'cc', upn: 'gone@x.com' }]);

    expect(result).toEqual([
        { type: 'assignee', upn: 'a@x.com', name: '이현진(CMS/ALM) - 이마트팀' },
        { type: 'cc', upn: 'gone@x.com', name: 'gone@x.com' },
    ]);
});

test('토큰 발급이 실패하면 모두 이메일을 이름으로 쓴다', async () => {
    const { resolveDisplayNames } = loadGraph(async () => jsonResponse(500, {}));

    const result = await resolveDisplayNames([{ type: 'assignee', upn: 'a@x.com' }]);

    expect(result).toEqual([{ type: 'assignee', upn: 'a@x.com', name: 'a@x.com' }]);
});

test('시크릿이 없으면 Graph 를 호출하지 않는다', async () => {
    delete process.env.AZURE_CLIENT_SECRET;
    const { resolveDisplayNames } = loadGraph(graphFetch);

    const result = await resolveDisplayNames([{ type: 'assignee', upn: 'a@x.com' }]);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result[0].name).toBe('a@x.com');
});

test('대상이 없거나 upn 이 없으면 빈 목록', async () => {
    const { resolveDisplayNames } = loadGraph(graphFetch);

    expect(await resolveDisplayNames(undefined)).toEqual([]);
    expect(await resolveDisplayNames([{ type: 'cc' }, null])).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
});
