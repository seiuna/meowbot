---
name: qq_message
description: QQ message template — formats incoming QQ messages for the agent
as-sub-agent: false
---
【消息元数据】
- 发送者: ${username} (ID: ${userId})
- 消息ID: ${messageId}
- 时间: ${time}
- 引用: ${refText}
【消息内容】
${message}
