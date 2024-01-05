import {Outlet, ShouldRevalidateFunction} from "@remix-run/react";
import {LinkDescriptor} from "@remix-run/server-runtime";
import {Component, ReactNode, useContext, useEffect, useMemo, useRef} from "react";
import {
    UNSAFE_DataRouterStateContext as DataRouterStateContext,
    useLocation,
    useRouteError,
} from "react-router";
import {Box} from "~/client/design/box.js";
import {ContextMenuManager} from "~/client/design/context_menu.js";
import {doubleClickDelayMs} from "~/client/design/timing_constants.js";
import {
    attachDevConsoleForAccountInProduction,
    useDevConsoleSettingsObject,
} from "~/client/dev/dev_console.js";
import {isTextInputElement} from "~/client/helpers/elements/is_text_input_element.js";
import {GlobalKeyDownEvent} from "~/client/helpers/global_key_down_event.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render.js";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {PeekStackContextProvider} from "~/client/peek/peek_stack.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {getLoaderDataWithSchema} from "~/client/remix/get_loader_data_with_schema.js";
import {RootNavigationContextProvider} from "~/client/remix/use_navigate.js";
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
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {InboxModel} from "~/shared/notifications/inbox_model.js";
import {Schema} from "~/shared/schema/schema.js";
import {
    SearchOptions,
    SearchOptionsSchema,
    standardSearchOptions,
} from "~/shared/search/search_options.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";
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
    const error = useRouteError();
    const rawLoaderData = dataRouterStateContext.loaderData["routes/s.$spaceId"];
    const isInitialAppRender = useIsInitialAppRender();
    const clientInfo = useClientInfo();

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
        [string]
    >(
        null,
        // Reset search state whenever the location changes.
        [location.key],
    );

    // NOCOMMIT: This dev console interface is kinda janky
    const debugOptions: SearchOptions & {
        readonly isEnabled: boolean;
    } = useDevConsoleSettingsObject("searchDebugOptions", searchOptionsDevConsoleSettingsConfig);

    // On initial render, if there's a `search` query parameter then open our
    // search modal.
    useEffect(() => {
        if (isInitialAppRender) return;

        const url = new URL(window.location.href);

        if (url.searchParams.has("search")) {
            const initialQueryText = url.searchParams.get("search") ?? "";

            setSearchState(searchState => {
                if (searchState) return searchState;
                return {initialQueryText};
            });
        }
    }, [isInitialAppRender, setSearchState]);

    const lastShiftKeyDownTimeRef = useRef<number | null>(null);

    return (
        <GlobalKeyDownEvent
            onGlobalKeyDown={event => {
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

                    // Double shift opens the search modal.
                    case "Shift": {
                        if (!event.altKey && !event.metaKey && !event.ctrlKey) {
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
                        <Box
                            display="flex"
                            flexDirection="column"
                            height="full"
                            overflow="hidden"
                            position="relative"
                            zIndex="0"
                        >
                            <PeekStackContextProvider>
                                <SpaceLayoutTopBar
                                    space={space}
                                    initialInbox={inbox}
                                    onSearchInputPress={() => {
                                        setSearchState(searchState => {
                                            if (searchState) return searchState;
                                            return {initialQueryText: ""};
                                        });
                                    }}
                                />
                                {error !== undefined ? (
                                    <SpaceRouteErrorRenderer error={error} />
                                ) : (
                                    <Outlet />
                                )}
                            </PeekStackContextProvider>
                        </Box>
                        {searchState && (
                            <SearchModalErrorBoundary>
                                <SearchModal
                                    initialQueryText={searchState.initialQueryText}
                                    onClose={() => setSearchState(null)}
                                    debugOptions={debugOptions.isEnabled ? debugOptions : null}
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

const searchOptionsDevConsoleSettingsConfig = {
    isEnabled: {
        defaultValue: false,
        schema: Schema.boolean,
    },
    ...Object.fromEntries(
        mapIterable(SearchOptionsSchema.propertySchemaByKey, ([key, propertySchema]) => [
            key,
            {
                defaultValue: (standardSearchOptions as any)[key],
                schema: propertySchema.valueSchema,
            },
        ]),
    ),
} as {
    isEnabled: {
        defaultValue: boolean;
        schema: Schema<boolean>;
    };
} & {
    [Key in keyof SearchOptions]: {
        defaultValue: SearchOptions[Key];
        schema: Schema<SearchOptions[Key]>;
    };
};

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
