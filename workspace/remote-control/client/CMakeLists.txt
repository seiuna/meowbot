cmake_minimum_required(VERSION 3.16)
project(RemoteControlClient CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# 依赖: libixwebsocket-dev (Linux) / ixwebsocket (vcpkg) / brew install ixwebsocket (macOS)
find_package(ixwebsocket REQUIRED)
find_package(ZLIB REQUIRED)
find_package(OpenSSL REQUIRED)

add_executable(remote_client main.cpp)

target_link_libraries(remote_client PRIVATE
    ixwebsocket::ixwebsocket
    ZLIB::ZLIB
    OpenSSL::SSL
    OpenSSL::Crypto
)

# Windows 需要 GDI+ 截图
if(WIN32)
    target_link_libraries(remote_client PRIVATE gdi32 gdiplus)
endif()

# 编译时传入服务器地址
# 用法: cmake -DSERVER_URL="ws://你的服务器IP:3000" ..
if(NOT DEFINED SERVER_URL)
    set(SERVER_URL "ws://127.0.0.1:3000")
endif()
target_compile_definitions(remote_client PRIVATE
    SERVER_URL="${SERVER_URL}"
    AUTH_PASSWORD="${AUTH_PASSWORD}"
)
