import { Node, Graphics, Color, UITransform, tween, Vec3, Layers, Sprite } from 'cc';
import { ResourceStore } from '../utils/ResourceStore';
import { GameConst } from '../core/GameConst';

/**
 * 特效系统：单颗小球归位扫光（左上→右下的斜光带，约束在球尺寸内）。
 * 颜色完成/通关时对每个小球同时播放。
 */
export class EffectSystem {
    constructor(private _layer: Node) {}

    /** 颜色填满提示：tip 图从棋盘上方由小变大再缩回去 */
    playColorDoneTip(worldPos: Vec3): void {
        if (!ResourceStore.tipFrame) return;
        const fx = new Node('ColorDoneTip');
        fx.layer = Layers.Enum.UI_2D;
        fx.addComponent(UITransform).setContentSize(372, 102);
        const sp = fx.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.spriteFrame = ResourceStore.tipFrame;
        this._layer.addChild(fx);
        fx.setPosition(worldPos.x, worldPos.y, 0); // 棋盘本地坐标，保持居中
        fx.setScale(0.15, 0.15, 1);
        tween(fx)
            .to(0.18, { scale: new Vec3(0.85, 0.85, 1) }, { easing: 'backOut' })
            .to(0.1, { scale: new Vec3(0.8, 0.8, 1) })
            .delay(0.8)
            .to(0.18, { scale: new Vec3(0.2, 0.2, 1) }, { easing: 'quadIn' })
            .call(() => fx.destroy())
            .start();
    }

    /** 批量扫光：单个 Graphics 节点同时为多个小球绘制扫光（避免每球一个节点导致卡顿） */
    playSweepsOnGems(gemNodes: Node[]): void {
        if (gemNodes.length === 0) return;
        const size = GameConst.PATTERN_GEM_SIZE;
        const fx = new Node('SweepBatch');
        fx.layer = Layers.Enum.UI_2D;
        fx.addComponent(UITransform).setContentSize(1, 1);
        this._layer.addChild(fx);
        // 效应层与宝石层同原点：直接用 gem 节点的本地坐标
        const points: Vec3[] = [];
        for (const n of gemNodes) {
            if (!n.isValid) continue;
            points.push(new Vec3(n.position.x, n.position.y, 0));
        }
        if (points.length === 0) { fx.destroy(); return; }

        const g = fx.addComponent(Graphics);
        const bandH = size * 0.28;   // 光带半宽
        const span = size * 0.55;    // 扫过范围
        const tilt = size * 0.35;    // 斜度（左上→右下）
        const draw = (ox: number) => {
            g.clear();
            g.fillColor = new Color(255, 255, 255, 110);
            for (const p of points) {
                g.moveTo(p.x + ox - bandH, p.y - span);
                g.lineTo(p.x + ox + bandH, p.y - span + tilt);
                g.lineTo(p.x + ox + bandH, p.y + span + tilt);
                g.lineTo(p.x + ox - bandH, p.y + span);
                g.close();
            }
            g.fill();
        };
        draw(-span);
        const state = { x: -span };
        tween(state)
            .to(0.18, { x: span }, { easing: 'sineInOut', onUpdate: () => draw(state.x) })
            .call(() => fx.destroy())
            .start();
    }

    /** 通关扫光：从左上角小球开始，沿对角线向右下角扩散（波次），总时长约 1.5s */
    playWinWaveSweep(gemNodes: Node[]): void {
        if (gemNodes.length === 0) return;
        const size = GameConst.PATTERN_GEM_SIZE;
        const fx = new Node('SweepWave');
        fx.layer = Layers.Enum.UI_2D;
        fx.addComponent(UITransform).setContentSize(1, 1);
        this._layer.addChild(fx);

        // 收集小球本地坐标并计算左上→右下的波次参数
        const pts: { x: number; y: number; wave: number }[] = [];
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const n of gemNodes) {
            if (!n.isValid) continue;
            const x = n.position.x, y = n.position.y;
            pts.push({ x, y, wave: 0 });
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
        if (pts.length === 0) { fx.destroy(); return; }
        const spanX = Math.max(maxX - minX, 1);
        const spanY = Math.max(maxY - minY, 1);
        for (const p of pts) {
            // 左上角 wave=0，右下角 wave=1
            const wx = (p.x - minX) / spanX;
            const wy = (maxY - p.y) / spanY;
            p.wave = Math.max(0, Math.min(1, (wx + wy) / 2));
        }

        const g = fx.addComponent(Graphics);
        const bandH = size * 0.28;   // 光带半宽
        const bandSpan = size * 0.55; // 扫过范围
        const tilt = size * 0.35;    // 斜度（左上→右下）
        const sweepTime = 0.22;      // 每颗球自身扫光时长
        const total = 1.5;           // 总过程
        const waveTime = total - sweepTime; // 波次铺开时长
        const ease = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2; // easeInOutSine
        const draw = (t: number) => {
            g.clear();
            g.fillColor = new Color(255, 255, 255, 110);
            for (const p of pts) {
                const start = p.wave * waveTime;
                const pLocal = (t - start) / sweepTime;
                if (pLocal <= 0 || pLocal >= 1) continue; // 还没轮到或已扫完
                const ox = -bandSpan + 2 * bandSpan * ease(pLocal);
                g.moveTo(p.x + ox - bandH, p.y - bandSpan);
                g.lineTo(p.x + ox + bandH, p.y - bandSpan + tilt);
                g.lineTo(p.x + ox + bandH, p.y + bandSpan + tilt);
                g.lineTo(p.x + ox - bandH, p.y + bandSpan);
                g.close();
            }
            g.fill();
        };
        draw(0);
        const state = { t: 0 };
        tween(state)
            .to(total, { t: 1 }, { easing: 'linear', onUpdate: () => draw(state.t * total) })
            .call(() => fx.destroy())
            .start();
    }

    /** 单颗小球归位扫光：尺寸约束在球大小内，斜光带从左上方扫向右下方 */
    playSmallSweep(worldPos: Vec3): void {
        const size = GameConst.PATTERN_GEM_SIZE; // 小球尺寸
        const fx = new Node('SweepSmall');
        fx.layer = Layers.Enum.UI_2D;
        fx.addComponent(UITransform).setContentSize(size, size);
        this._layer.addChild(fx);
        fx.setWorldPosition(worldPos);

        const g = fx.addComponent(Graphics);
        const bandH = size * 0.28;   // 光带半宽
        const span = size * 0.55;    // 扫过范围
        const tilt = size * 0.35;    // 斜度（左上→右下）
        const draw = (x: number) => {
            g.clear();
            g.fillColor = new Color(255, 255, 255, 110);
            g.moveTo(x - bandH, -span);
            g.lineTo(x + bandH, -span + tilt);
            g.lineTo(x + bandH, span + tilt);
            g.lineTo(x - bandH, span);
            g.close();
            g.fill();
        };
        const state = { x: -span };
        draw(state.x);
        tween(state)
            .to(0.18, { x: span }, { easing: 'sineInOut', onUpdate: () => draw(state.x) })
            .call(() => fx.destroy())
            .start();
    }
}