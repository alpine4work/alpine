import {Router, RouterNavigateOptions, To} from "@remix-run/router";
import {useCallback, useMemo, useRef} from "react";
import {UNSAFE_RouteContext as RouteContext, RouterProvider} from "react-router";
import {StaticRouterProvider} from "react-router-dom/server.js";
import {BottomBarFrameContextProvider} from "~/client/web/design/bottom_bar_frame_context_provider.js";
import {OverlayScopeContextProvider} from "~/client/web/design/overlay_scope_context_provider.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {PeekRemixEmbedRouter} from "~/client/web/peek/peek_remix_embed_router.js";
// eslint-disable-next-line cyberworlds/no-internal-imports
import {PeekContextDefinition} from "~/client/web/remix/internal/peek_context_definition.js";
import {UpdateMetaTitleContextProvider} from "~/client/web/remix/use_update_meta_title.js";
import {RouteLayout} from "~/shared/design/core/route_layout.js";
import {PeekId} from "~/shared/id/types/id_types.js";

/**
 * Embeds an instance of Remix with in-memory navigation that only renders
 * peek routes in our broader app. This gives a much better experience than
 * `<iframe>`s since the embed can still talk to the larger app.
 */
export function PeekRemixEmbed({
    peekId,
    layout,
    withinStack = false,
    withoutSearchAffinityViewEntityInteraction = false,
    router: originalRouter,
    onGoBackOverflow,
}: {
    peekId: PeekId;
    layout: RouteLayout;
    withinStack?: boolean;
    withoutSearchAffinityViewEntityInteraction?: boolean;
    router: PeekRemixEmbedRouter;
    onGoBackOverflow?: () => void;
}) {
    const onGoBackOverflowRef = useRef(onGoBackOverflow);

    useLayoutEffectWithoutServerSideWarning(() => {
        onGoBackOverflowRef.current = onGoBackOverflow;
    });

    const router: Router = useMemo(() => {
        return {
            ...originalRouter,

            // Spreading copies the current value of getters so manually override
            // the getters.
            // https://github.com/remix-run/react-router/blob/bc2552840147206716544e5cdcdb54f649f9193f/packages/router/router.ts#L2508-L2516
            get basename() {
                return originalRouter.basename;
            },
            get state() {
                return originalRouter.state;
            },
            get routes() {
                return originalRouter.routes;
            },

            // If we are navigating a relative number of steps (e.g. -1) then detect if we
            // are navigating backwards beyond the number of entries in our router. If so
            // we want to call `onGoBackOverflow()`.
            navigate: (to: number | To | null, options?: RouterNavigateOptions): Promise<void> => {
                if (typeof to === "number") {
                    const remainingEntryCount = originalRouter.getHistoryIndex();

                    if (to < 0 && -to > remainingEntryCount) {
                        if (remainingEntryCount > 0) {
                            const promise = originalRouter.navigate(-remainingEntryCount);
                            onGoBackOverflowRef.current?.();
                            return promise;
                        } else {
                            onGoBackOverflowRef.current?.();
                            return Promise.resolve();
                        }
                    } else {
                        return originalRouter.navigate(to);
                    }
                }

                return originalRouter.navigate(to, options);
            },
        };
    }, [originalRouter]);

    return (
        <OverlayScopeContextProvider
        // Make sure any overlays from the peek render here so if they're in
        // `<PeekStack>` they get the `greyElevatedClassName` styles.
        >
            <PeekContextDefinition.Provider
                value={useMemo(
                    () => ({
                        id: peekId,
                        layout,
                        withinStack,
                        withoutSearchAffinityViewEntityInteraction,
                    }),
                    [layout, peekId, withinStack, withoutSearchAffinityViewEntityInteraction],
                )}
            >
                <UpdateMetaTitleContextProvider
                    // Ignore title updates in a Remix embed. We currently don't render the title
                    // of a Remix embed though may in the future when allowing the user to navigate
                    // through embeds.
                    onUpdateMetaTitle={useCallback(() => {}, [])}
                >
                    <BottomBarFrameContextProvider
                    // Create a different bottom bar scope in every peek. So bottom bar changes in
                    // one don't end up scrolling `useScrollToAvoidBottomBarsAndMobileKeyboard()`
                    // listeners outside the peek.
                    >
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
                                    isDataRoute: false,
                                }),
                                [],
                            )}
                        >
                            {typeof window === "undefined" ? (
                                // When server-rendering use `<StaticRouterProvider>` like `<AppRemixServer>`.
                                // `<StaticRouterProvider>` is carefully written to have the same DOM structure
                                // as `<RouterProvider>` for hydration.
                                // https://github.com/remix-run/remix/blob/1c416b0b9baadbd75974ee72efb651b8186670cb/packages/remix-react/server.tsx#L27
                                <StaticRouterProvider
                                    router={router}
                                    context={{
                                        basename: router.basename,
                                        location: router.state.location,
                                        matches: router.state.matches,
                                        loaderData: router.state.loaderData,
                                        actionData: router.state.actionData,
                                        errors: router.state.errors,
                                        statusCode: 200,
                                        loaderHeaders: {},
                                        actionHeaders: {},
                                        activeDeferreds: null,
                                    }}
                                    hydrate={false}
                                    // See comment below on `dangerouslyAllowNesting`...
                                    dangerouslyAllowNesting={true}
                                />
                            ) : (
                                <RouterProvider
                                    router={router}
                                    fallbackElement={null}
                                    future={{v7_startTransition: true}}
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
                                />
                            )}
                        </RouteContext.Provider>
                    </BottomBarFrameContextProvider>
                </UpdateMetaTitleContextProvider>
            </PeekContextDefinition.Provider>
        </OverlayScopeContextProvider>
    );
}
