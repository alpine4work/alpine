import {
    Links,
    Meta,
    Outlet,
    UNSAFE_RemixContext as RemixContext,
    Scripts,
    ScrollRestoration,
} from "@remix-run/react";
import {LinkDescriptor} from "@remix-run/server-runtime";
import {IconContext} from "phosphor-react";
import {
    ContextType,
    ReactElement,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    UNSAFE_DataRouterContext as DataRouterContext,
    UNSAFE_DataRouterStateContext as DataRouterStateContext,
} from "react-router";
import {stylesUrl} from "~/app/helpers/styles_url.js";
import {BazelBuildIndicator} from "~/app/router/bazel_build_indicator.js";
import {NativeMobileOutlet} from "~/app/router/native_mobile_outlet.js";
import {isNativeMobileRouterState} from "~/app/router/native_mobile_router.js";
import {RootErrorBoundary} from "~/app/router/root_error_boundary.js";
import {handleCopyEventIfNotTextInputElement} from "~/client/content/handle_copy_event_if_not_text_input_element.js";
import {handleDragStartEventIfNotTextInputElement} from "~/client/content/handle_drag_start_event_if_not_text_input_element.js";
import {AppContextProvider, useAppContext} from "~/client/context/app_context.js";
import {BottomBarFrameContextProvider} from "~/client/design/bottom_bar_frame_context_provider.js";
import {MobileFullScreenModalContextProvider} from "~/client/design/mobile_full_screen_modal.js";
import {RootOverlayScopeContextProvider} from "~/client/design/overlay_scope_context_provider.js";
import {ReporterContextProvider} from "~/client/design/reporter_context_provider.js";
import {TooltipCoordinationContextProvider} from "~/client/design/tooltip_coordination_context_provider.js";
import {getColorSchemeWithoutListeningIfBrowser} from "~/client/helpers/color_scheme.js";
import {ColorSchemeManager} from "~/client/helpers/color_scheme_manager.js";
import {useGlobalContextProvider} from "~/client/helpers/global_context.js";
import {GlobalKeyDownRootContextProvider} from "~/client/helpers/global_key_down_event.js";
import {useAppInitialRenderContextProvider} from "~/client/helpers/lifecycle/initial_app_render.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {usePromise} from "~/client/helpers/use_promise.js";
import {useClientInfoContextProvider} from "~/client/remix/client_info_context.js";
import {CurrentTimeContextProvider} from "~/client/remix/current_time_context_provider.js";
import {getLoaderDataWithSchema} from "~/client/remix/get_loader_data_with_schema.js";
import {isLoadingIndicatorLoaderData} from "~/client/remix/loading_indicator_loader_data.js";
import {usePlatformContextProvider} from "~/client/remix/platform_context.js";
import {useSpacingScaleContextProvider} from "~/client/remix/spacing_scale_context.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {NavigationContextProvider} from "~/client/remix/use_navigate.js";
import {UpdateMetaTitleContextProvider} from "~/client/remix/use_update_meta_title.js";
import {fontsCriticalCss} from "~/client/styles/core/fonts_critical_css.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {contentCodeBlockLanguages} from "~/shared/content/code/content_code_block_language.js";
import {Platform} from "~/shared/design/core/platform.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {UnknownError} from "~/shared/error/error.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {generateId} from "~/shared/id/id.js";
import {getRealmId} from "~/shared/id/realm_id.js";
import {BrowserId} from "~/shared/id/types/id_types.js";
import {ClientInfoSchema, defaultClientInfo} from "~/shared/remix/client_info.js";
import {propagateEventDataKey} from "~/shared/remix/json_with_schema_shared.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {mergeTracerEventData} from "~/shared/tracer/helpers/merge_tracer_event_data.js";
import {TracerEventFullData} from "~/shared/tracer/types/tracer_event_data.js";

export function meta() {
    return [{title: "Alpine"}];
}

export function links(): Array<LinkDescriptor> {
    return [
        // Preload our primary fonts Inter and Source Serif from our shared styles in
        // parallel with CSS to try and avoid flashes of unstyled text.
        //
        // https://web.dev/articles/codelab-preload-web-fonts
        {
            rel: "preload",
            href: "/fonts/inter.v1.woff2",
            as: "font",
            type: "font/woff2",
            crossOrigin: "anonymous",
        },
        {
            rel: "preload",
            href: "/fonts/source-serif.v1.woff2",
            as: "font",
            type: "font/woff2",
            crossOrigin: "anonymous",
        },
        {rel: "stylesheet", href: stylesUrl},
        // Recommend the SVG favicon so it can render in light and dark mode.
        {rel: "icon", href: "/favicon.svg"},
    ];
}

// The loader returns constants. We don't need to reload on page change.
export const shouldRevalidate = () => false;

const LoaderSchema = Schema.object({
    initialTime: Schema.date,
    initialAppRenderId: Schema.id(),
    browserId: Schema.id<BrowserId>(),
    clientInfo: ClientInfoSchema,
    isIntegrationTest: Schema.boolean,
});

let contentCodeBlockLanguagesPromise: "Unloaded" | Promise<void> | null = "Unloaded";

export async function loader({context}: LoaderArgs) {
    // Make sure to load all code block languages are loaded before rendering
    // anything. That way if we server render a `<ContentView>` with a code block
    // it'll have syntax highlighting.
    //
    // We do this in the root loader instead of `/s/:spaceId` since we may render
    // `<ContentView>`s outside of a space. For example in a space share route or a
    // blog post.
    if (contentCodeBlockLanguagesPromise === null) {
        // Loaded! All good...
    } else {
        if (contentCodeBlockLanguagesPromise === "Unloaded") {
            contentCodeBlockLanguagesPromise = runAllPromises(
                contentCodeBlockLanguages.map(language => language.getParser()),
            ).then(() => {
                contentCodeBlockLanguagesPromise = null;
            });
        }

        await contentCodeBlockLanguagesPromise;
    }

    return jsonWithSchema(LoaderSchema, {
        initialTime: context.loader.getInitialTime(),
        initialAppRenderId: generateId(),
        browserId: context.loader.getBrowserId(),
        clientInfo: context.loader.getClientInfo(),
        isIntegrationTest: process.env.NODE_ENV === "test",
    });
}

const rootNativeMobileOutletParentRouteIds = ["root"] as const;

function renderRootHead(loaderData: SchemaType<typeof LoaderSchema> | null) {
    return (
        <head>
            <meta charSet="utf-8" />
            <meta
                name="viewport"
                // - `user-scalable=no`: Don't allow pinch to zoom. This is against
                //    industry accessibility guidelines. We want our site to feel like an app
                //    and apps don't allow zooming. Zooming is a very web feeling behavior. To
                //    help users with accessibility needs we should add support for font
                //    scaling.
                //
                // - `viewport-fit=cover`: Render content under [safe area insets][2]. We use
                //   `env(safe-area-inset-*)` to make sure we add the appropriate amount of
                //   padding.
                //
                // [1]: https://developer.mozilla.org/en-US/docs/Web/HTML/Viewport_meta_tag
                // [2]: https://webkit.org/blog/7929/designing-websites-for-iphone-x/
                content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
            />
            <meta
                // Ask Google to not index any of our routes.
                // https://developers.google.com/search/docs/crawling-indexing/block-indexing
                //
                // TODO(calebmer): This should be decided on a route-by-route basis instead of
                // global configuration that can't be configured.
                name="robots"
                content="noindex"
            />
            <meta
                // Don't automatically detect format of various text bits on iOS. If we want
                // format detection we'll manually add it ourselves. Format detection doesn't
                // play nicely with React server rendering.
                // https://nextjs.org/docs/messages/react-hydration-error#common-ios-issues
                name="format-detection"
                content="telephone=no, date=no, email=no, address=no"
            />
            <Meta />
            <style dangerouslySetInnerHTML={{__html: fontsCriticalCss}} />
            <Links />
            <ColorSchemeManager />
            {loaderData?.isIntegrationTest && (
                // If we're running an integration test then add noop `react-refresh`
                // globals so we don't get any reference errors. Our SWC development config
                // applies the `react-refresh` transform.
                <script
                    dangerouslySetInnerHTML={{
                        __html: `globalThis.$RefreshReg$ = () => {}; globalThis.$RefreshSig$ = () => value => value;`,
                    }}
                />
            )}
        </head>
    );
}

function renderRootBodyScripts(platform: Platform) {
    return (
        <>
            <ScrollRestoration />
            <BazelBuildIndicator platform={platform} />
            <script
                // Let our native app know we're ready once the server render has finished.
                // This script intentionally runs before React hydration since we can
                // immediately show the server rendered HTML to the user.
                //
                // Wrapped in a double `requestAnimationFrame()`. We want to let
                // native know we're ready after the browser paints so we don't have a flash of
                // unstyled content. Or a flash of the old content in case we're reloading.
                dangerouslySetInnerHTML={{
                    __html: "if (window.__NativeMobileBridge) { requestAnimationFrame(() => requestAnimationFrame(() => window.__NativeMobileBridge.health.ready())); }",
                }}
            />
            <Scripts />
        </>
    );
}

function useRootAppContext(
    dataRouterStateContext: NonNullable<ContextType<typeof DataRouterStateContext>>,
) {
    // Incidentally, re-rendering when loader data is fulfilled here also causes
    // our `<Meta>` to re-render which fills in the right HTML document title.
    const loadingIndicatorLoaderDataResult = usePromise(
        useMemo(() => {
            const loaderData = Object.values(dataRouterStateContext.loaderData).filter(
                isLoadingIndicatorLoaderData,
            );
            if (loaderData.length === 0) return null;
            return PromiseImmediate.allSettled(loaderData.map(({promise}) => promise));
        }, [dataRouterStateContext.loaderData]),
    );

    let context = useAppContext();

    // Add propagated event data to our tracer so that child React components
    // log events with the right context.
    context = useMemo(() => {
        const propagatedEventData: Array<TracerEventFullData> = [];

        const loaderData = Object.values(dataRouterStateContext.loaderData);
        for (const data of loaderData) {
            if (!data) continue;
            if (!hasOwnProperty(data, propagateEventDataKey)) continue;
            propagatedEventData.push(data[propagateEventDataKey] as TracerEventFullData);
        }

        if (!loadingIndicatorLoaderDataResult.isPending && loadingIndicatorLoaderDataResult.value) {
            for (const data of loadingIndicatorLoaderDataResult.value) {
                if (data.status !== "fulfilled") continue;
                if (!hasOwnProperty(data.value, propagateEventDataKey)) continue;
                propagatedEventData.push(data.value[propagateEventDataKey] as TracerEventFullData);
            }
        }

        if (propagatedEventData.length === 0) return context;
        return context.tracer.withPropagatedData(mergeTracerEventData(propagatedEventData));
    }, [
        dataRouterStateContext.loaderData,
        loadingIndicatorLoaderDataResult.isPending,
        loadingIndicatorLoaderDataResult.value,
        context,
    ]);

    return context;
}

export default function Root() {
    const remixContext = useContext(RemixContext);
    assert(remixContext, "Expected Remix context");

    const dataRouterContext = useContext(DataRouterContext);
    assert(dataRouterContext, "Expected data router context");

    const dataRouterStateContext = useContext(DataRouterStateContext);
    assert(dataRouterStateContext, "Expected data router state context");

    const context = useRootAppContext(dataRouterStateContext);

    // If there are any unhandled browser errors then report them with our tracer.
    // We put uncaught error handling here because we want it to include propagated
    // data from loaders.
    //
    // TODO(calebmer): Unhandled errors should display a blocking modal. Generally
    // you should prefer display errors (like a button press error) with a toast
    // since it's lightweight and lets the user try again. We automatically do this
    // in `<Button>` components. If there's an unhandled error, though, show that
    // with a blocking modal since we don't know whether we're left in a good state
    // or not.
    useEffect(() => {
        const handleError = (event: ErrorEvent) => {
            // If some other error event handler called `event.preventDefault()` then the
            // error will be silenced in the browser and we want to silence it here too.
            if (event.defaultPrevented) return;

            // For debugging purposes, errors caught by React are re-thrown as unhandled
            // exceptions so you can use the browser "Pause on uncaught exception" feature.
            //
            // We report these errors through React error boundaries so ignore them here.
            //
            // https://github.com/facebook/react/issues/10474
            if (
                process.env.NODE_ENV !== "production" &&
                // eslint-disable-next-line no-global-error
                new Error().stack?.includes("invokeGuardedCallbackDev")
            ) {
                return;
            }

            context.tracer.getRoot().logException(
                "Uncaught exception",
                event.error ?? new UnknownError(event.message),
                {},
                {
                    // Uncaught browser errors were already logged. We don't need to do it again.
                    disableConsoleLog: true,
                },
            );
        };

        window.addEventListener("error", handleError);
        return () => {
            window.removeEventListener("error", handleError);
        };
    }, [context.tracer]);

    const loaderData = useLoaderDataWithSchema(LoaderSchema);

    const nativeMobileRouterState = isNativeMobileRouterState(dataRouterStateContext)
        ? dataRouterStateContext
        : null;

    const nodes: Array<ReactElement> = [];

    const onUpdateMetaTitle = useCallback((title: string) => {
        // eslint-disable-next-line react-compiler/react-compiler
        document.title = title;
    }, []);

    const outletContainerStyle = {
        minHeight: "100svh",
    };

    if (!nativeMobileRouterState) {
        nodes.push(
            // Render a `<div>` around children even when we're not rendering in the
            // context of our native mobile app so that layout is consistent across native
            // mobile and everything else.
            <div
                // We need a key since we're in an array but the key doesn't matter.
                key="0"
                style={outletContainerStyle}
            >
                <UpdateMetaTitleContextProvider onUpdateMetaTitle={onUpdateMetaTitle}>
                    <Outlet />
                </UpdateMetaTitleContextProvider>
            </div>,
        );
    } else {
        const renderedSpaceIds = new Set<unknown>();

        const primarySpaceRouteMatch = dataRouterStateContext.matches.find(
            match => match.route.id === "routes/s.$spaceId",
        );

        const getPrimaryNode = (entryKey: string) => (
            <NativeMobileOutlet
                key={entryKey}
                parentRouteIds={rootNativeMobileOutletParentRouteIds}
                tracer={context.tracer.getRoot()}
                inertRouterState={null}
                onUpdateMetaTitle={onUpdateMetaTitle}
                globalLoadingIndicator={null}
                style={outletContainerStyle}
            />
        );

        // When in our native mobile app, we render multiple routes to the DOM at once!
        // We render the active route and we render previous routes in an inert state.
        // Inert routes are invisible and the user can't interact with them through
        // keyboard, mouse, anything. The reason we do this is two-fold:
        //
        // 1. Because we end up navigating more frequently on mobile, users expect when
        //    they return to a route for it to be in the exact same state as when they
        //    left it. Same scroll position, same text left in inputs, same everything.
        //
        // 2. If the user is swiping to go back, we render an old snapshot of the view
        //    we took while waiting for the web view to update. If our new web view is
        //    in a different state there will be a flash as we transition from the
        //    snapshot to the actual view.
        //
        // By keeping routes in the navigation stack rendered in the DOM (with their
        // React states and effects all still active) when the user returns to that
        // screen their state is entirely preserved.
        //
        // Keep in mind, it's not enough to unmount a route but preserve its loader
        // data, then render a route again with the old loader data. Doing this would
        // reset UI state like scroll position.
        //
        // Not all our inert routes are rendered here in `root.tsx`. Space inert routes
        // are rendered in `s.$spaceId.tsx`. That way we can share space-level context
        // across inert routes. Like the task realtime client.
        for (const {
            entryKey,
            routerState: inertRouterState,
        } of nativeMobileRouterState.inertRouterStates) {
            // Inert space routes that share the same `SpaceId` should be rendered under
            // one `/s/:spaceId` route so they share the same space context components.
            // So render the first `/s/:spaceId` route we see then trust that component to
            // render the remaining inert router states.
            const inertSpaceRouteMatch = inertRouterState.matches.find(
                match => match.route.id === "routes/s.$spaceId",
            );
            if (inertSpaceRouteMatch) {
                if (renderedSpaceIds.has(inertSpaceRouteMatch.params.spaceId)) {
                    continue;
                } else {
                    renderedSpaceIds.add(inertSpaceRouteMatch.params.spaceId);
                }
            }

            // If our primary route is rendered in the same space as this inert route then
            // render the primary route in this position with the current `entryKey` to
            // preserve the inert route's key path.
            //
            // TODO(calebmer): I haven't tested rendering an inert route from a different
            // space (nothing in the product does this I think?). It probably breaks
            // spectacularly. Or if it doesn't break it's inefficient since the component
            // will remount and we'll make multiple WebSocket connections per space.
            if (
                primarySpaceRouteMatch &&
                inertSpaceRouteMatch &&
                primarySpaceRouteMatch.params.spaceId === inertSpaceRouteMatch.params.spaceId
            ) {
                nodes.push(getPrimaryNode(`Space-${primarySpaceRouteMatch.params.spaceId!}`));
            } else {
                nodes.push(
                    <NativeMobileOutlet
                        key={entryKey}
                        parentRouteIds={rootNativeMobileOutletParentRouteIds}
                        tracer={context.tracer.getRoot()}
                        inertRouterState={inertRouterState}
                        onUpdateMetaTitle={onUpdateMetaTitle}
                        globalLoadingIndicator={null}
                        style={outletContainerStyle}
                    />,
                );
            }
        }

        if (
            !primarySpaceRouteMatch ||
            !renderedSpaceIds.has(primarySpaceRouteMatch.params.spaceId)
        ) {
            nodes.push(
                getPrimaryNode(
                    primarySpaceRouteMatch
                        ? `Space-${primarySpaceRouteMatch.params.spaceId!}`
                        : nativeMobileRouterState.entryKey,
                ),
            );
        }
    }

    // Maintain a consistent ordering of history stack items in the DOM. If history
    // stack items move during a navigation then their scroll positions and other
    // DOM state will be reset!
    //
    // History stack items often change order when switching tabs. For instance if
    // you switch to the inbox tab then all previous inbox history stack entries
    // will be moved to the end of `inertRouterStates`. If we keep entries in
    // `inertRouterStates` order then React will happily call
    // `Element.appendChild()` (or `Element.insertBefore()`) to move the history
    // stack entry in the DOM which resets the route's `scrollTop` state so if the
    // user navigates back their scroll position is lost. `scrollTop` also updates
    // without sending a scroll event which means `useNavigationBar()`'s state
    // won't update which will look broken.
    //
    // [Example of a problem not sorting causes][1]. Notice how the second time we
    // navigate to the document it's been scrolled to the top. That's because the
    // inert route DOM nodes are being reordered.
    //
    // [1]: https://gist.github.com/calebmer/9fdbc9ffb08c700c6737866f18fe340a
    if (nodes.length > 1) {
        nodes.sort((node1, node2) => defaultCompareStrings(String(node1.key), String(node2.key)));
    }

    const wrappedChildren5 = (
        <IconContext.Provider value={{color: "currentColor", size: spacing["5"]}}>
            <AppContextProvider value={context}>
                <CurrentTimeContextProvider initialTime={loaderData.initialTime}>
                    <NavigationContextProvider>
                        <GlobalKeyDownRootContextProvider>
                            <BottomBarFrameContextProvider>
                                <RootOverlayScopeContextProvider>
                                    <MobileFullScreenModalContextProvider>
                                        <TooltipCoordinationContextProvider>
                                            <ReporterContextProvider>
                                                {nodes}
                                            </ReporterContextProvider>
                                        </TooltipCoordinationContextProvider>
                                    </MobileFullScreenModalContextProvider>
                                </RootOverlayScopeContextProvider>
                            </BottomBarFrameContextProvider>
                        </GlobalKeyDownRootContextProvider>
                    </NavigationContextProvider>
                </CurrentTimeContextProvider>
            </AppContextProvider>
        </IconContext.Provider>
    );

    const {clientInfo, children: wrappedChildren4} = useClientInfoContextProvider(
        {
            browserId: loaderData.browserId,
            initialClientInfo: loaderData.clientInfo,
        },
        wrappedChildren5,
    );

    const {spacingScale, children: wrappedChildren3} = useSpacingScaleContextProvider(
        clientInfo,
        wrappedChildren4,
    );

    const {platform, children: wrappedChildren2} = usePlatformContextProvider(
        clientInfo,
        wrappedChildren3,
    );

    const wrappedChildren = useGlobalContextProvider(
        useAppInitialRenderContextProvider(
            loaderData.initialTime,
            loaderData.initialAppRenderId,
            wrappedChildren2,
        ),
    );

    const htmlRef = useRef<HTMLHtmlElement>(null);

    useLayoutEffectWithoutServerSideWarning(() => {
        const htmlElement = assertExists(htmlRef.current);

        const handleCopy = (event: ClipboardEvent) => {
            if (event.defaultPrevented) return;
            handleCopyEventIfNotTextInputElement(event);
        };

        const handleDragStart = (event: DragEvent) => {
            if (event.defaultPrevented) return;
            handleDragStartEventIfNotTextInputElement(event);
        };

        htmlElement.addEventListener("copy", handleCopy);
        htmlElement.addEventListener("dragstart", handleDragStart);
        return () => {
            htmlElement.removeEventListener("copy", handleCopy);
            htmlElement.removeEventListener("dragstart", handleDragStart);
        };
    }, []);

    return (
        <html
            ref={htmlRef}
            lang="en"
            data-platform={platform}
            data-spacing={spacingScale}
            data-color={getColorSchemeWithoutListeningIfBrowser()}
            data-engine={clientInfo.renderingEngine.toLowerCase()}
        >
            {renderRootHead(loaderData)}
            <body>
                {wrappedChildren}
                {renderRootBodyScripts(platform)}
            </body>
        </html>
    );
}

// This error boundary route mainly renders 404 errors. We add a default error
// boundary to all root route children in `app_client_routes.ts` and
// `app_server_routes.ts`. So we don't need to re-render the full `<html>`
// document if a child errors.
export {RootErrorBoundaryWrapper as ErrorBoundary};
function RootErrorBoundaryWrapper() {
    const dataRouterStateContext = useContext(DataRouterStateContext);
    assert(dataRouterStateContext, "Expected data router state context");

    const context = useRootAppContext(dataRouterStateContext);

    // `useLoaderData()` doesn't work in an error boundary or catch boundary.
    // We use this exact component for error and catch boundaries to avoid
    // remounting when navigating between errors and non-errors. So manually
    // deserialize the data for this route.
    const loaderData = useMemo(
        () =>
            dataRouterStateContext.loaderData.root
                ? getLoaderDataWithSchema(LoaderSchema, dataRouterStateContext.loaderData.root)
                : null,
        [dataRouterStateContext.loaderData.root],
    );

    const [fallbackInitialTime] = useState(() => new Date());

    // In case we don't have loader data (an error was thrown) fallback to trying
    // to read the current date.
    const initialTime = useMemo(
        () => loaderData?.initialTime ?? fallbackInitialTime,
        [fallbackInitialTime, loaderData?.initialTime],
    );

    const wrappedChildren5 = (
        <IconContext.Provider value={{color: "currentColor", size: spacing["5"]}}>
            <AppContextProvider value={context}>
                <NavigationContextProvider>
                    <RootErrorBoundary />
                </NavigationContextProvider>
            </AppContextProvider>
        </IconContext.Provider>
    );

    const {clientInfo, children: wrappedChildren4} = useClientInfoContextProvider(
        {
            // If there was an error at our root loader and we couldn't load `BrowserId`
            // then use the `RealmId` as the `BrowserId`.
            browserId: loaderData?.browserId ?? (getRealmId() as any as BrowserId),
            initialClientInfo: loaderData?.clientInfo ?? defaultClientInfo,
        },
        wrappedChildren5,
    );

    const {spacingScale, children: wrappedChildren3} = useSpacingScaleContextProvider(
        clientInfo,
        wrappedChildren4,
    );

    const {platform, children: wrappedChildren2} = usePlatformContextProvider(
        clientInfo,
        wrappedChildren3,
    );

    const wrappedChildren = useGlobalContextProvider(
        useAppInitialRenderContextProvider(
            initialTime,
            loaderData?.initialAppRenderId,
            wrappedChildren2,
        ),
    );

    return (
        <html
            lang="en"
            data-platform={platform}
            data-spacing={spacingScale}
            data-color={getColorSchemeWithoutListeningIfBrowser()}
            data-engine={clientInfo.renderingEngine.toLowerCase()}
        >
            {renderRootHead(loaderData)}
            <body>
                {wrappedChildren}
                {renderRootBodyScripts(platform)}
            </body>
        </html>
    );
}
