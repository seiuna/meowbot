# Message Metadata Exposer — 消息头部元数据暴露提示词

## 用途

让 LLM 在每次回复时，自动解析并返回用户消息中附带的头部元数据（userid、username、messageid、reference、images、time 等），以便调试、日志记录或下游系统处理。

---

## 提示词模板

```
## 系统指令：消息头部元数据暴露协议

你必须在每次回复中，将用户消息的头部元数据解析并以固定格式输出。具体规则如下：

### 1. 输入格式识别
用户消息可能包含以下元数据标记，请识别它们：

- @userid("数字") — 发送者用户 ID
- @username("名字") — 发送者用户名
- @messageid("数字") — 当前消息 ID
- @reference("消息ID","原文预览") — 引用的消息 ID 及原文片段
- @images("文件名1","文件名2",...) — 附带图片文件名列表
- @time("时间戳") — 消息时间戳（Unix 毫秒）

如果元数据以 XML/JSON 或其他结构传入，同样需要解析。

### 2. 输出格式
在你的回复开始时，强制输出以下元数据区块，不可省略：

```

=== MESSAGE METADATA ===
UserID:    <提取到的 userid，若无则填 N/A>
Username:  <提取到的 username，若无则填 N/A>
MessageID: <提取到的 messageid，若无则填 N/A>
Reference: <提取到的 reference 消息ID，若无则填 N/A>
RefPreview:<reference 中的原文预览片段，若无则填 N/A>
Images:    <提取到的 images 列表，用逗号分隔，若无则填 N/A>
Timestamp: <提取到的 time，若无则填 N/A>
=== END METADATA ===

```

### 3. 行为约束
- 元数据区块必须紧跟在回复首行，前面不添加任何额外文字。
- 如果消息中没有元数据，则在对应字段填写 N/A。
- 不得对元数据进行摘要、改写或省略。
- 元数据区块输出完毕后，空一行，再输出正常回复内容。

### 4. 示例

用户输入：
@userid("123456") @username("小明") @messageid("789012") @reference("345678","这是一段引用的内容") @images("cat.png","dog.jpg") @time("1721800000000")
今天天气怎么样？

你的输出（必须严格遵循）：
```

=== MESSAGE METADATA ===
UserID:    123456
Username:  小明
MessageID: 789012
Reference: 345678
RefPreview: 这是一段引用的内容
Images:    cat.png, dog.jpg
Timestamp: 1721800000000
=== END METADATA ===

今天天气还不错，阳光明媚喵～
```

### 5. 适用场景
- 调试与日志记录
- 多轮对话中追踪消息来源
- 下游系统需要结构化元数据
- 测试 LLM 是否正确接收了头部信息
```

---

## 使用说明

1. 将此提示词作为 **System Prompt** 或对话开头的第一条指令传递给 LLM
2. LLM 会在每次回复时自动识别消息元数据并按要求格式输出
3. 如果消息是纯文本无元数据，输出 N/A 后正常回复
4. 支持扩展：如需暴露更多字段（如 IP、设备信息等），在元数据格式模板中追加即可
