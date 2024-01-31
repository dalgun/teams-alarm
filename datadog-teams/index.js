'use strict';
const axios = require('axios'); // axios must be installed via npm i axios

exports.handler = async function (event, context) {
    console.log(event.body);
    var dataDog = JSON.parse(event.body);
    var webhookURL = dataDog.webhook_url;
    console.log(dataDog)

    var assignStr = []
    var ccStr = [];

    var fact = {
        "type": "FactSet",
        "separator" : true,
        "facts": []
    }

    var image = {
        "type": "Image",
        "url": "",
        "altText": "Metric graph"
    };

    var msg = {
        "type": "message",
            "attachments": [{
                "contentType": "application/vnd.microsoft.card.adaptive",
                "contentUrl": null,
                "content": {
                    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                    "version": "1.0",
                    "type": "AdaptiveCard",
                    "body": [
                        {
                            "type": "TextBlock",
                            "size": "Large",
                            "weight": "Bolder",
                            "text": "",
                            "wrap" : true,
                            "style" : "heading"
                        },
                        {
                            "type": "TextBlock",
                            "weight": "Bolder",
                            "text": "",
                            "wrap": true
                        }
                    ],
                    "msteams":  {
                        "width": "full",
                        "entities" : [] 
                    },
                    "actions": []
                }
            }]
    }

    dataDog.body = dataDog.body.replaceAll('%%%','');
    dataDog.body = dataDog.body.split('\n');
    dataDog.body = dataDog.body.filter(item => item.length > 1 );
    var link = dataDog.body.splice(dataDog.body.indexOf("- - -")+1);
    dataDog.body.pop()

    msg.attachments[0].content.body[0].text = dataDog.title
    msg.attachments[0].content.body[1].text = dataDog.body.join("\n\n")

    if (dataDog.event_type == 'query_alert_monitor'){
        image.url = dataDog.image
        msg.attachments[0].content.body.push(image)
    }

    for ( let person of dataDog.people){
        msg.attachments[0].content.msteams.entities.push({
            "type" : "mention",
            "text" : "<at>"+person.name+"</at>",
            "mentioned" : {
                "id" : person.mail,
                "name" : person.name
            }
    })
    if(person.type == "cc"){
        ccStr.push("<at>"+person.name+"</at>")
    }else{
        assignStr.push("<at>"+person.name+"</at>")
    }
    }
    fact.facts.push({
            "title" : "담당자",
            "value" : assignStr.join(",")
        })
    if(ccStr.length != 0) {
        fact.facts.push({
            "title" : "참조자",
            "value" : ccStr.join(",")
        })
    }
    msg.attachments[0].content.body.push(fact)
    if (link.length != 0){
    var linkArr = link[0].split(" · ")
    // console.log(linkArr)
    for (let linkUrl of linkArr){
        linkUrl = linkUrl.slice(1,-1)
        msg.attachments[0].content.actions.push({
            "type": "Action.OpenUrl",
            "title": linkUrl.substring(linkUrl.indexOf("[")+1,linkUrl.indexOf("]")),
            "url" : linkUrl.substring(linkUrl.indexOf("(")+1,linkUrl.indexOf(")"))
        })
    }
    }

    console.log(msg.attachments[0].content)
    
    try {
      const response = await axios.post(webhookURL, msg, {
        headers: {
          'content-type': 'application/vnd.microsoft.teams.card.o365connector'
        },
      });
         console.log(response.status, response.statusText)

      return `${response.status} - ${response.statusText}`;
    } catch (err) {
        console.log(err.message)
      return err;
    }
  }            