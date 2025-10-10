import {Memo, memo, useEffect, useMemo} from "react";
import {createPortal} from "react-dom";
import {
    BlobsSettings,
    blobsDefaultSettings,
    getBlobsCanvasId,
    getBlobsCanvasSize,
} from "~/client/blobs/helpers/blobs_settings.js";
import {Box} from "~/client/design/box.js";
import {useOverlayPortalElement} from "~/client/design/overlay_helpers.js";
import {ScriptBeforeAppInitialRender} from "~/client/helpers/lifecycle/script_before_initial_app_render.js";
import {peekStackOverlayBorderRadius} from "~/client/styles/peek_shared_styles.js";
import {blobsArtStyles} from "~/client/styles/styles.js";
import {blobsArtGradientClassName} from "~/shared/design/core/constant_class_names.js";
import {
    safe,
    safeFlatObjectString,
    safeIdentifierString,
    safeNumber,
} from "~/shared/helpers/string/safe_string.js";

type BlobsArtProps = {
    settings: Memo<
        Partial<BlobsSettings> & {
            seed: BlobsSettings["seed"];
            themeColor: BlobsSettings["themeColor"];
            hueSpread: BlobsSettings["hueSpread"];
        }
    >;
    scale?: number;
    withBezelTop?: boolean;
    withBezelX?: boolean;
};

const BlobsArtMemo = memo(BlobsArt);
export {BlobsArtMemo as BlobsArt};

declare global {
    interface Window {
        __drawBlobs: (blobCanvasId: string, settings: BlobsSettings, scale?: number) => void;
    }
}

function BlobsArt({settings: passedSettings, scale, withBezelTop, withBezelX}: BlobsArtProps) {
    const settings: BlobsSettings = useMemo(
        () => ({
            ...blobsDefaultSettings,
            ...passedSettings,
        }),
        [passedSettings],
    );

    // We need a predictable ID for the canvas so that the server-side script can draw to it.
    // This must then translate to the same ID on the client.
    const canvasId = getBlobsCanvasId(settings, scale);
    const safeCanvasId = safeIdentifierString(canvasId);

    // If our settings change, redraw the blobs.
    useEffect(() => {
        if (typeof window === "undefined") return;
        window.__drawBlobs(canvasId, settings, scale);
    }, [canvasId, settings, scale]);

    // The canvas is rendered on the server, but we can't draw to it via this component.
    // Instead, we copy the commands ran in generateBlobsForContent and drawBlobFactoryToCanvas
    // in the server-side script. See the blobs/script package.
    // eslint-disable-next-line string-quotes
    const generateBlobs = safe`window.__drawBlobs('${safeCanvasId}', ${safeFlatObjectString(
        settings,
    )}, ${safeNumber(scale || 1)})`;

    return (
        <>
            <div
                className={blobsArtStyles.containerClassName}
                aria-hidden="true"
                // Our blob `<script>` writes a `style` attribute on this element. Tell React
                // not to log a hydration warning, this is expected.
                suppressHydrationWarning
            >
                <canvas
                    className={blobsArtStyles.canvasClassName}
                    data-blob-id={canvasId}
                    data-testid={
                        process.env.NODE_ENV !== "production" ? `BlobsArtCanvas` : undefined
                    }
                    // Our blob `<script>` writes a `style` attribute on this element. Tell React
                    // not to log a hydration warning, this is expected.
                    suppressHydrationWarning
                />
                <div
                    className={blobsArtGradientClassName}
                    // Our blob `<script>` writes a `style` attribute on this element. Tell React
                    // not to log a hydration warning, this is expected.
                    suppressHydrationWarning
                />
                <ScriptBeforeAppInitialRender script={generateBlobs} />
            </div>
            {(withBezelTop || withBezelX) && (
                <BlobsArtBezel withTop={withBezelTop} withX={withBezelX} />
            )}
        </>
    );
}

// Adds a "bezel" effect when blobs are rendered within a peek stack overlay.
// It doesn't look good when blobs run up against the edge of a peek because
// the light grey border looks muddy next to the vibrant blob colors. This
// bezel (2px border around the edge of the blob art) adds contrast that makes
// sure blobs don't look muddy in a peek.
//
// The implementation is a little delicate. Because we want the bezel to only
// cover blobs not anything else (e.g. the navigation bar bottom border that
// shows up after scrolling). Also, while blobs scroll with content the bezel
// needs to stick to the top of the peek. It's easy enough to render the
// left/right bezel (absolute positioned element). But we need render the top
// bezel with a portal into the nearest `<OverlayScopeContextProvider>` so it
// can be sticky. This depends on cooperation from the parent component which
// needs to render `<BlobsArt>` at the right place to make sure it finds the
// right `<OverlayScopeContextProvider>`.
function BlobsArtBezel({withTop, withX}: {withTop?: boolean; withX?: boolean}) {
    const overlayPortalElement = useOverlayPortalElement();

    const canvasSize = getBlobsCanvasSize();

    return (
        <>
            {withX && (
                <Box
                    position="absolute"
                    top="0"
                    left="0"
                    right="0"
                    zIndex="10"
                    pointerEvents="none"
                    border="grey-0"
                    borderTop="none"
                    borderBottom="none"
                    borderWidth="thick"
                    style={{height: canvasSize.height}}
                />
            )}
            {withTop &&
                overlayPortalElement &&
                createPortal(
                    <Box
                        position="absolute"
                        top="0"
                        left="0"
                        right="0"
                        height="4"
                        zIndex="10"
                        pointerEvents="none"
                        border="grey-0"
                        borderBottom="none"
                        borderWidth="thick"
                        borderTopRadius={peekStackOverlayBorderRadius}
                    />,
                    overlayPortalElement,
                )}
        </>
    );
}
