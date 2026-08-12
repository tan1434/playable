import {
    _decorator, Component, Node, UITransform, tween, Vec3, Layers, Sprite,
} from 'cc';
import { BoardView } from '../board/BoardView';
import { GuideConfigData, GuideStep } from '../core/GameConfig';
import { ResourceStore } from '../utils/ResourceStore';
import { GameConst } from '../core/GameConst';

const { ccclass, property } = _decorator;

/**
 * 新手引导
 * - 手指：缩放 + x/y 位移；可配置“先指某格、再按到目标格”（如先指上方白球、下移一格点黄球）
 * - 引导期间：interactionGate 只放行“目标球同色八方向联通组”（或目标为空时的同底空格）
 */
@ccclass('GuideController')
export class GuideController extends Component {
    @property(Node)
    guideLayer: Node | null = null;

    private static readonly TIP_FIX = new Vec3(37, -50, 0);

    private _steps: NonNullable<GuideConfigData['steps']> = [];
    private _boardView: BoardView | null = null;
    private _currentTarget: { region: 0 | 1; grid: number } | null = null;
    private _fingerPath: number[] = [];
    /** 导演层忙碌检测器（busy=true 表示飞行动作未完成） */
    private _busyChecker: (() => boolean) | null = null;
    /** 步骤已推进、但手指等待异步动作（飞行）完成后再显示 */
    private _pendingShow = false;

    startGuide(cfg: GuideConfigData, boardView: BoardView, busyChecker?: () => boolean): void {
        this._boardView = boardView;
        this._busyChecker = busyChecker ?? null;
        this._steps = cfg.enabled ? (cfg.steps ?? []) : [];
        this._currentTarget = null;
        this._fingerPath = [];
        this._pendingShow = false;
        if (this._steps.length === 0) { this.hide(); return; }
        this.showStep();
    }

    update(): void {
        // 异步动作完成（导演层不再 busy）后，才显示下一步的手指
        if (this._pendingShow && this._busyChecker && !this._busyChecker()) {
            this._pendingShow = false;
            console.log('[Guide] 异步动作完成，显示下一步手指');
            this.showStep();
        }
    }

    /** 交互门禁：只允许点击目标球同色联通组（或目标为空时的同底空格） */
    isClickAllowed(region: 0 | 1, grid: number): boolean {
        const step = this._steps[0];
        if (!step) return true;
        if (region !== (step.region ?? 0)) return false;
        // 暂存区整体可点
        if (region === 1) return true;
        const target = this._currentTarget?.grid ?? step.grid;
        if (target == null || target < 0) return false;
        const group = this.collectConnectedGroup(target);
        if (group.size > 0) return group.has(grid);
        // 目标格已空（填入步骤）：允许点击同底色的空格
        const level = this._boardView?.level;
        if (!level) return false;
        const cols = level.pattern[0].length;
        const tr = Math.floor(target / cols), tc = target % cols;
        const tcell = level.pattern[tr]?.[tc];
        if (!tcell || tcell.baseColor < 0) return false;
        const r = Math.floor(grid / cols), c = grid % cols;
        const cell = level.pattern[r]?.[c];
        return !!cell && cell.baseColor === tcell.baseColor && cell.gemColor < 0;
    }

    /** 由导演层在玩家点击宝石/空格子且动作生效后回调，驱动步骤推进 */
    onInteraction(region: 0 | 1, grid: number): void {
        const step = this._steps[0];
        if (!step) return;
        if (this._currentTarget && !this.isClickAllowed(region, grid)) return;
        // 推进步骤：当前手指立刻消失；下一步手指等动作（悬浮/飞行）完成后再显示
        this._steps.shift();
        this._currentTarget = null;
        this._fingerPath = [];
        (this.guideLayer ?? this.node).removeAllChildren(); // 点击瞬间清掉当前手指
        console.log(`[Guide] onInteraction region=${region} grid=${grid} 剩余=${this._steps.length} 步`);
        if (this._steps.length > 0) {
            if (this._busyChecker && !this._busyChecker()) {
                this._pendingShow = true;
                console.log('[Guide] 动作进行中，等待完成');
            } else {
                this._pendingShow = false;
                this.showStep();
            }
        } else {
            this.hide();
        }
    }

    private showStep(): void {
        const layer = this.guideLayer ?? this.node;
        layer.active = true;
        layer.removeAllChildren();
        const step = this._steps[0];
        this._currentTarget = this.resolveTarget(step);
        // 手指坐标统一转引导层本地系，避免世界/本地混用导致偏移
        const toLocal = this.cellWorldToLocal(this._currentTarget?.grid, this._currentTarget?.region ?? 0);
        console.log(`[Guide] showStep step=${this._currentTarget?.region ?? 0}:${this._currentTarget?.grid ?? -1} toLocal=${toLocal ? 'OK' : 'NULL'} finger=${!!ResourceStore.fingerFrame}`);
        const pathLocals: Vec3[] = this._fingerPath.map((g) => this.cellWorldToLocal(g, 0)).filter((v) => v !== null) as Vec3[];

        if (toLocal && ResourceStore.fingerFrame) {
            const finger = new Node('GuideFinger');
            finger.layer = Layers.Enum.UI_2D;
            finger.addComponent(UITransform).setContentSize(120, 120);
            const sp = finger.addComponent(Sprite);
            sp.sizeMode = Sprite.SizeMode.CUSTOM;
            sp.spriteFrame = ResourceStore.fingerFrame;
            layer.addChild(finger);
            // 棋盘步骤：手指整体上移一格（指尖在目标球上方）
            const base = pathLocals.length > 0
                ? pathLocals[0]
                : (this._currentTarget?.region === 0 ? toLocal.clone().add(new Vec3(0, GameConst.PATTERN_TILE - 10, 0)) : toLocal);
            finger.setPosition(base.x, base.y, 0);
            const tw = tween(finger);
            if (pathLocals.length > 1) {
                // 依次经过路径各格（如 绿→白→黄→白→绿），指尖精确落格
                const stops = pathLocals.concat(pathLocals.slice(1, -1).reverse());
                stops.push(pathLocals[0]);
                for (const p of stops) {
                    tw.to(0.18, { position: p, scale: new Vec3(0.92, 0.92, 1) }, { easing: 'sineInOut' });
                }
            } else {
                // 无路径：目标格上轻微下按
                const press = base.clone().add(new Vec3(6, -9, 0)); // 往右下方轻按再回去（减小幅度）
                tw.to(0.26, { position: press, scale: new Vec3(0.86, 0.86, 1) }, { easing: 'sineInOut' })
                    .to(0.26, { position: base, scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' });
            }
            tw.delay(0.22).union().repeatForever().start();
        }

    }

    private resolveTarget(step: GuideStep): { region: 0 | 1; grid: number } | null {
        if (step.grid < 0 || step.grid == null) return null;
        const region = step.region ?? 0;
        this._fingerPath = [];
        const cols = this._boardView?.level?.pattern[0].length ?? 21;
        if (region === 0 && step.fingerPath && step.fingerPath.length > 0) {
            for (const [r, c] of step.fingerPath) this._fingerPath.push(r * cols + c);
        } else if (region === 0 && step.fingerRow != null && step.fingerCol != null) {
            this._fingerPath.push(step.fingerRow * cols + step.fingerCol);
        }
        return { region, grid: step.grid };
    }

    /** 格子世界坐标 + 指尖偏移 → 引导层本地坐标 */
    private cellWorldToLocal(grid: number | undefined, region: 0 | 1): Vec3 | null {
        if (grid == null || grid < 0) return null;
        const node = region === 0
            ? this._boardView?.getPatternSlotNode(grid)
            : this._boardView?.getTraySlotNode(grid);
        if (!node) return null;
        const w = node.worldPosition.clone().add(GuideController.TIP_FIX);
        const ut = (this.guideLayer ?? this.node).getComponent(UITransform);
        return ut ? ut.convertToNodeSpaceAR(w) : w;
    }

    /** 目标球同色八方向联通组 */
    private collectConnectedGroup(startGrid: number): Set<number> {
        const level = this._boardView?.level;
        const set = new Set<number>();
        if (!level) return set;
        const cols = level.pattern[0].length;
        const rows = level.pattern.length;
        const sr = Math.floor(startGrid / cols), sc = startGrid % cols;
        const cell = level.pattern[sr]?.[sc];
        if (!cell || cell.gemColor < 0) return set;
        const color = cell.gemColor;
        const visited = new Set<number>([startGrid]);
        const queue = [startGrid];
        while (queue.length > 0) {
            const cur = queue.shift()!;
            set.add(cur);
            const cr = Math.floor(cur / cols), cc = cur % cols;
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    if (dr === 0 && dc === 0) continue;
                    const nr = cr + dr, nc = cc + dc;
                    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
                    const nidx = nr * cols + nc;
                    if (visited.has(nidx)) continue;
                    const ncell = level.pattern[nr]?.[nc];
                    if (ncell && ncell.gemColor === color) {
                        visited.add(nidx);
                        queue.push(nidx);
                    }
                }
            }
        }
        return set;
    }

    /** 通关后：手指指向 url 按钮提示下载（清空引导队列，不再锁点击） */
    showDownloadHint(target: Node | null): void {
        this._steps = [];
        this._currentTarget = null;
        this._pendingShow = false;
        const layer = this.guideLayer ?? this.node;
        layer.active = true;
        layer.removeAllChildren();
        const ut = layer.getComponent(UITransform);
        const wp = target ? target.worldPosition.clone() : new Vec3(0, -860, 0);
        const local = ut ? ut.convertToNodeSpaceAR(wp.clone().add(GuideController.TIP_FIX)) : wp.clone().add(GuideController.TIP_FIX);
        if (ResourceStore.fingerFrame) {
            const finger = new Node('GuideFinger');
            finger.layer = Layers.Enum.UI_2D;
            finger.addComponent(UITransform).setContentSize(120, 120);
            const sp = finger.addComponent(Sprite);
            sp.sizeMode = Sprite.SizeMode.CUSTOM;
            sp.spriteFrame = ResourceStore.fingerFrame;
            layer.addChild(finger);
            finger.setPosition(local.x, local.y, 0);
            const base = local.clone();
            const press = base.clone().add(new Vec3(6, -9, 0));
            tween(finger)
                .to(0.26, { position: press, scale: new Vec3(0.88, 0.88, 1) }, { easing: 'sineInOut' })
                .to(0.26, { position: base, scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' })
                .delay(0.3)
                .union()
                .repeatForever()
                .start();
        }
    }

    hide(): void {
        this._pendingShow = false;
        if (this.guideLayer) this.guideLayer.active = false;
    }
}