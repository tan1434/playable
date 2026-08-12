import {
    _decorator, Component, Node, UITransform, Sprite, Color,
    view, ResolutionPolicy, director, Camera, Widget, Canvas, tween, Vec3,
} from 'cc';
import { GameConst } from './GameConst';
import { ResourceStore } from '../utils/ResourceStore';
import { GameConfig } from './GameConfig';
import { DemoLevels } from './DemoLevels';
import { LevelConfig } from './LevelConfig';
import { BSGameDirector } from './BSGameDirector';
import { GuideController } from '../ui/GuideController';
import { PlayableAdPlatform } from '../utils/PlayableAdPlatform';

const { ccclass, property } = _decorator;

/**
 * MetaGameController — 场景层主控制器：
 * - 应用设计分辨率（1080×1920）
 * - 加载配置、开局引导、通关后直接引导点击下载（无弹窗）
 * - 首关显示新手引导
 */
@ccclass('MetaGameController')
export class MetaGameController extends Component {
    @property(BSGameDirector) director: BSGameDirector | null = null;
    @property(Node) uiLayer: Node | null = null;
    @property(Node) popupLayer: Node | null = null;
    @property(Node) guideLayer: Node | null = null;
    @property(Node) titleNode: Node | null = null;
    @property(Node) downloadButton: Node | null = null;

    private _levelIndex = 1;
    private _guide: GuideController | null = null;

    async start(): Promise<void> {
        this.applyResolution();
        this.fixCamera();
        this.forceFullscreen();
        this.adaptResolution();
        await ResourceStore.loadAll();
        GameConfig.loadFromResources().then(() => this.initUi());
    }

    private _dcTimer = 0;

    /** 强制相机为 2D 正交（防止场景被覆盖成 3D 透视导致触摸失效） */
    /** 分辨率适配：根节点 Widget 撑满容器；棋盘整体按比例缩放，保证 9:16 ~ 16:9 都完整可见 */
    /** 强制全屏：交给引擎 Canvas align，只修正相机和背景铺满（适配各 DSP 容器尺寸） */
    private forceFullscreen(): void {
        const scene = director.getScene();
        if (!scene) return;
        const canvas = scene.getChildByName('Canvas');
        if (!canvas) return;
        const vis = view.getVisibleSize();

        // 1. Canvas 交给引擎 alignCanvasWithScreen 自动对齐（不要手动改 position/size）
        const canvasComp = canvas.getComponent(Canvas);
        if (canvasComp) canvasComp.alignCanvasWithScreen = true;

        // 2. 相机正交 + 高度对准可视区
        const camNode = canvas.getChildByName('Camera');
        const cam = camNode ? camNode.getComponent(Camera) : null;
        if (cam) {
            cam.projection = Camera.ProjectionType.ORTHO;
            cam.orthoHeight = vis.height / 2;
            cam.near = 0;
            cam.far = 2000;
            cam.clearColor = new Color(24, 26, 34, 255); // 深色底，避免默认蓝屏
        }

        // 3. 背景铺满全屏（GameBg 直接承载 bg 图，位置归零）
        const gameBg = canvas.getChildByName('GameBg');
        if (gameBg) {
            const bgUt = gameBg.getComponent(UITransform);
            if (bgUt) bgUt.setContentSize(vis.width, vis.height);
            gameBg.setPosition(0, 0, 0);
        }
        console.log(`[Fullscreen] vis=${vis.width}x${vis.height}`);
    }
    private adaptResolution(): void {
        // 根节点挂 Widget 撑满屏幕（对齐四边）
        const w = this.node.getComponent(Widget) ?? this.node.addComponent(Widget);
        w.isAlignTop = true;
        w.isAlignBottom = true;
        w.isAlignLeft = true;
        w.isAlignRight = true;
        w.top = 0;
        w.bottom = 0;
        w.left = 0;
        w.right = 0;
        w.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;
        // 棋盘整体按比例缩放（取宽高缩放较小值，保证全部内容可见）
        const vis = view.getVisibleSize();
        const scale = Math.min(vis.width / GameConst.DESIGN_WIDTH, vis.height / GameConst.DESIGN_HEIGHT);
        if (this.director) {
            this.director.node.setScale(scale, scale, 1);
        }
        console.log(`[Adapt] vis=${vis.width}x${vis.height} scale=${scale.toFixed(3)}`);
    }
    private fixCamera(): void {
        const scene = director.getScene();
        if (!scene) return;
        const canvas = scene.getChildByName('Canvas');
        const camNode = canvas ? canvas.getChildByName('Camera') : null;
        const cam = camNode ? camNode.getComponent(Camera) : null;
        if (cam) {
            cam.projection = Camera.ProjectionType.ORTHO;
            cam.orthoHeight = GameConst.DESIGN_HEIGHT / 2;
            cam.near = 0;
            cam.far = 2000;
            cam.clearColor = new Color(24, 26, 34, 255); // 深色底，避免默认蓝屏
            console.log('[Camera] forced 2D ORTHO orthoHeight=' + cam.orthoHeight);
        } else {
            console.warn('[Camera] camera not found, touch may fail');
        }
    }
    private applyResolution(): void {
        // 竖屏 1080×1920：比例 > 1.925 用 FIXED_WIDTH，否则 FIXED_HEIGHT（对齐参考 Playable）
        const vis = view.getVisibleSize();
        if (vis.height / vis.width > 1.925) {
            view.setDesignResolutionSize(GameConst.DESIGN_WIDTH, GameConst.DESIGN_HEIGHT, ResolutionPolicy.FIXED_WIDTH);
        } else {
            view.setDesignResolutionSize(GameConst.DESIGN_WIDTH, GameConst.DESIGN_HEIGHT, ResolutionPolicy.FIXED_HEIGHT);
        }
    }

    private initUi(): void {
        this.setupBackground();
        this.setStatus('资源已加载，构建棋盘...');

        this._guide = this.node.getComponent(GuideController) ?? this.node.addComponent(GuideController);
        this._guide.guideLayer = this.guideLayer;

        this.buildTitle();
        this.buildDownloadButton();
        this.director!.onLevelComplete = () => this.onWin();
        this.director!.boardView!.onTouchDebug = (msg) => this.setStatus(`点击: ${msg}`);
        // 新手引导交互钩子：点击宝石/空格子都会上报，用于推进引导步骤
        // 引导期间：只有当前步骤可点击区域能生效
        this.director!.interactionGate = (region, grid) => this._guide ? this._guide.isClickAllowed(region, grid) : true;
        this.director!.onGemClickedHook = (info) => this._guide?.onInteraction(info.region, info.grid);
        this.director!.onPatternSlotClickedHook = (idx) => this._guide?.onInteraction(0, idx);
        this.director!.onTraySlotClickedHook = (idx) => this._guide?.onInteraction(1, idx);
        // BGM：浏览器拦截自动播放时，首次任意点击立即解锁
        this.node.once(Node.EventType.TOUCH_END, () => this.director?.playBgm(), this);
        void this.startLevel(1);
    }

    /** 背景：bg 图铺满全屏（GameBg 直接承载，节点下的旧 bg 子节点已删除） */
    private setupBackground(): void {
        const scene = director.getScene();
        const canvas = scene ? scene.getChildByName('Canvas') : null;
        const gameBg = canvas ? canvas.getChildByName('GameBg') : null;
        if (!gameBg || !ResourceStore.bgFrame) return;
        gameBg.removeAllChildren();
        const sp = gameBg.getComponent(Sprite) ?? gameBg.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.spriteFrame = ResourceStore.bgFrame;
        const ut = gameBg.getComponent(UITransform)!;
        ut.setContentSize(view.getVisibleSize().width, view.getVisibleSize().height);
    }

    /** 标题：title 图显示在上方 */
    private buildTitle(): void {
        const title = this.titleNode;
        if (!title || !ResourceStore.titleFrame) return;
        title.removeAllChildren();
        const u = title.getComponent(UITransform) ?? title.addComponent(UITransform);
        u.setContentSize(672, 102);
        const sp = title.getComponent(Sprite) ?? title.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.spriteFrame = ResourceStore.titleFrame;
        title.setPosition(0, 900, 0); // 1.2 倍布局后上移，给更高棋盘腾空间
    }

    /** URL 按钮：url 图，点击打开商店 */
    private buildDownloadButton(): void {
        const btn = this.downloadButton;
        if (!btn || !ResourceStore.urlFrame) return;
        btn.removeAllChildren();
        const u = btn.getComponent(UITransform) ?? btn.addComponent(UITransform);
        u.setContentSize(642, 103);
        const sp = btn.getComponent(Sprite) ?? btn.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.spriteFrame = ResourceStore.urlFrame;
        btn.setPosition(0, -860, 0);
        btn.on(Node.EventType.TOUCH_END, () => PlayableAdPlatform.openStore());
        btn.on(Node.EventType.MOUSE_UP, () => PlayableAdPlatform.openStore());
    }

    private async startLevel(index: number): Promise<void> {
        this._levelIndex = index;
        this.setStatus(`开局 Level_${index}...`);
        // BoardRoot 归零，图案区/托盘由 BoardView 按屏幕中心布局
        if (this.director) this.director.node.setPosition(0, 0, 0);
        const level = (await LevelConfig.load(index)) ?? DemoLevels.create(index);
        this.director?.startLevel(level);
        let baseCount = 0;
        for (const row of level.pattern) for (const cell of row) if (cell.baseColor >= 0) baseCount++;
        const gemOk = ResourceStore.gemFrames.filter(f => !!f).length;
        const baseOk = ResourceStore.baseFrames.filter(f => !!f).length;
        this.setStatus(`图案 ${baseCount} 凹槽 / 托盘 ${level.trayCols * level.trayRows} 格 / gem贴图 ${gemOk} base贴图 ${baseOk} / 点小球测试`);
        // 开局引导：按 GuideConfig.json 的步骤队列播放；
        // busy 检测器保证“上一个动作完成才显示下一步手指”
        if (this._guide && this.director?.boardView) {
            this._guide.startGuide(GameConfig.guide, this.director.boardView, () => !this.director!.busy);
        }
    }

    private onWin(): void {
        this.setStatus('全部归位！胜利，引导点击下载');
        // 先播完左上→右下的波次扫光（约 1.5s），再把 url 弹到屏幕中间并缩放，最后手指指过去
        this.scheduleOnce(() => this.showUrlCta(), 1.6);
    }

    /** 通关后：url 从底部弹到屏幕中间，缓动缩放，手指指向它提示下载 */
    private showUrlCta(): void {
        const btn = this.downloadButton;
        if (!btn || !ResourceStore.urlFrame) return;
        const u = btn.getComponent(UITransform) ?? btn.addComponent(UITransform);
        u.setContentSize(642, 103);
        btn.setScale(0.6, 0.6, 1);
        tween(btn)
            .to(0.35, { position: new Vec3(0, 0, 0), scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
            .call(() => {
                // 手指指向屏幕中间的 url
                this._guide?.showDownloadHint(btn);
                // url 轻微呼吸缩放
                tween(btn)
                    .to(0.7, { scale: new Vec3(1.04, 1.04, 1) }, { easing: 'sineInOut' })
                    .to(0.7, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' })
                    .union()
                    .repeatForever()
                    .start();
            })
            .start();
    }

    private setStatus(text: string): void {
        console.log(`[STATUS] ${text}`);
    }
}
