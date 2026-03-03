import {Schema} from "~/shared/schema/schema.js";

export const DatabaseQueryRequestSchema = Schema.object({
    sql: Schema.string,
});

export const DatabaseQueryResponseSchema = Schema.object({
    rows: Schema.array(Schema.unknown()),
    pages: Schema.array(
        Schema.object({
            pageIndex: Schema.integer,
            data: Schema.bytes,
        }),
    ),
});
