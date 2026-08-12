# Jewel Coloring WebView 壳 APK（Android）

把 Cocos 的 web-mobile 构建产物装进 Android WebView 的极简壳工程，产出手机可直接安装的超小 APK（0.99MB）。
核心代码只有 `app/src/main/java/com/demo/jewelcoloring/MainActivity.java`：
内嵌一个零依赖的 HTTP 服务（http://127.0.0.1:8080）加载 `assets/www`，避免 WebView `file://` 黑屏；
外部 http(s) 链接（如商店 CTA）交给系统浏览器；首帧即自动播放（含音频）。

## 构建

1. 把最新 web-mobile 构建产物拷入 `app/src/main/assets/www/`（工程根目录不含该目录，需自行拷贝）。
2. 用 Android Studio 打开本目录，或命令行（需 JDK 17、Android SDK、AGP 8.10）：
   `gradle assembleRelease` 
3. 产物：`app/build/outputs/apk/release/app-release.apk`。

注意：`app/build.gradle` 中 release 签名引用了本机 `D:/Creator/3.8.8/.../debug.keystore`，
换机器构建请改为自己的 keystore（或使用 debug 签名）。
