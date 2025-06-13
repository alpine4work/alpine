import {ThemeColor} from "~/shared/design/core/theme_colors.js";

// We hardcode the canvas size since we can't measure the container until
// after the browser renders. If we handled this client side, there would be a
// flicker or jitter in the blob canvas. We set a somewhat ridiculous width
// since it's just for the color fade background.
export const blobsCanvasWidthPx = 10000;
export const blobsCanvasHeightPx = 800;

// This is the width of the content we're drawing the blobs for. The content is centered
// within the canvasWidth.
export const blobsContentWidthPx = 1200;

export type BlobsSettings = {
    seed: string;
    themeColor: ThemeColor;
    smoothness: number;
    blurSize: number;
    blurSpread: number;
    shouldDrawOutside: boolean;
    shouldDrawInside: boolean;
    colorLevelInsideLight: number;
    colorLevelInsideDark: number;
    colorLevelOutsideLight: number;
    colorLevelOutsideDark: number;
    colorLevelTextLight: number;
    colorLevelTextDark: number;
    minBlobCount: number;
    maxBlobCount: number;
    spreadLeft: number;
    spreadRight: number;
    minY: number;
    maxY: number;
    minRadiusFactor: number;
    maxRadiusFactor: number;
    colorSpread: number;
    hueSpread: number;
};

export const blobsDefaultSettings: Omit<BlobsSettings, "seed" | "hueSpread" | "themeColor"> = {
    smoothness: 70,
    blurSize: 200,
    blurSpread: 0.9,
    shouldDrawOutside: true,
    shouldDrawInside: true,
    colorLevelInsideLight: 20,
    colorLevelInsideDark: 80,
    colorLevelOutsideLight: 10,
    colorLevelOutsideDark: 90,
    colorLevelTextLight: 75,
    colorLevelTextDark: 20,
    minBlobCount: 6,
    maxBlobCount: 10,
    spreadLeft: -0.4,
    spreadRight: 0.2,
    minY: 0,
    maxY: 150,
    minRadiusFactor: 0.03,
    maxRadiusFactor: 0.1,
    colorSpread: 0,
};

/*
 * Gets a canvas id for a specific blob settings.
 * We set this in case there are multiple blobs on the page during server side rendering.
 * This is useful for blobs in and outside of React contexts.
 */
export const getBlobsCanvasId = (settings: Partial<BlobsSettings>) => {
    return `blobs_${settings.seed?.replaceAll("-", "")}_${settings.themeColor}_${
        settings.hueSpread
    }`;
};
