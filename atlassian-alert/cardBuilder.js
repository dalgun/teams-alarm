'use strict';
// Atlassian Statuspage incident webhook → Teams Adaptive Card
// Lambda(Node)와 미리보기 페이지(브라우저)에서 같은 코드를 쓰기 위해 UMD 형태로 작성
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.IncidentCardBuilder = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    // incident.impact
    const IMPACT = {
        critical:    { label: '치명',     style: 'attention', color: 'Attention' },
        major:       { label: '주요',     style: 'attention', color: 'Attention' },
        minor:       { label: '경미',     style: 'warning',   color: 'Warning' },
        maintenance: { label: '점검',     style: 'accent',    color: 'Accent' },
        none:        { label: '영향 없음', style: 'emphasis',  color: 'Default' },
    };

    // incident_update.status (DeepL 대신 고정 번역)
    const STATUS = {
        investigating: { label: '조사 중',   icon: '🔍' },
        identified:    { label: '원인 확인', icon: '🛠️' },
        monitoring:    { label: '모니터링',  icon: '👀' },
        resolved:      { label: '해결됨',    icon: '✅', style: 'good', color: 'Good' },
        postmortem:    { label: '사후 분석', icon: '📝', style: 'good', color: 'Good' },
        scheduled:     { label: '점검 예정', icon: '🗓️' },
        in_progress:   { label: '점검 중',   icon: '🔧' },
        verifying:     { label: '점검 확인', icon: '🔎' },
        completed:     { label: '점검 완료', icon: '✅', style: 'good', color: 'Good' },
    };
    const DEFAULT_STATUS = { label: '업데이트', icon: 'ℹ️' };

    // 진행 단계 표시용 (장애 / 정기 점검)
    const INCIDENT_STAGES = ['investigating', 'identified', 'monitoring', 'resolved'];
    const MAINTENANCE_STAGES = ['scheduled', 'in_progress', 'verifying', 'completed'];
    const STAGE_ALIAS = { postmortem: 'resolved' };

    const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
    const ORIGINAL_ID = 'original';
    const MSG_TYPE_FIRST = 'B';  // 새 글
    const MSG_TYPE_REPLY = 'C';  // 같은 uniqueId 글의 스레드 회신

    const statusOf = (key) => STATUS[key] || DEFAULT_STATUS;
    const impactOf = (key) => IMPACT[key] || IMPACT.none;

    const toKst = (iso) => {
        const ms = Date.parse(iso);
        return Number.isFinite(ms) ? new Date(ms + KST_OFFSET_MS).toISOString() : '';
    };
    const formatKst = (iso) => {
        const kst = toKst(iso);
        return kst ? `${kst.slice(0, 10)} ${kst.slice(11, 16)} KST` : '';
    };
    const formatKstTime = (iso) => toKst(iso).slice(11, 16);

    // Statuspage 는 incident_updates 를 최신순으로 보냄. 순서가 바뀌어도 되도록 직접 정렬
    const sortUpdates = (updates) => (Array.isArray(updates) ? updates : [])
        .filter((u) => u && typeof u === 'object')
        .slice()
        .sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));

    const latestUpdate = (incident) => sortUpdates(incident?.incident_updates)[0] || null;

    const componentNames = (incident) => Array.from(new Set(
        (Array.isArray(incident?.components) ? incident.components : []).map((c) => c?.name).filter(Boolean)));

    const textBlock = (text, extra) => ({ type: 'TextBlock', text, wrap: true, ...extra });

    const paragraphs = (text, extra) => String(text ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
        .map((p, i) => textBlock(p, { spacing: i ? 'Small' : 'Medium', ...extra }));

    // ---------- 카드 구성 요소 ----------

    // 해결 계열은 초록, 진행 중이면 영향도 색
    const toneOf = (incident, update) => {
        const status = statusOf(update.status);
        const impact = impactOf(incident.impact);
        return { style: status.style || impact.style, color: status.color || impact.color };
    };

    // 상태(색 글자) · 영향도 | 오른쪽 시각
    const statusRow = (update, tone, impactLabel) => {
        const status = statusOf(update.status);
        const meta = [`${status.icon} **${status.label}**`, impactLabel && `영향도 ${impactLabel}`].filter(Boolean).join('  ·  ');
        return {
            type: 'ColumnSet',
            columns: [
                { type: 'Column', width: 'stretch', items: [textBlock(meta, { size: 'Small', color: tone.color })] },
                { type: 'Column', width: 'auto', items: [textBlock(formatKst(update.created_at), { size: 'Small', isSubtle: true })] },
            ],
        };
    };

    const headerContainer = ({ incident, update, title, isReply }) => {
        const tone = toneOf(incident, update);
        const components = componentNames(incident);
        return {
            type: 'Container',
            style: tone.style,
            bleed: true,
            items: isReply
                ? [statusRow(update, tone)]
                : [
                    statusRow(update, tone, impactOf(incident.impact).label),
                    textBlock(title, { size: 'Large', weight: 'Bolder', spacing: 'Small' }),
                    ...(components.length
                        ? [textBlock(`Atlassian  ·  ${components.join(', ')}`, { size: 'Small', isSubtle: true, spacing: 'Small' })]
                        : []),
                ],
        };
    };

    // 평일 09:00~18:00(KST)에는 담당자만, 그 밖의 시간·주말에는 참조자까지 멘션
    const BUSINESS_HOURS = { start: 9, end: 18 };
    const isBusinessHours = (date) => {
        const kst = new Date(date.getTime() + KST_OFFSET_MS);
        const day = kst.getUTCDay();
        const hour = kst.getUTCHours();
        return day >= 1 && day <= 5 && hour >= BUSINESS_HOURS.start && hour < BUSINESS_HOURS.end;
    };
    const selectMentionPeople = (people, now) => {
        const list = Array.isArray(people) ? people : [];
        return isBusinessHours(now) ? list.filter((p) => p?.type !== 'cc') : list;
    };

    // 담당자/참조자 멘션 (첫 글에만). people: [{ type: 'assignee' | 'cc', upn, name }]
    const peopleMention = (people) => {
        const valid = (Array.isArray(people) ? people : []).filter((p) => p?.upn && p?.name);
        if (!valid.length) return null;
        const line = (isCc) => valid.filter((p) => (p.type === 'cc') === isCc).map((p) => `<at>${p.name}</at>`).join(', ');
        const facts = [{ title: '담당자', value: line(false) }, { title: '참조자', value: line(true) }].filter((f) => f.value);
        return {
            element: { type: 'FactSet', separator: true, spacing: 'Medium', facts },
            entities: valid.map((p) => ({ type: 'mention', text: `<at>${p.name}</at>`, mentioned: { id: p.upn, name: p.name } })),
        };
    };

    // 진행 단계: 단계별 첫 도달 시각을 표시하고, 현재 단계는 강조, 아직 안 온 단계는 흐리게
    const stageStepper = (updates, tone) => {
        const latest = updates[0];
        const stageKey = (s) => STAGE_ALIAS[s] || s;
        const stages = MAINTENANCE_STAGES.includes(stageKey(latest.status)) ? MAINTENANCE_STAGES : INCIDENT_STAGES;
        const reachedAt = updates.slice().reverse().reduce((acc, u) => {
            const key = stageKey(u.status);
            return acc[key] ? acc : { ...acc, [key]: u.created_at };
        }, {});
        const currentIndex = stages.indexOf(stageKey(latest.status));
        if (currentIndex < 0) return [];
        const columns = stages.map((key, i) => {
            const isCurrent = i === currentIndex;
            const isDone = i < currentIndex && reachedAt[key];
            const isSkipped = i < currentIndex && !reachedAt[key];
            const color = isCurrent ? tone.color : isDone ? 'Good' : 'Default';
            const muted = !isCurrent && !isDone;
            return {
                type: 'Column',
                width: 'stretch',
                items: [
                    textBlock(isCurrent ? '●' : isDone ? '●' : '○', { color, isSubtle: muted, horizontalAlignment: 'Center', spacing: 'None' }),
                    textBlock(statusOf(key).label, { size: 'Small', weight: isCurrent ? 'Bolder' : 'Default', isSubtle: muted, horizontalAlignment: 'Center', spacing: 'None' }),
                    textBlock(reachedAt[key] && i <= currentIndex ? formatKstTime(reachedAt[key]) : isSkipped ? '건너뜀' : ' ',
                        { size: 'Small', isSubtle: true, horizontalAlignment: 'Center', spacing: 'None' }),
                ],
            };
        });
        return [{ type: 'ColumnSet', separator: true, spacing: 'Medium', columns }];
    };

    /**
     * @param {object} incident  Statuspage webhook 의 incident
     * @param {{ name?: string, body?: string }} translated  incident.name / 최신 update body 의 번역문 (없으면 원문)
     * @param {{ people?: Array<{ type: string, upn: string, name: string }> }} [options]  첫 글에 멘션할 담당자/참조자
     * @returns {{ uniqueId: string, msgType: string, contents: object } | null}
     */
    const buildIncidentCard = (incident, translated, options) => {
        const updates = sortUpdates(incident?.incident_updates);
        const update = updates[0];
        if (!update) return null;
        const isReply = updates.length > 1;
        const title = translated?.name || incident.name || 'Atlassian 장애';
        const body = translated?.body || update.body || '';
        const hasOriginal = Boolean(translated?.body && update.body && translated.body !== update.body);
        const mention = isReply ? null : peopleMention(options?.people);

        const cardBody = [
            headerContainer({ incident, update, title, isReply }),
            ...paragraphs(body),
            ...(mention ? [mention.element] : []),
            ...stageStepper(updates, toneOf(incident, update)),
            ...(hasOriginal
                ? [{ type: 'Container', id: ORIGINAL_ID, isVisible: false, separator: true, spacing: 'Medium', items: paragraphs(update.body, { size: 'Small', isSubtle: true }) }]
                : []),
        ];
        const actions = [
            ...(incident.shortlink ? [{ type: 'Action.OpenUrl', title: '상태 페이지', url: incident.shortlink }] : []),
            ...(hasOriginal ? [{ type: 'Action.ToggleVisibility', title: '원문 보기', targetElements: [ORIGINAL_ID] }] : []),
        ];

        return {
            uniqueId: incident.id || '',
            msgType: isReply ? MSG_TYPE_REPLY : MSG_TYPE_FIRST,
            contents: {
                $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
                type: 'AdaptiveCard',
                version: '1.5',
                body: cardBody,
                actions,
                msteams: { width: 'Full', entities: mention ? mention.entities : [] },
            },
        };
    };

    return { buildIncidentCard, latestUpdate, formatKst, selectMentionPeople };
});
