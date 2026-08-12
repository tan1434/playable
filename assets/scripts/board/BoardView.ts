import {
    _decorator, Component, Node, Vec3, UITransform, EventTouch, Layers, Sprite, SpriteFrame, Graphics, Color,
} from 'cc';
import { LevelData } from '../core/LevelData';
import { gemColorName } from '../core/GemType';
import { GemElementView, GemViewState } from '../gem/GemElementView';
import { ResourceStore } from '../utils/ResourceStore';
import { GameConst } from '../core/GameConst';

const { ccclass, property } = _decorator;

export interface GemClickInfo {
    grid: number;
    region: 0 | 1; // 0=图案区 1=暂存区
    color: number;
}

/**
 * 游戏视图（竖屏 1080×1920）：
 * - 底图层：图案区只有底纹（无孔位贴图），直接画在格子节点上；孔位贴图只用于暂存区
 * - 宝石层：所有小球统一放 gemLayer，按颜色排序，飞行时挂到 flyLayer
 * - 托盘：tray 整图 + slot 孔位（始终存在，不随存放消失）
 */
@ccclass('BoardView')
export class BoardView extends Component {
    @property(Node) boardRoot: Node | null = null;    // 图案区容器
    @property(Node) stagingRoot: Node | null = null;  // 托盘容器
    @property(Node) gemLayer: Node | null = null;
    @property(Node) flyLayer: Node | null = null;
    @property(Node) effectLayer: Node | null = null;

    onGemClicked: ((info: GemClickInfo) => void) | null = null;
    onPatternSlotClicked: ((idx: number) => void) | null = null;
    onTraySlotClicked: ((idx: number) => void) | null = null;
    onTouchDebug: ((msg: string) => void) | null = null;

    level: LevelData | null = null;

    private _patternGemNodes = new Map<number, Node>();
    private _trayGemNodes = new Map<number, Node>();
    private _gemData = new Map<Node, { grid: number; region: 0 | 1 }>();
    private _patternSlots = new Map<number, Node>();
    private _traySlots: Node[] = [];
    private _trayCb: (() => void) | null = null;

    build(level: LevelData): void {
        console.log(`[BoardView] build: pattern=${this.countBase(level)} 凹槽 tray=${level.trayCols * level.trayRows}格`);
        this.level = level;
        this.clear();

        const patternRoot = this.boardRoot ?? this.node;
        patternRoot.getComponent(UITransform) ?? patternRoot.addComponent(UITransform);
        patternRoot.getComponent(UITransform)!.setContentSize(GameConst.PATTERN_TILE * GameConst.BOARD_COLS, GameConst.PATTERN_TILE * GameConst.BOARD_ROWS);
        patternRoot.setPosition(0, GameConst.PATTERN_Y, 0);

        // ---- 图案区底图层：Base 直接画在 slot 上，按颜色排序便于合批 ----
        const rows = level.pattern.length;
        const cols = level.pattern[0].length;
        const slotSort: { node: Node; color: number }[] = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const cell = level.pattern[r][c];
                if (cell.baseColor < 0) continue; // 图案外不建节点
                const x = (c - (cols - 1) / 2) * GameConst.PATTERN_TILE;
                const y = ((rows - 1) / 2 - r) * GameConst.PATTERN_TILE;
                const slot = new Node(`PatternCell_${r}_${c}`);
                this._patternSlots.set(r * cols + c, slot);
                slot.layer = Layers.Enum.UI_2D;
                slot.addComponent(UITransform).setContentSize(GameConst.PATTERN_TILE, GameConst.PATTERN_TILE);
                slot.setPosition(x, y, 0);
                patternRoot.addChild(slot);
                this.setupSprite(slot, ResourceStore.baseFrames[cell.baseColor], GameConst.PATTERN_GEM_SIZE);
                const patCb = () => { if (this.onPatternSlotClicked) this.onPatternSlotClicked(r * cols + c); };
                slot.on(Node.EventType.TOUCH_END, patCb);
                slot.on(Node.EventType.MOUSE_UP, patCb);
                slotSort.push({ node: slot, color: cell.baseColor });
            }
        }
        slotSort.sort((a, b) => a.color - b.color);
        slotSort.forEach((s, i) => s.node.setSiblingIndex(i));

        // ---- 托盘：tray 整图 + slot 孔位（孔位常驻，不随存放消失）----
        const trayRoot = this.stagingRoot ?? this.node;
        trayRoot.getComponent(UITransform) ?? trayRoot.addComponent(UITransform);
        trayRoot.getComponent(UITransform)!.setContentSize(GameConst.TRAY_IMAGE_W, GameConst.TRAY_IMAGE_H);
        trayRoot.setPosition(0, GameConst.TRAY_Y, 0);
        trayRoot.removeAllChildren();

        if (ResourceStore.trayFrame) {
            const trayBg = new Node('TrayBg');
            trayBg.layer = Layers.Enum.UI_2D;
            this.setupSprite(trayBg, ResourceStore.trayFrame, 0);
            trayBg.getComponent(UITransform)!.setContentSize(GameConst.TRAY_IMAGE_W, GameConst.TRAY_IMAGE_H);
            trayRoot.addChild(trayBg);
        }

        const tc = level.trayCols;
        const tr = level.trayRows;
        for (let r = 0; r < tr; r++) {
            for (let c = 0; c < tc; c++) {
                const idx = r * tc + c;
                const x = (c - (tc - 1) / 2) * GameConst.TRAY_PITCH;
                const y = ((tr - 1) / 2 - r) * GameConst.TRAY_PITCH;
                const slot = new Node(`TraySlot_${idx}`);
                this._traySlots[idx] = slot;
                slot.layer = Layers.Enum.UI_2D;
                slot.addComponent(UITransform).setContentSize(GameConst.TRAY_TILE, GameConst.TRAY_TILE);
                slot.setPosition(x, y, 0);
                trayRoot.addChild(slot);
                if (ResourceStore.slotFrame) this.setupSprite(slot, ResourceStore.slotFrame, GameConst.TRAY_TILE);
            }
        }

        // 暂存区整体可点：点击托盘任意位置（只要还有空位即可存入）
        if (this._trayCb) { trayRoot.off(Node.EventType.TOUCH_END, this._trayCb); trayRoot.off(Node.EventType.MOUSE_UP, this._trayCb); }
        this._trayCb = () => { if (this.onTraySlotClicked) this.onTraySlotClicked(-1); };
        trayRoot.on(Node.EventType.TOUCH_END, this._trayCb);
        trayRoot.on(Node.EventType.MOUSE_UP, this._trayCb);

        // ---- 宝石层：图案区 + 暂存区所有小球统一放 gemLayer，按颜色排序 ----
        const gemLayer = this.gemLayer ?? this.node;
        const gemSort: { node: Node; color: number }[] = [];
        const pos = new Vec3();
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const cell = level.pattern[r][c];
                if (cell.gemColor < 0) continue;
                const idx = r * cols + c;
                const gem = this.createGemNode(cell.gemColor, idx, 0);
                gemLayer.addChild(gem);
                this.getPatternCellPosition(idx, pos);
                gem.setPosition(pos.x, pos.y, 0);
                this._patternGemNodes.set(idx, gem);
                gemSort.push({ node: gem, color: cell.gemColor });
            }
        }
        for (let r = 0; r < tr; r++) {
            for (let c = 0; c < tc; c++) {
                const idx = r * tc + c;
                if (level.tray[r][c].gemColor < 0) continue;
                const gem = this.createGemNode(level.tray[r][c].gemColor, idx, 1);
                gemLayer.addChild(gem);
                this.getTrayCellPosition(idx, pos);
                gem.setPosition(pos.x, pos.y, 0);
                this._trayGemNodes.set(idx, gem);
                gemSort.push({ node: gem, color: level.tray[r][c].gemColor });
            }
        }
        gemSort.sort((a, b) => a.color - b.color);
        gemSort.forEach((s, i) => s.node.setSiblingIndex(i));

        console.log(`[BoardView] build done: patternSlots=${this._patternSlots.size} traySlots=${this._traySlots.length} gems=${this._patternGemNodes.size + this._trayGemNodes.size}`);
    }

    private countBase(level: LevelData): number {
        let n = 0;
        for (const row of level.pattern) for (const cell of row) if (cell.baseColor >= 0) n++;
        return n;
    }

    createGemNode(color: number, grid: number, region: 0 | 1): Node {
        const node = new Node(`Gem_${gemColorName(color)}_${grid}`);
        node.layer = Layers.Enum.UI_2D;
        node.getComponent(UITransform) ?? node.addComponent(UITransform);
        const view = node.addComponent(GemElementView);
        view.color = color;
        const size = region === 0 ? GameConst.PATTERN_GEM_SIZE : GameConst.TRAY_GEM_SIZE;
        node.getComponent(UITransform)!.setContentSize(size, size);
        const frame = ResourceStore.gemFrames[color] ?? null;
        if (frame) {
            const sp = node.addComponent(Sprite);
            sp.sizeMode = Sprite.SizeMode.CUSTOM;
            sp.spriteFrame = frame;
        } else {
            // 保底：贴图未加载时用彩色圆，保证小球可见可点
            console.warn(`[BoardView] gem贴图缺失 color=${color}，使用占位圆`);
            const g = node.addComponent(Graphics);
            g.fillColor = BoardView.COLOR_MAP[color] ?? new Color(200, 200, 200);
            g.circle(0, 0, size * 0.45);
            g.fill();
            g.strokeColor = new Color(255, 255, 255, 200);
            g.lineWidth = 1;
            g.circle(0, 0, size * 0.45);
            g.stroke();
        }
        node.on(Node.EventType.TOUCH_END, this.onGemTouchEnd, this);
        node.on(Node.EventType.MOUSE_UP, this.onGemTouchEnd, this);
        this._gemData.set(node, { grid, region });
        return node;
    }

    /** 占位色（贴图缺失时的保底颜色） */
    static readonly COLOR_MAP: Color[] = [
        new Color(231, 76, 96), new Color(52, 152, 219), new Color(46, 204, 113),
        new Color(243, 186, 47), new Color(155, 89, 182), new Color(230, 126, 34),
        new Color(255, 105, 180), new Color(0, 188, 212), new Color(127, 140, 141),
        new Color(44, 44, 44), new Color(121, 85, 72), new Color(128, 0, 32),
        new Color(0, 100, 0), new Color(60, 180, 75), new Color(170, 140, 220),
        new Color(255, 0, 255), new Color(20, 30, 80), new Color(255, 218, 185),
        new Color(220, 190, 150), new Color(135, 206, 235), new Color(255, 255, 255),
    ];

    getGemNode(region: 0 | 1, grid: number): Node | null {
        return region === 0 ? this._patternGemNodes.get(grid) ?? null : this._trayGemNodes.get(grid) ?? null;
    }
    getPatternSlotNode(idx: number): Node | null { return this._patternSlots.get(idx) ?? null; }
    getTraySlotNode(idx: number): Node | null { return this._traySlots[idx] ?? null; }

    /** 返回相对 BoardRoot/flyLayer 的格子中心坐标（含 patternRoot/trayRoot 偏移） */
    getPatternCellPosition(idx: number, out: Vec3): Vec3 {
        const cols = this.level!.pattern[0].length;
        const r = Math.floor(idx / cols);
        const c = idx % cols;
        const x = (c - (cols - 1) / 2) * GameConst.PATTERN_TILE;
        const y = ((this.level!.pattern.length - 1) / 2 - r) * GameConst.PATTERN_TILE;
        out.set(x, y + GameConst.PATTERN_Y, 0);
        return out;
    }

    getTrayCellPosition(idx: number, out: Vec3): Vec3 {
        const tc = this.level!.trayCols;
        const r = Math.floor(idx / tc);
        const c = idx % tc;
        const x = (c - (tc - 1) / 2) * GameConst.TRAY_PITCH;
        const y = ((this.level!.trayRows - 1) / 2 - r) * GameConst.TRAY_PITCH;
        out.set(x, y + GameConst.TRAY_Y, 0);
        return out;
    }

    moveGemNodeToLayer(node: Node): void {
        if (!node.parent || !this.flyLayer) return;
        const wp = node.worldPosition.clone();
        this.flyLayer.addChild(node);
        node.setWorldPosition(wp);
        // 飞行层也按颜色排序，减少飞行中的额外绘制切换
        this.sortChildrenByColor(this.flyLayer);
    }

    /** 落位：小球始终留在宝石层（不进 slot 子树，避免打断底图/宝石的合批顺序），pos 为格子中心坐标 */
    moveGemNodeToParent(node: Node, parent: Node, pos: Vec3): void {
        const layer = this.gemLayer ?? this.node;
        layer.addChild(node);
        node.setPosition(pos.x, pos.y, 0);
    }

    /** 宝石层按颜色重排（同纹理连续渲染），落位/紧凑后调用以保持低 DC */
    resortGemLayer(): void {
        if (this.gemLayer) this.sortChildrenByColor(this.gemLayer);
    }

    private sortChildrenByColor(parent: Node): void {
        const arr = parent.children.slice();
        arr.sort((a, b) => {
            // 悬浮中的球始终排到最后（渲染最上层），颜色重排不得将其盖住
            const la = a.getComponent(GemElementView)?.state === GemViewState.Lifted ? 1 : 0;
            const lb = b.getComponent(GemElementView)?.state === GemViewState.Lifted ? 1 : 0;
            if (la !== lb) return la - lb;
            return (a.getComponent(GemElementView)?.color ?? -1) - (b.getComponent(GemElementView)?.color ?? -1);
        });
        arr.forEach((n, i) => n.setSiblingIndex(i));
    }

    /** 选中悬浮的球置顶：仍在 gemLayer 内调整兄弟顺序（同图集纹理不影响合批），避免被已归位球遮挡 */
    bringGemsToFront(nodes: Node[]): void {
        const layer = this.gemLayer ?? this.node;
        if (!layer) return;
        const valid = nodes.filter((n) => n && n.isValid && n.parent === layer);
        valid.sort((a, b) => a.getSiblingIndex() - b.getSiblingIndex());
        for (const n of valid) {
            n.setSiblingIndex(layer.children.length - 1); // 显式移到末尾（渲染最上层），保持组内顺序
        }
    }
    /** 设置宝石节点显示尺寸（飞入暂存区变大，飞出变小） */
    setGemSize(node: Node, size: number): void {
        const ut = node.getComponent(UITransform);
        if (ut) ut.setContentSize(size, size);
    }

    mapPatternGem(idx: number, node: Node): void {
        this._patternGemNodes.set(idx, node);
        this._gemData.set(node, { grid: idx, region: 0 });
    }
    mapTrayGem(idx: number, node: Node): void {
        this._trayGemNodes.set(idx, node);
        this._gemData.set(node, { grid: idx, region: 1 });
    }
    unmapPatternGem(idx: number): void {
        const n = this._patternGemNodes.get(idx);
        if (n) { this._gemData.delete(n); this._patternGemNodes.delete(idx); }
    }
    unmapTrayGem(idx: number): void {
        const n = this._trayGemNodes.get(idx);
        if (n) { this._gemData.delete(n); this._trayGemNodes.delete(idx); }
    }

    /** 清扫场景中残留但已无数据映射的宝石节点（历史幽灵球），返回清理数量 */
    destroyOrphanGems(): number {
        let n = 0;
        for (const layer of [this.gemLayer, this.flyLayer]) {
            if (!layer) continue;
            for (const child of layer.children.slice()) {
                if (!child.getComponent(GemElementView)) continue;
                if (!this._gemData.has(child)) { child.destroy(); n++; }
            }
        }
        return n;
    }

    clear(): void {
        for (const n of this._patternGemNodes.values()) n.destroy();
        for (const n of this._trayGemNodes.values()) n.destroy();
        this._patternGemNodes.clear();
        this._trayGemNodes.clear();
        this._gemData.clear();
        this._patternSlots.clear();
        this._traySlots.length = 0;
        if (this.boardRoot) this.boardRoot.removeAllChildren();
        if (this.stagingRoot) this.stagingRoot.removeAllChildren();
        if (this.gemLayer) this.gemLayer.removeAllChildren();
        if (this.flyLayer) this.flyLayer.removeAllChildren();
        if (this.effectLayer) this.effectLayer.removeAllChildren();
    }

    private setupSprite(node: Node, frame: SpriteFrame | null, size: number): Sprite {
        node.getComponent(UITransform) ?? node.addComponent(UITransform);
        const sp = node.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.spriteFrame = frame;
        if (size > 0) node.getComponent(UITransform)!.setContentSize(size, size);
        return sp;
    }

    private _lastClickTime = 0;

    private onGemTouchEnd(event: EventTouch): void {
        const now = Date.now();
        if (now - this._lastClickTime < 120) return; // 鼠标+触摸同时派发时防重
        this._lastClickTime = now;
        const touched = this._gemData.get(event.currentTarget as Node);
        console.log(`[Touch] gem touched region=${touched?.region} grid=${touched?.grid}`);
        if (!touched) {
            // 孤儿节点：有贴图有监听但没有数据映射，直接销毁自愈
            console.warn('[Touch] 点击到孤儿宝石节点，已销毁');
            (event.currentTarget as Node).destroy();
            event.propagationStopped = true;
            return;
        }
        if (this.onTouchDebug && touched) this.onTouchDebug(`点球 ${touched.region === 0 ? '图案区' : '托盘'} 第${touched.grid}格`);
        event.propagationStopped = true;
        const node = event.currentTarget as Node;
        const data = this._gemData.get(node);
        const view = node.getComponent(GemElementView);
        if (!data || !view || !this.onGemClicked) return;
        this.onGemClicked({ grid: data.grid, region: data.region, color: view.color });
    }
}