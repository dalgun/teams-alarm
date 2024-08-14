'use strict';
const axios = require('axios'); // axios must be installed via npm i axios
const { EC2Client, DescribeInstancesCommand } = require("@aws-sdk/client-ec2");
var webhookURL = process.env.WEBHOOK_URL;
var channelId = process.env.CHANNEL_ID;
const ec2Client = new EC2Client({ region: 'ap-northeast-2' });

exports.handler = async function (event, context) {

    var message = JSON.parse(event.Records[0].Sns.Message);
    let message_type = decisionType(message['detail-type'])
    let state = message.detail.state;
    let pipeline = message.detail.application;
    let create_time = timestamp(message.time);
    let pipeline_id = message.detail.deploymentId;
    let title = 'CodeDeploy Deployment Started'
    let emoji = '🚀'
    let heading_color = 'Good'
    let env = "TEST";
    let deployment_group = message.detail.deploymentGroup;
    let ec2Name = '';
    console.log(message.detail)

    if (message_type === 'B'){
        let instance_id = message.detail.instanceId;
        const params = {
            InstanceIds: [instance_id]
        };
        const data = await ec2Client.send(new DescribeInstancesCommand(params));
        const instance = data.Reservations[0].Instances[0];
        const ec2Tag = instance.Tags.find(item => item.Key === "Name");
        ec2Name = ec2Tag.Value;
    }

    function decisionType(type) {
        if (type.includes('Deployment')) {
            return 'A'
        } else {
            return 'B'
        }
    }

    function timestamp(date) {
        var today = new Date(date);
        today.setHours(today.getHours() + 9);
        return today.toISOString().replace("T", " ").substring(0, 19);
    }


    const card = {
        'messageType': message_type,
        'instanceId': ec2Name,
        'channel': channelId,
        'pipelineId': pipeline_id,
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
                                "title": "Deployment Group",
                                "value": deployment_group
                            },
                            {
                                "title": "Application",
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
