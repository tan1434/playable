/** 关卡数据结构（Jewel Coloring）：
 * 使用二维数组定义图案区（[row][col]）和暂存区（[row][col]）
 */

export interface PatternCell {
    /** 凹槽目标色，-1 = 无凹槽（图案外） */
    baseColor: number;
    /** 当前宝石颜色，-1 = 空位 */
    gemColor: number;
}

export interface TrayCell {
    /** 当前宝石颜色，-1 = 空位 */
    gemColor: number;
}

export interface LevelData {
    name: string;
    /** 图案区：二维 [row][col] */
    pattern: PatternCell[][];
    /** 暂存区：二维 [row][col] */
    tray: TrayCell[][];
    /** 托盘列数/行数 */
    trayCols: number;
    trayRows: number;
}