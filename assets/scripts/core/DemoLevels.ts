import { LevelData } from './LevelData';
import { LevelConfig } from './LevelConfig';

/**
 * Demo 关卡兜底：直接使用 LevelConfig 内置的菠萝网格
 * （正常流程优先读取 res/config/level/Level_{n}.json，见 MetaGameController）
 */
export class DemoLevels {
    static create(levelIndex: number): LevelData {
        return LevelConfig.fallback(levelIndex);
    }
}