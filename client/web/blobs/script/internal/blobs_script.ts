import {
    BlobsSettings,
    blobsContentWidthPx,
    getBlobsCanvasSize,
} from "~/client/web/blobs/helpers/blobs_settings.js";
import {HTMLCanvasElementWithBlobSettings} from "~/client/web/blobs/helpers/blobs_types.js";
import {
    actuallyDrawBlobsForIntegrationTest,
    drawBlobFactoryToCanvas,
    getInterpolatedThemeColor,
} from "~/client/web/blobs/helpers/draw_blobs_factory.js";
import {generateBlobsForContent} from "~/client/web/blobs/helpers/generate_blobs_for_content.js";
import {ColorScheme} from "~/client/web/helpers/color_scheme.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

declare global {
    interface Window {
        __drawBlobs: typeof drawBlobs;
        __actuallyDrawBlobsForIntegrationTest?: typeof actuallyDrawBlobsForIntegrationTest;
    }
}

function drawBlobs(blobCanvasId: string, settings: BlobsSettings, scale?: number) {
    // eslint-disable-next-line cyberworlds/string-quotes
    const canvas = document.querySelectorAll(`canvas[data-blob-id="${blobCanvasId}"]`);

    const actuallyDrawBlobs = (colorScheme: ColorScheme) => {
        const backgroundColor = colorScheme === "light" ? "grey-0" : "grey-100";
        const baseThemeColor = getInterpolatedThemeColor(
            colorScheme === "dark" ? settings.colorLevelInsideDark : settings.colorLevelInsideLight,
            settings.themeColor,
        );
        const hueBias = 360 - assertExists(baseThemeColor.lch().object().h);
        const blobsCanvasSize = getBlobsCanvasSize();

        const blobs = generateBlobsForContent({
            contentWidthPx: blobsContentWidthPx,
            screenWidthPx: blobsCanvasSize.width,
            randomSeed: settings.seed,
            minBlobCount: settings.minBlobCount,
            maxBlobCount: settings.maxBlobCount,
            spreadLeft: settings.spreadLeft,
            spreadRight: settings.spreadRight,
            minY: settings.minY,
            maxY: settings.maxY,
            minRadiusFactor: settings.minRadiusFactor,
            maxRadiusFactor: settings.maxRadiusFactor,
            baseThemeColor: settings.themeColor,
            colorSpread: settings.colorSpread,
            hueSpread: settings.hueSpread,
        });

        // NOTE(imjoshin): In case multiple blobs are rendered with the same key, draw them
        // all here. To reduce redundant draws, within drawBlobFactoryToCanvas we check if
        // we've already drawn this blob and if so, skip it.
        canvas.forEach(canvas => {
            // keep track of the settings used to draw the blobs so that we can redraw them
            // when the color scheme changes
            (canvas as HTMLCanvasElementWithBlobSettings)._blobsSettings = settings;

            drawBlobFactoryToCanvas(
                canvas as HTMLCanvasElement,
                {
                    ...settings,
                    scale: scale || 1,
                    hueBias,
                    colorLevelInside:
                        colorScheme === "dark"
                            ? settings.colorLevelInsideDark
                            : settings.colorLevelInsideLight,
                    colorLevelOutside:
                        colorScheme === "dark"
                            ? settings.colorLevelOutsideDark
                            : settings.colorLevelOutsideLight,
                    backgroundColor,
                },
                blobs,
            );
        });
    };

    const localStorageColorScheme = localStorage.getItem("colorScheme");
    let initialColorScheme: ColorScheme = "light";
    if (localStorageColorScheme) {
        initialColorScheme = localStorageColorScheme === "dark" ? "dark" : "light";
    } else {
        initialColorScheme = window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light";
    }

    actuallyDrawBlobs(initialColorScheme);
}

if (typeof window !== "undefined") {
    window.__drawBlobs = drawBlobs;

    if (process.env.NODE_ENV !== "production" && (globalThis as any).__isIntegrationTest) {
        window.__actuallyDrawBlobsForIntegrationTest = actuallyDrawBlobsForIntegrationTest;
    }
}
