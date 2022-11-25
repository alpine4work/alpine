import classNames from "classnames";
import Color from "color";
import {CSSProperties, useMemo, useRef} from "react";
import {BlobFactorySettings} from "~/client/blob_factory/blob_factory_types";
import {
    BlobFactory,
    BlobFactoryBlob,
    BlobFactoryBlobs,
    drawBlobFactory,
    getInterpolatedThemeColor,
} from "~/client/blob_factory/internal/draw_blob_factory";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {useResizeObserver} from "~/client/helpers/use_resize_observer";
import {colors} from "~/shared/design/colors";
import {formatCssLinearGradient, generateEasedGradient} from "~/shared/design/gradient";
import {ThemeColor, themeColors} from "~/shared/design/theme_colors";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {easeInOutSin} from "~/shared/helpers/easing";
import {Vector2} from "~/shared/helpers/geometry/vector2";
import {StableRandom} from "~/shared/helpers/number/stable_random";
import {sprinkles} from "~/shared/styles/styles";

// TODO: responsive blobs
const DefaultContentWidthPx = 768;

type BlobGenerationSettings = {
    contentWidthPx: number;
    screenWidthPx: number;
    randomSeed: string;
    minBlobCount?: number;
    maxBlobCount?: number;
    spreadX?: number;
    minY?: number;
    maxY?: number;
    minRadiusFactor?: number;
    maxRadiusFactor?: number;
    baseThemeColor: ThemeColor;
    colorSpread?: number;
    hueSpread?: number;
};

export function generateBlobsForContent({
    contentWidthPx,
    screenWidthPx,
    randomSeed,
    minBlobCount = 5,
    maxBlobCount = 8,
    spreadX = 0.1,
    minY = 0,
    maxY = 300,
    minRadiusFactor = 0.1,
    maxRadiusFactor = 0.3,
    baseThemeColor,
    colorSpread = 1,
    hueSpread = 0,
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

export function BlobFactory({
    width,
    height,
    fadeToBlank = false,
    settings,
    randomSeed,
    onDraw,
    className,
    style,
}: {
    width?: number;
    height?: number;
    fadeToBlank?: boolean;
    randomSeed: string;
    settings: Omit<BlobFactorySettings, "hueBias"> &
        Omit<BlobGenerationSettings, "contentWidthPx" | "screenWidthPx" | "randomSeed">;
    onDraw?: (ctx: HTMLCanvasElement, size: Vector2, contentWidthPx: number) => void;
    className?: string;
    style?: CSSProperties;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const containerRect = useResizeObserver(containerRef);
    const hasContainerRect = !!containerRect;
    const displayCanvasRef = useRef<HTMLCanvasElement>(null);
    const blobFactoryRef = useRef<BlobFactory | null>(null);

    const baseThemeColorName = settings.baseThemeColor;
    const baseThemeColor = getInterpolatedThemeColor(settings.colorLevelInside, baseThemeColorName);
    const hueBias = 360 - assertExists(baseThemeColor.lch().object().h);

    const blobs = useMemo(() => {
        if (!containerRect) return;
        return generateBlobsForContent({
            contentWidthPx: DefaultContentWidthPx,
            screenWidthPx: containerRect.width,
            randomSeed,
            ...settings,
        });
    }, [containerRect, randomSeed, settings]);

    const onDrawEvent = useEvent((canvas: HTMLCanvasElement, size: Vector2) => {
        onDraw?.(canvas, size, DefaultContentWidthPx);
    });

    // We accept that while server-side rendering we can't show blobs.
    // I wonder if there is anyway to run blob factory server side...
    useLayoutEffectWithoutServerSideWarning(() => {
        if (!hasContainerRect) return;

        assert(displayCanvasRef.current);
        blobFactoryRef.current = drawBlobFactory(displayCanvasRef.current, {onDraw: onDrawEvent});

        return () => {
            assert(blobFactoryRef.current);
            blobFactoryRef.current.destroy();
            blobFactoryRef.current = null;
        };
    }, [hasContainerRect, onDrawEvent]);

    // We accept that while server-side rendering we can't show blobs
    // I wonder if there is anyway to run blob factory server side....
    useLayoutEffectWithoutServerSideWarning(() => {
        if (!containerRect) return;

        assert(blobFactoryRef.current);
        blobFactoryRef.current.setSize(new Vector2(containerRect.width, containerRect.height));
    }, [containerRect]);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (!containerRect) return;

        assert(blobFactoryRef.current);
        blobFactoryRef.current.setSettings({...settings, hueBias});
    }, [settings, containerRect, hueBias]);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (!containerRect || !blobs) return;

        assert(blobFactoryRef.current);
        blobFactoryRef.current.setBlobs(blobs);
    }, [blobs, containerRect]);

    return (
        <div
            ref={containerRef}
            className={classNames(
                sprinkles({
                    zIndex: "-50",
                    position: "absolute",
                    inset: "0",
                    width: width ? undefined : "full",
                    height: height ? undefined : "full",
                }),
                className,
            )}
            aria-hidden="true"
            style={{...style, width, height}}
        >
            {containerRect && (
                <canvas
                    ref={displayCanvasRef}
                    width={containerRect.width * window.devicePixelRatio}
                    height={containerRect.height * window.devicePixelRatio}
                    className={sprinkles({
                        position: "absolute",
                        inset: "0",
                        width: "full",
                        height: "full",
                    })}
                />
            )}
            {fadeToBlank && (
                <div
                    className={sprinkles({
                        position: "absolute",
                        inset: "0",
                    })}
                    style={{
                        backgroundImage: formatCssLinearGradient(
                            "to bottom",
                            generateEasedGradient(
                                new Color(colors[settings.backgroundColor]).alpha(0).toString(),
                                colors[settings.backgroundColor],
                                easeInOutSin,
                                10,
                            ),
                        ),
                    }}
                />
            )}
        </div>
    );
}
