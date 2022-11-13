import {ErrorSchema} from "~/shared/error/error_schema";
import {Schema} from "~/shared/schema/schema";

export const NetworkFunctionHttpInputSchema = Schema.object({
    executions: Schema.array(
        Schema.object({
            name: Schema.string,
            input: Schema.unknown,
        }),
    ),
});

export const NetworkFunctionHttpOutputExecutionSchema = Schema.result(
    Schema.object({
        ok: Schema.value(true),
        output: Schema.unknown,
    }),
    Schema.object({
        ok: Schema.value(false),
        error: ErrorSchema,
    }),
);

export const NetworkFunctionHttpOutputSchema = Schema.result(
    Schema.object({
        ok: Schema.value(true),
        executions: Schema.array(NetworkFunctionHttpOutputExecutionSchema),
    }),
    Schema.object({
        ok: Schema.value(false),
        error: ErrorSchema,
    }),
);
