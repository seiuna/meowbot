# 喵控 - 远程控制工具

通过 Web 浏览器远程执行 Shell 命令和截图桌面。

Go 后端 + C++ 客户端，WebSocket 通信。

## 架构

你(外地) -> 浏览器 -> Go 后端 -> WebSocket -> C++ 客户端(家里电脑)

Go 后端做中转，C++ 客户端运行在家里电脑上。

## 快速开始

### 1. 部署后端（需要一台有公网 IP 的服务器）

```bash
cd server

# 安装依赖
go mod tidy

# 编译
go build -o remote-server .

# 启动（默认端口 3000）
RC_PASSWORD=你的密码 ./remote-server
```

防火墙记得开放 3000 端口。

### 2. 在家里电脑上运行 C++ 客户端

**安装依赖：**

- Linux: `sudo apt install libixwebsocket-dev libssl-dev zlib1g-dev cmake g++`
- macOS: `brew install ixwebsocket cmake`

**编译运行：**

```bash
cd client
mkdir build && cd build
cmake .. -DSERVER_URL="ws://你的服务器IP:3000" -DAUTH_PASSWORD="你的密码"
make -j4

./remote_client
```

### 3. 在外地打开控制面板

浏览器访问 `http://你的服务器IP:3000`

输入密码登录，如果 C++ 客户端在线，状态会显示绿色。

## 功能

- 执行 Shell 命令
- 截图桌面

## 安全提醒

- 设置强密码（环境变量 RC_PASSWORD）
- 建议 HTTPS + WSS，或配合 nginx 反向代理
- 仅供个人管理使用

## 文件结构

```
remote-control/
├── server/
│   ├── main.go           # Go 后端主程序（WebSocket 中转）
│   ├── go.mod
│   └── public/
│       └── index.html    # 控制面板网页
├── client/
│   ├── main.cpp          # C++ 客户端（shell + 截图）
│   └── CMakeLists.txt
└── README.md
```
