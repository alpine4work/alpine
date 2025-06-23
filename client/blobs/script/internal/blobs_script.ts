import {
    BlobsSettings,
    blobsCanvasWidthPx,
    blobsContentWidthPx,
} from "~/client/blobs/helpers/blobs_settings.js";
import {
    drawBlobFactoryToCanvas,
    getInterpolatedThemeColor,
} from "~/client/blobs/helpers/draw_blobs_factory.js";
import {generateBlobsForContent} from "~/client/blobs/helpers/generate_blobs_for_content.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

function drawBlob(blobCanvasId: string, settings: BlobsSettings | true) {
    // We're just initializing this method in the server side script so esbuild doesn't remove it
    if (settings === true) {
        // Return ourselves so we can export the minified version from our Bazel build
        return drawBlob;
    }

    const localStorageColorScheme = localStorage.getItem("colorScheme");
    let colorScheme: "light" | "dark" = "light";
    if (localStorageColorScheme) {
        colorScheme = localStorageColorScheme === "dark" ? "dark" : "light";
    } else {
        colorScheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }

    const backgroundColor = colorScheme === "light" ? "grey-0" : "grey-100";
    const baseThemeColor = getInterpolatedThemeColor(
        colorScheme === "dark" ? settings.colorLevelInsideDark : settings.colorLevelInsideLight,
        settings.themeColor,
    );
    const hueBias = 360 - assertExists(baseThemeColor.lch().object().h);

    // eslint-disable-next-line string-quotes
    const canvas = document.querySelectorAll(`canvas[data-blob-id="${blobCanvasId}"]`);

    const blobs = generateBlobsForContent({
        contentWidthPx: blobsContentWidthPx,
        screenWidthPx: blobsCanvasWidthPx,
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
    // all here. To reduce redundant draws, within drawBlobFactoryToCanvas we check if we've
    // already drawn this blob and if so, skip it.
    canvas.forEach(canvas => {
        drawBlobFactoryToCanvas(
            canvas as HTMLCanvasElement,
            window.devicePixelRatio,
            {
                ...settings,
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
}

drawBlob("", true);
