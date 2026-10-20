'use strict';

const mockTranslate = jest.fn();
const mockSend = jest.fn();

jest.mock('deepl-node', () => ({
    Translator: jest.fn().mockImplementation(() => ({ translateText: mockTranslate })),
}));
jest.mock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
    PutItemCommand: jest.fn().mockImplementation((input) => ({ kind: 'put', input })),
    DeleteItemCommand: jest.fn().mockImplementation((input) => ({ kind: 'delete', input })),
}));
jest.mock('axios');
const mockResolve = jest.fn();
jest.mock('../graph', () => ({ resolveDisplayNames: (...args) => mockResolve(...args) }));
process.env.MENTION_PEOPLE = JSON.stringify([{ type: 'assignee', upn: 'a@x.com' }]);

process.env.WEBHOOK_URL = 'https://flow.example/hook';
process.env.CHANNEL_ID = 'channel-1';
process.env.DEDUP_TABLE = 'dedup-table';

const axios = require('axios');
const { handler } = require('../index');

const update = (id, status, minute) => ({ id, status, body: `body ${id}`, created_at: `2026-10-01T03:${String(minute).padStart(2, '0')}:00Z` });
const incidentEvent = (updates) => ({
    body: JSON.stringify({
        incident: { id: 'inc-1', name: 'Jira degraded', impact: 'major', shortlink: 'https://stspg.io/x', incident_updates: updates },
    }),
});
const conditionalFailure = () => Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' });

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockTranslate.mockImplementation(async (texts) => texts.map((t) => ({ text: `KO:${t}` })));
    mockSend.mockResolvedValue({});
    axios.post.mockResolvedValue({ status: 202, statusText: 'Accepted' });
    mockResolve.mockImplementation(async (people) => people.map((p) => ({ ...p, name: `이름:${p.upn}` })));
});

test('첫 글은 Graph 로 조회한 이름으로 멘션한다', async () => {
    await handler(incidentEvent([update('u1', 'investigating', 0)]));

    expect(mockResolve).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][1].contents.msteams.entities[0]).toMatchObject({ text: '<at>이름:a@x.com</at>', mentioned: { id: 'a@x.com' } });
});

test('회신은 Graph 를 조회하지 않고 멘션도 없다', async () => {
    await handler(incidentEvent([update('u2', 'identified', 10), update('u1', 'investigating', 0)]));

    expect(mockResolve).not.toHaveBeenCalled();
    expect(axios.post.mock.calls[0][1].contents.msteams.entities).toEqual([]);
});

test('첫 업데이트는 새 글(B)로 보내고, 제목과 본문만 번역한다', async () => {
    const result = await handler(incidentEvent([update('u1', 'investigating', 0)]));

    expect(result).toBe('202 - Accepted');
    expect(mockTranslate).toHaveBeenCalledTimes(1);
    expect(mockTranslate.mock.calls[0][0]).toEqual(['Jira degraded', 'body u1']);
    const [url, payload] = axios.post.mock.calls[0];
    expect(url).toBe('https://flow.example/hook');
    expect(payload).toMatchObject({ channel: 'channel-1', uniqueId: 'inc-1', msgType: 'B' });
    expect(JSON.stringify(payload.contents)).toContain('KO:body u1');
});

test('이후 업데이트는 회신(C)으로 보내고, 최신 업데이트 하나만 번역한다', async () => {
    await handler(incidentEvent([update('u3', 'resolved', 30), update('u2', 'identified', 20), update('u1', 'investigating', 0)]));

    expect(mockTranslate.mock.calls[0][0]).toEqual(['Jira degraded', 'body u3']);
    const [, payload] = axios.post.mock.calls[0];
    expect(payload.msgType).toBe('C');
    const text = JSON.stringify(payload.contents);
    expect(text).toContain('KO:body u3');
    expect(text).not.toContain('body u2');
});

test('최신 update id 로 조건부 기록을 남긴다', async () => {
    await handler(incidentEvent([update('u1', 'investigating', 0)]));

    const put = mockSend.mock.calls[0][0];
    expect(put.kind).toBe('put');
    expect(put.input.TableName).toBe('dedup-table');
    expect(put.input.Item.updateId).toEqual({ S: 'u1' });
    expect(put.input.ConditionExpression).toBe('attribute_not_exists(updateId)');
});

test('이미 보낸 업데이트면 번역도 전송도 하지 않는다', async () => {
    mockSend.mockRejectedValueOnce(conditionalFailure());

    const result = await handler(incidentEvent([update('u1', 'investigating', 0)]));

    expect(result).toContain('이미 보낸 업데이트');
    expect(mockTranslate).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
});

test('DynamoDB 오류면 중복 위험을 감수하고 전송한다', async () => {
    mockSend.mockRejectedValueOnce(new Error('throttled'));

    const result = await handler(incidentEvent([update('u1', 'investigating', 0)]));

    expect(result).toBe('202 - Accepted');
});

test('웹훅 전송이 실패하면 기록을 지우고 오류를 던진다', async () => {
    axios.post.mockRejectedValueOnce(new Error('flow down'));

    await expect(handler(incidentEvent([update('u1', 'investigating', 0)]))).rejects.toThrow('flow down');

    const del = mockSend.mock.calls.find(([cmd]) => cmd.kind === 'delete')[0];
    expect(del.input.Key).toEqual({ updateId: { S: 'u1' } });
});

test('번역이 실패하면 원문으로 보낸다', async () => {
    mockTranslate.mockRejectedValueOnce(new Error('quota'));

    await handler(incidentEvent([update('u1', 'investigating', 0)]));

    expect(JSON.stringify(axios.post.mock.calls[0][1].contents)).toContain('body u1');
});

test('구성 요소 알림은 번역·기록·전송 없이 끝낸다', async () => {
    const result = await handler({ body: JSON.stringify({ component_update: { new_status: 'operational' }, component: {} }) });

    expect(result).toContain('발송 X');
    expect(mockTranslate).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
});

test('incident 가 아니거나 업데이트가 없으면 보내지 않는다', async () => {
    expect(await handler({ body: JSON.stringify({ page: {} }) })).toContain('발송 X');
    expect(await handler(incidentEvent([]))).toContain('발송 X');
    expect(axios.post).not.toHaveBeenCalled();
});

test('body 가 JSON 이 아니면 400', async () => {
    const result = await handler({ body: '{bad' });

    expect(result.statusCode).toBe(400);
});
