#!/system/bin/sh
# NoTapToTop - post-fs-data.sh
# 在系统启动早期执行，尝试通过系统属性禁用

# 设置系统属性（部分ROM通过prop控制此行为）
setprop persist.sys.statusbar.scrolltotop 0
setprop sys.statusbar.scrolltotop 0

# 部分国产ROM的属性
setprop persist.sys.statusbar_tap_to_top 0
setprop sys.statusbar_tap_to_top 0
