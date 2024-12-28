import {
    getContentFileReference,
    getContentReferencesForNode,
} from "~/server/content/get_content_references.js";
import {ServerContentActionContext} from "~/server/context/server_content_action_context.js";
import {FileAuthorizer} from "~/server/files/data/files_table.js";
import {NotFoundError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
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
            const [references, files] = await runAllPromises([
                getContentReferencesForNode(context, spaceId, fileAuthorizer, payload.content),
                runAllPromises(
                    mapIterable(payload.fileIds, async fileId => {
                        const file = await getContentFileReference(
                            context,
                            spaceId,
                            fileId,
                            fileAuthorizer,
                        );
                        if (!file) throw new NotFoundError("File not found");
                        return file;
                    }),
                ),
            ]);

            return {
                type: "Content",
                parentMessageIndex: payload.parentMessageIndex,
                content: {
                    doc: payload.content,
                    references,
                },
                contentUpdatedTime: payload.contentUpdatedTime,
                files,
            };
        }
        case "Deleted":
            return payload;
        default:
            throw exhaustive(payload);
    }
}
