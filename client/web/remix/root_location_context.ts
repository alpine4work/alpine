import {Location} from "@remix-run/router";
import {createContext, useContext} from "react";
import {useLocation} from "react-router-dom";

/**
 * Context that provides access to the "root" browser router location.
 *
 * When code runs inside a peek (which uses its own memory router), `useLocation()`
 * returns the peek's memory router location. But sometimes we need access to the
 * main browser router's location - for example, to know what document/task the
 * user was viewing when they opened a chat in a peek.
 *
 * This context is set at the `PeekStackContextProvider` level and provides access
 * to the main browser router's location from anywhere, including inside peeks.
 */
export const RootLocationContext = createContext<Location | null>(null);

/**
 * Get the root browser router location.
 *
 * When called from inside a peek, this returns the main browser router's location
 * (e.g., the document the user was viewing when they opened the chat peek).
 *
 * When called from outside a peek, this falls back to `useLocation()` which is
 * equivalent to the root location.
 *
 * @returns The root browser router location
 */
export function useRootLocation(): Location {
    const rootLocationFromContext = useContext(RootLocationContext);
    const currentLocation = useLocation();

    // If we have a root location context (meaning we're potentially inside a peek),
    // use it. Otherwise fall back to the current location.
    return rootLocationFromContext ?? currentLocation;
}
