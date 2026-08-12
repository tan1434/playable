import { Node, Vec3 } from 'cc';
import { GameConst } from '../core/GameConst';

/**
 * 飞行系统：参考 Playable 同款逐帧采样方案（不用 tween 分段拼接，避免速度突变）
 * - 每颗球注册一个飞行任务：startDelay 错峰起飞，单条 easeInOutSine 速度曲线，全程连续平滑
 * - 尺寸沿飞行路径从 startScale 平滑过渡到 1（进暂存区变大、回棋盘变小）
 * - 由 BSGameDirector.update 每帧驱动，先出先落位由系统时间精确保证
 */
interface FlyTask {
    node: Node;
    from: Vec3;
    to: Vec3;
    ctrl: Vec3;
    startTime: number;
    duration: number;
    startScale: number;
    resolve: () => void;
}

export class FlySystem {
    private _tasks: FlyTask[] = [];
    private _now = 0;

    clear(): void {
        // 清空时先 resolve 所有未完成飞行，避免调用方 Promise.all 永久挂起
        for (const t of this._tasks) t.resolve();
        this._tasks.length = 0;
    }
    taskCount(): number { return this._tasks.length; }

    /** 强制结束所有飞行任务（节点回到起点，供卡死恢复使用） */
    failAll(): void {
        for (const t of this._tasks) {
            t.node.setPosition(t.from.x, t.from.y, 0);
            t.node.setScale(1, 1, 1);
            t.resolve();
        }
        this._tasks.length = 0;
    }

    update(deltaTime: number): void {
        this._now += deltaTime;
        for (let i = this._tasks.length - 1; i >= 0; i--) {
            const t = this._tasks[i];
            const p = (this._now - t.startTime) / t.duration;
            if (p >= 1) {
                t.node.setPosition(t.to.x, t.to.y, 0);
                t.node.setScale(1, 1, 1);
                const resolve = t.resolve;
                this._tasks.splice(i, 1);
                resolve();
                continue;
            }
            if (p <= 0) continue;
            const e = this.easeInOutSine(p);
            const inv = 1 - e;
            const x = inv * inv * t.from.x + 2 * inv * e * t.ctrl.x + e * e * t.to.x;
            const y = inv * inv * t.from.y + 2 * inv * e * t.ctrl.y + e * e * t.to.y;
            t.node.setPosition(x, y, 0);
            const s = t.startScale + (1 - t.startScale) * e;
            t.node.setScale(s, s, 1);
        }
    }

    fly(node: Node, from: Vec3, to: Vec3, startDelay = 0, duration = GameConst.FLY_DURATION, startScale = 1): Promise<void> {
        return new Promise((resolve) => {
            const ctrl = new Vec3((from.x + to.x) / 2, Math.max(from.y, to.y) + 30, 0);
            this._tasks.push({ node, from, to, ctrl, startTime: this._now + startDelay, duration, startScale, resolve });
        });
    }

    private easeInOutSine(t: number): number {
        return -(Math.cos(Math.PI * t) - 1) / 2;
    }
}