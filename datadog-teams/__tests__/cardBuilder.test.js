'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCard, parseTitle, splitBody, formatKst } = require('../cardBuilder');
const fixtures = require('./fixtures.json');

const allText = (card) => JSON.stringify(card.contents.body);

test('parseTitle: 우선순위가 앞에 오는 형식에서 상태와 우선순위를 분리한다', () => {
    const t = parseTitle('[P1] [Triggered] [NSAP-PRD-BI][ALB] ALB 응답 지연');
    assert.equal(t.status.label, 'Triggered');
    assert.equal(t.priority, 'P1');
    assert.equal(t.title, '[NSAP-PRD-BI][ALB] ALB 응답 지연');
});

test('parseTitle: "on {…}" 범위를 key별로 묶는다', () => {
    const t = parseTitle('[Warn on {service:a,service:b,env:prd}] [P1] 에러율 급증');
    assert.equal(t.status.style, 'warning');
    assert.deepEqual(t.scope, [{ key: 'service', value: 'a, b' }, { key: 'env', value: 'prd' }]);
    assert.equal(t.title, '에러율 급증');
});

test('parseTitle: Recovered / Re-Triggered / TEST 를 구분한다', () => {
    assert.equal(parseTitle('[Recovered] x').isRecovered, true);
    assert.equal(parseTitle('[P1] [Re-Triggered] x').status.label, 'Re-Triggered');
    const t = parseTitle('[TEST] [P2] x');
    assert.equal(t.isTest, true);
    assert.equal(t.status.label, 'Alert');
});

test('parseTitle: 태그가 없으면 원래 제목을 유지한다', () => {
    assert.equal(parseTitle('그냥 제목').title, '그냥 제목');
    assert.equal(parseTitle(undefined).title, '');
});

test('splitBody: 알림 핸들은 줄 전체든 문장 끝이든 제거한다', () => {
    const body = splitBody('%%%\n문장 끝 @webhook-a-mention\n@slack-b \n@webhook-c\n본문\n- - -\n[[Monitor Status](https://x/1)] · [[Edit](https://x/2)]\n%%%');
    assert.deepEqual(body.message.filter(Boolean), ['문장 끝', '본문']);
    assert.deepEqual(body.links, [{ title: 'Monitor Status', url: 'https://x/1' }, { title: 'Edit', url: 'https://x/2' }]);
});

test('splitBody: 쿼리와 자동 설명은 details 로 분리하고 그래프·발생 시각 줄은 버린다', () => {
    const { payload } = fixtures.logAlert;
    const body = splitBody(payload.body);
    assert.ok(body.details.some((l) => l.startsWith('More than **50** log events')));
    assert.ok(!body.message.some((l) => /last triggered/.test(l)));
    const crash = splitBody(fixtures.crashLoopWithCode.payload.body);
    assert.equal(crash.query.length, 1);
    assert.ok(!crash.details.some((l) => l.startsWith('[![')));
});

test('formatKst: epoch ms 를 KST 문자열로, 잘못된 값은 빈 문자열', () => {
    assert.equal(formatKst('1791774753000'), '2026-10-12 12:12 KST');
    assert.equal(formatKst('abc'), '');
});

test('buildCard: 멘션은 표시 이름으로, id 는 UPN 으로 만든다', () => {
    const { payload, people } = fixtures.alertWithPeople;
    const card = buildCard(payload, people);
    const [first] = card.contents.msteams.entities;
    assert.equal(first.text, `<at>${people[0].displayName}</at>`);
    assert.deepEqual(first.mentioned, { id: people[0].upn, name: people[0].displayName });
    assert.ok(allText(card).includes(`<at>${people[0].displayName}</at>`));
    assert.ok(!allText(card).includes(people[0].upn));
});

test('buildCard: 표시 이름이 없으면 UPN 으로 대체한다', () => {
    const { payload } = fixtures.alertWithPeople;
    const card = buildCard(payload, [{ type: 'assignee', upn: 'a@emart.com' }]);
    assert.equal(card.contents.msteams.entities[0].text, '<at>a@emart.com</at>');
});

test('buildCard: 알림 핸들·마크다운 그래프·last triggered 문구가 카드에 남지 않는다', () => {
    Object.values(fixtures).forEach(({ payload, people }) => {
        const text = allText(buildCard(payload, people));
        assert.doesNotMatch(text, /@webhook-|@slack-|\[!\[|last triggered/, payload.title);
    });
});

test('buildCard: 발생 알람은 msgType A, 그래프 Image 하나, 링크 버튼을 만든다', () => {
    const { payload, people } = fixtures.alertWithPeople;
    const card = buildCard(payload, people);
    assert.equal(card.msgType, 'A');
    assert.equal(card.contents.body.filter((e) => e.type === 'Image').length, 1);
    assert.ok(card.contents.actions.some((a) => a.title === 'Monitor Status'));
});

test('buildCard: 복구 알람은 msgType B, 그래프·멘션 없이 링크 버튼은 유지한다', () => {
    const { payload, people } = fixtures.recoveredWithPeople;
    const card = buildCard(payload, people);
    assert.equal(card.msgType, 'B');
    assert.equal(card.contents.body.some((e) => e.type === 'Image' || e.type === 'FactSet'), false);
    assert.deepEqual(card.contents.msteams.entities, []);
    assert.ok(card.contents.actions.length > 0);
    assert.equal(card.contents.body[0].style, 'good');
});

test('buildCard: 쿼리가 있으면 숨김 상세 영역과 토글 버튼을 만든다', () => {
    const card = buildCard(fixtures.crashLoopWithCode.payload, []);
    const details = card.contents.body.find((e) => e.id === 'details');
    assert.equal(details.isVisible, false);
    assert.ok(card.contents.actions.some((a) => a.type === 'Action.ToggleVisibility'));
});

test('buildCard: 본문의 코드 블록은 고정폭 Container 로 바꾼다', () => {
    const card = buildCard(fixtures.crashLoopWithCode.payload, []);
    const code = card.contents.body.find((e) => e.type === 'Container' && e.style === 'emphasis');
    assert.ok(code.items.every((i) => i.fontType === 'Monospace'));
    assert.ok(code.items[0].text.startsWith('kubectl logs'));
});

test('buildCard: image 가 null 이거나 https 가 아니면 Image 를 넣지 않는다', () => {
    const { payload } = fixtures.alertWithPeople;
    ['null', '', 'http://x/a.png'].forEach((image) => {
        const card = buildCard({ ...payload, image }, []);
        assert.equal(card.contents.body.some((e) => e.type === 'Image'), false);
    });
});

test('buildCard: Power Automate 로 넘기는 형식(channel/eventId/msgType/contents)을 유지한다', () => {
    const card = buildCard({ title: '[Triggered] x', body: '', channel: 'ch', event_id: 'e1' }, []);
    assert.deepEqual(Object.keys(card), ['channel', 'eventId', 'msgType', 'contents']);
    assert.equal(card.channel, 'ch');
    assert.equal(card.eventId, 'e1');
    assert.equal(card.contents.type, 'AdaptiveCard');
});

test('buildCard: 문자열이 아닌 title/body, null 담당자에도 예외 없이 카드를 만든다', () => {
    const card = buildCard({ title: 5, body: {}, date: 'x' }, [null, { type: 'cc' }]);
    assert.equal(card.contents.body[0].items[1].text, '5');
    assert.deepEqual(card.contents.msteams.entities, []);
    assert.equal(card.contents.body[0].items[0].columns.length, 1);
});

test('buildCard: 버튼은 상세 조건 토글을 포함해 6개를 넘지 않는다', () => {
    const links = Array.from({ length: 8 }, (_, i) => `[[L${i}](https://x/${i})]`).join(' · ');
    const card = buildCard({ title: '[Triggered] x', body: `msg\n\`q{a}\`\n- - -\n${links}` }, []);
    assert.equal(card.contents.actions.length, 6);
    assert.equal(card.contents.actions.at(-1).type, 'Action.ToggleVisibility');
});

test('buildCard: 본문이 비어 있어도 헤더는 만든다', () => {
    const card = buildCard({ title: '[Recovered] 빈 본문', body: '%%%\n@webhook-x\n%%%' }, []);
    assert.equal(card.contents.body.length, 1);
    assert.equal(card.contents.body[0].type, 'Container');
});
