import {RemixEntryContext} from "@remix-run/react/dist/esm/components";
import {AppState} from "@remix-run/react/dist/esm/errors";
import {createTransitionManager} from "@remix-run/react/dist/esm/transition";
import {Path, createMemoryHistory} from "history";
import {Context, Ref, useContext, useEffect, useImperativeHandle, useMemo, useState} from "react";
import {UNSAFE_RouteContext as RouteContext} from "react-router";
import {Router, useRoutes} from "react-router-dom";
import {useNavigate} from "~/client/remix/use_navigate";
import {InternalError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";

type RemixEntryContextType = typeof RemixEntryContext extends Context<infer ContextType>
    ? NonNullable<ContextType>
    : never;

/**
 * Embeds an instance of Remix with in-memory navigation that only renders
 * peek routes in our broader app. This gives a much better experience than
 * `<iframe>`s since the embed can still talk to the larger app.
 */
export function PeekRemixEmbed({
    initialPath,
    initialLoaderData,
    onExpandRef,
}: {
    initialPath: Path;
    initialLoaderData: {[key: string]: unknown};
    onExpandRef: Ref<(() => Promise<void>) | null>;
}) {
    const remixEntryContext = useContext(RemixEntryContext);
    assert(remixEntryContext, "Expected Remix entry context");
    const navigate = useNavigate();

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

    // Oh look! Remix internals.
    //
    // For peeks we want to create a mini navigation context embedded in our
    // app. We want that navigation context to have the same behaviors as
    // navigating in our app more generally:
    //
    // - Wait to navigate while loader data and route modules load
    // - Use the same `useNavigate()` hooks in component code which automatically
    //   go to the right place
    // - Data load is powered by a Remix loader function
    //
    // However, we want our embedded peek navigation stack to be separate from the
    // browser's navigation stack. You should be able to navigate in the browser
    // and navigate in the peek independently.
    //
    // To accomplish this we reuse Remix's data loading and routing internals to
    // create, effectively, another instance of Remix! This is very undocumented,
    // will be tricky to upgrade, and requires some patching of Remix and React
    // Router. However, the effect it creates is incredible and differentiates
    // us from other productivity tools. You have (multiple) full navigation
    // contexts on the page at once.
    //
    // Here we create a Remix transition manager which is responsible for loading
    // data and route modules from the server. Code is derived from root level
    // Remix here:
    // https://github.com/remix-run/remix/blob/32337757eba981e5d9705e40ad084d9d5c2d2bf2/packages/remix-react/components.tsx#L117-L127
    const [transitionManager] = useState(() =>
        createTransitionManager({
            routes: remixEntryContext.clientRoutes,
            location: historyState.location,
            loaderData: initialLoaderData,
            onRedirect: (to, state) => history.replace(to, state),
        }),
    );

    const [transitionState, setTransitionState] = useState(() => transitionManager.getState());

    useEffect(() => {
        setTransitionState(transitionManager.getState());
        return transitionManager.subscribe(setTransitionState);
    }, [transitionManager]);

    // The way Remix performs a navigation is the developer will push a new entry
    // to `history`, then we send `history`'s new location to `transitionManager`.
    // `transitionManager` kicks off loading the new route's data and modules
    // (cancelling any other pending transition). Finally once the data is loaded
    // `transitionManager`s state will update which actually renders the route.
    //
    // So there's this period where the location in `history` and
    // `transitionManager` are not in sync. Be careful.
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

    useImperativeHandle(
        onExpandRef,
        () => async () => {
            const match = historyState.location.pathname.match(/^(\/s\/[a-zA-Z0-9]+)\/peek(\/.*)/);
            if (!match) throw new InternalError("Can only expand peek routes");
            const pathnamePart1 = match[1]!;
            const pathnamePart2 = match[2]!;
            await navigate(`${pathnamePart1}${pathnamePart2}`);
        },
        [historyState.location.pathname, navigate],
    );

    return (
        <RemixEntryContext.Provider value={embedRemixEntryContent}>
            <RouteContext.Provider
                // The `<Router>` component does not reset this context but it needs to be reset
                // or else when we try to render nested routes they think they are within the
                // context of our parent router. Initial value can be found here:
                // https://github.com/remix-run/react-router/blob/230d9e5539c410c0c747db8670ec5de1d51558ae/packages/react-router/lib/context.ts#L143-L146
                //
                // See our comment below on how rendering nested `<Router>`s is not officially
                // supported.
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
                    // React Router has an assertion which bans you from rendering a `<Router>`
                    // inside of another `<Router>`. Likely to avoid developers making silly
                    // mistakes.
                    //
                    // However, we have a real use case! We want to render a `<Router>` powered by
                    // in-memory history within our Remix `<Router>` powered by browser history.
                    //
                    // So we patch `react-router` to add this prop here that turns off the
                    // assertion. Nested `<Router>`s are therefore not officially supported so we
                    // take all responsibility for making sure it works well.
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

    // We only want to allow peek routes to be rendered from a peek embed. So take
    // the full route tree from our remix context and create a new tree with just
    // the peek routes.
    //
    // A warning will be logged if you try to access a non-peek URL from this
    // instance of React Router.
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
