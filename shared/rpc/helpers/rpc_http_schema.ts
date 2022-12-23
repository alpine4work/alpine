import {ErrorSchema} from "~/shared/error/error_schema";
import {Schema} from "~/shared/schema/schema";

export const RpcHttpInputSchema = Schema.object({
    calls: Schema.array(
        Schema.object({
            name: Schema.string,
            input: Schema.unknown,
        }),
    ),
});

export const RpcHttpOutputCallSchema = Schema.result(
    Schema.object({
        ok: Schema.value(true),
        output: Schema.unknown,
    }),
    Schema.object({
        ok: Schema.value(false),
        error: ErrorSchema,
    }),
);

export const RpcHttpOutputSchema = Schema.result(
    Schema.object({
        ok: Schema.value(true),
        calls: Schema.array(RpcHttpOutputCallSchema),
    }),
    Schema.object({
        ok: Schema.value(false),
        error: ErrorSchema,
    }),
);
