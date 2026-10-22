'use strict';
const axios = require('axios');
const { buildCard, parseTitle } = require('./cardBuilder');

// 상수 정의
const GRAPH_API_ENDPOINT = 'https://graph.microsoft.com/v1.0/users';
const TOKEN_ENDPOINT = 'https://login.microsoftonline.com/d4ffc887-d88d-41cc-bf6a-6bb47ec0f3ca/oauth2/v2.0/token';
const CLIENT_ID = '17645b26-29bc-4d9d-8733-58901cf04bc0';
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET; // Lambda 환경변수
const SCOPE = 'https://graph.microsoft.com/.default';

// 전역 변수로 토큰 캐싱
let cachedToken = null;
let tokenExpiration = 0;

const getAccessToken = async () => {
    const now = Date.now();

    // 캐싱된 토큰이 유효한 경우 재사용
    if (!CLIENT_SECRET) throw new Error('AZURE_CLIENT_SECRET 환경변수가 없습니다.');
    if (cachedToken && now < tokenExpiration) {
        return cachedToken;
    }

    const requestBody = new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope: SCOPE,
        grant_type: 'client_credentials',
    });

    try {
        const response = await fetch(TOKEN_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: requestBody,
        });

        if (!response.ok) throw new Error(`토큰 요청 실패: ${response.status}`);
        const data = await response.json();

        cachedToken = data.access_token;
        // 토큰 유효 기간 설정 (예: 3600초 = 1시간, 실제 값은 API 응답에서 확인)
        tokenExpiration = now + (data.expires_in * 1000) - 60000; // 만료 1분 전 갱신
        return cachedToken;
    } catch (error) {
        console.error('⚠️ 액세스 토큰 요청 실패:', error.message);
        throw error;
    }
};

// 이메일 유효성 검사
const checkEmailValidity = async (email, token) => {
    try {
        const response = await fetch(`${GRAPH_API_ENDPOINT}/${encodeURIComponent(email)}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });

        if (response.ok) {
            const data = await response.json();
            return {
                isValid: true,
                displayName: data.displayName, // 사용자 표시 이름
                id: data.id,                   // 사용자 ID
                upn: data.userPrincipalName   // UPN 추가 (예: user@domain.com)
            };
        }
        if (response.status === 404) {
            console.log('❌ 유효하지 않은 이메일:', email);
            return { isValid: false };
        }
        const errorData = await response.json();
        console.error('⚠️ 오류 발생:', errorData);
        return { isValid: false };
    } catch (error) {
        console.error('⚠️ 요청 실패:', error.message);
        return { isValid: false };
    }
};

// Graph 로 확인된 사용자만 { type, displayName, upn } 으로 반환
// 토큰/Graph 오류가 나도 알람은 멘션 없이 보내야 하므로 예외를 삼키고 빈 배열 반환
const resolvePeople = async (people) => {
    const targets = Array.isArray(people) ? people.filter((p) => typeof p?.mail === 'string' && p.mail) : [];
    if (!targets.length) return [];
    try {
        const token = await getAccessToken();
        const results = await Promise.all(targets.map(async (person) => {
            const result = await checkEmailValidity(person.mail, token);
            return result.isValid ? { type: person.type, displayName: result.displayName, upn: result.upn, id: result.id } : null;
        }));
        return results.filter(Boolean);
    } catch (error) {
        console.error('⚠️ 담당자 조회 실패, 멘션 없이 전송:', error.message);
        return [];
    }
};

const badRequest = (message) => ({ statusCode: 400, body: JSON.stringify({ error: message }) });

// 메인 핸들러
exports.handler = async (event) => {
    console.log(event.body);
    let dataDog;
    try {
        dataDog = JSON.parse(event.body) || {};
    } catch (e) {
        console.error('⚠️ JSON 파싱 실패:', e.message);
        return badRequest('잘못된 JSON 형식입니다.');
    }
    if (!dataDog.webhook_url) {
        console.error('⚠️ webhook_url 누락');
        return badRequest('webhook_url 이 없습니다.');
    }

    // 복구 알람은 멘션하지 않으므로 Graph 조회 생략
    const people = parseTitle(dataDog.title).isRecovered ? [] : await resolvePeople(dataDog.people);
    const msg = buildCard(dataDog, people);

    try {
        const response = await axios.post(dataDog.webhook_url, msg, { headers: {} });
        console.log(`웹훅 전송: ${response.status} ${response.statusText}`);
        return `${response.status} - ${response.statusText}`;
    } catch (error) {
        console.error('⚠️ 웹훅 전송 실패:', error.message);
        throw error;
    }
};
