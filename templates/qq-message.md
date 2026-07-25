---
name: qq-message
description: QQ message template 鈥?formats incoming QQ messages for the agent
as-sub-agent: false
---
【Message Metadata】
- Sender: ${username} (UserID: ${userId})
- Group: ${publicId}
- Message ID: ${messageId}
- Time: ${time}
- Quote: ${refText}

【Message Body】
${message}

