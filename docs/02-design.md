# 设计文档 — Jewel Coloring 试玩广告（Cocos Creator 3.8）

> 本工程是"宝石填色（Jewel Coloring）"类型试玩广告的完整实现。
> 设计依据：玩法需求梳理（参考同类投放样本提炼玩法模型）、Figma 设计稿素材、
> 以及开发过程中逐轮确认的玩法规则。本文是最终实现的设计说明。

## 1. 技术选型与理由

| 项 | 选择 | 理由 |
|---|---|---|
| 引擎 | Cocos Creator 3.8.8（3.8 兼容） | 任务指定 3.x；3.8.8 稳定且本机已安装；同类型试玩广告普遍为 Cocos 3.x Web 形态，技术经验可直接复用 |
| 语言 | TypeScript | Cocos 3.x 官方语言；玩法状态机、网格数据、异步飞行链都需要类型约束 |
| 渲染 | 2D UI（Sprite + UITransform + Graphics 特效） | 纯 2D 玩法，无 3D 需求；统一 UI_2D 层避免触摸/合批混乱 |
| 资源 | 用户提供的 Figma 素材（atlas 图集 + images） | 小球 21 色 Gem、目标色 Base、slot/tray/手指/bg/title/url/tip 全部落本地 |
| 关卡 | JSON 字符画（21×33）+ 代码动态生成 | 底图即"有多少底图就有多少小球"，换图案只改 JSON |
| 适配 | 设计分辨率 1080×1920；FIXED_WIDTH/FIXED_HEIGHT 按比例切换 | 覆盖 9:16 ~ 19.5:9 各 DSP 容器；根节点 Widget 撑满 + 棋盘等比缩放 |
| 构建 | Web Mobile（Playable 投放形态） | 移动端/浏览器/模拟器可直接运行体验 |

### 为什么不引入额外框架 / 对象池 / 网格锁

- 试玩广告单局、单场景、无关卡循环（通关即 CTA），`GridLock/PoolManager/TaskStruct` 等
  重型框架模块（逐格锁/对象池/任务队列）对当前规模是负担，设计中刻意保持"一个导演 + 一个视图"的轻量结构。
- 宝石节点统一常驻 `gemLayer`，飞行时挂 `flyLayer`，不做 instantiate/destroy 循环；
  526 颗小球全生命周期只创建一次，GC 压力小。
- 并发控制用单一 `_busy` 标志 + 异步流程代号（`_gen`），比逐格锁更贴合"整组移动"的玩法。

## 2. 架构与模块职责

```
MetaGameController（场景控制器：适配/背景/标题/url/关卡加载/胜利流程/引导接线）
└─ BSGameDirector（玩法导演：状态机、连通算法、暂存区、填回、胜负、音频、看门狗）
   └─ BoardView（视图：图案区/暂存区/宝石层/飞行层/特效层，节点映射与触摸）
      ├─ GemElementView（单颗宝石三态状态机：Idle/Lifted/Correct）
      ├─ FlySystem（逐帧贝塞尔飞行采样，错峰队列）
      ├─ EffectSystem（单球扫光/颜色完成批量扫光/通关波次扫光/tip）
      ├─ AudioService（BGM + SFX 双音源，落位音打断）
      └─ ResourceStore（图集/图片/音频加载）
GuideController（四步新手引导：手指、点击门禁、动作完成后再显下一步）
PlayableAdPlatform（商店跳转）
```

### 2.1 数据模型

- `_gems: Map<"region:grid", GemInstance>` —— **唯一数据源**；
  `GemInstance = { color, region: 0|1, grid }`。
- `level.pattern[r][c] = { baseColor, gemColor }` —— 底图目标色 + 当前球色；
- `level.tray[r][c] = { gemColor }` —— 暂存区，开局全空；
- `BoardView._patternGemNodes / _trayGemNodes / _gemData` —— 节点 ↔ 网格映射。
- **三方一致性自愈**（`reconcileTray`）：每次空闲点击/存入/紧凑前交叉校验
  `_gems` / `level.tray` / 节点三份状态，销毁幽灵节点、重建缺失节点、修复格子数据、
  清扫孤儿节点（有贴图但无任何映射的残留球）。

### 2.2 核心玩法状态机

```
Idle ──点击同色连通组──▶ Lifted(整组悬浮)
 Lifted ──点自身──▶ 取消悬浮回原位
 Lifted ──点暂存区(有空位)──▶ 按序飞入暂存区（同色插到该色末尾，其他色滑移）
 Lifted ──点同色空底图──▶ 填回同底连通空位（近处优先，已填格阻断）
全部底图被匹配色填满 ──▶ 通关波次扫光 → url 弹到屏幕中间 → 手指引导下载
```

- **选中**：BFS 八方向（图案区=纯几何；暂存区=行优先蛇形+几何斜角），
  **已归位小球不算联通，阻断扩散**；
- **填回**：BFS 只沿"同底色空位"扩散，**已填/被占格阻断**；
- **暂存区插入**：新球插到该颜色末尾；中间其他颜色整体后移；
  移位用**两段式原子更新**（先全部卸载旧位置，再统一写入新位置），
  避免相隔 n 格的两颗球互相覆盖数据导致"看得见点不动"；
- **飞行**：`FlySystem` 逐帧贝塞尔 + easeInOutSine，错峰 0.06s、单颗 0.12s，
  先出先落位；未飞完/失败的球保持悬浮，不丢数据。

### 2.3 引导（四步）

1. 点棋盘宝石（悬浮）→ 2. 点暂存区（飞入）→ 3. 点同色绿球（悬浮）→ 4. 点回原位（填回）。
- 点击门禁：引导期间只放行"当前步骤目标球同色八方向连通组"（或空位同底空格）；
- **时序**：点击瞬间当前手指立即消失；悬浮/飞行动作完成（导演层不忙）后才显示下一步手指；
- 通关后：波次扫光播完 → url 从底部弹到屏幕中间（backOut 缩放）→ 手指指向 url → url 呼吸缩放。

### 2.4 特效与音频

- 单颗落位：小扫光（左上→右下的斜光带，约束在球尺寸内）+ 落位音（打断上一个）；
- 颜色完成：该色所有球**同时**批量扫光（单 Graphics 节点多光带）+ tip 飘图 + tip 音；
- 通关：**左上→右下波次扫光（约 1.5s）**（单节点单 tween，每球按对角线位置错峰起扫）；
- BGM 打开即播（浏览器拦截时首次输入兜底）；点击整组播一次 OnClick；批次飞完播 Ok。

## 3. 参考样本研究与需求对照

### 3.1 从投放样本与需求梳理中提炼的关键信息（详见 docs/01-playable-analysis.md）

- 投放样本为 Cocos Creator 3.x Web 构建（工程名 SortingStoreProject，bundle `bundle_brilliantsort`）；
- 设计分辨率 1080×2080，FIXED_WIDTH/FIXED_HEIGHT 按 1.925 阈值切换；
- 玩法模块：`BSGameDirector / MetaGameController / BoardView / GemElementView /
  CacheView / FlySystem / EffectSystem / AnimationCurveSampler / AudioService /
  GuideController / GridLock / TaskStruct / PoolManager / PrefabRegistry / PlayableAdPlatform`；
- 规则函数名梳理：`moveLiftedToCacheClassicWithColorAppend`（缓存同色追加）、
  `collectEmptyCacheIndices`、`canPlaceLiftedToBoardBase`、`winTargetProgressPercent`；
- 音频：6 段声明（BGM/pickup/othregion_place(_single)/success/store_move/store_place），
- 特效：`宝石扫光序列_大/小_00~09`（10 帧序列）、`宝石扫光特效`；
- 引导：`引导手指`（常态/放/缩三帧）+ 步骤文本；
- CTA：`DownButton` 跳商店（Google Play / App Store 双链接）。

### 3.2 本工程实现映射

| 样本模块 | 本工程 | 说明 |
|---|---|---|
| BSGameDirector / MetaGameController | 同名 | 导演 + 场景控制器，职责一致 |
| BoardView / CacheView / CacheSlot | BoardView（图案区+暂存区） | 图案区=Base 底纹（无孔位），暂存区=slot 孔位常驻 |
| GemElementView | GemElementView | 三态状态机（平/悬浮/归位） |
| FlySystem / FlySampler | FlySystem | 贝塞尔逐帧采样 + 错峰 |
| EffectSystem / 扫光序列 | EffectSystem | 批量/波次扫光（Graphics 实现，可换序列帧） |
| AudioService | AudioService | 双音源，SFX 打断 |
| GuideController | GuideController | 四步手指引导 + 点击门禁 |
| GridLock / TaskStruct | `_busy` + `_gen` | 整组互斥 + 异步流程代号 |
| PoolManager | 常驻 gemLayer | 小球全生命周期不销毁重建 |
| PopupController（结算） | 无 | 按需求去掉弹窗，通关直接引导 CTA |
| PrefabRegistry / ResourceService | ResourceStore | 静态 resources 加载 |

### 3.3 需求落地中的差异与取舍

- **素材**：投放样本内嵌资源经平台加密不可直接复用；本工程使用
  Figma 设计稿导出的素材 + 自制音效，命名对齐（`xxxGem/xxxBase`、`slot/tray/手指/bg/title/url/tip`）。
- **玩法形态**：投放样本为"宝石排序"（缓存格叠放归类）；本作目标玩法为
  **Jewel Coloring 填色**：图案底图（菠萝 21×33）+ 暂存区中转 + 点色填回，
  在样本基础上按设计稿与需求确认重构了完整交互闭环。
- **布局**：设计分辨率改为 1080×1920（用户指定）；图案区 21×33、格 30×30；
  暂存区 14×5、托盘图 808×304、孔位 40×40、间距 56。
- **胜利流程**：去掉"胜利弹窗+继续"，通关后扫光 → url 弹到屏幕中间 → 手指引导下载。
- **自适应**：棋盘整体按 `min(宽/1080, 高/1920)` 缩放，根节点 Widget 撑满，
  保证 9:16 ~ 16:9 都完整可见。

## 4. 设计稿落地中的取舍

- **孔位只在暂存区**：图案区只有 Base 底纹，slot 孔位贴图仅用于暂存区（常驻不随存放消失）；
- **小球/底图尺寸 = slot 的一半规格**：图案小球 30×30，暂存区小球 36×36（稍小于孔位 40）；
- **同色分组插入**：暂存区维护"同色相连"线性序列，插入到该色末尾、其他色滑移；
  取出后行优先前移补位（紧凑无空洞）；
- **连通规则**：八方向连通（用户明确要求），但**已归位小球不算联通**（选中与填回均阻断）；
- **动画节奏**：飞入暂存区变大、飞出变小；落位音打断；批次飞完播 Ok；
- **性能取舍**：颜色完成/通关扫光从"每球一节点"改为"单节点批量绘制"，
  526 颗球从 500+ Draw Call 降到 1 个，消除卡顿。

## 5. 优化方向（后续）

1. **正式美术替换**：小球/底图换高分辨率序列帧；扫光换 10 帧序列；加落位粒子；
2. **图集与合批**：正式包用 `base.pac` 自动图集（已配置），进一步压缩纹理与 DC；
3. **分帧加载/内存**：大关卡资源分帧加载（已按批 10 加载）；小球节点可池化复用；
4. **多关卡**：Level_1~N JSON 字符画扩展，可加"每色数量守恒 + 可解性校验"工具；
5. **投放平台接入**：各 DSP 的 CTA 点击回调、MD5 校验、Banner 开关；
6. **引导**：支持任意格子配置、多语言文案、手指路径动画参数化。

## 6. 上下游协作需求思考

- **与设计**：需要 1080×1920 安全区标注（刘海屏/圆角）；托盘孔位区留白规范；
  图案量化标准（21×33 字符画 ↔ 目标图案的映射工具）。
- **与美术**：小球按"颜色×贴图"21 套；Base 底纹 21 套；slot/tray/手指/bg/title/url/tip
  出透明 PNG；扫光序列帧（大/小）规格；音频 6 段（BGM/点击/落位/完成/OK/tip）。
- **与策划**：关卡 JSON 规范（`baseGrid` 字符画 + 可选 `gemGrid` 固定布局）；
  每色小球数=底图数的守恒约束；新手引导四步的目标格子由策划配置；
  通关节奏（扫光时长、url 弹出时机、手指循环）参数化。
- **与投放**：CTA 商店链接（Google Play / App Store）、按钮样式、首屏 3 秒可交互点、
  各 DSP 尺寸容器适配（9:16 ~ 16:9）。