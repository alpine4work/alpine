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
import {blobsArtStyles} from "~/client/styles/styles.js";
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

declare global {
    interface Window {
        __drawBlobs: (blobCanvasId: string, settings: BlobsSettings) => void;
    }
}

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
    const safeCanvasId = safeIdentifierString(canvasId);

    // If our settings change, redraw the blobs.
    useEffect(() => {
        if (typeof window === "undefined") return;
        window.__drawBlobs(canvasId, settings);
    }, [canvasId, settings, colorScheme]);

    // The canvas is rendered on the server, but we can't draw to it via this component.
    // Instead, we copy the commands ran in generateBlobsForContent and drawBlobFactoryToCanvas
    // in the server-side script. See the blobs/script package.
    // eslint-disable-next-line string-quotes
    const generateBlobs = safe`window.__drawBlobs('${safeCanvasId}', ${safeFlatObjectString(
        settings,
    )})`;

    return (
        <div
            className={blobsArtStyles.containerClassName}
            aria-hidden="true"
            style={{
                height: blobsCanvasHeightPx,
                width: blobsCanvasWidthPx,
                left: `calc(50% - (${blobsCanvasWidthPx / 2}px))`,
                transform: scale ? `scale(${scale})` : undefined,
            }}
        >
            <canvas
                className={blobsArtStyles.canvasClassName}
                data-blob-id={canvasId}
                width={blobsCanvasWidthPx}
                height={blobsCanvasHeightPx}
                data-testid={process.env.NODE_ENV !== "production" ? `BlobArtCanvas` : undefined}
            />
            <div className={blobsArtStyles.gradientClassName} />
            <ScriptBeforeAppInitialRender script={generateBlobs} />
        </div>
    );
}

export const BlobsArt = memo(BlobsArtComponent);
