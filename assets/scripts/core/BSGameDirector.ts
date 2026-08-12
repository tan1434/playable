import {
    _decorator, Component, Node, Vec3, UITransform, tween,
} from 'cc';
import { LevelData } from '../core/LevelData';
import { GemColor, GemInstance } from '../core/GemType';
import { BoardView, GemClickInfo } from '../board/BoardView';
import { GameConst } from './GameConst';
import { GemElementView, GemViewState } from '../gem/GemElementView';
import { FlySystem } from '../fx/FlySystem';
import { EffectSystem } from '../fx/EffectSystem';
import { AudioService, GemAudioKey } from '../utils/AudioService';
import { ResourceStore } from '../utils/ResourceStore';

const { ccclass, property } = _decorator;

/**
 * BSGameDirector — Jewel Coloring 玩法（竖屏 1080×1920）：
 * - 点球（图案区/托盘）→ 八方向连通同色组悬浮
 * - 悬浮后：点托盘空位 → 按序飞入；点匹配色空凹槽 → 填充
 * - 点自身/其他球 → 取消悬浮回原位 / 换提
 * - 胜利：图案区全部凹槽被匹配色宝石填满
 */
@ccclass('BSGameDirector')
export class BSGameDirector extends Component {
    @property(BoardView) boardView: BoardView | null = null;
    @property(Node) effectLayer: Node | null = null;
    @property(Node) audioRoot: Node | null = null;

    onLevelComplete: ((progress: number) => void) | null = null;
    /** 交互钩子（新手引导/调试用），在逻辑处理前回调 */
    onGemClickedHook: ((info: GemClickInfo) => void) | null = null;
    onPatternSlotClickedHook: ((idx: number) => void) | null = null;
    onTraySlotClickedHook: ((idx: number) => void) | null = null;
    /** 交互门禁（引导用）：返回 false 则本次点击不生效 */
    interactionGate: ((region: 0 | 1, grid: number) => boolean) | null = null;

    private _level: LevelData | null = null;
    private _gems = new Map<string, GemInstance>();
    private _lifted: GemInstance[] | null = null;
    private _busy = false;
    private _bgmStarted = false;
    private _busyTime = 0;
    private _gen = 0; // 异步流程代号：startLevel 时自增，作废旧流程
    private _bgmRetryTimer: ReturnType<typeof setInterval> | null = null;
    private _tippedColors = new Set<number>();

    private _flySystem = new FlySystem();
    private _effectSystem: EffectSystem | null = null;
    private _audio: AudioService | null = null;

    startLevel(level: LevelData): void {
        console.log(`[BSGameDirector] startLevel: ${level.name}`);
        this._gen++; // 作废上一关未完成的异步流程
        this._level = level;
        this._gems.clear();
        this._lifted = null;
        this._busy = false;
        this._tippedColors.clear();
        this._flySystem.clear(); // 清空上一关未完成的飞行任务

        if (this.effectLayer) this._effectSystem = new EffectSystem(this.effectLayer);
        if (this.audioRoot) {
            this._audio = new AudioService();
            this._audio.init(this.audioRoot);
            this._audio.register(GemAudioKey.Bgm, ResourceStore.bgmClip);
            this._audio.register(GemAudioKey.Pickup, ResourceStore.othregionSingleClip);
            this._audio.register(GemAudioKey.OthregionPlace, ResourceStore.othregionSingleClip);
            this._audio.register(GemAudioKey.OthregionPlaceSingle, ResourceStore.othregionSingleClip);
            this._audio.register(GemAudioKey.StoreMove, ResourceStore.storePlaceClip);
            this._audio.register(GemAudioKey.StorePlace, ResourceStore.storePlaceClip);
            this._audio.register(GemAudioKey.Success, ResourceStore.storePlaceClip);
            this._audio.register(GemAudioKey.OnClick, ResourceStore.onclickClip);
            this._audio.register(GemAudioKey.Ok, ResourceStore.okClip);
            this._audio.register(GemAudioKey.Tip, ResourceStore.tipClip);
        }
        // BGM 打开即播放：浏览器拦截自动播放时每 200ms 重试，直到播成功或首次输入解锁
        if (this._bgmRetryTimer) clearInterval(this._bgmRetryTimer);
        this._audio?.playBgm();
        let retry = 0;
        this._bgmRetryTimer = setInterval(() => {
            retry++;
            if (!this._audio || this._audio.isBgmPlaying() || retry > 6) { clearInterval(this._bgmRetryTimer!); this._bgmRetryTimer = null; return; }
            this._audio.playBgm();
        }, 200);

        this.boardView?.clear();
        this.boardView?.build(level);
        this.boardView!.onGemClicked = (info) => this.onGemClicked(info);
        this.boardView!.onPatternSlotClicked = (idx) => this.onPatternSlotClicked(idx);
        this.boardView!.onTraySlotClicked = (idx) => this.onTraySlotClicked(idx);

        this.initGems();
        console.log(`[BSGameDirector] gems=${this._gems.size} ready`);
    }

    update(deltaTime: number): void {
        // 逐帧驱动飞行任务（参考 Playable 同款方案）
        this._flySystem.update(deltaTime);
        // 看门狗：_busy 卡死超过 3 秒且无飞行任务时自动复位，避免暂存区/棋盘永久无反应
        if (this._busy) {
            this._busyTime += deltaTime;
            if (this._busyTime > 3 && this._flySystem.taskCount() === 0) {
                console.warn('[Director] busy 卡死自动恢复（作废旧异步流程并复位状态）');
                this._gen++;
                this._flySystem.failAll();
                this._lifted = null;
                this._busy = false;
                this._busyTime = 0;
                this.reconcileTray();
                this.resetAllGemStates();
            }
        } else {
            this._busyTime = 0;
        }
    }

    /** BGM 打开即播放（浏览器拦截时由首次输入解锁调用） */
    playBgm(): void { this._audio?.playBgm(); }

    /** 是否正在执行飞行动作（引导用：动作完成前不显示下一步手指） */
    get busy(): boolean { return this._busy; }

    /** BGM 首次输入后开始播放（自动播放被拦时的兜底） */
    private startBgmOnInput(): void {
        if (this._bgmStarted) return;
        this._bgmStarted = true;
        this._audio?.playBgm();
    }

    private key(region: 0 | 1, grid: number): string { return `${region}:${grid}`; }


    private initGems(): void {
        const level = this._level!;
        level.pattern.forEach((row, r) => {
            row.forEach((cell, c) => {
                const idx = r * level.pattern[0].length + c;
                if (cell.gemColor >= 0) this._gems.set(this.key(0, idx), { color: cell.gemColor, region: 0, grid: idx });
            });
        });
        level.tray.forEach((row, r) => {
            row.forEach((cell, c) => {
                const idx = r * level.trayCols + c;
                if (cell.gemColor >= 0) this._gems.set(this.key(1, idx), { color: cell.gemColor, region: 1, grid: idx });
            });
        });
    }

    // ============ 事件 ============

    private onGemClicked(info: GemClickInfo): void {
        if (this.interactionGate && !this.interactionGate(info.region, info.grid)) return;
        console.log(`[Director] onGemClicked region=${info.region} grid=${info.grid} color=${info.color} lifted=${!!this._lifted} busy=${this._busy}`);
        this.startBgmOnInput();
        if (this._busy) return;
        // 空闲时先自愈暂存区，避免幽灵球/重叠导致点击无反应
        this.reconcileTray();
        const gem = this._gems.get(this.key(info.region, info.grid));
        if (!gem) {
            if (info.region === 1) console.warn(`[Director] 点击暂存区幽灵球（数据缺失）grid=${info.grid}`);
            return;
        }

        // 已归位宝石锁定：颜色与凹槽目标色匹配，不可再点击
        if (this.isGemCorrect(gem)) {
            console.log(`[Director] 已归位锁定 region=${info.region} grid=${info.grid}`);
            return;
        }
        if (this._lifted) {
            if (this._lifted.indexOf(gem) >= 0) {
                // 点自身 → 取消悬浮回原位（不推进引导，避免引导卡住）
                this.cancelLift();
                return;
            } else {
                // 点其他球 → 取消当前，换提新组
                this.cancelLift();
                this.liftGroup(gem);
            }
        } else {
            this.liftGroup(gem);
        }
        // 动作执行完后再上报引导（悬浮为同步动作，引导可直接显示下一步手指）
        this.onGemClickedHook?.(info);
    }

    private onPatternSlotClicked(idx: number): void {
        if (this.interactionGate && !this.interactionGate(0, idx)) return;
        if (this._busy || !this._lifted) return;
        const level = this._level!;
        const r = Math.floor(idx / level.pattern[0].length);
        const c = idx % level.pattern[0].length;
        const cell = level.pattern[r][c];
        if (cell.baseColor < 0 || cell.gemColor >= 0) return;
        if (this._lifted[0].color !== cell.baseColor) return;
        this.fillPattern(cell.baseColor, idx);
        // 点击即推进引导（当前手指立刻消失）；下一步手指等飞行完成后再显示
        this.onPatternSlotClickedHook?.(idx);
    }

    private onTraySlotClicked(idx: number): void {
        if (this.interactionGate && !this.interactionGate(1, idx)) return;
        if (this._busy || !this._lifted) return;
        this.reconcileTray();
        // 暂存区的小球只能飞往棋盘，不能暂存区→暂存区
        if (this._lifted[0].region === 1) {
            console.log('[Director] 暂存区→暂存区 不允许（已选中的是暂存区小球）');
            return;
        }
        // 点击暂存区任意位置：只要还有空位就存入
        const level = this._level!;
        let empty = false;
        for (let r = 0; r < level.trayRows && !empty; r++) {
            for (let c = 0; c < level.trayCols; c++) {
                if (level.tray[r][c].gemColor < 0) { empty = true; break; }
            }
        }
        if (!empty) return;
        this.fillTray();
        // 点击即推进引导（当前手指立刻消失）；下一步手指等飞行完成后再显示
        this.onTraySlotClickedHook?.(idx);
    }

    // ============ 悬浮 ============

    private liftGroup(anchor: GemInstance): void {
        const group = this.collectGroup(anchor);
        console.log(`[Director] liftGroup size=${group.length} color=${anchor.color}`);
        this._lifted = group;
        const liftedNodes: Node[] = [];
        for (const g of group) {
            const node = this.boardView!.getGemNode(g.region, g.grid);
            if (!node) continue;
            // 小球常驻 gemLayer：悬浮/飞行只改坐标，不再挪到 flyLayer，避免反复换层打断 2D 合批（DC 越玩越高）
            node.getComponent(GemElementView)?.setState(GemViewState.Lifted);
            liftedNodes.push(node);
        }
        // 悬浮整组置顶，避免被已归位球遮挡（同图集纹理，兄弟顺序不影响合批）
        this.boardView!.bringGemsToFront(liftedNodes);
        this._audio?.play(GemAudioKey.OnClick); // 点击整组只播一次
        // 悬浮动画期间视为忙碌：引导手指等动画播完再出现，同时防止期间误点
        this._busy = true;
        this.scheduleOnce(() => { this._busy = false; }, 0.12);
    }

    private collectGroup(anchor: GemInstance): GemInstance[] {
        const region = anchor.region;
        const color = anchor.color;
        const visited = new Set<string>([this.key(region, anchor.grid)]);
        const queue = [anchor.grid];
        const group: GemInstance[] = [anchor];
        while (queue.length > 0) {
            const cur = queue.shift()!;
            for (const nb of this.neighbors(region, cur)) {
                const k = this.key(region, nb);
                if (visited.has(k)) continue;
                const g = this._gems.get(k);
                if (!g || g.color !== color) continue;
                if (this.isGemCorrect(g)) continue; // 已归位：不算联通，阻断扩散
                visited.add(k);
                queue.push(nb);
                group.push(g);
            }
        }
        // 扩散规则：按与点击球的距离由近到远排序（飞出/填入从点击位置向外扩散）
        const w = region === 0 ? this._level!.pattern[0].length : this._level!.trayCols;
        const ar = Math.floor(anchor.grid / w);
        const ac = anchor.grid % w;
        group.sort((a, b) => {
            const ra = Math.floor(a.grid / w), ca = a.grid % w;
            const rb = Math.floor(b.grid / w), cb = b.grid % w;
            return (Math.abs(ra - ar) + Math.abs(ca - ac)) - (Math.abs(rb - ar) + Math.abs(cb - ac));
        });
        return group;
    }

    /** 该宝石是否已正确归位（图案区且颜色匹配凹槽目标色） */
    private isGemCorrect(gem: GemInstance): boolean {
        if (gem.region !== 0) return false;
        const level = this._level!;
        const cols = level.pattern[0].length;
        const r = Math.floor(gem.grid / cols);
        const c = gem.grid % cols;
        const cell = level.pattern[r][c];
        return cell.baseColor >= 0 && cell.gemColor === cell.baseColor;
    }
    private neighbors(region: 0 | 1, idx: number): number[] {
        const level = this._level!;
        const w = region === 0 ? level.pattern[0].length : level.trayCols;
        const h = region === 0 ? level.pattern.length : level.trayRows;
        const col = idx % w;
        const row = Math.floor(idx / w);
        const res: number[] = [];
        // 上下
        if (row > 0) res.push(idx - w);
        if (row < h - 1) res.push(idx + w);
        if (region === 0) {
            // 图案区：纯几何八方向，行尾不回绕（避免行尾↔下一行行首的假连通）
            if (col > 0) res.push(idx - 1);
            if (col < w - 1) res.push(idx + 1);
            if (row > 0 && col > 0) res.push(idx - w - 1);
            if (row > 0 && col < w - 1) res.push(idx - w + 1);
            if (row < h - 1 && col > 0) res.push(idx + w - 1);
            if (row < h - 1 && col < w - 1) res.push(idx + w + 1);
        } else {
            // 暂存区：行优先蛇形线性连通（行尾↔下一行行首视为相邻，跨行后同色仍整体选中）；
            // 斜角只保留几何相邻，避免隔行假连通（如 13↔28 跨两行）
            if (idx > 0) res.push(idx - 1);
            if (idx < h * w - 1) res.push(idx + 1);
            if (row > 0 && col > 0) res.push(idx - w - 1);
            if (row > 0 && col < w - 1) res.push(idx - w + 1);
            if (row < h - 1 && col > 0) res.push(idx + w - 1);
            if (row < h - 1 && col < w - 1) res.push(idx + w + 1);
        }
        return res;
    }

    cancelLift(): void {
        if (!this._lifted) return;
        for (const g of this._lifted) this.restoreGem(g);
        this._lifted = null;
        this.boardView?.resortGemLayer();
    }

    private restoreGem(g: GemInstance): void {
        const node = this.boardView!.getGemNode(g.region, g.grid);
        if (!node) return;
        const pos = new Vec3();
        if (g.region === 0) this.boardView!.getPatternCellPosition(g.grid, pos);
        else this.boardView!.getTrayCellPosition(g.grid, pos);
        const slot = g.region === 0 ? this.boardView!.getPatternSlotNode(g.grid) : this.boardView!.getTraySlotNode(g.grid);
        if (slot) this.boardView!.moveGemNodeToParent(node, slot, pos);
        this.boardView!.setGemSize(node, g.region === 0 ? GameConst.PATTERN_GEM_SIZE : GameConst.TRAY_GEM_SIZE);
        node.getComponent(GemElementView)?.setState(GemViewState.Idle);
    }

    // ============ 填充 ============

    private async fillPattern(color: number, clickedIdx: number): Promise<void> {
        this.keepLiftedOnTop(); // 飞行前保持悬浮组置顶
        // 填入的联通按底图：只填点击底图的同色八方向连通空位（近处优先）
        const empties = this.collectPatternEmpties(color, clickedIdx);
        await this.fillTo(0, empties, GemAudioKey.OthregionPlaceSingle);
        this.checkColorDone(); // 某颜色底图全部填满时提示
        this.compactTray(); // 暂存区紧凑：取出后前移补位（无悬浮时）
        this.checkWin();
    }

    /** 底图连通：点击位置同色底图的八方向连通空位（BFS） */
    private collectPatternEmpties(color: number, startIdx: number): number[] {
        const level = this._level!;
        const cols = level.pattern[0].length;
        const visited = new Set<number>([startIdx]);
        const queue = [startIdx];
        const res: number[] = [];
        while (queue.length > 0) {
            const cur = queue.shift()!;
            const r = Math.floor(cur / cols), c = cur % cols;
            const cell = level.pattern[r]?.[c];
            if (!cell || cell.baseColor !== color || cell.gemColor >= 0) continue; // 已填/被占均阻断
            res.push(cur);
            for (const nb of this.neighbors(0, cur)) {
                const nr = Math.floor(nb / cols), nc = nb % cols;
                const ncell = level.pattern[nr]?.[nc];
                if (ncell && ncell.baseColor === color && ncell.gemColor < 0 && !visited.has(nb)) {
                    visited.add(nb);
                    queue.push(nb);
                }
            }
        }
        return res;
    }

    /** 暂存区插入：同色相连 + 原飞行动画共存。新球插到该颜色末尾；中间其他颜色整体后移 */
    /** 飞行/填入期间保持悬浮组置顶：reconcileTray 的按颜色重排会撤销置顶，需重新置顶 */
    private keepLiftedOnTop(): void {
        if (!this._lifted) return;
        const nodes: Node[] = [];
        for (const g of this._lifted) {
            const n = this.boardView?.getGemNode(g.region, g.grid);
            if (n) nodes.push(n);
        }
        this.boardView?.bringGemsToFront(nodes);
    }
    private async fillTray(): Promise<void> {
        const level = this._level!;
        const tc = level.trayCols;
        const capacity = level.trayRows * tc;
        const group = this._lifted!;
        if (group.length === 0) return;
        const color = group[0].color;
        const gen = this._gen;

        // 先自愈暂存区，保证 _gems / level.tray / 节点三方一致，再计算空位
        this.reconcileTray();
        this.keepLiftedOnTop(); // 重排会撤销置顶，飞行前恢复悬浮组在最上层

        // 现有暂存区球（行优先，以 _gems 为准）
        const oldGems: GemInstance[] = [];
        for (let r = 0; r < level.trayRows; r++) {
            for (let c = 0; c < tc; c++) {
                const idx = r * tc + c;
                const g = this._gems.get(this.key(1, idx));
                if (g) oldGems.push(g);
            }
        }
        const n = Math.min(group.length, capacity - oldGems.length);
        if (n === 0) return;

        this._busy = true;
        try {
            // 计算插入后的线性序列：新球插到该颜色末尾，中间其他颜色整体后移
            const items: Array<{ color: number; isNew: boolean }> = oldGems.map((g) => ({ color: g.color, isNew: false }));
            for (let i = 0; i < n; i++) {
                let pos = items.length;
                for (let j = items.length - 1; j >= 0; j--) {
                    if (items[j].color === color) { pos = j + 1; break; }
                }
                items.splice(pos, 0, { color, isNew: true });
            }
            console.log('[Tray] old=' + oldGems.map((g) => g.color).join(',') + ' insert=' + color + ' x' + n + ' -> result=' + items.map((it) => it.color).join(','));
            const newGridOfOld: number[] = new Array(oldGems.length);
            const newGridOfNew: number[] = [];
            { let oi = 0; for (let ni = 0; ni < items.length; ni++) { if (items[ni].isNew) newGridOfNew.push(ni); else newGridOfOld[oi++] = ni; } }

            // 旧球：两段式原子更新（先全部卸载旧位置，再统一写入新位置）。
            // 不能逐颗“边删边写”：插入 n 颗时旧球统一后移 n 格，相隔 n 格的两颗球会
            // 互相覆盖刚写入的新数据，导致小球从 _gems/_gemData 丢失 → 看得见却点不动。
            const oldNodes: (Node | null)[] = oldGems.map((g) => this.boardView!.getGemNode(1, g.grid));
            const oldGrids: number[] = oldGems.map((g) => g.grid);
            const shiftTasks: Promise<void>[] = [];
            for (const row of level.tray) for (const cell of row) cell.gemColor = -1;
            // 第一段：卸载所有旧网格
            for (let i = 0; i < oldGems.length; i++) {
                this._gems.delete(this.key(1, oldGrids[i]));
                this.boardView!.unmapTrayGem(oldGrids[i]);
            }
            // 第二段：统一写入新网格（数据/映射/格子/动画）
            for (let i = 0; i < oldGems.length; i++) {
                const gem = oldGems[i];
                const node = oldNodes[i];
                const newGrid = newGridOfOld[i];
                gem.grid = newGrid;
                this._gems.set(this.key(1, newGrid), gem);
                level.tray[Math.floor(newGrid / tc)][newGrid % tc].gemColor = gem.color;
                if (!node) continue;
                this.boardView!.mapTrayGem(newGrid, node);
                if (oldGrids[i] !== newGrid) {
                    const to = new Vec3();
                    this.boardView!.getTrayCellPosition(newGrid, to);
                    shiftTasks.push(new Promise<void>((resolve) => {
                        tween(node).to(0.12, { position: to }, { easing: 'sineOut' }).call(() => resolve()).start();
                    }));
                }
            }
            await Promise.all(shiftTasks);
            if (gen !== this._gen) return; // 关卡已重置，放弃本次插入
            // 新球与填入棋盘共用同一飞行动画（fillTo，完全一致）
            await this.fillTo(1, newGridOfNew, GemAudioKey.StorePlace);
        } finally {
            if (gen === this._gen) this._busy = false;
        }
    }

    /** 通用填充：将悬浮组按序飞入目标区空位，未飞完/失败的保持悬浮 */
    private async fillTo(targetRegion: 0 | 1, empties: number[], audioKey: GemAudioKey): Promise<void> {
        const gen = this._gen;
        const group = this._lifted!;
        const n = Math.min(group.length, empties.length);
        if (n === 0) return;

        this._busy = true;
        try {
            console.log('[Director] 连串飞行 n=' + n + ' 错峰=' + GameConst.FLOW_STAGGER + 's 单颗=' + GameConst.FLY_DURATION + 's');
            const tasks: Promise<void>[] = [];
            const failed = new Set<number>();
            for (let i = 0; i < n; i++) {
                const startDelay = i * GameConst.FLOW_STAGGER;
                const idx = i;
                tasks.push(this.placeGem(group[idx], targetRegion, empties[idx], startDelay).then((ok) => { if (!ok) failed.add(idx); }));
            }
            await Promise.all(tasks);
            if (gen !== this._gen) return; // 关卡已重置，放弃本次填充
            // 填棋盘批次全部飞完（填满指定区域或选中球全部飞出）后播放 Gam_ok
            if (targetRegion === 0 && failed.size === 0) this._audio?.play(GemAudioKey.Ok);
            // 未飞完的球保持悬浮（选择状态）；失败的球保留原位继续悬浮，不丢成幽灵球
            const remaining: GemInstance[] = [];
            group.forEach((g, i) => { if (i >= n || failed.has(i)) remaining.push(g); });
            this._lifted = remaining.length > 0 ? remaining : null;
        } finally {
            if (gen === this._gen) {
                this._busy = false;
                this.boardView?.resortGemLayer();
            }
        }
    }

    private async placeGem(gem: GemInstance, targetRegion: 0 | 1, targetGrid: number, startDelay = 0): Promise<boolean> {
        const gen = this._gen;
        const node = this.boardView!.getGemNode(gem.region, gem.grid);
        if (!node) return false;
        const from = node.position.clone();
        const to = new Vec3();
        if (targetRegion === 0) this.boardView!.getPatternCellPosition(targetGrid, to);
        else this.boardView!.getTrayCellPosition(targetGrid, to);

        // 平滑尺寸过渡：飞入暂存区变大、飞回棋盘变小（先换尺寸，用 scale 过渡）
        const ut = node.getComponent(UITransform);
        const oldSize = ut ? ut.width : GameConst.PATTERN_GEM_SIZE;
        const targetSize = targetRegion === 0 ? GameConst.PATTERN_GEM_SIZE : GameConst.TRAY_GEM_SIZE;
        let startScale = 1;
        if (ut && Math.abs(oldSize - targetSize) > 1) {
            startScale = oldSize / targetSize;
            ut.setContentSize(targetSize, targetSize);
            node.setScale(startScale, startScale, 1);
        }

        await this._flySystem.fly(node, from, to, startDelay, GameConst.FLY_DURATION, startScale);
        if (gen !== this._gen) return false; // 关卡已重置，节点可能已销毁
        // 防御：目标格已被其他球占用 → 放弃本次落位，球保留原位悬浮
        const existing = this._gems.get(this.key(targetRegion, targetGrid));
        if (existing && existing !== gem) {
            console.warn(`[Director] placeGem 目标被占用 region=${targetRegion} grid=${targetGrid}，放弃`);
            return false;
        }
        // 每颗球填入/存入时播放音效
        this._audio?.play(targetRegion === 0 ? GemAudioKey.OthregionPlaceSingle : GemAudioKey.StorePlace);

        this._gems.delete(this.key(gem.region, gem.grid));
        if (gem.region === 0) {
            const r = Math.floor(gem.grid / this._level!.pattern[0].length);
            const c = gem.grid % this._level!.pattern[0].length;
            this._level!.pattern[r][c].gemColor = GemColor.None;
            this.boardView!.unmapPatternGem(gem.grid);
        } else {
            const r = Math.floor(gem.grid / this._level!.trayCols);
            const c = gem.grid % this._level!.trayCols;
            this._level!.tray[r][c].gemColor = GemColor.None;
            this.boardView!.unmapTrayGem(gem.grid);
        }
        gem.region = targetRegion;
        gem.grid = targetGrid;
        this._gems.set(this.key(gem.region, gem.grid), gem);
        if (targetRegion === 0) {
            const r = Math.floor(targetGrid / this._level!.pattern[0].length);
            const c = targetGrid % this._level!.pattern[0].length;
            this._level!.pattern[r][c].gemColor = gem.color;
            const slot = this.boardView!.getPatternSlotNode(targetGrid);
            if (slot) this.boardView!.moveGemNodeToParent(node, slot, to);
            this.boardView!.mapPatternGem(targetGrid, node);
        } else {
            const r = Math.floor(targetGrid / this._level!.trayCols);
            const c = targetGrid % this._level!.trayCols;
            this._level!.tray[r][c].gemColor = gem.color;
            const slot = this.boardView!.getTraySlotNode(targetGrid);
            if (slot) this.boardView!.moveGemNodeToParent(node, slot, to);
            this.boardView!.mapTrayGem(targetGrid, node);
        }
        // 落位后按目标区域切换尺寸（暂存区=孔位大，图案区=小球）
        this.boardView!.setGemSize(node, targetRegion === 0 ? GameConst.PATTERN_GEM_SIZE : GameConst.TRAY_GEM_SIZE);
        // 归位状态：图案区且颜色匹配凹槽目标色 → Correct 锁定；否则 Idle
        let isCorrect = false;
        if (targetRegion === 0) {
            const cols = this._level!.pattern[0].length;
            const rr = Math.floor(targetGrid / cols);
            const cc = targetGrid % cols;
            isCorrect = this._level!.pattern[rr][cc].baseColor === gem.color;
        }
        node.getComponent(GemElementView)?.setState(isCorrect ? GemViewState.Correct : GemViewState.Idle);
        this._effectSystem?.playSmallSweep(node.worldPosition);
        return true;
    }

    /** 暂存区紧凑：取出球后（含悬浮中未飞完的球），剩余球按行优先前移补位，保证从左上角连续无空洞 */
    private compactTray(): void {
        const level = this._level!;
        if (!level) return;
        this.reconcileTray(); // 先自愈再紧凑，避免幽灵球被遗漏/错位
        const tc = level.trayCols;
        // 按行优先收集暂存区现有球
        const order: GemInstance[] = [];
        for (let r = 0; r < level.trayRows; r++) {
            for (let c = 0; c < tc; c++) {
                if (level.tray[r][c].gemColor >= 0) {
                    const idx = r * tc + c;
                    const gem = this._gems.get(this.key(1, idx));
                    if (gem) order.push(gem);
                }
            }
        }
        // 已紧凑则跳过
        let needCompact = false;
        for (let i = 0; i < order.length; i++) {
            if (order[i].grid !== i) { needCompact = true; break; }
        }
        if (!needCompact) return;

        // 清空暂存区数据
        for (const row of level.tray) for (const cell of row) cell.gemColor = -1;

        // 重排：球前移到前 n 个位置
        order.forEach((gem, i) => {
            const oldGrid = gem.grid;
            const node = this.boardView!.getGemNode(1, oldGrid);
            this._gems.delete(this.key(1, oldGrid));
            this.boardView!.unmapTrayGem(oldGrid);
            gem.grid = i;
            gem.region = 1;
            this._gems.set(this.key(1, i), gem);
            const r = Math.floor(i / tc);
            const c = i % tc;
            level.tray[r][c].gemColor = gem.color;
            if (!node) return;
            const isLifted = node.getComponent(GemElementView)?.state === GemViewState.Lifted;
            const pos = new Vec3();
            this.boardView!.getTrayCellPosition(i, pos);
            if (isLifted) {
                // 悬浮中的球：保持选中状态，滑动到新的暂存位置
                pos.y += GameConst.ITEM_LIFT_HEIGHT;
                tween(node).to(0.12, { position: pos }).start();
                this.boardView!.mapTrayGem(i, node);
            } else {
                const slot = this.boardView!.getTraySlotNode(i);
                if (slot) this.boardView!.moveGemNodeToParent(node, slot, pos);
                this.boardView!.mapTrayGem(i, node);
                this.boardView!.setGemSize(node, GameConst.TRAY_GEM_SIZE);
                node.getComponent(GemElementView)?.setState(GemViewState.Idle);
            }
        });
        this.boardView?.resortGemLayer();
    }

    /** 暂存区状态自愈：以 level.tray + _gems + 节点三方交叉校验，消除幽灵球/重叠/错位 */
    private reconcileTray(): void {
        const level = this._level;
        if (!level || !this.boardView) return;
        const tc = level.trayCols;
        const total = level.trayRows * tc;
        let fixed = 0;

        // 1. 按格子校验：数据/节点/格子三方一致
        for (let grid = 0; grid < total; grid++) {
            const cell = level.tray[Math.floor(grid / tc)][grid % tc];
            const gem = this._gems.get(this.key(1, grid));
            const node = this.boardView.getGemNode(1, grid);
            if (gem && cell.gemColor !== gem.color) { cell.gemColor = gem.color; fixed++; } // 格子数据丢失 → 恢复
            if (node && gem && node.getComponent(GemElementView)?.color !== gem.color) {
                // 节点颜色与数据不符 → 幽灵节点，销毁后由下方重建
                this.boardView.unmapTrayGem(grid);
                node.destroy();
                fixed++;
                continue;
            }
            if (node && !gem) {
                // 有节点无数据 → 视觉幽灵，销毁（这类球点击会“无反应”）
                this.boardView.unmapTrayGem(grid);
                node.destroy();
                fixed++;
                continue;
            }
            if (!node && gem) {
                // 有数据无节点 → 重建可见球（修复“小球消失”）
                this.rebuildTrayGem(gem, grid);
                fixed++;
                continue;
            }
            if (!node && !gem && cell.gemColor >= 0) {
                // 只有格子残留颜色（数据/节点都丢失）→ 清空，避免误以为还有球
                cell.gemColor = -1;
                fixed++;
            }
        }
        // 2. 清理越界/孤立数据条目，并兜底补节点
        for (const [k, gem] of this._gems) {
            if (gem.region !== 1) continue;
            if (gem.grid < 0 || gem.grid >= total) { this._gems.delete(k); fixed++; continue; }
            const cell = level.tray[Math.floor(gem.grid / tc)][gem.grid % tc];
            if (cell.gemColor !== gem.color) { cell.gemColor = gem.color; fixed++; }
            if (!this.boardView.getGemNode(1, gem.grid)) { this.rebuildTrayGem(gem, gem.grid); fixed++; }
        }
        // 3. 清扫历史遗留的孤儿节点（不在任何映射表里却残留在场景中，点击会 region=undefined）
        const orphans = this.boardView.destroyOrphanGems();
        if (orphans > 0) {
            fixed += orphans;
            console.warn(`[Tray] 清理孤儿宝石节点 x${orphans}`);
        }
        if (fixed > 0) console.warn(`[Tray] 自愈暂存区不一致 x${fixed}`);
        this.boardView.resortGemLayer();
    }

    /** 按数据重建暂存区宝石节点（贴图/点击/映射一次到位） */
    private rebuildTrayGem(gem: GemInstance, grid: number): void {
        const bv = this.boardView!;
        if (bv.getGemNode(1, grid)) return;
        const node = bv.createGemNode(gem.color, grid, 1);
        bv.gemLayer?.addChild(node);
        const pos = new Vec3();
        bv.getTrayCellPosition(grid, pos);
        node.setPosition(pos.x, pos.y, 0);
        bv.mapTrayGem(grid, node);
        bv.setGemSize(node, GameConst.TRAY_GEM_SIZE);
    }

    /** 卡死恢复后：所有球按当前数据回到格子位置并复位状态 */
    private resetAllGemStates(): void {
        const bv = this.boardView;
        if (!bv) return;
        for (const [, gem] of this._gems) {
            const node = bv.getGemNode(gem.region, gem.grid);
            if (!node) continue;
            const pos = new Vec3();
            if (gem.region === 0) bv.getPatternCellPosition(gem.grid, pos);
            else bv.getTrayCellPosition(gem.grid, pos);
            node.setPosition(pos.x, pos.y, 0);
            node.setScale(1, 1, 1);
            node.getComponent(GemElementView)?.setState(this.isGemCorrect(gem) ? GemViewState.Correct : GemViewState.Idle);
        }
        bv.resortGemLayer();
    }
    /** 颜色填满：该颜色所有已归位小球同时播放归位扫光 */
    private checkColorDone(): void {
        const level = this._level!;
        const total: number[] = [];
        const done: number[] = [];
        for (const row of level.pattern) {
            for (const cell of row) {
                if (cell.baseColor < 0) continue;
                total[cell.baseColor] = (total[cell.baseColor] ?? 0) + 1;
                if (cell.gemColor === cell.baseColor) done[cell.baseColor] = (done[cell.baseColor] ?? 0) + 1;
            }
        }
        for (let c = 0; c < total.length; c++) {
            if (total[c] > 0 && done[c] === total[c] && !this._tippedColors.has(c)) {
                this._tippedColors.add(c);
                this.sweepColorGems(c); // 该颜色所有小球同时扫光
                // tip 飘图（title 下方居中）与小球扫光同时出现
                const pos = new Vec3(0, GameConst.PATTERN_Y + GameConst.PATTERN_TILE * (GameConst.BOARD_ROWS - 1) / 2 + 35, 0);
                this._effectSystem?.playColorDoneTip(pos);
                this._audio?.play(GemAudioKey.Tip);
                break;
            }
        }
    }

    /** 指定颜色的所有已归位小球同时播放小扫光（批量绘制，避免每球一节点卡顿） */
    private sweepColorGems(color: number): void {
        const level = this._level!;
        const cols = level.pattern[0].length;
        const nodes: Node[] = [];
        for (let r = 0; r < level.pattern.length; r++) {
            for (let c = 0; c < cols; c++) {
                const cell = level.pattern[r][c];
                if (cell.baseColor !== color || cell.gemColor !== color) continue;
                const node = this.boardView?.getGemNode(0, r * cols + c);
                if (node) nodes.push(node);
            }
        }
        this._effectSystem?.playSweepsOnGems(nodes);
    }

    private checkWin(): void {
        const level = this._level!;
        let total = 0, correct = 0;
        level.pattern.forEach((row) => {
            row.forEach((cell) => {
                if (cell.baseColor < 0) return;
                total++;
                if (cell.gemColor === cell.baseColor) correct++;
            });
        });
        if (total > 0 && correct === total) {
            this._busy = true;
            // 通关：所有小球同时播放归位扫光（批量绘制，避免卡顿）
            const cols = level.pattern[0].length;
            const nodes: Node[] = [];
            for (let r = 0; r < level.pattern.length; r++) {
                for (let c = 0; c < cols; c++) {
                    const cell = level.pattern[r][c];
                    if (cell.baseColor < 0 || cell.gemColor !== cell.baseColor) continue;
                    const node = this.boardView?.getGemNode(0, r * cols + c);
                    if (node) nodes.push(node);
                }
            }
            this._effectSystem?.playWinWaveSweep(nodes); // 左上→右下波次扫光，约 1.5s
            this._audio?.play(GemAudioKey.Tip); // 通关播放 gem_tip
            this.onLevelComplete?.(1);
        }
    }
}