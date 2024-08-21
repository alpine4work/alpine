import {assert} from "~/shared/helpers/control/assert.js";

let devServerIsRestarting = false;

export function setDevServerIsRestarting(): void {
    assert(process.env.NODE_ENV === "development");
    devServerIsRestarting = true;
}

/**
 * Is our `AppService` currently shutting down? Can only be true in
 * development. Will disable WebSocket connection errors while shutting
 * down since we, understandably, can't reach our WebSocket servers.
 */
export function isDevServerRestarting(): boolean {
    return process.env.NODE_ENV === "development" && devServerIsRestarting;
}
