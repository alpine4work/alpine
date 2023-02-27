import {ErrorSchema} from "~/shared/error/error_schema";
import {Schema} from "~/shared/schema/schema";

export const RpcHttpCallInputSchema = Schema.object({
    name: Schema.string,
    input: Schema.unknown,
});

export const RpcHttpCallOutputSchema = Schema.result(
    Schema.object({
        ok: Schema.value(true),
        output: Schema.unknown,
    }),
    Schema.object({
        ok: Schema.value(false),
        error: ErrorSchema,
    }),
);

export const RpcHttpBatchCallInputSchema = Schema.object({
    calls: Schema.array(RpcHttpCallInputSchema),
});

export const RpcHttpBatchCallOutputSchema = Schema.result(
    Schema.object({
        ok: Schema.value(true),
        calls: Schema.array(RpcHttpCallOutputSchema),
    }),
    Schema.object({
        ok: Schema.value(false),
        error: ErrorSchema,
    }),
);
