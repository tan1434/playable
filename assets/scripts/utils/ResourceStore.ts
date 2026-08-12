import { resources, SpriteFrame, AudioClip } from 'cc';
import { GEM_COLOR_NAMES } from '../core/GemType';

/**
 * 资源加载：单图加载。贴图已整理到 atlas/bases（XXBase + slot）与 atlas/gams（XXGem），
 * 由 Cocos 3.x 自动图集（atlas/base.pac）在构建时透明合批；代码按实际目录加载。
 */
export class ResourceStore {
    static gemFrames: SpriteFrame[] = [];
    static baseFrames: SpriteFrame[] = [];
    static slotFrame: SpriteFrame | null = null;
    static trayFrame: SpriteFrame | null = null;
    static fingerFrame: SpriteFrame | null = null;
    static bgmClip: AudioClip | null = null;
    static othregionSingleClip: AudioClip | null = null;
    static storePlaceClip: AudioClip | null = null;
    static onclickClip: AudioClip | null = null;
    static okClip: AudioClip | null = null;
    static tipClip: AudioClip | null = null;
    static bgFrame: SpriteFrame | null = null;
    static titleFrame: SpriteFrame | null = null;
    static urlFrame: SpriteFrame | null = null;
    static tipFrame: SpriteFrame | null = null;
    static ready = false;

    static async loadAll(): Promise<void> {
        if (this.ready) return;
        // 收集所有加载任务
        const jobs: Array<() => Promise<void>> = [];
        for (let i = 0; i < GEM_COLOR_NAMES.length; i++) {
            const name = GEM_COLOR_NAMES[i];
            jobs.push(() => this.loadSpriteFrame(`atlas/gams/${name}Gem/spriteFrame`).then((f) => { this.gemFrames[i] = f; }));
            jobs.push(() => this.loadSpriteFrame(`atlas/bases/${name}Base/spriteFrame`).then((f) => { this.baseFrames[i] = f; }));
        }
        jobs.push(() => this.loadSpriteFrame('atlas/bases/slot/spriteFrame').then((f) => { this.slotFrame = f; }));
        jobs.push(() => this.loadSpriteFrame('images/tray/spriteFrame').then((f) => { this.trayFrame = f; }));
        jobs.push(() => this.loadSpriteFrame('images/手指/spriteFrame').then((f) => { this.fingerFrame = f; }));
        jobs.push(() => this.loadSpriteFrame('images/bg/spriteFrame').then((f) => { this.bgFrame = f; }));
        jobs.push(() => this.loadSpriteFrame('images/title/spriteFrame').then((f) => { this.titleFrame = f; }));
        jobs.push(() => this.loadSpriteFrame('images/url/spriteFrame').then((f) => { this.urlFrame = f; }));
        jobs.push(() => this.loadSpriteFrame('images/tip/spriteFrame').then((f) => { this.tipFrame = f; }));
        jobs.push(() => this.loadAudioClip('audio/Gem_Bgm_ingame_play').then((c) => { this.bgmClip = c; }));
        jobs.push(() => this.loadAudioClip('audio/Gem_othregion_place_single').then((c) => { this.othregionSingleClip = c; }));
        jobs.push(() => this.loadAudioClip('audio/Gem_store_place').then((c) => { this.storePlaceClip = c; }));
        jobs.push(() => this.loadAudioClip('audio/Gem_onclick').then((c) => { this.onclickClip = c; }));
        jobs.push(() => this.loadAudioClip('audio/Gem_ok').then((c) => { this.okClip = c; }));
        jobs.push(() => this.loadAudioClip('audio/Gem_tip').then((c) => { this.tipClip = c; }));

        // 分帧加载：每批最多 10 个，批间让出主线程，避免启动卡顿
        const BATCH = 10;
        for (let i = 0; i < jobs.length; i += BATCH) {
            await Promise.all(jobs.slice(i, i + BATCH).map((fn) => fn()));
            await this.nextFrame();
        }
        this.ready = true;
        const sfxCount = (this.othregionSingleClip ? 1 : 0) + (this.storePlaceClip ? 1 : 0);
        console.log(`[ResourceStore] gem=${this.gemFrames.filter(f => !!f).length} base=${this.baseFrames.filter(f => !!f).length} slot=${!!this.slotFrame} tray=${!!this.trayFrame} finger=${!!this.fingerFrame} bgm=${!!this.bgmClip} sfx=${sfxCount}/2`);
    }

    private static nextFrame(): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, 0));
    }
    private static loadAudioClip(path: string): Promise<AudioClip | null> {
        return new Promise((resolve) => {
            let done = false;
            const finish = (c: AudioClip | null) => { if (!done) { done = true; resolve(c); } };
            resources.load(path, AudioClip, (err, clip) => {
                if (err) { finish(null); return; }
                finish(clip);
            });
            setTimeout(() => finish(null), 3000);
        });
    }

    private static loadSpriteFrame(path: string): Promise<SpriteFrame | null> {
        return new Promise((resolve) => {
            let done = false;
            const finish = (f: SpriteFrame | null) => { if (!done) { done = true; resolve(f); } };
            resources.load(path, SpriteFrame, (err, frame) => {
                if (err) { finish(null); return; }
                finish(frame);
            });
            setTimeout(() => finish(null), 3000);
        });
    }
}