export const GameConst = {
    /** 设计分辨率（竖屏 1080×1920，对齐参考 Playable） */
    DESIGN_WIDTH: 1080,
    DESIGN_HEIGHT: 1920,

    /** 总棋盘：21 列 × 33 行，格 36×36（底纹与小球同尺寸，紧密排列无缝隙，1.2 倍放大） */
    BOARD_COLS: 21,
    BOARD_ROWS: 33,
    PATTERN_TILE: 36,
    PATTERN_GEM_SIZE: 36,

    /** 暂存区：托盘图 970×365，孔位区 922×317（四周留白 20，1.2 倍放大）
     *  14 列 × 5 行，孔 48×48，孔间距 (922-48)/13 = 67.2（孔间空隙 19.2） */
    TRAY_COLS: 14,
    TRAY_ROWS: 5,
    TRAY_IMAGE_W: 970,
    TRAY_IMAGE_H: 365,
    TRAY_REGION_W: 922,
    TRAY_REGION_H: 317,
    TRAY_TILE: 48,
    TRAY_PITCH: 67.2,
    TRAY_GEM_SIZE: 43, // 暂存区球稍小于孔位（48），明显大于棋盘球（36）

    /** 图案区 / 托盘 相对屏幕中心的 Y 偏移（图案区居中偏上、托盘贴底） */
    PATTERN_Y: 232,
    TRAY_Y: -580, // 暂存区上移，给底部 url 图片腾空间

    /** 悬浮抬升高度 */
    ITEM_LIFT_HEIGHT: 12,
    FLY_DURATION: 0.12, // 单颗飞行时长（加快）
    /** 一串拉出：相邻两颗经过通道点的错峰间隔 */
    FLOW_STAGGER: 0.06, // 错峰起飞间隔（更紧凑）
    LEVEL_RANGE_MIN: 1,
    LEVEL_RANGE_MAX: 10,
} as const;