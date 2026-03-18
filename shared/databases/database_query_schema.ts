import {Schema, type SchemaType} from "~/shared/schema/schema.js";

export const LoaderDatabaseQueryResultSchema = Schema.object({
    sql: Schema.string,
    rows: Schema.array(Schema.unknown()),
    pages: Schema.array(
        Schema.object({
            pageIndex: Schema.integer,
            timestamp: Schema.integer,
            data: Schema.bytes,
        }),
    ),
});

export type LoaderDatabaseQueryResult = SchemaType<typeof LoaderDatabaseQueryResultSchema>;
