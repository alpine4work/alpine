import {RemixEntryContext} from "@remix-run/react/dist/esm/components";
import {AppState} from "@remix-run/react/dist/esm/errors";
import {createTransitionManager} from "@remix-run/react/dist/esm/transition";
import {Path, createMemoryHistory} from "history";
import {Context, useContext, useEffect, useMemo, useState} from "react";
import {UNSAFE_RouteContext as RouteContext} from "react-router";
import {Router, useRoutes} from "react-router-dom";
import {Take} from "~/client/peek/internal/take";
import {InternalError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";

type RemixEntryContextType = typeof RemixEntryContext extends Context<infer ContextType>
    ? NonNullable<ContextType>
    : never;

export function PeekRemixEmbed({
    initialPath,
    initialLoaderData,
}: {
    initialPath: Path;
    initialLoaderData: Take<{[key: string]: unknown}>;
}) {
    const remixEntryContext = useContext(RemixEntryContext);
    assert(remixEntryContext, "Expected Remix entry context");

    const [history] = useState(() =>
        createMemoryHistory({
            initialEntries: [initialPath],
        }),
    );

    const [historyState, setHistoryState] = useState(() => ({
        action: history.action,
        location: history.location,
    }));

    useEffect(() => {
        // Update to the latest history state before listening for updates.
        setHistoryState(historyState => {
            if (
                historyState.action === history.action &&
                historyState.location === history.location
            ) {
                return historyState;
            }
            return {
                action: history.action,
                location: history.location,
            };
        });

        return history.listen(setHistoryState);
    }, [history]);

    // NOCOMMIT: Document all the internals we're using
    const [transitionManager] = useState(() =>
        createTransitionManager({
            routes: remixEntryContext.clientRoutes,
            location: historyState.location,
            loaderData: initialLoaderData.take(),
            onRedirect: (to, state) => history.replace(to, state),
        }),
    );

    const [transitionState, setTransitionState] = useState(() => transitionManager.getState());

    useEffect(() => {
        setTransitionState(transitionManager.getState());
        return transitionManager.subscribe(setTransitionState);
    }, [transitionManager]);

    useEffect(() => {
        const transitionState = transitionManager.getState();
        if (transitionState.location === historyState.location) return;

        void transitionManager.send({
            type: "navigation",
            action: historyState.action,
            location: historyState.location,
        });
    }, [historyState.action, historyState.location, transitionManager]);

    // TODO(calebmer): I'll admit I don't fully understand what this is doing.
    // Something with error boundaries? Do we care about supporting error
    // boundaries here? Code here is from:
    // https://github.com/remix-run/remix/blob/32337757eba981e5d9705e40ad084d9d5c2d2bf2/packages/remix-react/components.tsx#L131-L139
    const embedAppState: AppState = useMemo(
        () => ({
            catch: transitionState.catch,
            error: transitionState.error,
            catchBoundaryRouteId: transitionState.catchBoundaryId,
            loaderBoundaryRouteId: transitionState.errorBoundaryId,
            renderBoundaryRouteId: null,
            trackBoundaries: false,
            trackCatchBoundaries: false,
        }),
        [transitionState],
    );

    const embedRemixEntryContent: RemixEntryContextType = useMemo(
        () => ({
            // All our code and asset resources are shared between the parent and child
            // Remix contexts.
            manifest: remixEntryContext.manifest,
            routeModules: remixEntryContext.routeModules,
            clientRoutes: remixEntryContext.clientRoutes,

            // Data loading and navigation is overridden for our child Remix context.
            matches: transitionState.matches,
            routeData: transitionState.loaderData,
            actionData: transitionState.actionData,
            appState: embedAppState,
            transitionManager,

            // Unused in peek embeds since they aren't server-side rendered and don't
            // include `<scripts>`.
            serverHandoffString: "{}",
        }),
        [embedAppState, remixEntryContext, transitionManager, transitionState],
    );

    return (
        <RemixEntryContext.Provider value={embedRemixEntryContent}>
            <RouteContext.Provider
                // NOCOMMIT: Document how we need to reset this context
                value={useMemo(
                    () => ({
                        outlet: null,
                        matches: [],
                    }),
                    [],
                )}
            >
                <Router
                    navigationType={historyState.action}
                    location={transitionState.location}
                    navigator={history}
                    // NOCOMMIT: Document this
                    dangerouslyAllowNesting={true}
                >
                    <PeekRemixEmbedRoutes />
                </Router>
            </RouteContext.Provider>
        </RemixEntryContext.Provider>
    );
}

function PeekRemixEmbedRoutes() {
    const remixEntryContext = useContext(RemixEntryContext);
    assert(remixEntryContext, "Expected Remix entry context");

    const routes = useMemo(() => {
        try {
            assert(remixEntryContext.clientRoutes.length === 1);
            const rootRoute = remixEntryContext.clientRoutes[0]!;
            assert(rootRoute.id === "root");
            const spaceRoute = assertExists(
                rootRoute.children?.find(route => route.id === "routes/s/$space_id"),
            );
            const spacePeekRoute = assertExists(
                spaceRoute.children?.find(route => route.id === "routes/s/$space_id/peek"),
            );
            return [
                {
                    caseSensitive: spaceRoute.caseSensitive,
                    path: spaceRoute.path,
                    children: [spacePeekRoute],
                },
            ];
        } catch (error) {
            throw InternalError.from(error, "Could not find `/internal` Remix client route");
        }
    }, [remixEntryContext.clientRoutes]);

    return useRoutes(routes);
}
