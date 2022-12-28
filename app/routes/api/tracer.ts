import {LoaderArgs} from "~/server/remix/loader_context";
import {validateTracerEventFlatData} from "~/server/tracer/validate_tracer_event_flat_data";
import {InvalidArgumentError} from "~/shared/error/error";
import {ErrorSchema} from "~/shared/error/error_schema";
import {isHttp500Error} from "~/shared/error/is_http_500_error_code";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object";
import {SchemaSerializedValue} from "~/shared/schema/schema";
import {TracerEvent} from "~/shared/tracer/tracer_event";

export async function action({request, context}: LoaderArgs) {
    try {
        const events: SchemaSerializedValue = await request.json();
        if (!isReadonlyArray(events)) throw new InvalidArgumentError("Expected an array of events");

        const errors = [];

        for (const event of events) {
            if (!isPlainObject(event))
                throw new InvalidArgumentError("Expected each event to be an object");

            if (typeof event.time !== "number" || !Number.isInteger(event.time) || event.time < 0)
                throw new InvalidArgumentError(
                    'Expected each event to have a positive integer "time" property',
                );

            if (!isPlainObject(event.data))
                throw new InvalidArgumentError(
                    'Expected each event to have a "data" object property',
                );

            try {
                validateTracerEventFlatData(event.data);

                if (event.data["meta.untrusted"] !== true)
                    throw new InvalidArgumentError(
                        'All events coming from an untrusted client must have the "meta.untrusted" attribute set to true',
                    );

                // We may have other untrusted hosts in the future. We validate both the
                // `meta.untrusted` attribute and `js.host` so that we can filter on
                // `js.host = "Node"` and be guaranteed to see only trusted events.
                if (event.data["js.host"] !== "Web")
                    throw new InvalidArgumentError(
                        'All events coming from an untrusted client must have "js.host" set to an untrusted host',
                    );

                // Now that we've validated our event, send it with our root tracer. The root
                // tracer will handle batching events into one request to Honeycomb.
                context.tracer
                    .getTracer()
                    .getRoot()
                    ._sendEvent(new TracerEvent(event.time, null, event.data));
            } catch (error) {
                // A bad event should not stop us from recording other good events in the batch
                // sent by the client.
                context.tracer.logException(error);
                errors.push(error);
            }
        }

        if (errors.length === 0) {
            return new Response(JSON.stringify({ok: true}), {
                status: 200,
                headers: {"content-type": "application/json"},
            });
        } else {
            return new Response(
                JSON.stringify({
                    ok: false,
                    errors: errors.map(error => ErrorSchema.serialize(error)),
                }),
                {
                    status: errors.reduce<number>(
                        (status, error) => Math.max(status, isHttp500Error(error) ? 500 : 400),
                        200,
                    ),
                    headers: {"content-type": "application/json"},
                },
            );
        }
    } catch (error) {
        context.tracer.logException(error);

        const status = isHttp500Error(error) ? 500 : 400;

        return new Response(
            JSON.stringify({
                ok: false,
                errors: [ErrorSchema.serialize(error)],
            }),
            {
                status,
                headers: {"content-type": "application/json"},
            },
        );
    }
}
