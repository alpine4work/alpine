import {ErrorSchema} from "~/shared/error/error_schema.js";
import {Schema} from "~/shared/schema/schema.js";
import {TracerPropagationContextSchema} from "~/shared/tracer/tracer_propagation_context_schema.js";

export const RpcHttpCallInputSchema = Schema.object({
    name: Schema.string,
    input: Schema.unknown(),
});

export const RpcHttpCallOutputSchema = Schema.result(
    Schema.object({
        ok: Schema.value(true),
        output: Schema.unknown(),
    }),
    Schema.object({
        ok: Schema.value(false),
        error: ErrorSchema,
    }),
);

export const RpcHttpBatchCallInputSchema = Schema.object({
    calls: Schema.array(
        RpcHttpCallInputSchema.merge(
            Schema.object({
                tracerContext: TracerPropagationContextSchema.nullable().default(null),
            }),
        ),
    ),
});

export const RpcHttpBatchByActorCallInputSchema = Schema.object({
    actors: Schema.array(
        Schema.object({
            authorization: Schema.string,
        }),
    ),
    calls: Schema.array(
        RpcHttpCallInputSchema.merge(
            Schema.object({
                tracerContext: TracerPropagationContextSchema.nullable(),
                actorIndex: Schema.integer,
            }),
        ),
    ),
});

export const RpcHttpBatchCallErrorOutputSchema = Schema.object({
    ok: Schema.value(false),
    error: ErrorSchema,
});

export const RpcHttpBatchCallEventOutputSchema = Schema.object({
    index: Schema.integer.min(0),
    call: RpcHttpCallOutputSchema,
});
