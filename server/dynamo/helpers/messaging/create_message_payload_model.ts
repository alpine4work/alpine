import {RequestContext} from "~/server/dynamo/context/request_context";
import {getContentReferencesForNode} from "~/server/dynamo/helpers/get_content_references";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {SpaceId} from "~/shared/id/types/id_types";
import {MessagePayload, MessagePayloadModel} from "~/shared/models/message_model";

/**
 * Create a `MessagePayloadModel` (what we send to the client) from a
 * `MessagePayload` (what we store in the database).
 */
export async function createMessagePayloadModel(
    context: RequestContext,
    spaceId: SpaceId,
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
