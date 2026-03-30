import {DatabaseModel} from "~/shared/databases/database_model.js";
import {DatabaseId, SpaceId} from "~/shared/id/types/id_types.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {Schema} from "~/shared/schema/schema.js";

export const createDatabase = defineRpc({
    name: "createDatabase",
    // Creates two databases if called twice.
    isIdempotent: false,
    input: {
        spaceId: Schema.id<SpaceId>(),
        databaseId: Schema.id<DatabaseId>().optional(),
        name: Schema.string,
    },
    output: {
        databaseId: Schema.id<DatabaseId>(),
        createdTime: Schema.date,
    },
});

export const updateDatabaseName = defineRpc({
    name: "updateDatabaseName",
    isIdempotent: true,
    input: {
        databaseId: Schema.id<DatabaseId>(),
        name: Schema.string,
    },
    output: {
        database: DatabaseModel.schema(),
    },
});
