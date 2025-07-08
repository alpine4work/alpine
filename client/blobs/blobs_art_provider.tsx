import {blobScriptString} from "~/client/blobs/script/blobs_script_string.js";
import {ScriptBeforeAppInitialRender} from "~/client/helpers/lifecycle/script_before_initial_app_render.js";
import {dangerouslyCreateSafeString} from "~/shared/helpers/string/safe_string.js";

/**
 * Exposes the blob art script on the window as __drawBlobs.
 * This allows us to store the function in a global context, allowing
 * other scripts to call it without needing to hold a copy.
 */
export function BlobsArtProvider() {
    return (
        <>
            <ScriptBeforeAppInitialRender script={dangerouslyCreateSafeString(blobScriptString)} />
        </>
    );
}
