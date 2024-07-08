import {assert} from "~/shared/helpers/control/assert.js";

let remixIsLiveReloading = false;

export function setRemixIsLiveReloading(): void {
    assert(process.env.NODE_ENV === "development");
    remixIsLiveReloading = true;
}

/**
 * Is Remix currently reloading? Can only be true in development. Will disable
 * certain error messages among other things during the reload.
 */
export function isRemixLiveReloading(): boolean {
    return process.env.NODE_ENV === "development" && remixIsLiveReloading;
}
