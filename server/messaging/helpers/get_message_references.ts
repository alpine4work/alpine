import {getContentReferences} from "~/server/content/get_content_references.js";
import {ServerContentActionContext} from "~/server/context/server_content_action_context.js";
import {FileAuthorizer} from "~/server/files/data/files_table.js";
import {getMessageContentPayloadModelFile} from "~/server/messaging/helpers/create_message_payload_model.js";
import {getAccount} from "~/server/spaces/spaces_table.js";
import {InternalError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {MessageReferencedIds, MessageReferences} from "~/shared/messaging/message_references.js";

export async function getMessageReferences(
    context: ServerContentActionContext,
    spaceId: SpaceId,
    fileAuthorizer: FileAuthorizer | "AssertHasNoFiles",
    referencedIds: MessageReferencedIds,
): Promise<MessageReferences> {
    const [author, contentReferences, fileEntries] = await runAllPromises([
        referencedIds.authorId !== null
            ? getAccount(context, spaceId, referencedIds.authorId)
            : null,
        getContentReferences(
            context,
            spaceId,
            // `MessageContent` doesn't have referenced files in content. Make sure no
            // files were passed in by not providing a `FileAuthorizer`.
            "AssertHasNoFiles",
            referencedIds.contentReferencedIds,
        ),
        runAllPromises(
            mapIterable(referencedIds.fileIds, async fileId => {
                if (fileAuthorizer === "AssertHasNoFiles") {
                    throw new InternalError("Expected message to not include any referenced files");
                }
                return [
                    fileId,
                    await getMessageContentPayloadModelFile(
                        context,
                        spaceId,
                        fileAuthorizer,
                        fileId,
                    ),
                ] as const;
            }),
        ),
    ]);

    return {author, contentReferences, fileById: new Map(fileEntries)};
}
