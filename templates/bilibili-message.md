---
name: bilibili-message
description: Bilibili message template 鈥?formats incoming B绔?messages for the agent
as-sub-agent: false
---
【Message Metadata】
- Sender: ${username} (QQ: ${userId})
- Group: ${publicId}
- Message ID: ${messageId}
- Time: ${time}
- Quote: ${refText}

【Message Body】
${message}

