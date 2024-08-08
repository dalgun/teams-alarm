'use strict';
const axios = require('axios'); // axios must be installed via npm i axios

var webhookURL = process.env.WEBHOOK_URL;
var channelId = process.env.DEV_CHANNEL_ID;


exports.handler = async function (event, context) {

    var message = JSON.parse(JSON.stringify(event.Records[0].Sns.Message));

    let state = message.detail.state;
    let pipeline = message.detail.pipeline;
    let create_time = timestamp(message.time);
    let pipeline_id = message.detail['execution-id'];
    let title = "";
    let emoji = "";
    let heading_color = "";
    let arn = message.resources[0];
    let env = "";
    if (pipeline.toString().includes('dev') || pipeline.toString().includes('PPS')) {
        env = "[DEV] Emart CC"
    } else {
        env = "[PRD] Emart CC"
        channelId = process.env.PRD_CHANNEL_ID;
    }

    function timestamp(date) {
        var today = new Date(date);
        // 미국시간 기준이니까 9를 더해주면 대한민국 시간됨
        today.setHours(today.getHours() + 9);
        // 문자열로 바꿔주고 T를 빈칸으로 바꿔주면 yyyy-mm-dd hh:mm:ss 이런 형식 나옴
        return today.toISOString().replace("T", " ").substring(0, 19);
    }

    if (state === 'STARTED') {
        title = 'CodeDeploy Deployment Started'
        emoji = '🚀'
        heading_color = 'Good'
    } else if (state === 'SUCCEEDED') {
        title = 'CodeDeploy Deployment Succeeded'
        emoji = '✅'
        heading_color = 'Good'
    } else if (state === 'FAILED' || state === 'CANCELED') {
        title = 'CodeDeploy Deployment Failed(or Canceled)'
        emoji = '❌'
        heading_color = 'Attention'
    } else if (state === 'STOPPED' || state === 'STOPPING') {
        title = 'CodeDeploy Deployment Stopped'
        emoji = '⏹️'
        heading_color = 'Attention'
    } else {
        console.log('Unknown deployment status:', state)
    }

    const card = {
        'channel': channelId,
        'pipelineId' : pipeline_id,
        'status': state,
        'contents': {
            '$schema': 'http://adaptivecards.io/schemas/adaptive-card.json',
            'type': 'AdaptiveCard',
            'version': '1.5',
            'body': [
                {
                    'type': 'Container',
                    'padding': 'None',
                    'items': [
                        {
                            'type': 'TextBlock',
                            'wrap': 'true',
                            'size': 'Large',
                            'color': heading_color,
                            'text': `${emoji} ${state}: ${title}`,
                        }
                    ]
                },
                {
                    'type': 'Container',
                    'items': [{
                        "type": "FactSet",
                        "facts": [
                            {
                                "title": "Pipeline Id",
                                "value": pipeline_id
                            },
                            {
                                "title": "Resources",
                                "value": arn
                            },
                            {
                                "title": "PipeLine",
                                "value": pipeline
                            },
                            {
                                "title": "Status",
                                "value": state
                            },
                            {
                                "title": "Create Time",
                                "value": create_time
                            }
                        ]
                    }],
                    'isVisible': 'false',
                    'id': 'deployment-details',
                },
                {
                    'type': 'Container',
                    'padding': 'None',
                    'items': [
                        {
                            'type': 'ColumnSet',
                            'columns': [
                                {
                                    'type': 'Column',
                                    'width': 'stretch',
                                    'items': [
                                        {
                                            'type': 'TextBlock',
                                            'text': 'Env',
                                            'wrap': 'true',
                                            'isSubtle': 'true',
                                            'weight': 'Bolder',
                                        },
                                        {
                                            'type': 'TextBlock',
                                            'wrap': 'true',
                                            'spacing': 'Small',
                                            'text': `${env}`,
                                        },
                                    ],
                                },
                                {
                                    'type': 'Column',
                                    'width': 'stretch',
                                    'items': [
                                        {
                                            'type': 'TextBlock',
                                            'text': 'Pipeline',
                                            'wrap': 'true',
                                            'isSubtle': 'true',
                                            'weight': 'Bolder',
                                        },
                                        {
                                            'type': 'TextBlock',
                                            'wrap': 'true',
                                            'spacing': 'Small',
                                            'text': `${pipeline}`,
                                        }
                                    ]
                                },
                                {
                                    'type': 'Column',
                                    'width': 'stretch',
                                    'items': [
                                        {
                                            'type': 'TextBlock',
                                            'text': 'Start Time',
                                            'wrap': 'true',
                                            'isSubtle': 'true',
                                            'weight': 'Bolder',
                                        },
                                        {
                                            'type': 'TextBlock',
                                            'wrap': 'true',
                                            'spacing': 'Small',
                                            'text': `${create_time}`,
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ],
            'padding': 'None',
            'actions': [
                {
                    'type': 'Action.ToggleVisibility',
                    'title': 'Show Details',
                    'targetElements': ['deployment-details'],
                }
            ]
            ,
            "msteams": {
                "width": "Full"
            }
        },

    };

    try {
        const response = await axios.post(webhookURL, card, {
            headers: {
                'content-type': 'application/json'
            },
        });
        return `${response.status} - ${response.statusText}`;
    } catch (err) {
        return err;
    }
}
