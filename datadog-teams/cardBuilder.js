'use strict';
// Datadog webhook payload → Teams Adaptive Card (개편안)
// Lambda(Node)와 미리보기 페이지(브라우저)에서 같은 코드를 쓰기 위해 UMD 형태로 작성
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CardBuilder = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    // 상태별 표시 정보 (title 의 [Triggered] / [Warn on {...}] 등에서 판별)
    const STATUS = {
        'triggered':    { label: 'Triggered',    icon: '🔴', style: 'attention', color: 'Attention' },
        're-triggered': { label: 'Re-Triggered', icon: '🔁', style: 'attention', color: 'Attention' },
        'warn':         { label: 'Warn',         icon: '🟠', style: 'warning',   color: 'Warning' },
        're-warn':      { label: 'Re-Warn',      icon: '🟠', style: 'warning',   color: 'Warning' },
        'recovered':    { label: 'Recovered',    icon: '🟢', style: 'good',      color: 'Good' },
        'no data':      { label: 'No Data',      icon: '⚪', style: 'emphasis',  color: 'Default' },
        're-no data':   { label: 'No Data',      icon: '⚪', style: 'emphasis',  color: 'Default' },
    };
    const DEFAULT_STATUS = { label: 'Alert', icon: '🔔', style: 'emphasis', color: 'Default' };

    const MONITOR_TYPES = {
        query_alert_monitor: '메트릭',
        log_alert: '로그',
        trace_analytics_alert: 'APM',
        synthetics_alert: 'Synthetics',
        event_v2_alert: '이벤트',
    };

    const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
    const SECTION_SEPARATOR = '- - -';
    const DETAILS_ID = 'details';
    const MAX_ACTIONS = 6; // Teams 가 카드 하단에 한 줄로 보여 주는 버튼 수
    const IMAGE_WIDTH = '360px'; // 높이는 비율 유지

    const TITLE_TAG = /^\s*\[([^\]]*)\]/;
    const STATUS_TAG = /^((?:Re-)?(?:Triggered|Warn|Recovered|No Data))(?: on \{(.*)\})?$/i;
    const PRIORITY_TAG = /^P[1-5]$/i;
    const TEST_TAG = /^TEST$/i;

    // Datadog 알림 채널 핸들(@webhook-…, @slack-… 등)과 이메일 알림(@user@domain)
    const NOTIFY_HANDLE = /(^|\s)@(?:webhook|slack|teams|opsgenie|pagerduty|oncall)-\S+/gi;
    const NOTIFY_EMAIL = /(^|\s)@[\w.+-]+@[\w.-]+/g;
    const MARKDOWN_LINK = /\[([^\[\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
    const QUERY_LINE = /^`[^`]+`$/;
    const CODE_FENCE = /^```/;
    const HEADING = /^#{1,6}\s+(.*)$/;
    const LIST_ITEM = /^[-*]\s+(.*)$/;

    // 사용자가 쓴 메시지가 끝나고 Datadog 이 자동으로 붙이는 영역이 시작되는 줄
    const AUTO_SECTION_START = [
        /^\[!\[/,                                   // 메트릭 그래프 이미지
        QUERY_LINE,                                 // 모니터 쿼리
        /^The monitor was last triggered at /,
        /^\[\d+ events? triggered this monitor\]/,
        /^- - -$/,
        /^(More than|Less than or exactly|The \*\*count\*\*) /,
        /^\*\*.+\*\* over \*\*/,
    ];
    const AUTO_NOISE = [/^\[!\[/, /^The monitor was last triggered at /, /^- - -$/];

    // ---------- title ----------

    const parseScope = (raw) => {
        if (!raw) return [];
        const grouped = raw.split(',').reduce((acc, pair) => {
            const i = pair.indexOf(':');
            if (i < 0) return acc;
            const key = pair.slice(0, i).trim();
            const value = pair.slice(i + 1).trim();
            return { ...acc, [key]: [...(acc[key] || []), value] };
        }, {});
        return Object.entries(grouped).map(([key, values]) => ({ key, value: values.join(', ') }));
    };

    const parseTitle = (rawTitle) => {
        const titleText = String(rawTitle ?? '');
        const initial = { statusKey: null, priority: null, isTest: false, scope: [], rest: titleText };
        const step = (acc) => {
            const match = acc.rest.match(TITLE_TAG);
            if (!match) return acc;
            const tag = match[1].trim();
            const next = { ...acc, rest: acc.rest.slice(match[0].length) };
            const status = tag.match(STATUS_TAG);
            if (status && !acc.statusKey) {
                return step({ ...next, statusKey: status[1].toLowerCase(), scope: parseScope(status[2]) });
            }
            if (PRIORITY_TAG.test(tag) && !acc.priority) return step({ ...next, priority: tag.toUpperCase() });
            if (TEST_TAG.test(tag)) return step({ ...next, isTest: true });
            return acc;
        };
        const parsed = step(initial);
        return {
            status: STATUS[parsed.statusKey] || DEFAULT_STATUS,
            isRecovered: parsed.statusKey === 'recovered',
            priority: parsed.priority,
            isTest: parsed.isTest,
            scope: parsed.scope,
            title: parsed.rest.trim() || titleText.trim(),
        };
    };

    // ---------- body ----------

    const stripHandles = (line) => line.replace(NOTIFY_HANDLE, '$1').replace(NOTIFY_EMAIL, '$1').trimEnd();

    const extractLinks = (lines) => lines.flatMap((line) =>
        Array.from(line.matchAll(MARKDOWN_LINK), (m) => ({ title: m[1].replace(/^\[/, ''), url: m[2] })));

    const splitBody = (rawBody) => {
        const lines = (typeof rawBody === 'string' ? rawBody : '').replaceAll('%%%', '').split('\n').map((l) => l.trimEnd());
        const lastSeparator = lines.lastIndexOf(SECTION_SEPARATOR);
        const content = lastSeparator >= 0 ? lines.slice(0, lastSeparator) : lines;
        const links = lastSeparator >= 0 ? extractLinks(lines.slice(lastSeparator + 1)) : [];
        const autoStart = content.findIndex((l) => AUTO_SECTION_START.some((re) => re.test(l.trim())));
        const message = (autoStart >= 0 ? content.slice(0, autoStart) : content).map(stripHandles);
        const auto = autoStart >= 0 ? content.slice(autoStart).map((l) => l.trim()) : [];
        const meaningful = auto.filter((l) => l && !AUTO_NOISE.some((re) => re.test(l)));
        return {
            message,
            links,
            query: meaningful.filter((l) => QUERY_LINE.test(l)).map((l) => l.slice(1, -1)),
            details: meaningful.filter((l) => !QUERY_LINE.test(l) && !stripHandles(l).match(/^\s*$/)).map(stripHandles),
        };
    };

    // ---------- adaptive card elements ----------

    const normalizeLine = (line) => {
        const trimmed = line.trim();
        const heading = trimmed.match(HEADING);
        if (heading) return `**${heading[1]}**`;
        const item = trimmed.match(LIST_ITEM);
        return item ? `- ${item[1]}` : trimmed;
    };

    const textBlock = (text, extra) => ({ type: 'TextBlock', text, wrap: true, ...extra });

    const codeContainer = (lines) => ({
        type: 'Container',
        style: 'emphasis',
        spacing: 'Small',
        items: lines.map((l, i) => textBlock(l || ' ', { fontType: 'Monospace', size: 'Small', spacing: i ? 'None' : 'Default' })),
    });

    // 빈 줄은 문단 구분으로만 쓰고, 줄마다 TextBlock 하나 (Teams 마크다운 줄바꿈 차이를 피하기 위함)
    const messageToElements = (lines, extra) => {
        const initial = { elements: [], code: null, gap: false };
        const result = lines.reduce((acc, line) => {
            if (CODE_FENCE.test(line.trim())) {
                return acc.code
                    ? { elements: [...acc.elements, codeContainer(acc.code)], code: null, gap: false }
                    : { ...acc, code: [] };
            }
            if (acc.code) return { ...acc, code: [...acc.code, line] };
            const text = normalizeLine(line);
            if (!text) return { ...acc, gap: acc.elements.length > 0 };
            const spacing = acc.elements.length === 0 ? 'Medium' : acc.gap ? 'Medium' : 'Small';
            return { ...acc, elements: [...acc.elements, textBlock(text, { spacing, ...extra })], gap: false };
        }, initial);
        return result.code ? [...result.elements, codeContainer(result.code)] : result.elements;
    };

    const formatKst = (epochMs) => {
        const ms = Number(epochMs);
        if (!Number.isFinite(ms) || ms <= 0) return '';
        const iso = new Date(ms + KST_OFFSET_MS).toISOString();
        return `${iso.slice(0, 10)} ${iso.slice(11, 16)} KST`;
    };

    const headerContainer = (parsed, payload) => {
        const meta = [
            `${parsed.status.icon} **${parsed.status.label}**`,
            parsed.priority && `**${parsed.priority}**`,
            parsed.isTest && 'TEST',
            MONITOR_TYPES[payload.event_type],
        ].filter(Boolean).join('  ·  ');
        const scopeText = parsed.scope.map((s) => `${s.key}: **${s.value}**`).join('   ');
        const occurredAt = formatKst(payload.date);
        return {
            type: 'Container',
            style: parsed.status.style,
            bleed: true,
            items: [
                {
                    type: 'ColumnSet',
                    columns: [
                        { type: 'Column', width: 'stretch', items: [textBlock(meta, { size: 'Small', color: parsed.status.color })] },
                        ...(occurredAt ? [{ type: 'Column', width: 'auto', items: [textBlock(occurredAt, { size: 'Small', isSubtle: true })] }] : []),
                    ],
                },
                textBlock(parsed.title, { size: 'Large', weight: 'Bolder', spacing: 'Small' }),
                ...(scopeText ? [textBlock(scopeText, { size: 'Small', isSubtle: true, spacing: 'Small' })] : []),
            ],
        };
    };

    const mentionLabel = (person) => person.displayName || person.upn;

    const peopleFactSet = (people) => {
        const byType = (type) => people.filter((p) => (p.type === 'cc') === (type === 'cc'))
            .map((p) => `<at>${mentionLabel(p)}</at>`).join(', ');
        const facts = [
            { title: '담당자', value: byType('assignee') },
            { title: '참조자', value: byType('cc') },
        ].filter((f) => f.value);
        return facts.length ? [{ type: 'FactSet', separator: true, spacing: 'Medium', facts }] : [];
    };

    const mentionEntities = (people) => people.map((p) => ({
        type: 'mention',
        text: `<at>${mentionLabel(p)}</at>`,
        mentioned: { id: p.upn, name: mentionLabel(p) },
    }));

    // 카드 안 멘션은 알림이 가지 않아, 흐름이 이 목록으로 멘션 회신을 따로 단다
    const mentionTargets = (people) => people.map((p) => ({ type: p.type === 'cc' ? 'cc' : 'assignee', upn: p.upn, name: mentionLabel(p) }));

    // Graph 로 올릴 글: 카드 첨부 + 그 아래 멘션 줄(알림 발생) + 카드 첨부. 카드 안 멘션은 알림이 가지 않는다
    const GRAPH_CARD_ID = 'alertcard';
    const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Teams 는 멘션 문구에 & 가 있으면 뒤에 `/at>` 를 남기므로 전각 ＆ 로 바꾼다
    const graphMentionText = (person) => mentionLabel(person).replace(/&/g, '＆');

    const buildGraphMessage = (card, people) => {
        const mentionable = people.filter((p) => p.id);
        const groups = [
            ['담당자', mentionable.filter((p) => p.type !== 'cc')],
            ['참조자', mentionable.filter((p) => p.type === 'cc')],
        ].filter(([, list]) => list.length);
        const ordered = groups.flatMap(([, list]) => list);
        const line = groups
            .map(([label, list]) => `${label}: ${list.map((p) => `<at id="${ordered.indexOf(p)}">${escapeHtml(graphMentionText(p))}</at>`).join(', ')}`)
            .join(' / ');
        return {
            body: { contentType: 'html', content: `<attachment id="${GRAPH_CARD_ID}"></attachment>${line ? `<p>${line}</p>` : ''}` },
            attachments: [{ id: GRAPH_CARD_ID, contentType: 'application/vnd.microsoft.card.adaptive', content: JSON.stringify(card) }],
            mentions: ordered.map((p, i) => ({
                id: i,
                mentionText: graphMentionText(p),
                mentioned: { user: { id: p.id, displayName: mentionLabel(p), userIdentityType: 'aadUser' } },
            })),
        };
    };

    const isUsableImage = (url) => typeof url === 'string' && /^https:\/\//.test(url);

    const detailsContainer = (body) => {
        if (!body.details.length && !body.query.length) return [];
        return [{
            type: 'Container',
            id: DETAILS_ID,
            isVisible: false,
            separator: true,
            spacing: 'Medium',
            items: [
                ...messageToElements(body.details, { size: 'Small', isSubtle: true }),
                ...(body.query.length ? [codeContainer(body.query)] : []),
            ],
        }];
    };

    const adaptiveCard = (body, actions, entities) => ({
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.5',
        body,
        actions,
        msteams: { width: 'Full', entities },
    });

    // resolvedPeople: [{ type: 'assignee' | 'cc', displayName, upn, id }] (Graph 조회로 확인된 사용자만)
    const buildCard = (payload, resolvedPeople) => {
        const people = (Array.isArray(resolvedPeople) ? resolvedPeople : []).filter((p) => p && p.upn);
        const parsed = parseTitle(payload.title);
        const body = splitBody(payload.body);
        const showAlertExtras = !parsed.isRecovered;
        const details = detailsContainer(body);

        const headBody = [
            headerContainer(parsed, payload),
            ...messageToElements(body.message),
            ...(showAlertExtras && isUsableImage(payload.image)
                ? [{
                    type: 'Image',
                    url: payload.image,
                    altText: 'Metric graph',
                    width: IMAGE_WIDTH,
                    spacing: 'Medium',
                    selectAction: { type: 'Action.OpenUrl', url: payload.image }, // 클릭 시 원본 크기로
                }]
                : []),
        ];
        const actions = [
            ...body.links.slice(0, details.length ? MAX_ACTIONS - 1 : MAX_ACTIONS).map((l) => ({ type: 'Action.OpenUrl', title: l.title, url: l.url })),
            ...(details.length ? [{ type: 'Action.ToggleVisibility', title: '상세 조건', targetElements: [DETAILS_ID] }] : []),
        ];

        // contents: 기존 '카드 게시' 단계용 (담당자 칸 + 카드 안 멘션)
        // graphMessage: Graph 로 올릴 새 글 (멘션 줄 + 담당자 칸 없는 카드). 새 알람에만 넣는다
        const contents = adaptiveCard(
            [...headBody, ...(showAlertExtras ? peopleFactSet(people) : []), ...details],
            actions,
            showAlertExtras ? mentionEntities(people) : [],
        );
        return {
            channel: payload.channel || '',
            eventId: payload.event_id || '',
            msgType: parsed.isRecovered ? 'B' : 'A',
            mentions: showAlertExtras ? mentionTargets(people) : [],
            contents,
            ...(showAlertExtras ? { graphMessage: buildGraphMessage(adaptiveCard([...headBody, ...details], actions, []), people) } : {}),
        };
    };

    return { buildCard, parseTitle, splitBody, formatKst };
});
