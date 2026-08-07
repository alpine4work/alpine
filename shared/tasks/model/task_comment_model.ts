import {SpaceId, TaskId} from "~/shared/id/types/id_types.open_source.js";
import {MessageModel, MessagePayloadModelSchema} from "~/shared/messaging/message_model.js";
import {MessageStreamSchema} from "~/shared/messaging/message_schema.js";
import {TimeZoneSchema} from "~/shared/schema/helpers/time_zone_schema.js";
import {Model} from "~/shared/schema/model/model.js";
import {Schema} from "~/shared/schema/schema.open_source.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export class TaskCommentModel
    extends Model(
        Schema.object({
            taskId: Schema.id<TaskId>(),
            index: Schema.integer,
            version: Schema.integer,
            author: AccountModel.schema,
            createdTime: Schema.date,
            createdTimeZone: TimeZoneSchema,
            payload: MessagePayloadModelSchema,
            stream: MessageStreamSchema.nullable(),
        }),
    )
    implements MessageModel<TaskId>
{
    public readonly isOptimistic?: undefined;

    public getRoomKey() {
        return this.taskId;
    }

    public getSeeReactionsUrl(
        spaceId: SpaceId,
        contentVersion: number,
        pos: number | "Files",
    ): string {
        const baseUrl = `/task/${this.taskId}/comment/${this.index}/reactions`;
        const at = pos === "Files" ? "files" : `${pos}@${contentVersion}`;
        return `${baseUrl}?at=${at}`;
    }
}
