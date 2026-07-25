#!/system/bin/sh
# NoTapToTop - service.sh
# 在系统启动完成后执行，尝试通过settings等命令禁用
# 兼容多个ROM版本

MODDIR=${0%/*}

# 等待系统完全启动
while [ "$(getprop sys.boot_completed)" != "1" ]; do
    sleep 2
done

# 额外等待SystemUI加载
sleep 5

# ========== 方法1: 通用settings方法 ==========
# 尝试所有可能的key名称
for key in \
    status_bar_scroll_to_top \
    status_bar_tap_to_scroll \
    statusbar_scroll_to_top \
    tap_status_bar_to_scroll \
    tap_status_bar_scroll_to_top \
    navigation_bar_tap_to_top \
    sem_status_bar_scroll_to_top \
    miui_status_bar_scroll_to_top \
    hw_status_bar_scroll_to_top \
; do
    settings put system "$key" 0 2>/dev/null
    settings put secure "$key" 0 2>/dev/null
    settings put global "$key" 0 2>/dev/null
done

# ========== 方法2: device_config (Android 12+ 特性flag) ==========
# Android 12+ 使用device_config管理SystemUI的运行时标志
if command -v device_config &>/dev/null; then
    device_config put systemui status_bar_scroll_to_top_disabled true 2>/dev/null
    device_config put systemui status_bar_tap_to_scroll_disabled true 2>/dev/null
    device_config put systemui disable_scroll_to_top true 2>/dev/null
fi

# ========== 方法3: 针对OneUI (三星) ==========
settings put system sem_status_bar_scroll_to_top 0 2>/dev/null
settings put secure sem_status_bar_scroll_to_top 0 2>/dev/null

# ========== 方法4: 针对MIUI/HyperOS ==========
settings put system miui_status_bar_scroll_to_top 0 2>/dev/null
settings put secure miui_status_bar_scroll_to_top 0 2>/dev/null

# ========== 方法5: 针对ColorOS / RealmeUI ==========
settings put system oppo_status_bar_scroll_to_top 0 2>/dev/null
settings put secure oppo_status_bar_scroll_to_top 0 2>/dev/null

# ========== 方法6: 针对EMUI / HarmonyOS ==========
settings put system hw_status_bar_scroll_to_top 0 2>/dev/null
settings put secure hw_status_bar_scroll_to_top 0 2>/dev/null

# ========== 方法7: 针对LineageOS / crDroid等自定义ROM ==========
settings put secure status_bar_scroll_to_top 0 2>/dev/null
settings put system status_bar_scroll_to_top 0 2>/dev/null

# ========== 方法8: 重启SystemUI使设置生效 ==========
# 注释掉以免影响使用，需要时可取消注释
# am force-stop com.android.systemui 2>/dev/null

# ========== 打印日志 ==========
log -t NoTapToTop "模块已加载 - 已尝试禁用状态栏点击回到顶部"

# 持久监听模式: 每30秒重新应用设置（防止被系统或其他应用重置）
while true; do
    for key in status_bar_scroll_to_top sem_status_bar_scroll_to_top miui_status_bar_scroll_to_top; do
        current=$(settings get system "$key" 2>/dev/null)
        if [ "$current" != "0" ] && [ -n "$current" ]; then
            settings put system "$key" 0 2>/dev/null
        fi
    done
    settings put secure status_bar_scroll_to_top 0 2>/dev/null
    sleep 30
done
