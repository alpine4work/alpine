import {Outlet} from "@remix-run/react";
import {useContext, useMemo} from "react";
import {UNSAFE_DataRouterStateContext as DataRouterStateContext} from "react-router";
import {LoadingIndicatorSpaceOutletContainer} from "~/app/router/loading_indicator_space_outlet_container.js";
import {AppContextProvider, useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {usePromise} from "~/client/web/helpers/use_promise.js";
import {PeekErrorBoundary} from "~/client/web/peek/peek_error_boundary.js";
import {isLoadingIndicatorLoaderData} from "~/client/web/remix/loading_indicator_loader_data.js";
import {usePeekContext} from "~/client/web/remix/peek_context.js";
import {NavigationContextProvider} from "~/client/web/remix/use_navigate.js";
import {
    GlobalLoadingIndicatorChip,
    GlobalLoadingIndicatorContextProvider,
} from "~/client/web/spaces/global_loading_indicator_context_provider.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.js";
import {getRouteStringFromMatches} from "~/shared/remix/get_route_string_from_matches.js";
import {propagateEventDataKey} from "~/shared/remix/json_with_schema_shared.js";
import {getTracerEventPropagatedDataForPathname} from "~/shared/tracer/get_tracer_event_propagated_data_for_pathname.js";
import {mergeTracerEventData} from "~/shared/tracer/helpers/merge_tracer_event_data.js";
import {tracerEventDataContextPeekMoveIntoAboveKeys} from "~/shared/tracer/helpers/tracer_event_data_context_peek_move_into_above_key.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";
import {TracerEventFullData} from "~/shared/tracer/types/tracer_event_data.js";

export default function PeekLayout() {
    // Navigating to this route via URL will show you an error! This route can only
    // be rendered as a child component of a peek renderer like `<PeekRemixEmbed>`.
    // Peeks leverage Remix's routing, bundle splitting, and data loading
    // capabilities but in a context embedded within the rest of our application.
    const peekContext = usePeekContext();
    if (!peekContext)
        throw new InvalidArgumentError("May only render peek routes in an embedded peek component");

    const dataRouterStateContext = useContext(DataRouterStateContext);
    assert(dataRouterStateContext, "Expected data router state context");

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
        const tracer = context.tracer.getTracer();

        // While server-side rendering we will have a tracer that's part of a span.
        // Ignore this tracer and don't move propagated data around. On the client, we
        // always expect a root tracer.
        assert(
            typeof window === "undefined" || tracer instanceof TracerRoot,
            "Expected tracer in app context to be root tracer",
        );
        if (!(tracer instanceof TracerRoot)) return context;

        const replacePropagatedEventData: {[key: string]: unknown} = tracer.propagatedEventData
            ? {...tracer.propagatedEventData}
            : {};

        const replaceContextPropagatedEventData: {[key: string]: unknown} =
            replacePropagatedEventData.context ? {...replacePropagatedEventData.context} : {};

        const replaceContextPeekPropagatedEventData: {[key: string]: unknown} =
            replaceContextPropagatedEventData.peek
                ? {...replaceContextPropagatedEventData.peek}
                : {};

        replacePropagatedEventData.context = replaceContextPropagatedEventData;
        replaceContextPropagatedEventData.peek = replaceContextPeekPropagatedEventData;
        replaceContextPropagatedEventData.route = getRouteStringFromMatches(
            dataRouterStateContext.matches,
        );
        replaceContextPropagatedEventData.routeLayout = peekContext.layout;

        // Move some defined IDs in `context` into `peek.context` with an "above"
        // prefix. This disambiguates context IDs the user is interacting with from the
        // main context IDs of the page.
        for (const key of Object.keys(tracerEventDataContextPeekMoveIntoAboveKeys)) {
            if (hasOwnProperty(replaceContextPropagatedEventData, key)) {
                replaceContextPeekPropagatedEventData[
                    `above${key[0]?.toUpperCase() ?? ""}${key.slice(1)}`
                ] = replaceContextPropagatedEventData[key];
                delete replaceContextPropagatedEventData[key];
            }
        }

        const propagatedEventData = [replacePropagatedEventData];

        const pathnamePropagatedData = getTracerEventPropagatedDataForPathname(
            dataRouterStateContext.location.pathname,
        );
        if (pathnamePropagatedData) propagatedEventData.push(pathnamePropagatedData);

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

        return context.clone({
            tracer: new TracerContextModule(
                tracer.withReplacedPropagatedData(mergeTracerEventData(propagatedEventData)),
            ),
        });
    }, [
        context,
        peekContext.layout,
        dataRouterStateContext.matches,
        dataRouterStateContext.location.pathname,
        dataRouterStateContext.loaderData,
        loadingIndicatorLoaderDataResult.isPending,
        loadingIndicatorLoaderDataResult.value,
    ]);

    return (
        <AppContextProvider value={context}>
            <NavigationContextProvider
            // Make sure we use a new navigation context provider in peeks so the promises
            // returned by `navigate()` will correspond to the peek `useLocation()`.
            >
                <LoadingIndicatorSpaceOutletContainer routeId="routes/s.$spaceId.peek">
                    <GlobalLoadingIndicatorContextProvider>
                        {globalLoadingIndicator => (
                            <>
                                <Outlet />
                                {globalLoadingIndicator && (
                                    <Box
                                        pointerEvents="none"
                                        position="absolute"
                                        zIndex="10"
                                        bottom="0"
                                        right="0"
                                        borderTopRightRadius="1"
                                        backgroundColor="grey-0"
                                    >
                                        <GlobalLoadingIndicatorChip
                                            indicator={globalLoadingIndicator}
                                        />
                                    </Box>
                                )}
                            </>
                        )}
                    </GlobalLoadingIndicatorContextProvider>
                </LoadingIndicatorSpaceOutletContainer>
            </NavigationContextProvider>
        </AppContextProvider>
    );
}

export const ErrorBoundary = PeekErrorBoundary;
