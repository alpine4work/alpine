import {BlobsSettings} from "~/client/blobs/helpers/blobs_settings.js";
import {HTMLCanvasElementWithBlobSettings} from "~/client/blobs/helpers/blobs_types.js";
import {blobScriptString} from "~/client/blobs/script/blobs_script_string.js";
import {useColorScheme} from "~/client/helpers/color_scheme.js";
import {ScriptBeforeAppInitialRender} from "~/client/helpers/lifecycle/script_before_initial_app_render.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {dangerouslyCreateSafeString} from "~/shared/helpers/string/safe_string.js";

declare global {
    interface Window {
        __drawBlobs: (blobCanvasId: string, settings: BlobsSettings) => void;
    }
}

/**
 * Exposes the blob art script on the window as __drawBlobs.
 * This allows us to store the function in a global context, allowing
 * other scripts to call it without needing to hold a copy.
 */
export function BlobsArtProvider() {
    const colorScheme = useColorScheme();

    // If our color scheme changes, redraw the blobs.
    // Some blobs may not be drawn in a react context, so we handle the color scheme here.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (typeof window === "undefined") return;
        const canvases = document.querySelectorAll("canvas[data-blob-id]");

        canvases.forEach(canvas => {
            const canvasId = canvas.getAttribute("data-blob-id");
            const blobsSettings = (canvas as HTMLCanvasElementWithBlobSettings)._blobsSettings;

            // If the canvas ID or dataDrawn attributes are not set, skip drawing.
            // If the blobSettings attribute is not set, it means the blobs have not been drawn yet.
            if (!canvasId || !blobsSettings) return;

            // Call the global draw function
            window.__drawBlobs(canvasId, blobsSettings);
        });
    }, [colorScheme]);

    return (
        <>
            <ScriptBeforeAppInitialRender script={dangerouslyCreateSafeString(blobScriptString)} />
        </>
    );
}
