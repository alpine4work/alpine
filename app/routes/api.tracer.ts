import {LoaderArgs} from "~/server/remix/loader_context.js";
import {validateTracerEventFlatData} from "~/server/tracer/validate_tracer_event_flat_data.js";
import {createAggregateError} from "~/shared/error/aggregate_error.js";
import {DataLossError, InvalidArgumentError} from "~/shared/error/error.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";
import {TracerEvent} from "~/shared/tracer/tracer_event.js";

export async function action({request, context, span}: LoaderArgs) {
    try {
        if (request.method !== "POST") throw new InvalidArgumentError("Must use POST HTTP method");

        const events: SchemaSerializedValue = await request.json();
        if (!isReadonlyArray(events)) throw new InvalidArgumentError("Expected an array of events");

        const errors = [];

        for (const event of events) {
            if (!isPlainObject(event))
                throw new InvalidArgumentError("Expected each event to be an object");

            if (typeof event.time !== "number" || !Number.isFinite(event.time) || event.time < 0)
                throw new InvalidArgumentError(
                    "Expected each event to have a positive number `time` property",
                );

            if (!isPlainObject(event.data))
                throw new InvalidArgumentError(
                    "Expected each event to have a `data` object property",
                );

            try {
                validateTracerEventFlatData(event.data);

                if (event.data["meta.untrusted"] !== true)
                    throw new InvalidArgumentError(
                        "All events coming from an untrusted client must have the `meta.untrusted` attribute set to true",
                    );

                switch (event.data["service.name"]) {
                    case "AppClient": {
                        if (event.data["js.host"] !== "Web") {
                            throw new InvalidArgumentError(
                                "All events coming from `AppClient` untrusted client must have `js.host` set to `Web`",
                            );
                        }
                        break;
                    }
                    case "CliClient": {
                        if (event.data["js.host"] !== "Node") {
                            throw new InvalidArgumentError(
                                "All events coming from `CliClient` untrusted client must have `js.host` set to `Node`",
                            );
                        }
                        break;
                    }
                    default: {
                        throw new InvalidArgumentError(
                            "Unrecognized `service.name` for untrusted client",
                        );
                    }
                }

                // Now that we've validated our event, send it with our root tracer. The root
                // tracer will handle batching events into one request to Honeycomb.
                context.tracer.getRoot()._sendEvent(new TracerEvent(event.time, null, event.data));
            } catch (error) {
                // A bad event should not stop us from recording other good events in the batch
                // sent by the client.
                errors.push(
                    DataLossError.from(error, "Throwing away invalid tracer event from client"),
                );
            }
        }

        if (errors.length === 0) {
            return new Response(JSON.stringify({ok: true}), {
                status: 200,
                headers: {"content-type": "application/json"},
            });
        } else {
            const error = createAggregateError(errors);

            span.addException(error);

            const status = isSystemError(error) ? 500 : 400;

            return new Response(
                JSON.stringify({
                    ok: false,
                    errors: errors.map(error => ErrorSchema.serialize(error)),
                }),
                {
                    status,
                    headers: {"content-type": "application/json"},
                },
            );
        }
    } catch (error) {
        span.addException(error);

        const status = isSystemError(error) ? 500 : 400;

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
