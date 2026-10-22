'use strict';
const { buildIncidentCard, latestUpdate, formatKst, selectMentionPeople } = require('../cardBuilder');

const update = (id, status, time, body = `body ${id}`) => ({ id, status, body, created_at: `2026-10-01T${time}:00Z` });
const incidentOf = (updates, extra) => ({
    id: 'inc-1', name: 'Jira degraded', impact: 'major', shortlink: 'https://stspg.io/x',
    components: [{ name: 'Jira' }, { name: 'Confluence' }, { name: 'Jira' }],
    incident_updates: updates,
    ...extra,
});
const stepper = (card) => card.contents.body.find((e) => e.type === 'ColumnSet' && e.separator);
const stepTexts = (card) => stepper(card).columns.map((c) => c.items.map((i) => i.text).join('|'));
const allText = (card) => JSON.stringify(card.contents);

test('latestUpdate: 순서와 상관없이 가장 최근 업데이트를 고른다', () => {
    const incident = incidentOf([update('a', 'investigating', '02:00'), update('b', 'identified', '03:00')]);
    expect(latestUpdate(incident).id).toBe('b');
    expect(latestUpdate({})).toBeNull();
});

test('formatKst: UTC 를 KST 로, 잘못된 값은 빈 문자열', () => {
    expect(formatKst('2026-10-01T02:55:55Z')).toBe('2026-10-01 11:55 KST');
    expect(formatKst('nope')).toBe('');
});

test('첫 글: 헤더에 상태·영향도·제목·영향 서비스(중복 제거)를 넣는다', () => {
    const card = buildIncidentCard(incidentOf([update('u1', 'investigating', '02:55')]), { name: '지라 성능 저하', body: '번역 본문' });

    expect(card.msgType).toBe('B');
    expect(card.uniqueId).toBe('inc-1');
    const header = card.contents.body[0];
    expect(header).toMatchObject({ type: 'Container', style: 'attention', bleed: true });
    const text = JSON.stringify(header);
    expect(text).toContain('🔍 **조사 중**');
    expect(text).toContain('영향도 주요');
    expect(text).toContain('지라 성능 저하');
    expect(text).toContain('Atlassian  ·  Jira, Confluence"');
});

test('경미 장애는 헤더가 주황(warning)', () => {
    const card = buildIncidentCard(incidentOf([update('u1', 'investigating', '02:55')], { impact: 'minor' }), {});

    expect(card.contents.body[0].style).toBe('warning');
});

test('회신: 색 띠에 상태 줄만 두고 제목 없이 최신 본문만 넣는다', () => {
    const card = buildIncidentCard(incidentOf([update('u2', 'identified', '03:47'), update('u1', 'investigating', '02:55')]), { name: '제목', body: '최신 번역' });

    expect(card.msgType).toBe('C');
    expect(card.contents.body[0]).toMatchObject({ type: 'Container', style: 'attention' });
    expect(card.contents.body[0].items).toHaveLength(1);
    expect(allText(card)).not.toContain('제목');
    expect(allText(card)).toContain('최신 번역');
    expect(allText(card)).not.toContain('body u1');
});

test('진행 단계: 도달 시각, 건너뛴 단계, 현재 단계를 표시한다', () => {
    const card = buildIncidentCard(incidentOf([
        update('u3', 'resolved', '07:51'), update('u2b', 'identified', '05:00'),
        update('u2', 'identified', '03:47'), update('u1', 'investigating', '02:55'),
    ]), {});

    expect(stepTexts(card)).toEqual(['●|조사 중|11:55', '●|원인 확인|12:47', '○|모니터링|건너뜀', '●|해결됨|16:51']);
    expect(stepper(card).columns[3].items[1].weight).toBe('Bolder');
});

test('진행 단계: 아직 안 온 단계는 시각 없이 흐리게', () => {
    const card = buildIncidentCard(incidentOf([update('u1', 'investigating', '02:55')]), {});

    expect(stepTexts(card)).toEqual(['●|조사 중|11:55', '○|원인 확인| ', '○|모니터링| ', '○|해결됨| ']);
    expect(stepper(card).columns[1].items[1].isSubtle).toBe(true);
});

test('정기 점검은 점검 단계로 표시한다', () => {
    const card = buildIncidentCard(incidentOf([update('m1', 'in_progress', '01:00')], { impact: 'maintenance' }), {});

    expect(stepTexts(card).map((t) => t.split('|')[1])).toEqual(['점검 예정', '점검 중', '점검 확인', '점검 완료']);
});

test('알 수 없는 상태는 진행 단계 없이 업데이트로 표시한다', () => {
    const card = buildIncidentCard(incidentOf([update('x', 'something', '01:00')]), {});

    expect(stepper(card)).toBeUndefined();
    expect(allText(card)).toContain('업데이트');
});

test('해결됨은 초록(good) 배지', () => {
    const card = buildIncidentCard(incidentOf([update('u2', 'resolved', '03:00'), update('u1', 'investigating', '02:00')]), {});

    expect(card.contents.body[0].style).toBe('good');
});

test('멘션: 첫 글에 담당자/참조자 FactSet 과 entity 를 넣는다', () => {
    const people = [
        { type: 'assignee', upn: 'a@x.com', name: '이현진' },
        { type: 'assignee', upn: 'b@x.com', name: '이수빈' },
        { type: 'cc', upn: 'c@x.com', name: '김민애' },
        { type: 'cc', upn: '', name: '빈 계정' },
    ];
    const first = buildIncidentCard(incidentOf([update('u1', 'investigating', '02:55')]), {}, { people });

    const facts = first.contents.body.find((e) => e.type === 'FactSet').facts;
    expect(facts).toEqual([
        { title: '담당자', value: '<at>이현진</at>, <at>이수빈</at>' },
        { title: '참조자', value: '<at>김민애</at>' },
    ]);
    expect(first.contents.msteams.entities).toEqual([
        { type: 'mention', text: '<at>이현진</at>', mentioned: { id: 'a@x.com', name: '이현진' } },
        { type: 'mention', text: '<at>이수빈</at>', mentioned: { id: 'b@x.com', name: '이수빈' } },
        { type: 'mention', text: '<at>김민애</at>', mentioned: { id: 'c@x.com', name: '김민애' } },
    ]);
    expect(first.mentions).toEqual([
        { type: 'assignee', upn: 'a@x.com', name: '이현진' },
        { type: 'assignee', upn: 'b@x.com', name: '이수빈' },
        { type: 'cc', upn: 'c@x.com', name: '김민애' },
    ]);
});

test('graphMessage: 첫 글은 멘션 줄과 담당자 칸 없는 카드를 담고, 회신에는 없다', () => {
    const people = [
        { type: 'assignee', upn: 'a@x.com', name: '이현진(CMS/ALM) - 이마트팀', id: 'oid-a' },
        { type: 'cc', upn: 'c@x.com', name: '권달마(A&I팀)', id: 'oid-c' },
        { type: 'cc', upn: 'n@x.com', name: 'ID 없음' },
    ];
    const first = buildIncidentCard(incidentOf([update('u1', 'investigating', '02:55')]), {}, { people });
    const { body, attachments, mentions } = first.graphMessage;

    expect(body.content).toBe('<attachment id="incidentcard"></attachment><p>담당자: <at id="0">이현진(CMS/ALM) - 이마트팀</at> / 참조자: <at id="1">권달마(A＆I팀)</at></p>');
    expect(mentions).toEqual([
        { id: 0, mentionText: '이현진(CMS/ALM) - 이마트팀', mentioned: { user: { id: 'oid-a', displayName: '이현진(CMS/ALM) - 이마트팀', userIdentityType: 'aadUser' } } },
        { id: 1, mentionText: '권달마(A＆I팀)', mentioned: { user: { id: 'oid-c', displayName: '권달마(A&I팀)', userIdentityType: 'aadUser' } } },
    ]);
    const card = JSON.parse(attachments[0].content);
    expect(card.body.some((e) => e.type === 'FactSet')).toBe(false);
    expect(card.msteams.entities).toEqual([]);

    const reply = buildIncidentCard(incidentOf([update('u2', 'identified', '03:00'), update('u1', 'investigating', '02:55')]), {}, { people });
    expect(reply.graphMessage).toBeUndefined();
});

test('selectMentionPeople: 평일 09~18시(KST)는 담당자만, 그 외·주말은 참조자까지', () => {
    const people = [{ type: 'assignee', upn: 'a', name: 'A' }, { type: 'cc', upn: 'c', name: 'C' }];
    const names = (iso) => selectMentionPeople(people, new Date(iso)).map((p) => p.name);

    expect(names('2026-10-20T00:00:00Z')).toEqual(['A']);        // 화 09:00 KST
    expect(names('2026-10-20T08:59:00Z')).toEqual(['A']);        // 화 17:59 KST
    expect(names('2026-10-20T09:00:00Z')).toEqual(['A', 'C']);   // 화 18:00 KST
    expect(names('2026-10-19T23:59:00Z')).toEqual(['A', 'C']);   // 화 08:59 KST
    expect(names('2026-10-24T03:00:00Z')).toEqual(['A', 'C']);   // 토 12:00 KST
    expect(selectMentionPeople(undefined, new Date())).toEqual([]);
});

test('멘션: 회신이나 대상이 없으면 넣지 않는다', () => {
    const people = [{ type: 'assignee', upn: 'a@x.com', name: '이현진' }];
    const reply = buildIncidentCard(incidentOf([update('u2', 'identified', '03:00'), update('u1', 'investigating', '02:55')]), {}, { people });
    const none = buildIncidentCard(incidentOf([update('u1', 'investigating', '02:55')]), {}, { people: 'bad' });

    [reply, none].forEach((card) => {
        expect(card.contents.msteams.entities).toEqual([]);
        expect(card.mentions).toEqual([]);
        expect(card.contents.body.some((e) => e.type === 'FactSet')).toBe(false);
    });
});

test('번역문이 원문과 다를 때만 원문 보기 토글을 만든다', () => {
    const incident = incidentOf([update('u1', 'investigating', '02:55', 'English body')]);

    const translated = buildIncidentCard(incident, { body: '한국어 본문' });
    expect(translated.contents.actions.map((a) => a.title)).toEqual(['상태 페이지', '원문 보기']);
    expect(translated.contents.body.find((e) => e.id === 'original').isVisible).toBe(false);

    const untranslated = buildIncidentCard(incident, { body: 'English body' });
    expect(untranslated.contents.actions.map((a) => a.title)).toEqual(['상태 페이지']);
});

test('업데이트가 없으면 null', () => {
    expect(buildIncidentCard(incidentOf([]), {})).toBeNull();
    expect(buildIncidentCard({}, {})).toBeNull();
});
