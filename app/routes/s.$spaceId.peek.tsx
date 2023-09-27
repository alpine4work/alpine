import {Outlet} from "@remix-run/react";
import {useContext, useMemo} from "react";
import {UNSAFE_DataRouterStateContext as DataRouterStateContext} from "react-router";
import {AppContextProvider, useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {ErrorBodyRenderer} from "~/client/design/error_body_renderer.js";
import {useStableValue} from "~/client/helpers/use_stable_value.js";
import {usePeekContext} from "~/client/peek/peek_remix_embed.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.js";
import {propagateEventDataKey} from "~/shared/remix/json_with_schema_shared.js";
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

    let context = useAppContext();

    // Add propagated event data to our tracer so that child React components
    // log events with the right context.
    context = useMemo(() => {
        const loaderData = Object.values(dataRouterStateContext.loaderData);

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
        replaceContextPropagatedEventData.peekId = peekContext.id;
        replaceContextPropagatedEventData.peek = replaceContextPeekPropagatedEventData;

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

        const propagatedEventData = [
            replacePropagatedEventData,
            ...filterMapIterable(loaderData, data => {
                if (!data) return null;
                if (!hasOwnProperty(data, propagateEventDataKey)) return null;
                return data[propagateEventDataKey] as TracerEventFullData;
            }),
        ];

        return context.clone({
            tracer: new TracerContextModule(
                tracer.withReplacedPropagatedData(mergeTracerEventData(propagatedEventData)),
            ),
        });
    }, [dataRouterStateContext.loaderData, context, peekContext.id]);

    return (
        <AppContextProvider value={context}>
            <Outlet />
        </AppContextProvider>
    );
}

export function ErrorBoundary({error: _error}: {error: unknown}) {
    // It appears that Remix does not `useMemo()` its error object. So stabilize
    // the object reference here. Our error rendering components use referential
    // identity to determine whether we need to log the error.
    const error = useStableValue(ErrorSchema, _error);

    return (
        <Box display="flex" justifyContent="center">
            <Box width="full" maxWidth="128" paddingX="6" paddingTop="10" paddingBottom="8">
                <ErrorBodyRenderer title="Couldn’t show content" error={error} />
            </Box>
        </Box>
    );
}
