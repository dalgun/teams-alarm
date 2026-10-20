'use strict';
const axios = require('axios');
const deepl = require('deepl-node');
const { DynamoDBClient, PutItemCommand, DeleteItemCommand } = require('@aws-sdk/client-dynamodb');
const { buildIncidentCard, latestUpdate, selectMentionPeople } = require('./cardBuilder');
const { resolveDisplayNames } = require('./graph');

const webhookURL = process.env.WEBHOOK_URL;
const channelId = process.env.CHANNEL_ID;
const dedupTable = process.env.DEDUP_TABLE;
// 첫 글에 멘션할 사람: MENTION_PEOPLE='[{"type":"assignee","upn":"a@x.com"}, {"type":"cc","upn":"b@x.com"}]'
// 표시 이름은 보낼 때 Graph 로 조회
const parseMentionPeople = (raw) => {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.error('MENTION_PEOPLE 형식 오류, 멘션 없이 전송:', err.message);
        return [];
    }
};
const mentionPeople = parseMentionPeople(process.env.MENTION_PEOPLE);
const translator = new deepl.Translator(process.env.DEEPL_AUTH_KEY, { serverUrl: 'https://api-free.deepl.com' });
const dynamo = new DynamoDBClient({});

const DEDUP_TTL_SECONDS = 7 * 24 * 60 * 60;

// DeepL 실패 시 원문 그대로 사용
const translateTexts = async (texts) => {
    try {
        const result = await translator.translateText(texts, null, 'ko');
        return result.map((r) => r.text);
    } catch (err) {
        console.error('Translation error:', err.message);
        return texts;
    }
};

// 같은 incident update 는 한 번만 보낸다. 조건부 쓰기에 성공한 호출만 true
// DynamoDB 자체 오류는 알람 누락보다 중복이 낫다고 보고 true(전송) 처리
const claimUpdate = async (update, incidentId) => {
    if (!dedupTable) return true;
    try {
        await dynamo.send(new PutItemCommand({
            TableName: dedupTable,
            Item: {
                updateId: { S: update.id },
                incidentId: { S: incidentId || '' },
                expiresAt: { N: String(Math.floor(Date.now() / 1000) + DEDUP_TTL_SECONDS) },
            },
            ConditionExpression: 'attribute_not_exists(updateId)',
        }));
        return true;
    } catch (err) {
        if (err.name === 'ConditionalCheckFailedException') return false;
        console.error('Dedup check error, sending anyway:', err.message);
        return true;
    }
};

// 전송 실패 시 기록을 지워서 Statuspage 재시도 때 다시 보낼 수 있게 한다
const releaseUpdate = async (update) => {
    if (!dedupTable) return;
    try {
        await dynamo.send(new DeleteItemCommand({ TableName: dedupTable, Key: { updateId: { S: update.id } } }));
    } catch (err) {
        console.error('Dedup release error:', err.message);
    }
};

const handleIncident = async (incident) => {
    const update = latestUpdate(incident);
    if (!update?.id) return 'incident update 없음 → 발송 X';
    console.log(JSON.stringify({ incidentId: incident.id, updateId: update.id, status: update.status, updates: incident.incident_updates.length }));

    if (!(await claimUpdate(update, incident.id))) return `이미 보낸 업데이트(${update.id}) → 발송 X`;

    const [name, body] = await translateTexts([incident.name || '', update.body || '']);
    // 회신에는 멘션하지 않으므로 첫 글일 때만 Graph 조회
    const isFirstPost = incident.incident_updates.length === 1;
    const people = isFirstPost ? await resolveDisplayNames(selectMentionPeople(mentionPeople, new Date())) : [];
    const card = buildIncidentCard(incident, { name, body }, { people });
    try {
        const response = await axios.post(webhookURL, { channel: channelId, ...card }, { headers: { 'content-type': 'application/json' } });
        return `${response.status} - ${response.statusText}`;
    } catch (err) {
        console.error('Webhook error:', err.message);
        await releaseUpdate(update);
        throw err;
    }
};

exports.handler = async (event) => {
    let message;
    try {
        message = JSON.parse(event.body);
    } catch (e) {
        console.error('Invalid JSON body:', e.message);
        return { statusCode: 400, body: 'Invalid JSON' };
    }

    // 구성 요소 상태 변경 알림은 채널로 보내지 않음 (번역 전에 종료)
    if (message?.component_update) return '컴포넌트 구성 요소 알람으로 분류되어 팀즈 메세지 발송 X';
    if (!Array.isArray(message?.incident?.incident_updates)) return 'incident 알림 아님 → 발송 X';

    return handleIncident(message.incident);
};
