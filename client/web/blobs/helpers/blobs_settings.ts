import {ThemeColor} from "~/shared/design/core/theme_colors.js";
import {assert} from "~/shared/helpers/control/assert.js";

// https://jhildenbiddle.github.io/canvas-size/#/?id=test-results
const maxPossibleCanvasSize = 10_000;

/**
 * Get the size of the blobs canvas. This can only be called in the browser and
 * will error if not. We hardcode the canvas size since we can't measure the
 * container until after the browser renders. We don't draw blobs in SSR, so this
 * is ok to do.
 */
export function getBlobsCanvasSize() {
    assert(typeof window !== "undefined");

    // There is an edge case where the user resizes their window bigger than their
    // screen, which will result in hard lines on the edge of the canvas, but that's
    // not a case we care about. We have a minimal width of 3000px to ensure the blobs
    // are large enough for previews.
    const blobsCanvasWidthPx = Math.max(window.screen.width, 3000);

    // We have a standard height for the blobs canvas. This controls the height of the
    // canvas and the gradient that fades it out.
    const blobsCanvasHeightPx = 800;

    return {
        width: blobsCanvasWidthPx,
        height: blobsCanvasHeightPx,
    };
}

/**
 * This is the scale of the canvas. We use this to scale the canvas to a higher
 * resolution for high DPI displays, but we also scale it down to fit within the
 * container. We set a max based on the max possible canvas size to prevent the
 * canvas from being too large. For example, if our DPR is 4, we would may only
 * scale to a max DPR of 3 to make sure we don't exceed the max possible canvas
 * size.
 */
export function getBlobsCanvasScale() {
    assert(typeof window !== "undefined");

    return Math.min(
        Math.floor(maxPossibleCanvasSize / window.devicePixelRatio),
        window.devicePixelRatio,
    );
}

// This is the width of the content we're drawing the blobs for. The content is
// centered within the canvasWidth.
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
export const getBlobsCanvasId = (settings: Partial<BlobsSettings>, scale?: number) => {
    return `blobs_${settings.seed?.replaceAll("-", "")}_${settings.themeColor}_${
        settings.hueSpread
    }_${Math.floor((scale || 1) * 1000)}`;
};
