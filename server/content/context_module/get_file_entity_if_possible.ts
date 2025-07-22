import {ServerContentActionContextModules} from "~/server/context/server_content_action_context.js";
import {getFileDocumentEntityModelIfPossible} from "~/server/documents/data/get_file_document_entity_model_if_possible.js";
import {createPostNotFoundError, getPostIfPossible} from "~/server/forum/data/forum_table.js";
import {getFileChannelEntityModelIfPossible} from "~/server/forum/data/get_file_channel_entity_model_if_possible.js";
import {getFileTaskCollectionEntityModelIfPossible} from "~/server/tasks/data/get_file_task_collection_entity_model_if_possible.js";
import {TaskContextModuleBase} from "~/server/tasks/data/task_context_module.js";
import {getContentSnippet} from "~/shared/content/get_content_snippet.js";
import {Context} from "~/shared/context/context.js";
import {FileDocumentEntityModelSchema} from "~/shared/documents/file_document_entity_model_schema.js";
import {ErrorBase} from "~/shared/error/error.js";
import {FileEntityId, parseFileEntityId} from "~/shared/files/file_entity_id.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {FileChannelEntityModelSchema} from "~/shared/forum/file_channel_entity_model_schema.js";
import {FilePostEntityModelSchema} from "~/shared/forum/file_post_entity_model_schema.js";
import {assertPostContent} from "~/shared/forum/post_content_schema.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {mapResult} from "~/shared/helpers/control/map_result.js";
import {Result} from "~/shared/helpers/control/result.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {FileTaskCollectionEntityModelSchema} from "~/shared/tasks/file_task_collection_entity_model.js";

export async function getFileEntityIfPossible(
    context: Context<ServerContentActionContextModules & {tasks: TaskContextModuleBase}>,
    spaceId: SpaceId,
    entityId: FileEntityId,
): Promise<Result<FileEntityModel, ErrorBase>> {
    const entityIdObject = parseFileEntityId(entityId);

    switch (entityIdObject.type) {
        case "Document": {
            const result = await getFileDocumentEntityModelIfPossible(
                context,
                entityIdObject.documentId,
            );
            return mapResult(
                result,
                model => new FileEntityModel(FileDocumentEntityModelSchema, model),
            );
        }
        case "TaskCollection": {
            const result = await getFileTaskCollectionEntityModelIfPossible(
                context,
                spaceId,
                entityIdObject.collectionId,
            );
            return mapResult(
                result,
                model => new FileEntityModel(FileTaskCollectionEntityModelSchema, model),
            );
        }
        case "Channel": {
            const result = await getFileChannelEntityModelIfPossible(
                context,
                entityIdObject.channelId,
            );
            return mapResult(
                result,
                model => new FileEntityModel(FileChannelEntityModelSchema, model),
            );
        }
        case "Post": {
            const {postId} = entityIdObject;

            const postResult = await getPostIfPossible(context, postId);

            if (!postResult) return {ok: false, error: createPostNotFoundError(postId)};

            if (!postResult.ok) return postResult;
            const post = postResult.value;

            return {
                ok: true,
                value: new FileEntityModel(FilePostEntityModelSchema, {
                    type: "Post",
                    versions: [post.version, post.model.channel.version],
                    id: postId,
                    author: post.model.author,
                    createdTime: post.model.createdTime,
                    channelName: post.model.channel?.name,
                    content: {
                        doc: assertPostContent(
                            getContentSnippet(post.model.content.doc.resolve(0), {
                                linesAbove: 0,
                                linesBelow: 10,
                            }),
                        ),
                        references: post.model.content.references,
                    },
                }),
            };
        }
        default:
            throw exhaustive(entityIdObject);
    }
}
