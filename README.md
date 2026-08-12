# Jewel Coloring — 试玩广告（Cocos Creator 3.8）

宝石填色（Jewel Coloring）试玩广告完整实现：图案底图 + 打乱小球 + 暂存区中转 + 填色归位。
玩法模型经同类投放样本调研与需求逐轮确认，美术素材来自 Figma 设计稿；移动端竖屏，可构建 Web / Android。

## 快速开始

1. 用 **Cocos Creator 3.8.8** 打开本目录（3.8.0 亦可）。
2. 双击 `assets/scenes/GameScene.scene`，点 ▶ 预览（浏览器/模拟器）。

玩法：点同色连通组悬浮 → 点暂存区存入 → 点同色空底图填回 → 颜色完成扫光 → 通关波次扫光 →
url 弹到屏幕中间 → 手指引导下载。

## 目录结构

```
JewelColoring/
├─ assets/
│  ├─ scenes/GameScene.scene      # 场景（节点/组件绑定齐全）
│  ├─ scripts/                    # 全部 TS 源码
│  │  ├─ core/                    # MetaGameController / BSGameDirector / 关卡 / 配置 / 常量
│  │  ├─ board/                   # BoardView（棋盘/暂存区/宝石层/触摸/映射）
│  │  ├─ gem/                     # GemElementView（三态状态机）
│  │  ├─ fx/                      # FlySystem（飞行）/ EffectSystem（扫光/tip）
│  │  ├─ ui/                      # GuideController（四步引导）
│  │  └─ utils/                   # ResourceStore / AudioService / PlayableAdPlatform
│  └─ resources/
│     ├─ atlas/gams,bases,base.pac # 小球/底纹图集
│     ├─ images/                  # bg/title/url/tray/tip/手指
│     ├─ audio/                   # BGM/点击/落位/完成/OK/tip
│     └─ res/config/              # GlobalConfig / GuideConfig / Level_1
├─ docs/                          # 参考分析、设计文档、过程记录
├─ build/                         # 构建产物（Android APK / web）
└─ package.json
```

## 文档

- `docs/01-playable-analysis.md` — 参考样本分析与需求梳理
- `docs/02-design.md` — 设计文档（技术选型/实现思路/需求落地取舍/优化方向/协作思考）
- `docs/03-process.md` — 开发过程记录与调试日志

## 构建与产物

- Web：构建发布 → Web Mobile（`build.web-mobile.json`，已裁剪引擎模块）
- Android：构建发布 → Android（`build.android.json`，release + 模块裁剪，无调试面板）

### 最终产物（build/apk/）

| 文件 | 体积 | 说明 |
|------|------|------|
| jewel-coloring-web-shell.apk | 0.99MB | WebView 壳 + 裁剪 Web 包（<1.5MB），可直接安装到 Android 手机体验 |

> DSP 试玩广告以 Web 包为准（<1.5MB）；原生 release APK 约 10MB，如需可本地按 build.android.json 构建。

### 命令行构建

**① Cocos 自带构建（即"构建配置"对应的操作，直接复用 `build.*.json`）**

1. Web：`CocosCreator.exe --project <工程> --build "configPath=build.web-mobile.json"`
2. Android：`CocosCreator.exe --project <工程> --build "configPath=build.android.json"`

> 构建配置就是这两个 JSON 文件（平台 / release / 引擎模块裁剪 / 包名 ABI 签名等选项），
> Cocos 编辑器"构建发布"面板与上面的 CLI 都读它，是标准功能，无需额外工程。

**② WebView 壳 APK（独立小工程，非 Cocos 内置功能）**

壳工程源码在本仓库 `shell-webview/`（MainActivity + 零依赖 AssetServer + WebView，核心约 20 行）：
把 web-mobile 构建产物拷入 `shell-webview/app/src/main/assets/www`，用 Android Studio 打开该目录
或 `gradle assembleRelease` 打包（构建背景见 docs/03-process.md 第 5 节）。这是为
"手机直接装 0.99MB 试玩包"额外写的 WebView 壳，Cocos 本身不产出这种壳，属于配套交付物。
