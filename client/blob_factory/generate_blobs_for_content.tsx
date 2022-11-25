import {BlobFactoryBlob, BlobFactoryBlobs} from "~/client/blob_factory/internal/draw_blob_factory";
import {ThemeColor, themeColors} from "~/shared/design/theme_colors";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {Vector2} from "~/shared/helpers/geometry/vector2";
import {StableRandom} from "~/shared/helpers/number/stable_random";

type BlobGenerationSettings = {
    contentWidthPx: number;
    screenWidthPx: number;
    randomSeed: string;
    minBlobCount: number;
    maxBlobCount: number;
    spreadX: number;
    minY: number;
    maxY: number;
    minRadiusFactor: number;
    maxRadiusFactor: number;
    baseThemeColor: ThemeColor;
    colorSpread: number;
    hueSpread: number;
};

export function generateBlobsForContent({
    contentWidthPx,
    screenWidthPx,
    randomSeed,
    minBlobCount,
    maxBlobCount,
    spreadX,
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

                    leftX - contentWidthPx * spreadX,
                    rightX + contentWidthPx * spreadX,
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
