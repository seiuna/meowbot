# 链队列（LinkQueue）总结

## 结构定义
typedef struct LinkNode {
    ELEMTYPE data;
    struct LinkNode *next;
} LinkNode;

typedef struct {
    LinkNode *front;  // 队头指针
    LinkNode *rear;   // 队尾指针
} LinkQueue;

---

## 一、带头结点版本

### 初始化
void InitLinkQueueH(LinkQueue &Q) {
    Q.front = Q.rear = (LinkNode *)malloc(sizeof(LinkNode));
    Q.front->next = nullptr;  // 别忘了这步！
}

### 判空
bool IsEmptyLinkQueue(LinkQueue Q) {
    return Q.front == Q.rear;
}

### 入队（尾插法）
bool EnQueueLH(LinkQueue &Q, ELEMTYPE x) {
    LinkNode *p = (LinkNode *)malloc(sizeof(LinkNode));
    if (p == nullptr) return false;
    p->data = x;
    p->next = nullptr;
    Q.rear->next = p;
    Q.rear = p;
    return true;
}

### 出队（头删法，注意！不是删头结点）
bool DeQueueLH(LinkQueue &Q, ELEMTYPE &x) {
    if (IsEmptyLinkQueue(Q)) return false;
    LinkNode *p = Q.front->next;     // p 是第一个数据节点
    x = p->data;
    Q.front->next = p->next;         // 跳过头结点指向下一个
    if (p == Q.rear) Q.rear = Q.front;  // ★ 关键：删最后一个节点时更新rear
    free(p);
    return true;
}

---

## 二、不带头结点版本

### 初始化
void InitLinkQueue(LinkQueue &Q) {
    Q.front = Q.rear = nullptr;
}

### 判空
bool IsEmptyLinkQueue(LinkQueue Q) {
    return Q.front == nullptr && Q.rear == nullptr;
}

### 入队（尾插法）
bool EnQueueL(LinkQueue &Q, ELEMTYPE x) {
    LinkNode *p = (LinkNode *)malloc(sizeof(LinkNode));
    if (p == nullptr) return false;
    p->data = x;
    p->next = nullptr;
    if (IsEmptyLinkQueue(Q)) {
        Q.front = Q.rear = p;       // 第一个节点特殊处理
        return true;                 // ★ 别忘了 return！
    }
    Q.rear->next = p;
    Q.rear = p;
    return true;
}

### 出队（头删法）
bool DeQueueL(LinkQueue &Q, ELEMTYPE &x) {
    if (IsEmptyLinkQueue(Q)) return false;
    LinkNode *p = Q.front;
    x = p->data;
    Q.front = Q.front->next;
    if (Q.rear == p) Q.rear = nullptr;  // ★ 关键：删最后一个节点时更新rear
    free(p);
    return true;
}

---

## 三、两种版本对比

|          | 带头结点                          | 不带头结点                          |
|----------|----------------------------------|-------------------------------------|
| 初始化   | 分配头结点，front=rear指向头结点   | front=rear=nullptr                  |
| 判空条件 | front == rear                    | front == nullptr && rear == nullptr |
| 入队     | 统一尾插，无需特判                 | 空队列时需单独处理                   |
| 出队     | 删 front->next（第一个数据节点）   | 删 front（第一个数据节点）            |
| 尾节点出队| rear 指回头结点                    | rear 置为 nullptr                    |

## 四、关键易错点

1. 带头结点出队要明确：头结点不动，删的是 front->next
2. 无论哪种版本，出队只剩最后一个节点时，都要处理 rear 指针
3. 不带头结点空队列入队后要 return，避免继续执行 p->next = p 自己指向自己
4. malloc 后要检查 nullptr
