import {
    Links,
    Meta,
    Outlet,
    UNSAFE_RemixContext as RemixContext,
    Scripts,
    ScrollRestoration,
} from "@remix-run/react";
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
import {BlobsArtProvider} from "~/client/web/blobs/blobs_art_provider.js";
import {handleCopyEventIfNotTextInputElement} from "~/client/web/content/handle_copy_event_if_not_text_input_element.js";
import {handleDragStartEventIfNotTextInputElement} from "~/client/web/content/handle_drag_start_event_if_not_text_input_element.js";
import {AppContextProvider, useAppContext} from "~/client/web/context/app_context.js";
import {BottomBarFrameContextProvider} from "~/client/web/design/bottom_bar_frame_context_provider.js";
import {MobileFullScreenModalContextProvider} from "~/client/web/design/mobile_full_screen_modal.js";
import {RootOverlayScopeContextProvider} from "~/client/web/design/overlay_scope_context_provider.js";
import {ReporterContextProvider} from "~/client/web/design/reporter_context_provider.js";
import {TooltipCoordinationContextProvider} from "~/client/web/design/tooltip_coordination_context_provider.js";
import {getColorSchemeWithoutListeningIfBrowser} from "~/client/web/helpers/color_scheme.js";
import {ColorSchemeManager} from "~/client/web/helpers/color_scheme_manager.js";
import {useGlobalContextProvider} from "~/client/web/helpers/global_context.js";
import {GlobalKeyDownRootContextProvider} from "~/client/web/helpers/global_key_down_event.js";
import {useAppInitialRenderContextProvider} from "~/client/web/helpers/lifecycle/initial_app_render.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {usePromise} from "~/client/web/helpers/use_promise.js";
import {getWebPushStore} from "~/client/web/notifications/web_push_store.js";
import {useClientInfoContextProvider} from "~/client/web/remix/client_info_context.js";
import {CurrentTimeContextProvider} from "~/client/web/remix/current_time_context_provider.js";
import {getLoaderDataWithSchema} from "~/client/web/remix/get_loader_data_with_schema.js";
import {isLoadingIndicatorLoaderData} from "~/client/web/remix/loading_indicator_loader_data.js";
import {usePlatformContextProvider} from "~/client/web/remix/platform_context.js";
import {getDefaultRouteLayoutForPlatform} from "~/client/web/remix/route_layout_context.js";
import {useSpacingScaleContextProvider} from "~/client/web/remix/spacing_scale_context.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {NavigationContextProvider} from "~/client/web/remix/use_navigate.js";
import {UpdateMetaTitleContextProvider} from "~/client/web/remix/use_update_meta_title.js";
import {getFontsCriticalCss} from "~/client/web/styles/core/fonts_critical_css.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {contentCodeBlockLanguages} from "~/shared/content/code/content_code_block_language.js";
import {colors} from "~/shared/design/core/colors.js";
import {Platform} from "~/shared/design/core/platform.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
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
import {ClientInfo, ClientInfoSchema, defaultClientInfo} from "~/shared/remix/client_info.js";
import {getRouteStringFromMatches} from "~/shared/remix/get_route_string_from_matches.js";
import {propagateEventDataKey} from "~/shared/remix/json_with_schema_shared.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {mergeTracerEventData} from "~/shared/tracer/helpers/merge_tracer_event_data.js";
import {TracerEventFullData} from "~/shared/tracer/types/tracer_event_data.js";

export function meta() {
    return [{title: "Alpine"}];
}

// The loader returns constants. We don't need to reload on page change.
export const shouldRevalidate = () => false;

const LoaderSchema = Schema.object({
    initialTime: Schema.date,
    initialAppRenderId: Schema.id(),
    browserId: Schema.id<BrowserId>(),
    clientInfo: ClientInfoSchema,
    isIntegrationTest: Schema.boolean,
    webPushVapidPublicKey: Schema.string,
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
        webPushVapidPublicKey: context.loader.webPushVapidPublicKey,
        isIntegrationTest: process.env.NODE_ENV === "test",
    });
}

const rootNativeMobileOutletParentRouteIds = ["root"] as const;

const resourceServiceUrl = __RESOURCE_SERVICE_URL__;

// These `<head>` elements never change. If Remix/React re-render then these
// elements should not update. Updating these elements may cause resources to
// be fetched from the server again!
const constantRootHead = (
    <>
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
        <meta
            // Set the theme color for PWA installations.
            // This controls the color of the outer UI of the PWA when it's installed on a device.
            name="theme-color"
            content={colors["grey-0"]}
            media="(prefers-color-scheme: light)"
        />
        <meta
            // Set the theme color for PWA installations
            // This controls the color of the outer UI of the PWA when it's installed on a device.
            name="theme-color"
            content={colors["grey-100"]}
            media="(prefers-color-scheme: dark)"
        />
        <link
            // Preload our primary font Inter from our shared styles in parallel with CSS
            // to try and avoid flashes of unstyled text.
            //
            // https://web.dev/articles/codelab-preload-web-fonts
            rel="preload"
            href={`${resourceServiceUrl}/fonts/inter.v1.woff2`}
            as="font"
            type="font/woff2"
            crossOrigin="anonymous"
        />
        <link rel="stylesheet" href={stylesUrl} />
        <link rel="icon" href="/favicon.ico" sizes="128x128" />
        <link
            rel="apple-touch-icon"
            sizes="512x512"
            href={`${resourceServiceUrl}/app-icons/app-icon-512x512.png`}
        />
        <link
            rel="apple-touch-icon"
            sizes="1024x1024"
            href={`${resourceServiceUrl}/app-icons/app-icon-1024x1024.png`}
        />
        <link
            // Recommend the SVG favicon so it can render in light and dark mode.
            // Ensure this icon is last so it gets preference over any other icon types.
            rel="icon"
            href="/favicon.svg"
            type="image/svg+xml"
            sizes="any"
        />
        <link rel="manifest" href="/manifest.json" />

        <Meta />
        <Links />

        <style
            // Must be after `<Links>` to ensure we use our preloaded fonts.
            dangerouslySetInnerHTML={{__html: getFontsCriticalCss(resourceServiceUrl)}}
        />

        <ColorSchemeManager />
    </>
);

function renderRootHead(loaderData: SchemaType<typeof LoaderSchema> | null) {
    return (
        <head>
            {constantRootHead}
            {loaderData?.isIntegrationTest && (
                // If we're running an integration test then add noop `react-refresh`
                // globals so we don't get any reference errors. Our SWC development config
                // applies the `react-refresh` transform.
                <script
                    dangerouslySetInnerHTML={{
                        __html: `globalThis.__isIntegrationTest = true; globalThis.$RefreshReg$ = () => {}; globalThis.$RefreshSig$ = () => value => value;`,
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
            <Scripts crossOrigin="anonymous" />
        </>
    );
}

function useRootAppContext(
    clientInfo: ClientInfo,
    spacingScale: SpacingScale,
    platform: Platform,
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

        propagatedEventData.push({
            context: {
                route: getRouteStringFromMatches(dataRouterStateContext.matches),
                platform,
                spacingScale,
                routeLayout: getDefaultRouteLayoutForPlatform(platform),
                renderingEngine: clientInfo.renderingEngine,
            },
        });

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

        return context.tracer.withPropagatedData(mergeTracerEventData(propagatedEventData));
    }, [
        platform,
        spacingScale,
        clientInfo.renderingEngine,
        dataRouterStateContext.loaderData,
        dataRouterStateContext.matches,
        loadingIndicatorLoaderDataResult.isPending,
        loadingIndicatorLoaderDataResult.value,
        context.tracer,
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

    const loaderData = useLoaderDataWithSchema(LoaderSchema);

    const nativeMobileRouterState = isNativeMobileRouterState(dataRouterStateContext)
        ? dataRouterStateContext
        : null;

    const {clientInfo, render: renderClientInfoContextProvider} = useClientInfoContextProvider({
        browserId: loaderData.browserId,
        initialClientInfo: loaderData.clientInfo,
    });

    const {spacingScale, render: renderSpacingScaleContextProvider} =
        useSpacingScaleContextProvider(clientInfo);

    const {platform, render: renderPlatformContextProvider} =
        usePlatformContextProvider(clientInfo);

    const context = useRootAppContext(clientInfo, spacingScale, platform, dataRouterStateContext);

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

    const children = renderClientInfoContextProvider(
        renderSpacingScaleContextProvider(
            renderPlatformContextProvider(
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
                                                        <BlobsArtProvider />
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
                </IconContext.Provider>,
            ),
        ),
    );

    const wrappedChildren = useGlobalContextProvider(
        useAppInitialRenderContextProvider(
            loaderData.initialTime,
            loaderData.initialAppRenderId,
            children,
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

    const webPushStoreInitializedRef = useRef(false);

    useEffect(() => {
        if (webPushStoreInitializedRef.current) return;
        // Initialize the web push store with the vapid public key so it can be used later to
        // subscribe to web push notifications.
        const webPushStore = getWebPushStore();
        webPushStore
            .setVapidCredentials(loaderData.webPushVapidPublicKey)
            .then(() => (webPushStoreInitializedRef.current = true))
            .catch(error => {
                context.tracer.getRoot().logException("Error initializing web push store", error);
            });
    }, [loaderData, context.tracer]);

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

    const {clientInfo, render: renderClientInfoContextProvider} = useClientInfoContextProvider({
        // If there was an error at our root loader and we couldn't load `BrowserId`
        // then use the `RealmId` as the `BrowserId`.
        browserId: loaderData?.browserId ?? (getRealmId() as any as BrowserId),
        initialClientInfo: loaderData?.clientInfo ?? defaultClientInfo,
    });

    const {spacingScale, render: renderSpacingScaleContextProvider} =
        useSpacingScaleContextProvider(clientInfo);

    const {platform, render: renderPlatformContextProvider} =
        usePlatformContextProvider(clientInfo);

    const context = useRootAppContext(clientInfo, spacingScale, platform, dataRouterStateContext);

    const [fallbackInitialTime] = useState(() => new Date());

    // In case we don't have loader data (an error was thrown) fallback to trying
    // to read the current date.
    const initialTime = useMemo(
        () => loaderData?.initialTime ?? fallbackInitialTime,
        [fallbackInitialTime, loaderData?.initialTime],
    );

    const children = renderClientInfoContextProvider(
        renderSpacingScaleContextProvider(
            renderPlatformContextProvider(
                <IconContext.Provider value={{color: "currentColor", size: spacing["5"]}}>
                    <AppContextProvider value={context}>
                        <NavigationContextProvider>
                            <RootErrorBoundary />
                        </NavigationContextProvider>
                    </AppContextProvider>
                </IconContext.Provider>,
            ),
        ),
    );

    const wrappedChildren = useGlobalContextProvider(
        useAppInitialRenderContextProvider(initialTime, loaderData?.initialAppRenderId, children),
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
