import {BlobsSettings} from "~/client/web/blobs/helpers/blobs_settings.js";
import {HTMLCanvasElementWithBlobSettings} from "~/client/web/blobs/helpers/blobs_types.js";
import {blobScriptString} from "~/client/web/blobs/script/blobs_script_string.js";
import {useColorScheme} from "~/client/web/helpers/color_scheme.js";
import {ScriptBeforeAppInitialRender} from "~/client/web/helpers/lifecycle/script_before_initial_app_render.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {dangerouslyCreateSafeString} from "~/shared/helpers/string/safe_string.js";

declare global {
    interface Window {
        __drawBlobs: (blobCanvasId: string, settings: BlobsSettings, scale?: number) => void;
    }
}

/**
 * Exposes the blob art script on the window as \_\_drawBlobs. This allows us to
 * store the function in a global context, allowing other scripts to call it
 * without needing to hold a copy.
 */
export function BlobsArtProvider() {
    const {colorScheme} = useColorScheme();

    // If our color scheme changes, redraw the blobs. Some blobs may not be drawn in a
    // react context, so we handle the color scheme here.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (typeof window === "undefined") return;
        const canvases = document.querySelectorAll("canvas[data-blob-id]");

        canvases.forEach(c => {
            const canvas = c as HTMLCanvasElementWithBlobSettings;
            const canvasId = canvas.getAttribute("data-blob-id");
            const blobsSettings = canvas._blobsSettings;
            const scale = canvas._blobsDrawn?.scale;

            // If the canvas ID or dataDrawn attributes are not set, skip drawing. If the
            // blobSettings attribute is not set, it means the blobs have not been drawn yet.
            if (!canvasId || !blobsSettings) return;

            // Call the global draw function
            window.__drawBlobs(canvasId, blobsSettings, scale);
        });
    }, [colorScheme]);

    return (
        <>
            <ScriptBeforeAppInitialRender script={dangerouslyCreateSafeString(blobScriptString)} />
        </>
    );
}
