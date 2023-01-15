import {ChannelId, SpaceId} from "~/shared/id/types/id_types";
import {LabelStringSchema} from "~/shared/schema/label_string_schema";
import {Model} from "~/shared/schema/model";
import {Schema} from "~/shared/schema/schema";

export class ChannelModel extends Model(
    Schema.object({
        id: Schema.id<ChannelId>(),
        spaceId: Schema.id<SpaceId>(),
        createdTime: Schema.date,
        name: LabelStringSchema,
    }),
) {}
