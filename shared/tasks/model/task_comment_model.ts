import {TaskId} from "~/shared/id/types/id_types.js";
import {MessageModel, MessagePayloadModelSchema} from "~/shared/messaging/message_model.js";
import {MessageStreamSchema} from "~/shared/messaging/message_schema.js";
import {Model} from "~/shared/schema/model/model.js";
import {Schema} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export class TaskCommentModel
    extends Model(
        Schema.object({
            taskId: Schema.id<TaskId>(),
            index: Schema.integer,
            version: Schema.integer,
            author: AccountModel.schema,
            createdTime: Schema.date,
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
}
