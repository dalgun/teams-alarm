'use strict';
const axios = require('axios');
const deepl = require('deepl-node');
const Ajv = require('ajv');
const ajv = new Ajv();
const webhookURL = process.env.WEBHOOK_URL;
const channelId = process.env.CHANNEL_ID;
const authKey = process.env.DEEPL_AUTH_KEY;
const translator = new deepl.Translator(authKey, { serverUrl: 'https://api-free.deepl.com' });

const componentSchema = {
    "type": "object",
    "properties": {
        "meta": {
            "type": "object",
            "properties": {
                "unsubscribe": { "type": "string" },
                "documentation": { "type": "string" }
            },
            "required": ["unsubscribe", "documentation"]
        },
        "page": {
            "type": "object",
            "properties": {
                "id": { "type": "string" },
                "status_indicator": { "type": "string" },
                "status_description": { "type": "string" }
            },
            "required": ["id", "status_indicator", "status_description"]
        },
        "component_update": {
            "type": "object",
            "properties": {
                "created_at": { "type": "string" },
                "new_status": { "type": "string" },
                "old_status": { "type": "string" },
                "id": { "type": "string" },
                "component_id": { "type": "string" }
            },
            "required": ["created_at", "new_status", "old_status", "id", "component_id"]
        },
        "component": {
            "type": "object",
            "properties": {
                "created_at": { "type": "string" },
                "id": { "type": "string" },
                "name": { "type": "string" },
                "status": { "type": "string" }
            },
            "required": ["created_at", "id", "name", "status"]
        }
    },
    "required": ["meta", "page", "component_update", "component"]
};

exports.handler = async function (event) {
    let message;
    try {
        message = JSON.parse(event.body);
    } catch (e) {
        console.error("Invalid JSON body:", e);
        return { statusCode: 400, body: "Invalid JSON" };
    }

    let msgType = "";
    let uniqueId = "";

    const msg = {
        "channel": channelId,
        "uniqueId": uniqueId,
        "msgType": msgType,
        "contents": {
            "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
            "version": "1.0",
            "type": "AdaptiveCard",
            "body": [],
            "msteams": { "width": "full", "entities": [] }
        }
    };

    const setColor = (status) => {
        const statusMap = {
            "major outage": "Attention",
            "operational": "Good"
        };
        return statusMap[status.toLowerCase()] || "Warning";
    };

    const timestamp = (date) => {
        return new Date(date).toLocaleString('ko-KR', {
            timeZone: 'Asia/Seoul',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false
        });
    };

    const translateTexts = async (texts) => {
        try {
            const result = await translator.translateText(texts, null, "ko");
            console.log("Translation result:", result); // 번역 결과 출력
            return result.map(r => r.text);
        } catch (err) {
            console.error("Translation error:", err);
            return texts; // Fallback to original texts in case of failure
        }
    };

    try {
        const isValidComponent = ajv.validate(componentSchema, message);

        if (isValidComponent) {
            // Component 상태 변경에 따른 알람
            msg.msgType = "A";
            msg.uniqueId = message.component.id;
            const [newStatus, oldStatus, desc] = await translateTexts([
                message.component_update.new_status.replaceAll('_', ' '),
                message.component_update.old_status.replaceAll('_', ' '),
                message.page.status_description
            ]);

            msg.contents.body = [
                {
                    "type": "Container",
                    "items": [
                        {
                            "type": "TextBlock",
                            "text": "🗣️ 지라/위키 구성 요소 상태 변경 안내",
                            "weight": "Bolder",
                            "size": "Large",
                            "color": setColor(newStatus)
                        },
                        {
                            "type": "FactSet",
                            "facts": [
                                { "title": "구성 요소:", "value": message.component.name },
                                { "title": "이전 상태:", "value": oldStatus },
                                { "title": "현재 상태:", "value": newStatus },
                                { "title": "변경 일시:", "value": timestamp(message.component_update.created_at) },
                                { "title": "설명:", "value": desc }
                            ]
                        },
                        {
                            "type": "ActionSet",
                            "actions": [{ "type": "Action.OpenUrl", "title": "상세 정보 보기", "url": "https://jira-software.status.atlassian.com", "style": "positive" }]
                        }
                    ]
                }
            ];
        } else if (message.incident) {
            if (message.incident.incident_updates.length === 1) {
                // 단일 Incident 알람
                msg.msgType = "B";
                msg.uniqueId = message.incident.id;
                const [incidentName, incidentBody, incidentStatus] = await translateTexts([
                    message.incident.name,
                    message.incident.incident_updates[0].body,
                    message.incident.incident_updates[0].status
                ]);

                msg.contents.body = [
                    {
                        "type": "TextBlock",
                        "text": "❗지라/위키 장애 알람",
                        "weight": "Bolder",
                        "size": "Large"
                    },
                    {
                        "type": "FactSet",
                        "facts": [
                            { "title": "장애 등급", "value": message.incident.impact },
                            { "title": "상태", "value": incidentStatus },
                            { "title": "발생 일시", "value": timestamp(message.incident.created_at) },
                            { "title": "내용", "value": incidentName },
                            { "title": "상세", "value": incidentBody }
                        ]
                    },
                    {
                        "type": "ActionSet",
                        "actions": [{ "type": "Action.OpenUrl", "title": "장애 상세 페이지 확인", "url": message.incident.shortlink, "style": "destructive" }]
                    }
                ];
            } else {
                // 다중 Incident 알람
                msg.msgType = "C";
                msg.uniqueId = message.incident.id;
                const updates = message.incident.incident_updates;

                const translatedUpdates = await Promise.all(updates.map(async (update) => {
                    const [incidentStatus, incidentBody] = await translateTexts([update.status, update.body]);
                    return {
                        status: incidentStatus,
                        body: incidentBody,
                        createdAt: timestamp(update.created_at)
                    };
                }));

                msg.contents.body = translatedUpdates.map((update, index) => ({
                    "type": "ColumnSet",
                    "columns": [
                        {
                            "type": "Column",
                            "width": "40px",
                            "backgroundImage": {
                                "url": index === 0 ? "https://svgur.com/i/19ue.svg" : "https://i.postimg.cc/TYs2b8qG/timeline.png",
                                "horizontalAlignment": "Center",
                                "fillMode": "RepeatVertically"
                            },
                            "horizontalAlignment": "Right"
                        },
                        {
                            "type": "Column",
                            "width": "stretch",
                            "items": [
                                {
                                    "type": "Container",
                                    "spacing": "None",
                                    "minHeight": "4px",
                                    "items": [
                                        {
                                            "type": "TextBlock",
                                            "text": update.status,
                                            "wrap": true,
                                            "size": "Large",
                                            "weight": "Bolder",
                                            "spacing": "Medium"
                                        },
                                        {
                                            "type": "TextBlock",
                                            "text": update.createdAt,
                                            "wrap": true,
                                            "weight": "Bolder",
                                            "color": "Accent"
                                        },
                                        {
                                            "type": "TextBlock",
                                            "text": update.body,
                                            "wrap": true,
                                            "size": "Small",
                                            "isSubtle": true
                                        }
                                    ]
                                }
                            ]
                        },
                        {
                            "type": "Column",
                            "width": "16px"
                        }
                    ]
                }));
            }
        }
    }  catch (error) {
        console.error("Validation or processing error:", error);
    }

    if (msg.msgType === 'A') {
        return "컴포넌트 구성 요소 알람으로 분류되어 팀즈 메세지 발송 X";
    }

    try {
        const response = await axios.post(webhookURL, msg, { headers: { 'content-type': 'application/json' } });
        return `${response.status} - ${response.statusText}`;
    } catch (err) {
        console.error("Webhook error:", err);
        return err;
    }
};