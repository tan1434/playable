import { sys } from 'cc';

/**
 * 广告平台适配（对齐原版 PlayableAdPlatform）：
 * - CTA 跳转商店
 * - Banner 开关（Demo 默认关闭）
 */
export class PlayableAdPlatform {
    static readonly ANDROID_URL = 'https://play.google.com/store/apps/details?id=color.number.paint.pixle.art.sort.jigsaw';
    static readonly IOS_URL = 'https://itunes.apple.com/app/id6759081967';

    static openStore(): void {
        const url = sys.os === sys.OS.IOS ? this.IOS_URL : this.ANDROID_URL;
        sys.openURL(url);
    }

    static showBanner(): void {
        // Demo 不实现 banner，留接口
    }
}