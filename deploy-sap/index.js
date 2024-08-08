'use strict';
const axios = require('axios'); // axios must be installed via npm i axios
const { EC2Client, DescribeInstancesCommand } = require("@aws-sdk/client-ec2"); // CommonJS import

// Set the region
AWS.config.update({ region: "ap-northeast-2" });

var webhookURL = process.env.WEBHOOK_URL;
var channelId = process.env.CHANNEL_ID;

exports.handler = async function (event, context) {

    var message = JSON.parse(JSON.stringify(event.Records[0].Sns.Message));

    let documentName = message.detail['document-name'];
    let commandId = message.detail['command-id'];
    let instanceId = message.detail['instance-id'];
    let status = message.detail.status;


    let instance = "";
    let ec2name_tag = "";
    let ec2name = "";

    const input = {
        "InstanceIds":[
            instanceId
        ]
    }

    const ec2 = new AWS.EC2();
    const command = new DescribeInstancesCommand(input)



}