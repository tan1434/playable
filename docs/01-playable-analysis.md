# 参考样本分析与需求梳理 — Jewel Coloring（宝石排序）

> 本文档基于任务提供的两段真实投放样本（`jewel-coloring-a.html` / `jewel-coloring-b.html`）梳理分析整理，
> 两段样本均以 AppLovin `al_renderHtml` 方式投放，正文内容是一份 Cocos Creator 3.x Web 构建产物
> （工程内部名 `SortingStoreProject`，资源 bundle 名 `bundle_brilliantsort`），A/B 为同一产品不同投放版本。

## 1. 产品形态

- **品类**：宝石排序（Gem Sorting / Brilliant Sort），休闲益智，移动端竖屏。
- **App 名称**：Jewel Coloring（Playable 的下载 CTA 指向：
  `https://play.google.com/store/apps/details?id=color.number.paint.pixle.art.sort.jigsaw`，
  iOS 指向 `https://itunes.apple.com/app/id6759081967`）。
- **技术栈（样本）**：Cocos Creator 3.x（Web Mobile 构建，含 spine / meshopt 运行时）。
- **设计分辨率**：1080 × 2080（宽高比约 1 : 1.926，覆盖主流 19.5:9 全面屏）。
  启动时按可视区域比例在 `FIXED_WIDTH` / `FIXED_HEIGHT` 间切换适配。

## 2. 核心玩法规则

### 2.1 目标
棋盘上铺满多种颜色的宝石，玩家把同色宝石"提起 → 飞行 → 放置"到对应的缓存格区域，
按颜色完成归类。全部宝石归类完成即过关，进入下一关；连续完成后弹出结算/CTA。

### 2.2 操作模型
- `ClickBoardCell` / `ClickCacheGem`：点击棋盘格或缓存区中的宝石。
- 点击棋盘宝石 → "提起（Lift）"：宝石从格子中抬起，跟随手指或停留空中（`itemLiftHeight`），
  有专门的"提起采样动画"。
- 点击目标格 → "飞行（Fly）"：宝石沿曲线飞向目标格（`FlySystem` / `FlySampler`），落位后恢复常态。
- `moveLiftedToCacheClassicWithColorAppend`：飞入缓存区的经典规则——**同色可以叠放/追加**，
  即缓存格内已有同色宝石时可以继续叠放；`collectEmptyCacheIndices` 收集空缓存格用于放置。
- `allowBoardPick` / `allowCachePick`：棋盘格与缓存格分别控制是否允许拾取。
- `canPlaceLiftedToBoardBase`：判断能否放回棋盘底座（`boardBaseType`，格子上有"底"贴图）。
- `clickTolerance`：触摸移动容差，用于区分"点击"与"拖拽"（点击 = 抬起/放置，拖动 = 跟随）。
- `GridLock`：网格级互斥锁，同一格同一时刻只允许一个任务，防止连点导致并发错误。
- `TaskStruct`：任务类型枚举 `Fly=1, Lift=2`；任务有 `Waiting / Run / Done / Cancel` 状态机。
- 胜利条件来自配置：`winTargetProgressPercent` / `checkConfigWinCondition` / `winLevelCondition`
  （可配置为"百分比进度"或"特定关卡条件"）。

### 2.3 关卡结构（Level_1 ~ Level_10）
- 关卡文件为 **Tiled 地图 JSON**（45 × 46 网格，54 × 54 px/格，正交）。
- 两层瓦片：
  - **Board 层**：棋盘底板。瓦片 id ∈ {5, 16, 28, 30, 31}（原图集 Board_Images）。
  - **Gems 层**：宝石本体。瓦片 id ∈ {73, 84, 96, 98, 99}（原图集 Gems_Images，firstgid=35，
    即图集内序号 {38, 49, 61, 63, 64}）。
- 共现矩阵（Level_1）：

  | Board gid | Gem gid | 数量 | 推断语义 |
  |---|---|---|---|
  | 16 | 96 | 243 | 棋盘可移动格（宝石 96 号） |
  | 30 | 96 | 102 | 棋盘可移动格（同色，另一形态） |
  | 28 | 73/84/98/99 | 347 | 缓存/目标区（多种颜色） |
  | 31 | 84/96 | 8 | 特殊格（锁定/装饰） |
  | 5  | 84/96 | 38 | 外框边缘装饰 |

  > 说明：Board 层与 Gems 层只是"底图 + 宝石"两层叠画，瓦片 id 是美术索引；
  > 运行时由 `parseLevelConfig` 结合两张图集 SpriteFrame 映射到逻辑格与宝石类型。

- 关卡总量：Level_1 共 736 颗宝石；5 种宝石类型（红/黄/紫/蓝/绿，Level_1 用 5 色，
  全局图集含 6 色：红黄紫蓝绿灰）。

## 3. 美术资源清单（样本素材梳理）

### 3.1 宝石元素（`宝石排序_棋盘模块` 图集，102 个 SpriteFrame）
命名模式 `0_XXXX_颜色N_姿态`：
- 颜色：红(red) / 黄(yellow) / 紫(purple) / 蓝(blue) / 绿(green) / 灰(gray)。
- 每种颜色编号 1~6（多种宝石造型），每号三态：`宝石_平`（平放）、`宝石_立`（立起）、`底`（底座）。
- 例：`0_0000_红1_宝石_立`、`0_0001_红1_宝石_平`、`0_0002_红1_底`。
- 用途：棋盘上平/立两态混排，底座画在格子内。

### 3.2 特效
- `宝石扫光序列_大_00~09`（10 帧，成功完成一种颜色时的大扫光）。
- `宝石扫光序列_小_00~09`（10 帧，单颗宝石放置时的小扫光）。
- `宝石扫光特效`（合成特效，`GemSweep`）。

### 3.3 UI 元素
- **主游戏模块**：`棋盘图片框`、`格子底板`、`空格子`、`单个格子虚线`、`格子虚线`、
  `未解锁格子`、`文本框底板`、`棋盘外边缘_上/下/左/右/左上/右上/左下/右下`（九宫格圆角框）。
- **结算模块**：`结算模块` 底板 + `Arrows_成功彩带_1` +
- **新手引导**：`引导手指`（常态/放/缩 三帧：`my sticker room_主游戏_手指_常态/放/缩`）、引导层、引导文本。
- **下载按钮**：`DownButton`（绿色下载按钮，含 `RESOURCE_DOWN_BUTTOM_BG` 底图），点击打开商店。

### 3.4 音频
| 文件 | 用途 |
|---|---|
| `Gem_Bgm_ingame_play` | 游戏内 BGM（首帧输入后开始播放） |
| `Gem_pickup` | 拾取/提起宝石 |
| `Gem_othregion_place` / `_single` | 放置到其他区域（单颗/连放） |
| `Gem_success` | 完成一种颜色 |
| `Gem_store_move` | 缓存区移动 |
| `Gem_store_place` | 缓存区放置 |

## 4. 场景与节点结构（样本 Scene）

```
GameScene (SceneAsset)
└─ Canvas (1080×2080, cc.Canvas + Camera)
   ├─ GameBg (全屏背景, 1080×2800 图)
   ├─ TitleSprite (顶部标题图, 880×180, 按语言加载多语言图片)
   ├─ MetaGameLayer (1080×1280, 主游戏层, 挂 MetaGameController)
   │  └─ …（宝石棋盘、缓存区、特效层、引导层由 BSGameDirector 动态构建）
   ├─ DownButton (下载 CTA 按钮, 606×97, 绿色)
   └─ PopupLayer (胜利弹窗层, WinBg + 结算语 + 彩带)
```

## 5. 关键脚本模块（样本内部模块名 → 职责）

| 样本模块 | 职责 |
|---|---|
| `BSGameDirector` | 全局导演：关卡循环、状态机、胜利/失败回调 |
| `MetaGameController` | 场景层控制器：加载 bundle、标题、下载按钮、debug 手指 |
| `GameScene` | 场景组件：布局适配、标题、DownButton |
| `BoardView` / `BoardStruct` | 棋盘视图与数据结构（格子、底座、邻接判断） |
| `GemElementView` | 单颗宝石视图（皮肤帧、平/立/底、提起高光） |
| `CacheView` / `CacheSlot` | 缓存区视图（空槽收集、同色追加） |
| `FlySystem` | 飞行任务调度（曲线、排队、取消） |
| `EffectSystem` | 扫光特效、成功反馈 |
| `AnimationCurveSampler` | 采样动画曲线（提起/飞行/缩放出现） |
| `AudioService` | 音效播放（拾取/放置/成功/BGM） |
| `GuideController` / `GuideStruct` | 新手引导（手指 + 文本 + 步骤） |
| `PoolManager` | 对象池（宝石、高光、扫光） |
| `GridLock` / `TaskLockMap` | 格子互斥锁 |
| `PrefabRegistry` | 预制体注册表（按 key 加载/预热） |
| `ResourceService` / `ResourceBundleManager` | bundle 加载 |
| `ViewInputGate` | 输入门（结算/切换关卡时屏蔽点击） |
| `DebugFingerIndicator` | 调试手指指示器（开发用） |
| `PlayableAdPlatform` | 广告平台适配（CTA、banner、商店跳转） |

## 6. 流程节奏

1. **启动**：加载 resources bundle → GameConfig → bundle_brilliantsort → GameScene。
2. **开场**：显示标题图 + 下载按钮（首帧延迟）；首次进入显示新手引导（手指点击第一颗宝石）。
3. **游玩**：点宝石提起 → 点目标格飞行放置 → 同色追加 → 颜色完成扫光 + 音效 → 下一关。
4. **CTA**：随时可点下载按钮；通关后引导跳转商店。


