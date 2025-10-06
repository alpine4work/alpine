import {FontSize} from "~/shared/design/core/fonts.js";
import {Spacing} from "~/shared/design/core/spacing.js";

export type AccountAvatarPileSize = "3" | "4" | "5" | "6" | "7" | "12";

export const accountAvatarPileSizes: Record<
    AccountAvatarPileSize,
    {
        avatarOverlapWidth: Spacing;
        borderWidth: 1 | 1.5 | 2 | 3;
        overflowFontSize: FontSize;
        overflowScale?: number;
    }
> = {
    "3": {
        avatarOverlapWidth: "2.5",
        borderWidth: 1,
        overflowFontSize: "50",
        overflowScale: 0.75,
    },
    "4": {
        avatarOverlapWidth: "3",
        borderWidth: 1.5,
        overflowFontSize: "50",
        overflowScale: 0.75,
    },
    "5": {
        avatarOverlapWidth: "4",
        borderWidth: 2,
        overflowFontSize: "50",
        overflowScale: 0.75,
    },
    "6": {
        avatarOverlapWidth: "5",
        borderWidth: 2,
        overflowFontSize: "50",
    },
    "7": {
        avatarOverlapWidth: "6",
        borderWidth: 2,
        overflowFontSize: "50",
    },
    "12": {
        avatarOverlapWidth: "10",
        borderWidth: 3,
        overflowFontSize: "100",
    },
} as const;
