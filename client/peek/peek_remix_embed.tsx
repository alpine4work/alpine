import {RemixEntryContext} from "@remix-run/react/dist/esm/components";
import {createTransitionManager} from "@remix-run/react/dist/esm/transition";
import {createMemoryHistory} from "history";
import {useContext, useEffect, useMemo, useState} from "react";
import {UNSAFE_RouteContext as RouteContext} from "react-router";
import {Router, useRoutes} from "react-router-dom";
import {InternalError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";

export function PeekRemixEmbed() {
    const remixEntryContext = useContext(RemixEntryContext);
    assert(remixEntryContext, "Expected Remix entry context");

    const [history] = useState(() =>
        createMemoryHistory({
            // NOCOMMIT: Actual initial entries!
            initialEntries: ["/internal/virtualized"],
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
            // NOCOMMIT: Start with the real location!
            location: createMemoryHistory().location,
            loaderData: {
                // NOCOMMIT: Actual loader data!
                root: remixEntryContext.routeData.root,
            },
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

    return (
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
    );
}

function PeekRemixEmbedRoutes() {
    const remixEntryContext = useContext(RemixEntryContext);
    assert(remixEntryContext, "Expected Remix entry context");

    const internalClientRoutes = useMemo(() => {
        try {
            assert(remixEntryContext.clientRoutes.length === 1);
            const rootClientRoute = remixEntryContext.clientRoutes[0]!;
            assert(rootClientRoute.id === "root");
            const internalClientRoute = assertExists(
                rootClientRoute.children?.find(clientRoute => clientRoute.id === "routes/internal"),
            );
            return [internalClientRoute];
        } catch (error) {
            throw InternalError.from(error, "Could not find `/internal` Remix client route");
        }
    }, [remixEntryContext.clientRoutes]);

    return useRoutes(internalClientRoutes);
}
