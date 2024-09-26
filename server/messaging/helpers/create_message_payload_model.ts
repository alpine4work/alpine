import {getContentReferencesForNode} from "~/server/content/get_content_references.js";
import {ServerContentActionContext} from "~/server/context/server_content_action_context.js";
import {FileAuthorizer} from "~/server/files/data/files_table.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {MessagePayload, MessagePayloadModel} from "~/shared/messaging/message_model.js";

/**
 * Create a `MessagePayloadModel` (what we send to the client) from a
 * `MessagePayload` (what we store in the database).
 */
export async function createMessagePayloadModel(
    context: ServerContentActionContext,
    spaceId: SpaceId,
    fileAuthorizer: FileAuthorizer,
    payload: MessagePayload,
): Promise<MessagePayloadModel> {
    switch (payload.type) {
        case "Content": {
            return {
                ...payload,
                content: {
                    doc: payload.content,
                    references: await getContentReferencesForNode(
                        context,
                        spaceId,
                        fileAuthorizer,
                        payload.content,
                    ),
                },
            };
        }
        case "Deleted":
            return payload;
        default:
            throw exhaustive(payload);
    }
}
