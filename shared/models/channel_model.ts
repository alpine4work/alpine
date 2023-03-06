import {ChannelId, SpaceId} from "~/shared/id/types/id_types";
import {MessageContentWithReferencesSchema} from "~/shared/models/message_model";
import {Model} from "~/shared/models/model";
import {LabelStringSchema} from "~/shared/schema/label_string_schema";
import {Schema} from "~/shared/schema/schema";

export class ChannelModel extends Model(
    Schema.object({
        id: Schema.id<ChannelId>(),
        spaceId: Schema.id<SpaceId>(),
        createdTime: Schema.date,
        name: LabelStringSchema,
        description: MessageContentWithReferencesSchema,
    }),
) {}
