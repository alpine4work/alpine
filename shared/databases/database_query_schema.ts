import {Schema} from "~/shared/schema/schema.js";

export const DatabaseQueryRequestSchema = Schema.object({
    sql: Schema.string,
});

export const DatabaseQueryResponseSchema = Schema.object({
    rows: Schema.array(Schema.unknown()),
    readPages: Schema.map(
        Schema.integer,
        Schema.object({
            timestamp: Schema.integer,
            data: Schema.bytes,
        }),
    ),
});
