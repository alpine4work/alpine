import {Schema} from "~/shared/schema/schema";

export const RpcEndpointInputSchema = Schema.object({
    executions: Schema.array(
        Schema.object({
            name: Schema.string,
            input: Schema.unknown,
        }),
    ),
});

export const RpcEndpointOutputErrorSchema = Schema.object({
    code: Schema.integer,
    message: Schema.string,
    name: Schema.string.optional(),
    stack: Schema.string.optional(),
});

export const RpcEndpointOutputExecutionSchema = Schema.result(
    Schema.object({
        ok: Schema.value(true),
        output: Schema.unknown,
    }),
    Schema.object({
        ok: Schema.value(false),
        error: RpcEndpointOutputErrorSchema,
    }),
);

export const RpcEndpointOutputSchema = Schema.result(
    Schema.object({
        ok: Schema.value(true),
        executions: Schema.array(RpcEndpointOutputExecutionSchema),
    }),
    Schema.object({
        ok: Schema.value(false),
        error: RpcEndpointOutputErrorSchema,
    }),
);
