package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// ==================== 配置 ====================
var (
	port     = envOrDefault("PORT", "3000")
	password = envOrDefault("RC_PASSWORD", "meow123456")
)

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// ==================== 消息结构 ====================
type Message struct {
	Type     string `json:"type"`
	Role     string `json:"role,omitempty"`
	Password string `json:"password,omitempty"`
	UserId   string `json:"userId,omitempty"`
	ReqId    string `json:"reqId,omitempty"`
	Command  string `json:"command,omitempty"`
	Stdout   string `json:"stdout,omitempty"`
	Stderr   string `json:"stderr,omitempty"`
	Base64   string `json:"base64,omitempty"`
	Size     int    `json:"size,omitempty"`
	Ok       bool   `json:"ok,omitempty"`
	Online   bool   `json:"online,omitempty"`
	Message  string `json:"message,omitempty"`
}

// ==================== 会话管理 ====================
type UserSession struct {
	Conn           *websocket.Conn
	PendingReqs    map[string]*websocket.Conn
	Mu             sync.Mutex
}

type Server struct {
	mu       sync.RWMutex
	client   *websocket.Conn
	users    map[string]*UserSession
	upgrader websocket.Upgrader
}

func NewServer() *Server {
	return &Server{
		users: make(map[string]*UserSession),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
			ReadBufferSize:  4096,
			WriteBufferSize: 4096,
		},
	}
}

func (s *Server) generateUserId() string {
	b := make([]byte, 6)
	rand.Read(b)
	return "user_" + hex.EncodeToString(b)
}

func (s *Server) broadcastClientStatus(online bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	msg, _ := json.Marshal(Message{
		Type:   "client_status",
		Online: online,
	})

	for _, us := range s.users {
		us.Mu.Lock()
		if us.Conn != nil {
			us.Conn.WriteMessage(websocket.TextMessage, msg)
		}
		us.Mu.Unlock()
	}
}

func (s *Server) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[错误] WebSocket 升级失败: %v", err)
		return
	}

	ip := r.RemoteAddr
	log.Printf("[连接] 新客户端来自 %s", ip)

	var (
		isClient bool
		userId   string
		userSess *UserSession
	)

	defer func() {
		conn.Close()
		if isClient {
			log.Println("[断开] C++ 客户端已离线")
			s.mu.Lock()
			s.client = nil
			s.mu.Unlock()
			s.broadcastClientStatus(false)
		} else if userId != "" {
			log.Printf("[断开] 用户 %s 已断开", userId)
			s.mu.Lock()
			delete(s.users, userId)
			s.mu.Unlock()
		}
	}()

	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			break
		}

		var msg Message
		if err := json.Unmarshal(raw, &msg); err != nil {
			conn.WriteJSON(Message{Type: "error", Message: "无效的 JSON"})
			continue
		}

		switch msg.Type {
		case "auth":
			if msg.Password != password {
				conn.WriteJSON(Message{Type: "auth_result", Ok: false, Message: "密码错误"})
				continue
			}

			if msg.Role == "client" {
				isClient = true
				s.mu.Lock()
				s.client = conn
				s.mu.Unlock()
				log.Println("[认证] C++ 客户端已连接")
				conn.WriteJSON(Message{Type: "auth_result", Ok: true, Role: "client"})
				s.broadcastClientStatus(true)
			} else if msg.Role == "user" {
				userId = msg.UserId
				if userId == "" {
					userId = s.generateUserId()
				}
				userSess = &UserSession{
					Conn:        conn,
					PendingReqs: make(map[string]*websocket.Conn),
				}
				s.mu.Lock()
				s.users[userId] = userSess
				clientOnline := s.client != nil
				s.mu.Unlock()
				log.Printf("[认证] 用户 %s 已连接", userId)
				conn.WriteJSON(Message{Type: "auth_result", Ok: true, Role: "user", UserId: userId, Online: clientOnline})
			}
			// 如果客户端已在线，通知用户
			s.mu.RLock()
			cliOnline := s.client != nil
			s.mu.RUnlock()
			if cliOnline && msg.Role == "user" {
				conn.WriteJSON(Message{Type: "client_status", Online: true})
			}

		case "shell_exec", "screenshot":
			s.mu.RLock()
			cli := s.client
			s.mu.RUnlock()
			if cli == nil {
				conn.WriteJSON(Message{Type: "error", Message: "客户端未连接或离线"})
				continue
			}

			reqId := fmt.Sprintf("req_%d_%x", time.Now().UnixNano(), time.Now().UnixNano()&0xFFFF)
			msg.ReqId = reqId

			if userSess != nil {
				userSess.Mu.Lock()
				userSess.PendingReqs[reqId] = conn
				userSess.Mu.Unlock()
			}

			cli.WriteJSON(msg)

		case "shell_result", "screenshot_result":
			if isClient && msg.ReqId != "" {
				s.mu.RLock()
				for _, us := range s.users {
					us.Mu.Lock()
					if targetConn, ok := us.PendingReqs[msg.ReqId]; ok {
						delete(us.PendingReqs, msg.ReqId)
						us.Mu.Unlock()
						if targetConn != nil {
							targetConn.WriteJSON(msg)
						}
						goto handled
					}
					us.Mu.Unlock()
				}
				s.mu.RUnlock()
			handled:

			}

		case "ping":
			conn.WriteJSON(Message{Type: "pong"})

		default:
			conn.WriteJSON(Message{Type: "error", Message: "未知消息类型"})
		}
	}
}

func main() {
	server := NewServer()

	// 静态文件服务
	fs := http.FileServer(http.Dir("public"))
	http.Handle("/", fs)

	// WebSocket 端点
	http.HandleFunc("/ws", server.HandleWebSocket)

	log.Printf("[启动] 喵控远程控制服务器运行在 http://0.0.0.0:%s", port)
	log.Printf("[启动] 密码: %s", password)

	if err := http.ListenAndServe("0.0.0.0:"+port, nil); err != nil {
		log.Fatalf("[错误] 启动失败: %v", err)
	}
}
