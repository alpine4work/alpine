import {LabelStringSchema} from "~/shared/schema/label_string_schema";
import {Model} from "~/shared/schema/model";
import {Schema} from "~/shared/schema/schema";

export class ChannelModel extends Model(
    Schema.object({
        id: Schema.id,
        spaceId: Schema.id,
        createdTime: Schema.date,
        name: LabelStringSchema,
    }),
) {}
