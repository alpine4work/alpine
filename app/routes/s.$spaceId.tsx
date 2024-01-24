import {Outlet, ShouldRevalidateFunction} from "@remix-run/react";
import {LinkDescriptor} from "@remix-run/server-runtime";
import {Component, ReactNode, useContext, useEffect, useMemo, useRef} from "react";
import {
    UNSAFE_DataRouterStateContext as DataRouterStateContext,
    useLocation,
    useParams,
    useRouteError,
} from "react-router";
import {NativeMobileOutlet} from "~/app/router/native_mobile_outlet.js";
import {isNativeMobileRouterState} from "~/app/router/native_mobile_router.js";
import {useAppContext} from "~/client/context/app_context.js";
import {ContextMenuManager} from "~/client/design/context_menu.js";
import {doubleClickDelayMs} from "~/client/design/timing_constants.js";
import {
    attachDevConsoleForAccountInProduction,
    useDevConsoleTool,
} from "~/client/dev/dev_console.js";
import {isTextInputElement} from "~/client/helpers/elements/is_text_input_element.js";
import {GlobalKeyDownEvent} from "~/client/helpers/global_key_down_event.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render.js";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {useLocalStorage} from "~/client/helpers/use_local_storage.js";
import {PeekStackContextProvider, PeekStackContextProviderRef} from "~/client/peek/peek_stack.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {getLoaderDataWithSchema} from "~/client/remix/get_loader_data_with_schema.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {RootNavigationContextProvider} from "~/client/remix/use_navigate.js";
import {useUpdateMetaTitle} from "~/client/remix/use_update_meta_title.js";
import {SearchModal} from "~/client/search/search_modal.js";
import {SpaceLayoutTopBar} from "~/client/spaces/layout/space_layout_top_bar.js";
import {SpaceContextProvider} from "~/client/spaces/space_context.js";
import {SpaceRouteErrorRenderer} from "~/client/spaces/space_route_error_renderer.js";
import {TaskRealtimeClientContextProvider} from "~/client/tasks/task_realtime_client_context_provider.js";
import {getInbox} from "~/server/notifications/data/notifications_table.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getSpace} from "~/server/spaces/spaces_table.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {createDynamoGeneralRealtimeItemSchema} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {InboxModel} from "~/shared/notifications/inbox_model.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {
    SearchOptions,
    SearchOptionsSchema,
    standardSearchOptions,
} from "~/shared/search/search_options.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";
import {sprinkles} from "~/shared/styles/styles.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

export const LoaderSchema = Schema.object({
    space: SpaceModel.schema(),
    currentAccount: AccountModel.schema,
    inbox: createDynamoGeneralRealtimeItemSchema(InboxModel.schema()),
});

export function links(): Array<LinkDescriptor> {
    return [
        // Turn off scrolling on `body` when in a space which comes with a top bar.
        // This prevents over-scrolling up and down when at the top or bottom of a
        // nested scroll view.
        {rel: "stylesheet", href: `data:text/css,${encodeURIComponent("body {overflow: hidden}")}`},
    ];
}

// Run the loader again only when the `SpaceId` changes.
export const shouldRevalidate: ShouldRevalidateFunction = ({currentParams, nextParams}) =>
    currentParams.spaceId !== nextParams.spaceId;

export async function loader({context: loaderContext, params}: LoaderArgs) {
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? null);

    const context = (await loaderContext.actor.authenticate()).actor.authorizeSession();

    const [space, currentAccount, inbox] = await runAllPromises([
        getSpace(context, spaceId),
        context.actor.getAccount(),
        getInbox(context, {spaceId}),
    ]);

    const propagateEventData: TracerEventData = {
        context: {
            accountId: currentAccount.id,
            spaceId: space.id,
        },
    };

    return jsonWithSchema(
        LoaderSchema,
        {
            space,
            currentAccount,
            inbox,
        },
        {propagateEventData},
    );
}

const SearchDebugOptionsSchema = Schema.object({
    isDebugModeEnabled: Schema.boolean,
    options: SearchOptionsSchema,
});

const defaultSearchDebugOptionsSchema: SchemaType<typeof SearchDebugOptionsSchema> = {
    isDebugModeEnabled: false,
    options: standardSearchOptions,
};

const spaceNativeMobileOutletParentRouteIds = ["root", "routes/s.$spaceId"] as const;

/**
 * Routes that render under `/s/$spaceId` should generally render
 * `<SpaceRouteScrollView>` as their parent since it contains best practices for
 * a space route's content area. Ideally we would make it the default but some
 * routes need to opt-out and manage scrolling on their own
 * (e.g. virtualized lists).
 */
export default function SpaceLayoutRoute() {
    const dataRouterStateContext = assertExists(useContext(DataRouterStateContext));
    const location = useLocation();
    const params = useParams();
    const error = useRouteError();
    const rawLoaderData = dataRouterStateContext.loaderData["routes/s.$spaceId"];
    const context = useAppContext();
    const isInitialAppRender = useIsInitialAppRender();
    const updateMetaTitle = useUpdateMetaTitle();
    const clientInfo = useClientInfo();
    const isMobile = useIsMobile();

    const peekStackRef = useRef<PeekStackContextProviderRef>(null);

    // `useLoaderData()` doesn't work in an error boundary. We use this exact
    // component for error and catch boundaries to avoid remounting when navigating
    // between errors and non-errors. So manually deserialize the data for this
    // route.
    const loaderData = useMemo(
        () => (rawLoaderData ? getLoaderDataWithSchema(LoaderSchema, rawLoaderData) : null),
        [rawLoaderData],
    );

    // If it's our `/s/:spaceId` route throwing then we won't be able to render the
    // state chrome so let a parent error boundary handle it.
    if (!loaderData) throw error;

    const {space, currentAccount, inbox} = loaderData;

    useEffect(() => {
        attachDevConsoleForAccountInProduction(currentAccount);
    }, [currentAccount]);

    const [searchState, setSearchState] = useStateWithDependencies<
        {initialQueryText: string} | null,
        [string, boolean]
    >(
        null,
        // Reset search state when:
        //
        // - The location changes
        // - We switch from desktop mode to mobile mode
        [location.key, isMobile],
    );

    const [debugOptions, setDebugOptions] = useLocalStorage(
        "cyberworlds/searchDebugOptions",
        SearchDebugOptionsSchema,
        defaultSearchDebugOptionsSchema,
    );

    useDevConsoleTool("search", () => ({
        toggleDebugMode: () =>
            setDebugOptions({
                ...debugOptions,
                isDebugModeEnabled: !debugOptions.isDebugModeEnabled,
            }),

        getDebugOptions: () => debugOptions.options,
        setDebugOptions: (options: SearchOptions) =>
            setDebugOptions({isDebugModeEnabled: debugOptions.isDebugModeEnabled, options}),
        resetDebugOptions: () =>
            setDebugOptions({
                isDebugModeEnabled: debugOptions.isDebugModeEnabled,
                options: standardSearchOptions,
            }),
    }));

    // On initial render, if there's a `search` query parameter then open our
    // search modal.
    useEffect(() => {
        if (isInitialAppRender) return;

        // Don't open the search modal on mobile.
        //
        // NOCOMMIT: If we have the `search` param on mobile I think we should navigate
        // to the search page? To support that URL scheme.
        if (isMobile) return;

        const url = new URL(window.location.href);

        if (url.searchParams.has("search")) {
            const initialQueryText = url.searchParams.get("search") ?? "";

            setSearchState(searchState => {
                if (searchState) return searchState;
                return {initialQueryText};
            });
        }
    }, [isInitialAppRender, isMobile, setSearchState]);

    const lastShiftKeyDownTimeRef = useRef<number | null>(null);

    const nativeMobileRouterState = isNativeMobileRouterState(dataRouterStateContext)
        ? dataRouterStateContext
        : null;

    const nodes = [];
    let nodeKey = 1;

    const outletContainerClassName = sprinkles({
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
        zIndex: "0",
    });

    const outletContainerStyle = {height: "100vh"};

    if (!nativeMobileRouterState) {
        nodes.push(
            <div key={nodeKey++} className={outletContainerClassName} style={outletContainerStyle}>
                <SpaceLayoutTopBar
                    space={space}
                    initialInbox={inbox}
                    onSearchInputPress={() => {
                        // Don't open the search modal on mobile.
                        if (isMobile) return;

                        setSearchState(searchState => {
                            if (searchState) return searchState;
                            return {initialQueryText: ""};
                        });
                    }}
                />
                {error !== undefined ? <SpaceRouteErrorRenderer error={error} /> : <Outlet />}
            </div>,
        );
    } else {
        // In our native mobile app, render all inert routes for this `SpaceId`. We
        // render them here instead of `root.tsx` so we can share space context like
        // the task realtime client.
        //
        // To learn more about inert route rendering, there's a comment in `root.tsx`
        // on top of a similar loop over `nativeMobileRouterState.inertRouterStates`
        // you can read.
        for (const inertRouterState of nativeMobileRouterState.inertRouterStates) {
            if (
                !inertRouterState.matches.some(
                    match =>
                        match.route.id === "routes/s.$spaceId" &&
                        match.params.spaceId === params.spaceId,
                )
            ) {
                continue;
            }

            nodes.push(
                <NativeMobileOutlet
                    // Previous rendered routes need to preserve their keys if a new route is
                    // pushed. So the first route in our stack has a key of 1, the second 2, and so
                    // on. Newly pushed routes get new keys.
                    //
                    // We can't use `location.key` because if the URL is replaced then
                    // `location.key` changes but we don't want to fully remount our routes.
                    key={nodeKey++}
                    parentRouteIds={spaceNativeMobileOutletParentRouteIds}
                    tracer={context.tracer.getRoot()}
                    inertRouterState={inertRouterState}
                    onUpdateMetaTitle={updateMetaTitle}
                    className={outletContainerClassName}
                    style={outletContainerStyle}
                />,
            );
        }

        nodes.push(
            // NOTE(calebmer): There may be a cleaner way to handle errors. Since error
            // handling only happens for the primary route, if an inert route has an error
            // then nothing will be rendered in the inert route? That's probably fine.
            error !== undefined ? (
                <div
                    key={nodeKey++}
                    className={outletContainerClassName}
                    style={outletContainerStyle}
                >
                    <SpaceRouteErrorRenderer error={error} />
                </div>
            ) : (
                <NativeMobileOutlet
                    key={nodeKey++}
                    parentRouteIds={spaceNativeMobileOutletParentRouteIds}
                    tracer={context.tracer.getRoot()}
                    inertRouterState={null}
                    onUpdateMetaTitle={updateMetaTitle}
                    className={outletContainerClassName}
                    style={outletContainerStyle}
                />
            ),
        );
    }

    // Put the latest item in the history stack first in the DOM.
    if (nodes.length > 1) {
        nodes.reverse();
    }

    return (
        <GlobalKeyDownEvent
            onGlobalKeyDown={event => {
                // Double shift opens the search modal.
                if (
                    event.key === "Shift" &&
                    !event.altKey &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    // Don't open the search modal on mobile.
                    !isMobile
                ) {
                    event.preventDefault();
                    event.stopPropagation();

                    const currentTime = Date.now();
                    const lastShiftKeyDownTime = lastShiftKeyDownTimeRef.current;
                    lastShiftKeyDownTimeRef.current = currentTime;

                    if (
                        lastShiftKeyDownTime !== null &&
                        currentTime - lastShiftKeyDownTime < doubleClickDelayMs
                    ) {
                        setSearchState(searchState => {
                            if (searchState) return searchState;
                            return {initialQueryText: ""};
                        });
                    }
                    return;
                }

                // If the user presses a key other than `Shift` then reset the double shift
                // timer. This happens often when typing text like “I <3 NY” fast. Since you
                // type `Shift`, `I`, `Shift`, `,` (since `Shift+,` is `<`).
                lastShiftKeyDownTimeRef.current = null;

                switch (event.key) {
                    // Disable Home/End browser behavior. Don't let them scroll our page. Scrolling
                    // to the extremity of a lazy loaded virtualized scroll view with Home/End
                    // doesn't make sense. Forces the user to scroll continuously with the scroll
                    // wheel or scroll bar.
                    //
                    // Individual components may implement Home/End keyboard shortcuts. These
                    // shortcuts are focused on small, local, start/end navigations. Instead of full
                    // page disruptive navigations. (Which a user may trigger on accident.)
                    case "Home":
                    case "End": {
                        event.preventDefault();
                        event.stopPropagation();
                        break;
                    }

                    // Don't perform the browser default undo logic unless we are focused in a text
                    // input. The browser will pick the last text input you interacted with and undo
                    // from there which we don't want. Some of our more complex systems (like the
                    // task system) need careful control over what we undo.
                    case "z":
                    case "y": {
                        if (
                            (!document.activeElement ||
                                !isTextInputElement(document.activeElement)) &&
                            (clientInfo.isAppleDevice ? event.metaKey : event.ctrlKey)
                        ) {
                            event.preventDefault();
                            event.stopPropagation();
                        }
                        break;
                    }
                }
            }}
        >
            <RootNavigationContextProvider>
                <SpaceContextProvider
                    // Re-render everything when the space changes.
                    key={space.id}
                    space={space}
                    currentAccount={currentAccount}
                >
                    <TaskRealtimeClientContextProvider spaceId={space.id}>
                        <ContextMenuManager />
                        <PeekStackContextProvider ref={peekStackRef}>
                            {nodes}
                        </PeekStackContextProvider>
                        {searchState && (
                            <SearchModalErrorBoundary>
                                <SearchModal
                                    initialQueryText={searchState.initialQueryText}
                                    onClose={() => setSearchState(null)}
                                    pushPeekStack={async (to, options) => {
                                        await assertExists(peekStackRef.current).push(to, options);
                                    }}
                                    debugOptions={
                                        debugOptions.isDebugModeEnabled
                                            ? debugOptions.options
                                            : null
                                    }
                                />
                            </SearchModalErrorBoundary>
                        )}
                    </TaskRealtimeClientContextProvider>
                </SpaceContextProvider>
            </RootNavigationContextProvider>
        </GlobalKeyDownEvent>
    );
}

// We use the same component for the error boundary so we don't remount the
// space context and top bar if an error in a child component occurs.
//
// Making sure there's no remount on error requires careful patching to Remix
// and React Router.
export const ErrorBoundary = SpaceLayoutRoute;

/**
 * Protect against infinite error loops with `<SearchModal>`. If
 * `<SearchModal>` errs on initial render while rendering we'll re-render at
 * the nearest error boundary which will attempt to render `<SearchModal>`
 * again because `search` is in the URL causing an infinite error loop. With
 * this error boundary if `<SearchModal>` errs, we make sure not to render it
 * again by clearing `search` from the URL.
 */
class SearchModalErrorBoundary extends Component<{children: ReactNode}> {
    public override componentDidCatch(error: unknown) {
        const url = new URL(window.location.href);
        url.searchParams.delete("search");

        // Silently update the URL without telling Remix so our components don't
        // re-render unnecessarily.
        window.history.replaceState(null, "", url);

        throw error;
    }

    public override render() {
        return this.props.children;
    }
}
