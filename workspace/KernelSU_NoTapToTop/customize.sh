#!/system/bin/sh
# NoTapToTop - customize.sh
# 模块安装时的自定义脚本

# KernelSU模块标准安装流程
SKIPMOUNT=false
PROPFILE=true
POSTFSDATA=true
LATESTARTSERVICE=true

# 打印信息
ui_print ""
ui_print "  NoTapToTop - 禁用状态栏点击回到顶部"
ui_print "  ================================="
ui_print ""
ui_print "  支持的ROM:"
ui_print "  - AOSP / 原生Android"
ui_print "  - LineageOS / crDroid / 类原生"
ui_print "  - MIUI / HyperOS"
ui_print "  - OneUI (三星)"
ui_print "  - ColorOS / RealmeUI"
ui_print "  - EMUI / HarmonyOS"
ui_print ""
ui_print "  安装完成，重启后生效"
ui_print ""

# 注意: KernelSU用SKIPMOUNT, PROPFILE等控制行为
# 这里留空，使用module.prop中的配置
