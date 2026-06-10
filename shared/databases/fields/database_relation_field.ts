import {defineVirtualDatabaseFieldProvider} from "~/shared/databases/fields/database_field_provider.js";
import {InternalError} from "~/shared/error/error.js";
import type {DatabaseRowId, DatabaseTableId} from "~/shared/id/types/id_types.js";
import {Schema, type SchemaType} from "~/shared/schema/schema.js";

export const DatabaseRelationFieldConfigSchema = Schema.object({
    type: Schema.value("relation"),
    joinTableId: Schema.id<DatabaseTableId>(),
    side: Schema.enum(["source", "target"]),
    cardinality: Schema.enum(["one", "many"]),
    linkedTableId: Schema.id<DatabaseTableId>(),
});

export type DatabaseRelationFieldConfig = SchemaType<typeof DatabaseRelationFieldConfigSchema>;

export const DatabaseRelationValueSchema = Schema.array(
    Schema.object({
        id: Schema.id<DatabaseRowId>(),
        name: Schema.string.nullable(),
    }),
);

export type DatabaseRelationValue = SchemaType<typeof DatabaseRelationValueSchema>;

export const databaseRelationFieldProvider = defineVirtualDatabaseFieldProvider({
    type: "relation",
    valueSchema: DatabaseRelationValueSchema,
    configSchema: DatabaseRelationFieldConfigSchema,
    getDefaultConfig: () => {
        throw new InternalError("relation fields require explicit config");
    },
    parseString: () => ({ok: false, error: undefined}),
    formatString: value => value.map(link => link.name ?? "Untitled").join(", "),
});
