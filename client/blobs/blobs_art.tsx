import Color from "color";
import {Memo, memo, useMemo, useRef} from "react";
import {
    formatCssLinearGradient,
    generateEasedGradient,
} from "~/client/blobs/helpers/blobs_css_gradient.js";
import {
    BlobsSettings,
    blobsCanvasHeightPx,
    blobsCanvasWidthPx,
    blobsContentWidthPx,
    blobsDefaultSettings,
    getBlobsCanvasId,
} from "~/client/blobs/helpers/blobs_settings.js";
import {
    drawBlobFactoryToCanvas,
    getInterpolatedThemeColor,
} from "~/client/blobs/helpers/draw_blobs_factory.js";
import {generateBlobsForContent} from "~/client/blobs/helpers/generate_blobs_for_content.js";
import {blobScriptString} from "~/client/blobs/script/blobs_script_string.js";
import {
    getColorSchemeWithoutListeningIfBrowser,
    useColorScheme,
} from "~/client/helpers/color_scheme.js";
import {ScriptBeforeAppInitialRender} from "~/client/helpers/lifecycle/script_before_initial_app_render.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {blobsArtStyles, sprinkles} from "~/client/styles/styles.js";
import {colors} from "~/shared/design/core/colors.js";
import {easeInOutSin} from "~/shared/design/core/easing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {
    dangerouslyCreateSafeString,
    safe,
    safeFlatObjectString,
    safeIdentifierString,
} from "~/shared/helpers/string/safe_string.js";

type BlobArtProps = {
    settings: Memo<
        Partial<BlobsSettings> & {
            seed: BlobsSettings["seed"];
            themeColor: BlobsSettings["themeColor"];
            hueSpread: BlobsSettings["hueSpread"];
        }
    >;
    scale?: number;
};

function BlobsArtComponent({
    settings: passedSettings,
    scale,
}: BlobArtProps & {style?: React.CSSProperties}) {
    const settings: BlobsSettings = useMemo(
        () => ({
            ...blobsDefaultSettings,
            ...passedSettings,
        }),
        [passedSettings],
    );

    const displayCanvasRef = useRef<HTMLCanvasElement>(null);

    const colorScheme = useColorScheme();
    const backgroundColor = colorScheme === "light" ? "grey-0" : "grey-100";
    const baseThemeColor = getInterpolatedThemeColor(
        colorScheme === "dark" ? settings.colorLevelInsideDark : settings.colorLevelInsideLight,
        settings.themeColor,
    );
    const hueBias = 360 - assertExists(baseThemeColor.lch().object().h);

    const blobs = useMemo(() => {
        return generateBlobsForContent({
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
    }, [settings]);

    useLayoutEffectWithoutServerSideWarning(() => {
        const actualColorScheme = colorScheme ?? getColorSchemeWithoutListeningIfBrowser();
        const canvas = assertExists(displayCanvasRef.current);

        drawBlobFactoryToCanvas(
            canvas,
            window.devicePixelRatio,
            {
                ...settings,
                hueBias,
                colorLevelInside:
                    actualColorScheme === "dark"
                        ? settings.colorLevelInsideDark
                        : settings.colorLevelInsideLight,
                colorLevelOutside:
                    actualColorScheme === "dark"
                        ? settings.colorLevelOutsideDark
                        : settings.colorLevelOutsideLight,
                backgroundColor,
            },
            blobs,
        );
    }, [backgroundColor, blobs, colorScheme, hueBias, settings]);

    // We need a predictable ID for the canvas so that the server-side script can draw to it.
    // This must then translate to the same ID on the client.
    const canvasId = getBlobsCanvasId(settings);

    // The canvas is rendered on the server, but we can't draw to it via this component.
    // Instead, we copy the commands ran in generateBlobsForContent and drawBlobFactoryToCanvas
    // in the server-side script. See the draw_ssr package.
    const generateBlobs = safe`__drawBlobs('${safeIdentifierString(
        canvasId,
    )}', ${safeFlatObjectString(settings)})`;

    const serverSideRenderingScripts = (
        <>
            <ScriptBeforeAppInitialRender script={dangerouslyCreateSafeString(blobScriptString)} />
            <ScriptBeforeAppInitialRender script={generateBlobs} />
        </>
    );

    return (
        <div
            className={blobsArtStyles.containerClassName}
            aria-hidden="true"
            style={{
                height: blobsCanvasHeightPx,
            }}
        >
            <canvas
                ref={displayCanvasRef}
                data-blob-id={canvasId}
                width={blobsCanvasWidthPx}
                height={blobsCanvasHeightPx}
                className={sprinkles({
                    position: "absolute",
                    inset: "0",
                    width: "full",
                    height: "full",
                })}
                style={{
                    width: blobsCanvasWidthPx,
                    left: `calc(-1 * (${blobsCanvasWidthPx / 2}px + 100%))`,
                    transform: scale ? `scale(${scale})` : undefined,
                    transformOrigin: "center top",
                }}
                data-testid={process.env.NODE_ENV !== "production" ? `BlobArtCanvas` : undefined}
            />
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
            {serverSideRenderingScripts}
        </div>
    );
}

export const BlobsArt = memo(BlobsArtComponent);
