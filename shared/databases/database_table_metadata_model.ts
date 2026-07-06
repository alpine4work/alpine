import {AccessPolicySchema} from "~/shared/access/access_policy.js";
import type {DatabaseGroupId, DatabaseTableId, SpaceId} from "~/shared/id/types/id_types.js";
import {Model} from "~/shared/schema/model/model.js";
import {Schema} from "~/shared/schema/schema.js";

export class DatabaseTableMetadataModel extends Model(
    Schema.object({
        databaseGroupId: Schema.id<DatabaseGroupId>(),
        tableId: Schema.id<DatabaseTableId>(),
        spaceId: Schema.id<SpaceId>(),
        name: Schema.string.nullable(),
        isDeleted: Schema.boolean,
        accessPolicy: AccessPolicySchema,
        version: Schema.integer,
    }),
) {}
