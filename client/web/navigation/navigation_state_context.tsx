/* eslint-disable react-refresh/only-export-components */

import {Action} from "@remix-run/router";
import {ReactNode, createContext, useContext, useEffect, useMemo, useState} from "react";
import {useLocation, useNavigationType} from "react-router";
import {assert} from "~/shared/helpers/control/assert.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

const NavigationStateContext = createContext<NavigationState | null>(null);

const NavigationStateSchema = Schema.object({
    initialLocationKey: Schema.string,
    latestLocationKey: Schema.string,
    locationKey: Schema.string,
    hasNextLocation: Schema.boolean,
    hasPreviousLocation: Schema.boolean,
});

type NavigationState = SchemaType<typeof NavigationStateSchema>;

export function NavigationStateProvider({children}: {children?: ReactNode}) {
    const location = useLocation();
    const navigationType = useNavigationType();

    const [navigationState, setNavigationState] = useState<NavigationState>({
        initialLocationKey: location.key,
        latestLocationKey: location.key,
        locationKey: location.key,
        hasNextLocation: false,
        hasPreviousLocation: false,
    });

    if (navigationState.locationKey !== location.key) {
        setNavigationState({
            initialLocationKey: navigationState.initialLocationKey,
            latestLocationKey:
                navigationType === Action.Push ? location.key : navigationState.latestLocationKey,
            locationKey: location.key,
            hasNextLocation:
                navigationType === Action.Pop && location.key !== navigationState.latestLocationKey,
            hasPreviousLocation:
                navigationType === Action.Push ||
                location.key !== navigationState.initialLocationKey,
        });
    }

    // Read our current navigation state from `sessionStorage` and use it to
    // initialize our context's state.
    useEffect(() => {
        const navigationStateString = sessionStorage.getItem("cyberworlds/navigationState");
        if (navigationStateString) {
            setNavigationState(
                NavigationStateSchema.deserialize(JSON.parse(navigationStateString)),
            );
        }
    }, []);

    useEffect(() => {
        sessionStorage.setItem(
            "cyberworlds/navigationState",
            JSON.stringify(NavigationStateSchema.serialize(navigationState)),
        );
    }, [navigationState]);

    const value = useMemo<NavigationState>(
        () => ({
            initialLocationKey: navigationState.initialLocationKey,
            latestLocationKey: navigationState.latestLocationKey,
            locationKey: navigationState.locationKey,
            hasNextLocation: navigationState.hasNextLocation,
            hasPreviousLocation: navigationState.hasPreviousLocation,
        }),
        [navigationState],
    );

    return (
        <NavigationStateContext.Provider value={value}>{children}</NavigationStateContext.Provider>
    );
}

/**
 * Hook to access the current navigation state. Tracks the browser's location
 * history within Alpine to determine if forward/back navigation is possible.
 *
 * Must be used within a `NavigationStateProvider`.
 */
export function useNavigationState() {
    const context = useContext(NavigationStateContext);
    assert(context, "Expected the React tree to be rendered inside `<NavigationStateProvider>`");
    return context;
}
