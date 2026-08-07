import {createContext, useContext} from "react";
import {useLocalStorage} from "~/client/web/helpers/use_local_storage.js";
import {Schema} from "~/shared/schema/schema.open_source.js";

export const mediaDebugModeLocalStorageKey = "cyberworlds/mediaDebugMode";
export const MediaDebugModeSchema = Schema.boolean;
export const MediaDebugModeContext = createContext(false);

let mediaDebugModeEnabled = false;
const mediaDebugModeListeners = new Set<() => void>();

export function useMediaDebugModeLocalStorage() {
    return useLocalStorage(mediaDebugModeLocalStorageKey, MediaDebugModeSchema, false);
}

export function useMediaDebugModeEnabled() {
    return useContext(MediaDebugModeContext);
}

export function getMediaDebugModeEnabled() {
    return mediaDebugModeEnabled;
}

export function setMediaDebugModeEnabledForNonReact(isEnabled: boolean) {
    if (mediaDebugModeEnabled === isEnabled) return;

    mediaDebugModeEnabled = isEnabled;

    for (const listener of mediaDebugModeListeners) {
        listener();
    }
}

export function subscribeToMediaDebugModeChange(listener: () => void) {
    mediaDebugModeListeners.add(listener);

    return () => {
        mediaDebugModeListeners.delete(listener);
    };
}
