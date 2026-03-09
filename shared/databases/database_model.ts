import {DatabaseId, SpaceId} from "~/shared/id/types/id_types.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {Model} from "~/shared/schema/model/model.js";
import {Schema} from "~/shared/schema/schema.js";

export class DatabaseModel extends Model(
    Schema.object({
        id: Schema.id<DatabaseId>(),
        spaceId: Schema.id<SpaceId>(),
        version: Schema.integer,
        createdTime: Schema.date,
        name: LabelStringSchema,
    }),
) {}
