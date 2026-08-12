# 05 - 开发过程记录（过程文件）

> 本文档沉淀本项目的开发过程：阶段、关键决策、Bug 调试记录、参考资料整理。
> 与 AI 协作开发，过程以对话方式逐轮推进；这里整理成可复读的日志。

## 1. 阶段时间线

### 阶段一：框架搭建与场景生成（不写代码先定结构）
- 确定 Cocos 3.x、纯 2D、竖屏 1080×1920 方案；
- 先产出"场景/预制体结构清单"（Canvas → MetaGameLayer → BoardRoot → 五个子层），
  由用户在编辑器创建场景与节点，脚本只负责动态构建棋盘；

### 阶段二：玩法规则对齐（与用户多轮澄清）
- 明确 Jewel Coloring 填色玩法：图案底图 + 上层打乱小球 + 暂存区中转；
- 规则演进：点击同色**八方向连通组**悬浮 → 点暂存区存入（同色插末尾、其他色滑移）→
  点同色空底图填回 → 全部归位通关；
- 补充规则：暂存区只能存、不能暂存区→暂存区；悬浮球未飞完保持选中；
  已归位小球不算联通（选中与填回均阻断，最终版）；
- 引导：四步流程（点宝石 → 点暂存区 → 点同色绿球 → 点回原位），

### 阶段三：资源落地（Figma 素材 → 本地）
- 用户从 Figma 设计稿提取素材放入 `assets/resources`；
- 小球 = `atlas/gams/{name}Gem`、底纹 = `atlas/bases/{name}Base`、孔位 = slot、
  托盘 = tray、手指 = 手指、背景 = bg、标题 = title、下载 = url、提示 = tip；

### 阶段四：反复出现的 Bug 与修复（重点）

| 现象 | 根因 | 修复 |
|---|---|---|
| 点击无反应 | 相机 3D 透视 / 层级/节点无 UITransform | 强制 2D 正交相机、统一 UI_2D 层 |
| `region=undefined grid=undefined` | 节点在场景但 `_gemData` 映射丢失（fillTray 逐颗边删边写，相隔 n 格互相覆盖） | 改**两段式原子更新**（先全部卸载再统一写入）+ `reconcileTray` 三方自愈 + 孤儿节点清扫 |
| 幽灵球（看得见点不动） | `_gems` / `level.tray` / 节点三份状态不同步 | 每次空闲点击/存入/紧凑前交叉校验；销毁幽灵、重建缺失、清脏格子 |
| 暂存区小球消失/重叠 | 同上 + compactTray 跳过幽灵 | 自愈 + 紧凑前 reconcile |
| 跨行/隔行选不中 | `neighbors()` 行尾回绕假连通；已归位球被当墙 | 图案区纯几何八方向；暂存区蛇形+几何斜角；按需求恢复"已归位阻断" |
| 扫光卡顿 | 每颗球一个 Graphics 节点（500+ Draw Call） | 单节点批量绘制；通关波次扫光 1.5s（单节点单 tween） |

### 阶段五：性能与收尾
- 小球常驻 gemLayer，按颜色排序合批；图集 base.pac；
- 分帧加载资源（每批 10）
- 产出文档与构建产物。

## 2. 参考资料整理

- `jewel-coloring-a.html` / `jewel-coloring-b.html`：两段投放样本；
- Figma 设计稿（Gameplay Engineering Challenge，访问密码 make-it-juicy）：素材来源；
- 详细样本分析见 `docs/01-playable-analysis.md`。

## 3. 关键日志模式（调试速查）

- `[Director] onGemClicked region=.. grid=.. busy=..` —— 点击是否进入逻辑；
- `[Tray] 自愈暂存区不一致 xN` / `清理孤儿宝石节点 xN` —— 数据自愈触发；
- `点击暂存区幽灵球（数据缺失）` —— 点到无数据节点（应已被自愈清除）；
- `[Guide] showStep step=r:g toLocal=OK/NULL` —— 引导手指是否成功定位；
- `[Director] busy 卡死自动恢复` —— 看门狗兜底触发。
## 4. Android APK 构建记录（2026-08-11）
- NDK 20 编译引擎报 
oexcept = default 异常规范不匹配 → 换官方支持范围 NDK r21.4.7075529（AGP 自动安装）。
- 内存：4.6G JVM 堆 + ninja 全核并行导致整机重启；降为 -Xmx2048m、
  --max-workers=2、CMake -DCMAKE_JOB_POOL_COMPILE=compile -DCMAKE_JOB_POOLS=compile=4 后稳定。
- 产物：uild/apk/jewel-coloring-debug.apk（25MB，arm64-v8a，debug 签名）。
## 5. 包体瘦身与 DC 优化记录（2026-08-11 续）

### 包体：25MB debug → 11.2MB release / 1.9MB WebView 壳

- 体积构成（debug APK）：libcocos.so 原始 71MB（-O0 + 调试符号）压缩 20.6MB 占 85%；
  JS 引擎包 4.9MB；物理 bullet.wasm 等模块冗余。
- 做法：
  1. `build.android.json` 改 `debug:false`（release：无调试面板/调试符号，JS 压缩，proguard）。
  2. `includeModules` 裁剪：只留 base/2d/ui/graphics/tween/audio/affine-transform/custom-pipeline，
     去掉 3d/spine/dragonbones/video/webview/socket/physics 等 → 原生编译目标从 704 降到 568，
     data 目录 8.5MB → 3MB。
  3. `useSplashScreen:false` 去启动屏（编辑器提示“移除插屏配置失败”时会用默认插屏，属正常告警）。
- 结果：原生 release APK 11.16MB（lib 压缩 9.08MB + assets 1.81MB）。
- **5MB 硬指标**：原生引擎含 V8 下限约 8-12MB，达不到 → 采用 WebView 壳方案：
  Web（web-mobile，同样裁剪后 3.14MB raw / zip 1.5MB 左右）+ 20 行 WebView 壳工程
  （MainActivity 内置零依赖 AssetServer，WebView 走 http://127.0.0.1:8080 加载 assets/www，
  避免 WebView file:// 黑屏；自动播放 + 外部 http(s) 链接交系统浏览器），壳 APK 1.94MB，<5MB 达标。
  DSP 试玩广告本就以 Web 包为准，此壳便于手机上直接验证 Web 玩法。

### DC 越玩越高（初始 ~19 → 操作后 70-100+）排查与修复

- 已核实：自动图集生效（43 张小图合 1 张纹理，构建产物仅 7 张贴图）；静态结构按颜色排序、
  单纹理合批，初始 ~19 DC 符合预期；脚本无节点泄漏、扫光已是批量单 Graphics。
- 引擎 2D 合批依据（batcher-2d.ts）：`dataHash = hash(bufferId + layer + textureHash)`，
  三个条件任一变化即断批；`BATCHER2D_MEM_INCREMENT=144KB`（6144 顶点 ≈ 1536 个 quad）。
- 结构性隐患：每次拾取整组小球 `moveGemNodeToLayer` 挪到 flyLayer，落位再挪回 gemLayer，
  反复 `setSiblingIndex` 重排数百节点 → 帧内合批顺序被打乱、批次随操作累积。
- 修复：**小球常驻 gemLayer**，悬浮/飞行只改坐标不再换层（GemLayer/FlyLayer 同原点，
  坐标数学不变）；并加 `[DC-TELEMETRY]` 日志（每 2 秒打印 draw call）便于验证。
- 验证方式：装 release 包后 `adb logcat | grep DC`，或先用编辑器预览看面板数值前后对比。