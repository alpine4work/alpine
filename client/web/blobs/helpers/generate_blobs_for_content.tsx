import {BlobFactoryBlobs} from "~/client/web/blobs/helpers/blobs_types.js";
import {BlobFactoryBlob} from "~/client/web/blobs/helpers/draw_blobs_factory.js";
import {ThemeColor, themeColors} from "~/shared/design/core/theme_colors.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {Vector2} from "~/shared/helpers/geometry/vector2.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.open_source.js";

type BlobGenerationSettings = {
    contentWidthPx: number;
    screenWidthPx: number;
    randomSeed: string;
    minBlobCount: number;
    maxBlobCount: number;
    spreadLeft: number;
    spreadRight: number;
    minY: number;
    maxY: number;
    minRadiusFactor: number;
    maxRadiusFactor: number;
    baseThemeColor: ThemeColor;
    colorSpread: number;
    hueSpread: number;
};

/*
 * Creates the blobs for the blob art.
 */
export function generateBlobsForContent({
    contentWidthPx,
    screenWidthPx,
    randomSeed,
    minBlobCount,
    maxBlobCount,
    spreadLeft,
    spreadRight,
    minY,
    maxY,
    minRadiusFactor,
    maxRadiusFactor,
    baseThemeColor,
    colorSpread,
    hueSpread,
}: BlobGenerationSettings): BlobFactoryBlobs {
    const rng = new StableRandom(randomSeed);

    const centerX = screenWidthPx / 2;
    const leftX = centerX - contentWidthPx / 2;
    const rightX = centerX + contentWidthPx / 2;

    const baseThemeColorIndex = themeColors.indexOf(baseThemeColor);

    const blobs = createArrayWithLength(
        rng.randomInteger("count", 0, minBlobCount, maxBlobCount),
        idx => {
            const position = new Vector2(
                rng.randomFloat(
                    "x",
                    idx,

                    leftX - contentWidthPx * spreadLeft,
                    rightX + contentWidthPx * spreadRight,
                ),
                rng.randomFloat("y", idx, minY, maxY),
            );
            const radius = rng.randomFloat(
                "radius",
                idx,
                contentWidthPx * minRadiusFactor,
                contentWidthPx * maxRadiusFactor,
            );
            const colorOffset = Math.round(
                rng.randomNormalDistribution("color", idx) * colorSpread,
            );
            const color = assertExists(
                themeColors.at((baseThemeColorIndex + colorOffset) % themeColors.length),
            );
            return new BlobFactoryBlob(
                position,
                radius,
                color,
                rng.randomNormalDistribution("hue", idx) * hueSpread,
            );
        },
    );

    return blobs;
}
