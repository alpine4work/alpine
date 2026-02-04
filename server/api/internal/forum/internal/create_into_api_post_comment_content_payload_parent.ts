import {intoApiMessageContentPayloadParent} from "~/server/api/internal/shared/into_api_message_content_payload_parent.js";
import {ServerBotActionContext} from "~/server/context/server_action_context.js";
import {getPostCommentParentContent} from "~/server/forum/data/post_messaging.js";
import {assertMessageContent} from "~/shared/content/message_content_schema.js";
import {assertPostContent} from "~/shared/forum/post_content_schema.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {PostId, SpaceId} from "~/shared/id/types/id_types.js";
import {MessageContentPayloadParent} from "~/shared/messaging/message_schema.js";

export function createIntoApiPostCommentContentPayloadParent(
    context: ServerBotActionContext,
    spaceId: SpaceId,
    postId: PostId,
) {
    return async function (parent: MessageContentPayloadParent) {
        const {content, authorId} = await getPostCommentParentContent(context, postId, {
            parent,
            consistency: "StrongWithinCache",
        });

        switch (parent.type) {
            case "Message":
                return intoApiMessageContentPayloadParent(context, spaceId, {
                    index: parent.index,
                    content: assertMessageContent(content),
                    authorId,
                    type: "Message",
                });
            case "MessagesRange": {
                return intoApiMessageContentPayloadParent(context, spaceId, {
                    startIndex: parent.startIndex,
                    endIndex: parent.endIndex,
                    content: assertMessageContent(content),
                    authorId,
                    type: "MessagesRange",
                });
            }
            case "PostRange": {
                return intoApiMessageContentPayloadParent(context, spaceId, {
                    authorId,
                    content: assertPostContent(content),
                    type: "PostRange",
                });
            }
            default: {
                throw exhaustive(parent);
            }
        }
    };
}
