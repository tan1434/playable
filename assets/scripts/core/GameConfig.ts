import { resources, JsonAsset, sys } from 'cc';
import { GameConst } from './GameConst';

/** 全局配置（对齐原版 res/config/game/GlobalConfig） */
export interface GlobalConfigData {
    /** 关卡范围 */
    levelRange: { min: number; max: number };
    /** 是否显示 Banner */
    showBanner?: boolean;
    /** 是否显示标题图 */
    showTitle?: boolean;
    /** 是否显示调试手指 */
    showDebugfinger?: boolean;
    /** 下载按钮 MD5 校验（广告平台保护，Demo 置空） */
    md5?: string;
    /** 胜利条件：完成进度百分比（0~1），默认 1 */
    winTargetProgressPercent?: number;
    /** 是否在胜利条件满足时直接结束（配合弹窗） */
    winLevelCondition?: string;
}

/** 新手引导配置（对齐原版 res/config/guide/GuideConfig） */
export interface GuideConfigData {
    enabled?: boolean;
    steps?: GuideStep[];
}

export interface GuideStep {
    /** 目标区域：0=图案区 1=暂存区（默认 0，auto 步骤无需填） */
    region?: 0 | 1;
    /** 目标格子序号（row-major，从 0 开始）；省略或 -1 = 只显示文字不指手指；auto 步骤忽略 */
    grid?: number;
    /** 手指提示文字 */
    text?: string;
    /** 自动定位：tray-empty=第一个暂存空位 / board-match=与露出的底图同色的棋盘小球 / revealed-base=露出的匹配底图 */
    auto?: 'tray-empty' | 'board-match' | 'revealed-base';
    /** 手指路径：指尖依次经过的格子（绝对行列，0 基），循环播放；缺省 = 仅在目标格轻按 */
    fingerPath?: Array<[number, number]>;
    /** 手指指尖指向的绝对格子（0 基）；缺省 = 棋盘步骤目标格上一格 / 暂存区目标格 */
    fingerRow?: number;
    fingerCol?: number;
}

export class GameConfig {
    private static _global: GlobalConfigData | null = null;
    private static _guide: GuideConfigData | null = null;

    static get global(): GlobalConfigData {
        return this._global ?? this.defaultGlobal();
    }

    static get guide(): GuideConfigData {
        return this._guide ?? { enabled: false };
    }

    static async loadFromResources(): Promise<void> {
        const [g, gd] = await Promise.all([
            this.loadJson<GlobalConfigData>('res/config/game/GlobalConfig'),
            this.loadJson<GuideConfigData>('res/config/guide/GuideConfig'),
        ]);
        this._global = g ?? this.defaultGlobal();
        this._guide = gd ?? { enabled: false };
    }

    private static loadJson<T>(path: string): Promise<T | null> {
        return new Promise((resolve) => {
            resources.load(path, JsonAsset, (err, asset) => {
                if (err) {
                    console.warn(`[GameConfig] load ${path} failed, fallback to defaults`);
                    resolve(null);
                    return;
                }
                resolve(asset.json as T);
            });
        });
    }

    private static defaultGlobal(): GlobalConfigData {
        return {
            levelRange: { min: GameConst.LEVEL_RANGE_MIN, max: GameConst.LEVEL_RANGE_MAX },
            showBanner: false,
            showTitle: true,
            showDebugfinger: false,
            winTargetProgressPercent: 1,
        };
    }

    static currentLanguage(): string {
        const lang = sys.languageCode;
        return lang.startsWith('zh') ? 'zh' : 'en';
    }
}
