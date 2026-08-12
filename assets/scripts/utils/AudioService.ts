import { AudioClip, AudioSource, Node } from 'cc';

export enum GemAudioKey {
    Pickup = 'Gem_pickup',
    OthregionPlace = 'Gem_othregion_place',
    OthregionPlaceSingle = 'Gem_othregion_place_single',
    Success = 'Gem_success',
    StoreMove = 'Gem_store_move',
    StorePlace = 'Gem_store_place',
    Bgm = 'Gem_Bgm_ingame_play',
    OnClick = 'Gem_onclick',
    Ok = 'Gem_ok',
    Tip = 'Gem_tip',
}

/**
 * 音频服务：正式音频资源放入 resources/audio 后即可播放；
 * 资源缺失时静默失败，不影响玩法。
 */
export class AudioService {
    private _bgmSource: AudioSource | null = null;
    private _sfxSource: AudioSource | null = null;
    private _clips = new Map<GemAudioKey, AudioClip>();
    private _root: Node | null = null;

    init(root: Node): void {
        this._root = root;
        const srcs = root.getComponents(AudioSource);
        this._bgmSource = srcs[0] ?? root.addComponent(AudioSource);
        this._sfxSource = srcs[1] ?? root.addComponent(AudioSource);
    }

    register(key: GemAudioKey, clip: AudioClip | null): void {
        if (clip) this._clips.set(key, clip);
    }

    play(key: GemAudioKey): void {
        const clip = this._clips.get(key);
        if (!clip || !this._sfxSource) return;
        this._sfxSource.stop(); // 打断前一个音效（如上一颗球的落位音）
        this._sfxSource.playOneShot(clip, 0.8);
    }

    isBgmPlaying(): boolean {
        const clip = this._clips.get(GemAudioKey.Bgm);
        return !!this._bgmSource && !!clip && this._bgmSource.playing && this._bgmSource.clip === clip;
    }

    playBgm(): void {
        const clip = this._clips.get(GemAudioKey.Bgm);
        if (!clip || !this._bgmSource) return;
        if (this._bgmSource.playing && this._bgmSource.clip === clip) return; // 已播放不重启
        this._bgmSource.clip = clip;
        this._bgmSource.loop = true;
        this._bgmSource.play();
        console.log('[Audio] playBgm clip=' + !!clip + ' playing=' + this._bgmSource.playing + ' (浏览器可能拦截自动播放)');
    }
}
