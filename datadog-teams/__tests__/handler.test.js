'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const fixtures = require('./fixtures.json');

process.env.AZURE_CLIENT_SECRET = 'test-secret';

const GRAPH_USERS = {
    'gildong.hong@emart.com': { displayName: '홍길동', id: 'id-1', userPrincipalName: 'gildong.hong@emart.com' },
};

const jsonResponse = (status, data) => ({ ok: status < 300, status, json: async () => data });

// 토큰 요청과 Graph 사용자 조회만 흉내 낸다
const fakeFetch = async (url) => {
    if (url.includes('/oauth2/')) return jsonResponse(200, { access_token: 't', expires_in: 3600 });
    const mail = decodeURIComponent(url.split('/').pop());
    return GRAPH_USERS[mail] ? jsonResponse(200, GRAPH_USERS[mail]) : jsonResponse(404, {});
};

const setup = (t) => {
    const posted = [];
    t.mock.method(global, 'fetch', fakeFetch);
    t.mock.method(axios, 'post', async (url, body) => {
        posted.push({ url, body });
        return { status: 202, statusText: 'Accepted' };
    });
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'error', () => {});
    return { posted, handler: require('../index').handler };
};

const eventOf = (payload) => ({ body: JSON.stringify({ ...payload, webhook_url: 'https://flow.example/hook' }) });

test('handler: 담당자 멘션을 Graph 표시 이름으로 보낸다 (조회 실패한 사람은 제외)', async (t) => {
    const { posted, handler } = setup(t);
    const payload = {
        ...fixtures.alertWithPeople.payload,
        people: [
            { mail: 'gildong.hong@emart.com', type: 'assignee' },
            { mail: 'nobody@emart.com', type: 'cc' },
        ],
    };

    const result = await handler(eventOf(payload));

    assert.equal(result, '202 - Accepted');
    assert.equal(posted[0].url, 'https://flow.example/hook');
    const { entities } = posted[0].body.contents.msteams;
    assert.deepEqual(entities, [{
        type: 'mention',
        text: '<at>홍길동</at>',
        mentioned: { id: 'gildong.hong@emart.com', name: '홍길동' },
    }]);
});

test('handler: 복구 알람은 Graph 를 조회하지 않는다', async (t) => {
    const { posted, handler } = setup(t);
    const payload = { ...fixtures.recoveredWithPeople.payload, people: [{ mail: 'gildong.hong@emart.com', type: 'assignee' }] };

    await handler(eventOf(payload));

    assert.equal(global.fetch.mock.callCount(), 0);
    assert.equal(posted[0].body.msgType, 'B');
});

test('handler: 토큰 발급이 실패해도 멘션 없이 카드를 보낸다', async (t) => {
    const { posted, handler } = setup(t);
    global.fetch.mock.mockImplementation(async () => jsonResponse(500, {}));
    const payload = { ...fixtures.alertWithPeople.payload, people: [{ mail: 'new.person@emart.com', type: 'assignee' }, null] };

    const result = await handler(eventOf(payload));

    assert.equal(result, '202 - Accepted');
    assert.deepEqual(posted[0].body.contents.msteams.entities, []);
});

test('handler: body 가 JSON 이 아니면 400 을 돌려준다', async (t) => {
    const { posted, handler } = setup(t);

    const result = await handler({ body: '{not json' });

    assert.equal(result.statusCode, 400);
    assert.equal(posted.length, 0);
});

test('handler: webhook_url 이 없으면 400 을 돌려준다', async (t) => {
    const { posted, handler } = setup(t);

    const result = await handler({ body: JSON.stringify({ title: '[Triggered] x', body: '' }) });

    assert.equal(result.statusCode, 400);
    assert.equal(posted.length, 0);
});
