import {Memo, memo, useEffect, useMemo} from "react";
import {
    BlobsSettings,
    blobsCanvasHeightPx,
    blobsCanvasWidthPx,
    blobsDefaultSettings,
    getBlobsCanvasId,
} from "~/client/blobs/helpers/blobs_settings.js";
import {useColorScheme} from "~/client/helpers/color_scheme.js";
import {ScriptBeforeAppInitialRender} from "~/client/helpers/lifecycle/script_before_initial_app_render.js";
import {blobsArtStyles, sprinkles} from "~/client/styles/styles.js";
import {
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
    const colorScheme = useColorScheme();
    const settings: BlobsSettings = useMemo(
        () => ({
            ...blobsDefaultSettings,
            ...passedSettings,
        }),
        [passedSettings],
    );

    // We need a predictable ID for the canvas so that the server-side script can draw to it.
    // This must then translate to the same ID on the client.
    const canvasId = getBlobsCanvasId(settings);

    useEffect(() => {
        if (typeof window === "undefined") return;
        // @ts-expect-error __drawBlobs is defined in the blobs script.
        window.__drawBlobs(canvasId, settings);
    }, [canvasId, settings, colorScheme]);

    /* eslint-disable string-quotes */

    // The canvas is rendered on the server, but we can't draw to it via this component.
    // Instead, we copy the commands ran in generateBlobsForContent and drawBlobFactoryToCanvas
    // in the server-side script. See the draw_ssr package.
    const generateBlobs = safe`__drawBlobs('${safeIdentifierString(
        canvasId,
    )}', ${safeFlatObjectString(settings)})`;

    /* eslint-enable string-quotes */

    return (
        <div
            className={blobsArtStyles.containerClassName}
            aria-hidden="true"
            style={{
                height: blobsCanvasHeightPx,
            }}
        >
            <canvas
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
                    left: `calc(50% - (${blobsCanvasWidthPx / 2}px))`,
                    transform: scale ? `scale(${scale})` : undefined,
                    transformOrigin: "center top",
                }}
                data-testid={process.env.NODE_ENV !== "production" ? `BlobArtCanvas` : undefined}
            />
            <div className={blobsArtStyles.gradientClassName} />
            <ScriptBeforeAppInitialRender script={generateBlobs} />
        </div>
    );
}

export const BlobsArt = memo(BlobsArtComponent);
