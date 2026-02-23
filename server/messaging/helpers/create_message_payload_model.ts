import {getContentFileReference} from "~/server/content/get_content_references.js";
import {getContentReferencedIdsAssumingViewAccessWithOptionalSpaceAccess} from "~/server/content/get_content_references_assuming_view_access_with_optional_space_access.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {FileAuthorizer} from "~/server/files/data/file_authorizer.js";
import {getFileEntityIfPossible} from "~/server/files/data/get_file_entity_if_possible.js";
import {NotFoundError} from "~/shared/error/error.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {isId} from "~/shared/id/id.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {
    MessageContentPayloadModelFile,
    MessagePayloadModel,
} from "~/shared/messaging/message_model.js";
import {getMessageContentPayloadReferencedIds} from "~/shared/messaging/message_references.js";
import {MessagePayload, MessageStream} from "~/shared/messaging/message_schema.js";

/**
 * Create a `MessagePayloadModel` (what we send to the client) from a
 * `MessagePayload` (what we store in the database).
 */
export async function createMessagePayloadModel(
    context: ServerActionContext,
    spaceId: SpaceId,
    fileAuthorizer: FileAuthorizer,
    payload: MessagePayload,
    stream: MessageStream | null,
): Promise<MessagePayloadModel> {
    switch (payload.type) {
        case "Deleted": {
            assert(stream === null);
            return payload;
        }
        case "Content": {
            const [references, files] = await runAllPromises([
                getContentReferencedIdsAssumingViewAccessWithOptionalSpaceAccess(
                    context,
                    spaceId,
                    "AssertHasNoFiles",
                    getMessageContentPayloadReferencedIds(payload, stream),
                ),
                runAllPromises(
                    mapIterable(payload.fileIds, fileId =>
                        getMessageContentPayloadModelFile(context, spaceId, fileAuthorizer, fileId),
                    ),
                ),
            ]);

            return {
                type: "Content",
                parent: payload.parent,
                content: {
                    doc: payload.content,
                    references,
                },
                contentUpdate: payload.contentUpdate,
                files,
                clerical: payload.clerical,
                reactionsByPos: payload.reactionsByPos,
                filesReactions: payload.filesReactions,
            };
        }
        default:
            throw exhaustive(payload);
    }
}

export async function getMessageContentPayloadModelFile(
    context: ServerActionContext,
    spaceId: SpaceId,
    fileAuthorizer: FileAuthorizer,
    fileId: FileId | FileEntityId,
): Promise<MessageContentPayloadModelFile> {
    if (isId<FileId>(fileId)) {
        const file = await getContentFileReference(context, spaceId, fileId, fileAuthorizer);
        if (!file) throw new NotFoundError("File not found");
        return file;
    } else {
        const fileEntityResult = await getFileEntityIfPossible(context, spaceId, fileId);

        // Only returns null if we've exceeded the file entity recursion depth. If the
        // entity doesn't exist we return a result object with a not found error.
        assert(fileEntityResult);

        return {
            type: "FileEntity" as const,
            fileEntityId: fileId,
            fileEntityResult,
        };
    }
}
