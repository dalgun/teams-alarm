import json, time, os, http.client

teams_hook_uri = [
    '/workflows/7e51b79db3444adbaac5468ba70d650e/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=4HlQvT1lyIPJNj9voS5ZVgnUycrzPlEacWDJ0ayGwvM']

slack_hook_uri = ['/services/T04FXBEDBMH/B04GGCREYAH/27CC5UtDeF6nFJuVORM3SuDD']

channel_id = os.environ.get('CHANNEL_ID')


def timeKSTconvert(gmt):
    tt = gmt.replace(',', '')
    tt2 = time.strptime(tt, '%a %d %b %Y %H:%M:%S %Z')
    kst = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(time.mktime(tt2) + 9 * 60 * 60))
    return kst


def send_teams(region, account, detailType, service, eventTypeCode, eventTypeCategory, starttime, endtime, affected,
               description, color):
    attachments = \
        {
            "channel": channel_id,
            "contents": {
                "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                "version": "1.5",
                "type": "AdaptiveCard",
                "body": [
                    {
                        "type": "TextBlock",
                        "text": detailType + " 발생 | " + "Account: " + account + " | " + region,
                        "style": "heading",
                        "size": "Large",
                        "weight": "Bolder",
                        "wrap": "true",
                        "color": "Default"
                    },
                    {
                        "type": "RichTextBlock",
                        "inlines": [
                            {
                                "type": "TextRun",
                                "text": description
                            }
                        ]
                    },
                    {
                        "type": "FactSet",
                        "facts": [
                            {
                                "title": "Event Type Code:",
                                "value": eventTypeCode
                            },
                            {
                                "title": "Service:",
                                "value": service
                            },
                            {
                                "title": "Category:",
                                "value": eventTypeCategory
                            },
                            {
                                "title": "Affected Resource:",
                                "value": affected
                            },
                            {
                                "title": "Start Time(KST):",
                                "value": starttime
                            },
                            {
                                "title": "End Time(KST):",
                                "value": endtime
                            }
                        ]
                    }
                ],
                "msteams": {
                    "width": "Full"
                }
            }
        }
    connection = http.client.HTTPSConnection('prod2-38.southeastasia.logic.azure.com:443')
    headers = {'Content-type': 'application/json'}
    attachments = json.dumps(attachments)
    for hook_url in teams_hook_uri:
        connection.request('POST', hook_url, attachments, headers)
        response = connection.getresponse()
        print(response.read().decode())


def send_slack(region, account, detailType, service, eventTypeCode, eventTypeCategory, starttime, endtime, affected,
               description, color):
    attachments = \
        {
            "attachments": [
                {
                    "color": color,
                    "title": detailType + " 발생 | " + "Account: " + account + " | " + region,
                    "fields": [
                        {
                            "title": "Event Type Code:",
                            "value": eventTypeCode
                        },
                        {
                            "title": "Service:",
                            "value": service
                        },
                        {
                            "title": "Category:",
                            "value": eventTypeCategory
                        },
                        {
                            "title": "Affected Resource:",
                            "value": affected
                        },
                        {
                            "title": "Start Time(KST):",
                            "value": starttime
                        },
                        {
                            "title": "End Time(KST):",
                            "value": endtime
                        }
                    ],
                    "text": description
                }
            ]
        }
    connection = http.client.HTTPSConnection('hooks.slack.com')
    headers = {'Content-type': 'application/json'}
    attachments = json.dumps(attachments)
    for hook_url in slack_hook_uri:
        connection.request('POST', hook_url, attachments, headers)
        response = connection.getresponse()
        print(response.read().decode())


def lambda_handler(event, context):
    try:
        region = event['region']
    except:
        region = '--'

    try:
        accountName = os.environ['ACCOUNT_NAME']
        event["account"] = accountName
    except:
        accountName = '--'

    try:
        detailType = event['detail-type']
    except:
        detailType = '--'

    try:
        service = event['detail']['service']
    except:
        service = '--'

    try:
        eventTypeCode = event['detail']['eventTypeCode']
    except:
        eventTypeCode = '--'

    try:
        eventTypeCategory = event['detail']['eventTypeCategory']
    except:
        eventTypeCategory = '--'

    color = 'EF8B20'

    try:
        if "startTime" in event['detail']:
            starttime = event['detail']['startTime']
            kst_starttime = timeKSTconvert(starttime)
        else:
            starttime = '--'
            kst_starttime = '--'
    except:
        starttime = '--'
        kst_starttime = '--'

    try:
        if "endTime" in event['detail']:
            endtime = event['detail']['endTime']
            kst_endtime = timeKSTconvert(endtime)
        else:
            endtime = '--'
            kst_endtime = '--'
    except:
        endtime = '--'
        kst_endtime = '--'

    affected = []

    try:
        if "affectedEntities" in event['detail']:
            for i in event['detail']['affectedEntities']:
                affected.append(i['entityValue'])
        else:
            affected.append('없음')
        affected = str(affected).replace('[', '').replace(']', '').replace("'", "")
    except:
        affected = '없음'

    try:
        description = event['detail']['eventDescription'][0]['latestDescription']
    except:
        description = '--'
    send_teams(region, accountName, detailType, service, eventTypeCode, eventTypeCategory, kst_starttime, kst_endtime,
               affected, description, color)
    send_slack(region, accountName, detailType, service, eventTypeCode, eventTypeCategory, kst_starttime, kst_endtime,
               affected, description, color)
