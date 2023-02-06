import Color from "color";
import {useMemo, useRef, useState} from "react";
import {generateBlobsForContent} from "~/client/blob_factory/generate_blobs_for_content";
import {
    drawBlobFactoryToBlob,
    drawBlobFactoryToCanvas,
    getInterpolatedThemeColor,
} from "~/client/blob_factory/internal/draw_blob_factory";
import {useDevConsoleSettingsObject} from "~/client/dev/dev_console";
import {useColorScheme} from "~/client/helpers/color_scheme";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {useResizeObserver} from "~/client/helpers/use_resize_observer";
import {colors} from "~/shared/design/colors";
import {easeInOutSin} from "~/shared/design/easing";
import {formatCssLinearGradient, generateEasedGradient} from "~/shared/design/gradient";
import {themeColors} from "~/shared/design/theme_colors";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {Vector2} from "~/shared/helpers/geometry/vector2";
import {Schema} from "~/shared/schema/schema";
import {contentSchemaStyles, documentBlobsStyles, sprinkles} from "~/shared/styles/styles";

// TODO: responsive blobs
const DefaultContentWidthPx = 768;

export type DocumentBlobFactorySettings = ReturnType<typeof useDocumentBlobSettings>;
export function useDocumentBlobSettings({defaultSeed}: {defaultSeed: string}) {
    return useDevConsoleSettingsObject("blobs", {
        textFillEnabled: {
            // TODO(calebmer): Decide what to do about text fill. I'm leaning off?
            defaultValue: false,
            schema: Schema.boolean,
        },
        seed: {
            defaultValue: defaultSeed,
            schema: Schema.string,
        },
        smoothness: {
            defaultValue: 70,
            schema: Schema.float,
        },
        blurSize: {
            defaultValue: 200,
            schema: Schema.float,
        },
        blurSpread: {
            defaultValue: 0.9,
            schema: Schema.float,
        },
        shouldDrawOutside: {
            defaultValue: true,
            schema: Schema.boolean,
        },
        shouldDrawInside: {
            defaultValue: true,
            schema: Schema.boolean,
        },
        colorLevelInsideLight: {
            defaultValue: 20,
            schema: Schema.integer,
        },
        colorLevelInsideDark: {
            defaultValue: 80,
            schema: Schema.integer,
        },
        colorLevelOutsideLight: {
            defaultValue: 10,
            schema: Schema.integer,
        },
        colorLevelOutsideDark: {
            defaultValue: 90,
            schema: Schema.integer,
        },
        colorLevelTextLight: {
            defaultValue: 75,
            schema: Schema.integer,
        },
        colorLevelTextDark: {
            defaultValue: 20,
            schema: Schema.integer,
        },
        minBlobCount: {
            defaultValue: 6,
            schema: Schema.integer,
        },
        maxBlobCount: {
            defaultValue: 10,
            schema: Schema.integer,
        },
        spreadLeft: {
            defaultValue: -0.4,
            schema: Schema.float,
        },
        spreadRight: {
            defaultValue: 0.2,
            schema: Schema.float,
        },
        minY: {
            defaultValue: 0,
            schema: Schema.float,
        },
        maxY: {
            defaultValue: 150,
            schema: Schema.float,
        },
        minRadiusFactor: {
            defaultValue: 0.03,
            schema: Schema.float,
        },
        maxRadiusFactor: {
            defaultValue: 0.1,
            schema: Schema.float,
        },
        baseThemeColor: {
            defaultValue: "blue" as const,
            schema: Schema.enum(themeColors),
        },
        colorSpread: {
            defaultValue: 0,
            schema: Schema.float,
        },
        hueSpread: {
            defaultValue: 45,
            schema: Schema.float,
        },
    });
}

export function DocumentBlobFactory({
    settings,
    containerId,
}: {
    settings: DocumentBlobFactorySettings;
    containerId: string;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const displayCanvasRef = useRef<HTMLCanvasElement>(null);
    const containerRect = useResizeObserver(containerRef);

    const colorScheme = useColorScheme();
    const [textFill, setTextFill] = useState<{url: string; offsetX: number; size: Vector2} | null>(
        null,
    );

    const backgroundColor = colorScheme === "light" ? "grey-0" : "grey-dark";

    const baseThemeColorName = settings.baseThemeColor;
    const baseThemeColor = getInterpolatedThemeColor(
        colorScheme === "dark" ? settings.colorLevelInsideDark : settings.colorLevelInsideLight,
        baseThemeColorName,
    );
    const hueBias = 360 - assertExists(baseThemeColor.lch().object().h);

    const blobs = useMemo(() => {
        if (!containerRect) return;
        return generateBlobsForContent({
            contentWidthPx: DefaultContentWidthPx,
            screenWidthPx: containerRect.width,
            randomSeed: settings.seed,
            minBlobCount: settings.minBlobCount,
            maxBlobCount: settings.maxBlobCount,
            spreadLeft: settings.spreadLeft,
            spreadRight: settings.spreadRight,
            minY: settings.minY,
            maxY: settings.maxY,
            minRadiusFactor: settings.minRadiusFactor,
            maxRadiusFactor: settings.maxRadiusFactor,
            baseThemeColor: baseThemeColorName,
            colorSpread: settings.colorSpread,
            hueSpread: settings.hueSpread,
        });
    }, [
        baseThemeColorName,
        containerRect,
        settings.colorSpread,
        settings.hueSpread,
        settings.maxBlobCount,
        settings.maxRadiusFactor,
        settings.maxY,
        settings.minBlobCount,
        settings.minRadiusFactor,
        settings.minY,
        settings.seed,
        settings.spreadLeft,
        settings.spreadRight,
    ]);

    useLayoutEffectWithoutServerSideWarning(() => {
        const canvas = displayCanvasRef.current;
        if (!containerRect || !canvas) {
            return;
        }

        drawBlobFactoryToCanvas(
            canvas,
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

        if (settings.textFillEnabled) {
            const size = new Vector2(containerRect.width, containerRect.height);

            let isCancelled = false;
            drawBlobFactoryToBlob(
                size,
                window.devicePixelRatio,
                {
                    ...settings,
                    hueBias,
                    shouldDrawInside: false,
                    colorLevelInside: 0,
                    colorLevelOutside:
                        colorScheme === "dark"
                            ? settings.colorLevelTextDark
                            : settings.colorLevelTextLight,
                    backgroundColor,
                    blurSpread: 1,
                },
                blobs,
            )
                .then(url => {
                    if (isCancelled) return;
                    setTextFill({
                        url: url,
                        offsetX: (DefaultContentWidthPx - containerRect.width) / 2,
                        size,
                    });
                })
                .catch(() => setTextFill(null));

            return () => {
                isCancelled = true;
            };
        }
    }, [backgroundColor, blobs, colorScheme, containerRect, hueBias, settings]);

    return (
        <div
            ref={containerRef}
            className={documentBlobsStyles.blobsClassName}
            aria-hidden="true"
            style={{height: 800}}
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
            <div
                className={sprinkles({
                    position: "absolute",
                    inset: "0",
                })}
                style={{
                    backgroundImage: formatCssLinearGradient(
                        "to bottom",
                        generateEasedGradient(
                            new Color(colors[backgroundColor]).alpha(0).toString(),
                            colors[backgroundColor],
                            easeInOutSin,
                            10,
                        ),
                    ),
                }}
            />
            {settings.textFillEnabled && textFill && (
                <style>{`
                    #${containerId} .${contentSchemaStyles.titleClassName} {
                        background-image: url(${textFill.url});
                        background-size: ${textFill.size.x}px ${textFill.size.y}px;
                        background-position: ${textFill.offsetX}px 0;
                        background-clip: text;
                        -webkit-background-clip: text;
                        text-fill-color: transparent;
                        -webkit-text-fill-color: transparent;
                    }
                `}</style>
            )}
        </div>
    );
}
