import { _decorator, Component, Vec3, tween, Tween, Node } from 'cc';
import { GameConst } from '../core/GameConst';

const { ccclass, property } = _decorator;

/** 宝石视图状态（三态）：空闲 / 悬浮选中 / 已归位锁定 */
export enum GemViewState {
    Idle = 0,
    Lifted = 1,
    Correct = 2,
}

/**
 * 宝石视图：三态状态机 + 动画
 * - Idle：静止
 * - Lifted：上浮（选中反馈）
 * - Correct：已归位锁定（轻微下沉 + 高亮），不可再点击
 */
@ccclass('GemElementView')
export class GemElementView extends Component {
    color = -1;
    private _state = GemViewState.Idle;
    private _tween: Tween<Node> | null = null;

    get state(): GemViewState { return this._state; }

    /** 切换状态（动画由视图自管，位置落位由导演控制） */
    setState(s: GemViewState): void {
        if (this._state === s) return;
        this._state = s;
        if (this._tween) { this._tween.stop(); this._tween = null; }

        if (s === GemViewState.Lifted) {
            // 仅悬浮上移，无呼吸/脉动
            this._tween = tween(this.node)
                .to(0.08, { position: new Vec3(this.node.position.x, this.node.position.y + GameConst.ITEM_LIFT_HEIGHT, 0) })
                .start();
        } else if (s === GemViewState.Correct) {
            this._tween = tween(this.node)
                .to(0.1, { scale: new Vec3(1.12, 1.12, 1) })
                .to(0.08, { scale: new Vec3(1.02, 1.02, 1) })
                .start();
        } else {
            // Idle：复位（位置由导演控制，这里只保证 scale）
            this._tween = tween(this.node)
                .to(0.08, { scale: new Vec3(1, 1, 1) })
                .start();
        }
    }

    onDestroy(): void {
        if (this._tween) this._tween.stop();
    }
}