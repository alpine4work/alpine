import {ChannelId, SpaceId} from "~/shared/id/types/id_types.js";
import {MessageContentWithReferencesSchema} from "~/shared/messaging/message_content_schema.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {Model} from "~/shared/schema/model/model.js";
import {Schema} from "~/shared/schema/schema.js";

export class ChannelModel extends Model(
    Schema.object({
        id: Schema.id<ChannelId>(),
        spaceId: Schema.id<SpaceId>(),
        createdTime: Schema.date,
        name: LabelStringSchema,
        description: MessageContentWithReferencesSchema,
    }),
) {
    public asPreview() {
        return new ChannelPreviewModel({
            id: this.id,
            spaceId: this.spaceId,
            createdTime: this.createdTime,
            name: this.name,
        });
    }
}

export class ChannelPreviewModel extends Model(
    Schema.object({
        id: Schema.id<ChannelId>(),
        spaceId: Schema.id<SpaceId>(),
        createdTime: Schema.date,
        name: LabelStringSchema,
    }),
) {}
