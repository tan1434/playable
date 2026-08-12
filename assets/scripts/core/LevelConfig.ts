import { resources, JsonAsset } from 'cc';
import { LevelData, PatternCell, TrayCell } from './LevelData';
import { GameConst } from './GameConst';

/**
 * 关卡配置（res/config/level/Level_{n}.json）
 * - baseGrid：21 列 × 33 行字符画，'-' = 图案外（无底图、无小球、不建节点），其余字符 = 对应颜色底图
 * - gemGrid：可选；'-' = 图案外，其余 = 初始小球；省略则自动随机全错位
 * 规则：有多少底图就有多少小球 —— 开局每个底图格都有球，图案外什么都没有
 * 字符 → 颜色：0=red 1=blue 2=green 3=yellow 4=purple 5=orange 6=pink 7=cyan
 *              8=gray 9=black a=brown b=burgundy c=emerald d=grassgreen e=lavender
 *              f=magenta g=navy h=peach i=sand j=skyblue k=white
 */
export interface LevelJson {
    name?: string;
    rows?: number;
    cols?: number;
    baseGrid?: string[];
    gemGrid?: string[];
}

/** 默认菠萝关卡（boluo1.png 量化结果，JSON 缺失时的兜底） */
export const DEFAULT_PINEAPPLE_GRID: string[] = [
    '---------kkk---------',
    '--------kk9kk--------',
    '----kkkkk9d9kkkkk----',
    '---kk9dd9ddd9dd9kk---',
    '--kk9d9d9d2d9d9d9kk--',
    '--k9dd99d222d99dd9k--',
    '--k9ddd9222229ddd9k--',
    '--k9d22d92929d22d9k--',
    '--kk922dd9d9dd229kk--',
    '--kk9222d9d9d2229kkk-',
    'kk9992229ddd9222999kk',
    'k9ddd9229d2d9229ddd9k',
    'kk92dd929222929dd29kk',
    '-kk92d292222292d29kk-',
    '--kk9222999992229kk--',
    '---kk929a3a3a929kk---',
    '----kk9a3a3a3a9kk----',
    '----k9a3a3a3a3a9k----',
    '-kkkk93a3a3a3a39kkkk-',
    '-k77777773a37777777k-',
    '-kk79kk997779kk997kk-',
    '--k799kk997999kk97k--',
    '--k7999kk7a7999kk7k--',
    '--k979997a3a799979k--',
    '--k9a777a3a3a777a9k--',
    '--k93a3a3a3a3a3a39k--',
    '--k9a3a3a3a3a3a3a9k--',
    '--k93a3akk3kka3a39k--',
    '--k9a3a3a3k3a3a3a9k--',
    '--kk9a3a3a3a3a3a9kk--',
    '---kk993a3a3a399kk---',
    '----kkk9999999kkk----',
    '------kkkkkkkkk------',
];

export function charToColor(ch: string): number {
    if (ch === '-' || ch === '.' || ch === ' ') return -1; // 图案外
    if (ch >= '0' && ch <= '9') return ch.charCodeAt(0) - 48;
    const v = ch.charCodeAt(0) - 87;
    if (v >= 10 && v <= 20) return v;
    return -1; // 其余非法字符一律按图案外处理
}

export class LevelConfig {
    /** 从 res/config/level/Level_{index}.json 加载关卡；文件不存在返回 null */
    static async load(levelIndex: number): Promise<LevelData | null> {
        const json = await this.loadJson<LevelJson>(`res/config/level/Level_${levelIndex}`);
        if (!json || !json.baseGrid || json.baseGrid.length === 0) return null;
        return this.build(json, levelIndex);
    }

    /** 用默认菠萝网格生成兜底关卡（无 JSON 时） */
    static fallback(levelIndex: number): LevelData {
        return this.build({ name: `Level_${levelIndex}`, baseGrid: DEFAULT_PINEAPPLE_GRID }, levelIndex);
    }

    static build(json: LevelJson, levelIndex: number): LevelData {
        const grid = json.baseGrid!;
        const rows = grid.length;
        const cols = grid[0].length;
        const baseSeq: number[] = [];
        for (let r = 0; r < rows; r++) {
            const line = grid[r];
            for (let c = 0; c < cols; c++) baseSeq.push(charToColor(line[c]));
        }
        const gemSeq = this.resolveGemGrid(json, rows, cols, baseSeq);

        const pattern: PatternCell[][] = [];
        let gi = 0;
        for (let r = 0; r < rows; r++) {
            const prow: PatternCell[] = [];
            for (let c = 0; c < cols; c++) {
                prow.push({ baseColor: baseSeq[gi], gemColor: gemSeq[gi] });
                gi++;
            }
            pattern.push(prow);
        }

        const tray: TrayCell[][] = [];
        for (let r = 0; r < GameConst.TRAY_ROWS; r++) {
            const trow: TrayCell[] = [];
            for (let c = 0; c < GameConst.TRAY_COLS; c++) trow.push({ gemColor: -1 });
            tray.push(trow);
        }
        return {
            name: json.name ?? `Level_${levelIndex}`,
            pattern,
            tray,
            trayCols: GameConst.TRAY_COLS,
            trayRows: GameConst.TRAY_ROWS,
        };
    }

    /** 解析初始小球：gemGrid 可选。提供时必须与 baseGrid 形状一致（底图格全有球、图案外全无球），否则回退随机 */
    private static resolveGemGrid(json: LevelJson, rows: number, cols: number, baseSeq: number[]): number[] {
        const gemGrid = json.gemGrid;
        if (gemGrid && gemGrid.length === rows) {
            const seq: number[] = [];
            let valid = true;
            for (let r = 0; r < rows && valid; r++) {
                const line = gemGrid[r];
                if (line.length !== cols) { valid = false; break; }
                for (let c = 0; c < cols; c++) seq.push(charToColor(line[c]));
            }
            if (valid) {
                let shapeOk = true;
                for (let i = 0; i < baseSeq.length; i++) {
                    const isBase = baseSeq[i] >= 0;
                    const hasGem = seq[i] >= 0;
                    if (isBase !== hasGem) { shapeOk = false; break; }
                }
                if (shapeOk) return seq;
                console.warn('[LevelConfig] gemGrid 与 baseGrid 形状不一致（底图格必须有球、图案外必须无球），已回退随机全错位');
            }
        }
        return this.randomDeranged(baseSeq);
    }

    /** 随机全错位：只给底图格发球（数量 = 底图数量），图案外保持 -1，且小球颜色 ≠ 底图颜色 */
    static randomDeranged(baseSeq: number[]): number[] {
        const gemSeq = baseSeq.map(() => -1);
        const baseIdx: number[] = [];
        for (let i = 0; i < baseSeq.length; i++) if (baseSeq[i] >= 0) baseIdx.push(i);
        const colors = baseIdx.map((i) => baseSeq[i]);
        this.shuffle(colors);
        for (let i = 0; i < colors.length; i++) {
            if (colors[i] === baseSeq[baseIdx[i]]) {
                for (let j = i + 1; j < colors.length; j++) {
                    if (colors[j] !== baseSeq[baseIdx[i]] && colors[i] !== baseSeq[baseIdx[j]]) {
                        [colors[i], colors[j]] = [colors[j], colors[i]];
                        break;
                    }
                }
            }
        }
        const last = colors.length - 1;
        if (last >= 0 && colors[last] === baseSeq[baseIdx[last]]) {
            for (let j = 0; j < last; j++) {
                if (colors[j] !== baseSeq[baseIdx[last]] && colors[last] !== baseSeq[baseIdx[j]]) {
                    [colors[last], colors[j]] = [colors[j], colors[last]];
                    break;
                }
            }
        }
        for (let j = 0; j < baseIdx.length; j++) gemSeq[baseIdx[j]] = colors[j];
        return gemSeq;
    }

    private static shuffle<T>(arr: T[]): void {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
    }

    private static loadJson<T>(path: string): Promise<T | null> {
        return new Promise((resolve) => {
            resources.load(path, JsonAsset, (err, asset) => {
                if (err) { resolve(null); return; }
                resolve(asset.json as T);
            });
        });
    }
}