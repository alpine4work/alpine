import {intoApiMessageContentPayloadParent} from "~/server/api/internal/shared/into_api_message_content_payload_parent.js";
import {ServerBotActionContext} from "~/server/context/server_action_context.js";
import {getTaskCommentParentContent} from "~/server/tasks/data/task_messaging.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {MessageContentPayloadParent} from "~/shared/messaging/message_schema.js";

export function createIntoApiTaskCommentContentPayloadParent(
    context: ServerBotActionContext,
    spaceId: SpaceId,
    taskId: TaskId,
) {
    return async function (parent: MessageContentPayloadParent) {
        assert(parent.type !== "PostRange");

        const parentContent = await getTaskCommentParentContent(context, taskId, {
            parent,
            consistency: "StrongWithinCache",
        });
        return await intoApiMessageContentPayloadParent(context, spaceId, {
            ...parent,
            content: parentContent.content,
            authorId: parentContent.authorId,
        });
    };
}
