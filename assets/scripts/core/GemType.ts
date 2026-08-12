/**
 * 宝石颜色：使用用户素材的贴图命名（atlas/gams/xxxGem.png, atlas/bases/xxxBase.png）
 */
export enum GemColor {
    None = -1,
    Red = 0,
    Blue = 1,
    Green = 2,
    Yellow = 3,
    Purple = 4,
    Orange = 5,
    Pink = 6,
    Cyan = 7,
    Gray = 8,
    Black = 9,
    Brown = 10,
    Burgundy = 11,
    Emerald = 12,
    GrassGreen = 13,
    Lavender = 14,
    Magenta = 15,
    Navy = 16,
    Peach = 17,
    Sand = 18,
    SkyBlue = 19,
    White = 20,
}

/** 颜色 → 贴图文件名（atlas/gams/{name}Gem.png / atlas/bases/{name}Base.png） */
export const GEM_COLOR_NAMES: string[] = [
    'red', 'blue', 'green', 'yellow', 'purple', 'orange',
    'pink', 'cyan', 'gray', 'black', 'brown', 'burgundy',
    'emerald', 'grassgreen', 'lavender', 'magenta', 'navy',
    'peach', 'sand', 'skyblue', 'white',
];

export function gemColorName(color: number): string {
    if (color < 0 || color >= GEM_COLOR_NAMES.length) return 'gray';
    return GEM_COLOR_NAMES[color];
}

/** 单颗宝石运行时数据（以 region+grid 唯一定位） */
export interface GemInstance {
    color: number;
    /** 所在区域：0=图案区，1=暂存区 */
    region: 0 | 1;
    /** 所在格索引 */
    grid: number;
}