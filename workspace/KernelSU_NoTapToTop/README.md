# NoTapToTop - KernelSU 模块

## 功能
禁用 Android 系统「点击状态栏回到页面顶部」的功能。

## 原理
该模块通过以下方法尝试禁用此功能：
1. 设置系统属性 (system.prop)
2. 修改多种 ROM 对应的 Settings 键值
3. 使用 Android 12+ 的 device_config 特性flag
4. 后台守护进程每30秒重新应用设置，防止被重置

## 兼容性
| ROM | 支持情况 |
|-----|---------|
| AOSP / 原生 Android | 部分支持（取决于系统版本） |
| LineageOS / crDroid | 支持（有对应 settings 键值） |
| MIUI / HyperOS | 支持 |
| OneUI (三星) | 支持 |
| ColorOS / RealmeUI | 支持 |
| EMUI / HarmonyOS | 支持 |

## 安装方法
1. 在 KernelSU Manager 中点击「模块」
2. 点击「从本地安装」选择本模块压缩包
3. 重启手机

## 卸载方法
在 KernelSU Manager 中直接卸载模块并重启即可。

## 局限性
由于「点击状态栏回到顶部」是 Android SystemUI 的深度硬编码行为，部分 AOSP 原生系统可能没有提供对应的设置项。如果在您的设备上无效，建议配合 LSPosed 模块使用以获得更好的兼容性。

## 自定义
编辑 `service.sh` 可以调整监听间隔（默认30秒）。
