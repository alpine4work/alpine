import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {getFileDocumentEntityModelIfPossible} from "~/server/files/data/get_document_file_entity_model_if_possible.js";
import {getFileChannelEntityModelIfPossible} from "~/server/files/data/get_file_channel_entity_model_if_possible.js";
import {getFileChatEntityModelIfPossible} from "~/server/files/data/get_file_chat_entity_model_if_possible.js";
import {getFileSiteEntityModelIfPossible} from "~/server/files/data/get_file_site_entity_model_if_possible.js";
import {getFileTaskCollectionEntityModelIfPossible} from "~/server/files/data/get_file_task_collection_entity_model_if_possible.js";
import {getFileTaskEntityModelIfPossible} from "~/server/files/data/get_file_task_entity_model_if_possible.js";
import {FileChatEntityModelSchema} from "~/shared/chat/file_chat_entity_model_schema.js";
import {getContentSnippet} from "~/shared/content/get_content_snippet.js";
import {Context} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {FileDocumentEntityModelSchema} from "~/shared/documents/file_document_entity_model_schema.js";
import {ErrorBase} from "~/shared/error/error.open_source.js";
import {FileEntityId, parseFileEntityId} from "~/shared/files/file_entity_id.js";
import {fileEntityMaxRecursionDepth} from "~/shared/files/file_entity_max_recursion_depth.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {FileChannelEntityModelSchema} from "~/shared/forum/file_channel_entity_model_schema.js";
import {FilePostEntityModelSchema} from "~/shared/forum/file_post_entity_model_schema.js";
import {createPostNotFoundError} from "~/shared/forum/forum_error_messages.js";
import {assertPostContent} from "~/shared/forum/post_content_schema.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {mapResult} from "~/shared/helpers/control/map_result.js";
import {Result} from "~/shared/helpers/control/result.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {FileSiteEntityModelSchema} from "~/shared/sites/file_site_entity_model_schema.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";
import {FileTaskCollectionEntityModelSchema} from "~/shared/tasks/file_task_collection_entity_model.js";
import {FileTaskEntityModelSchema} from "~/shared/tasks/file_task_entity_model.js";

// NOTE(calebmer, 2025-08-19): It could be useful to have a generic
// `StateContextModule` that lets you stash arbitrary state in context instead of
// creating one-off context modules like this. However, following our style guide
// recommendation that "No abstraction is better than the wrong abstraction". Let's
// wait until we have more examples of state in context.
class FileEntityDepthContextModule extends ContextModuleBase {
    public readonly depth: number;

    constructor(depth: number) {
        super();
        this.depth = depth;
    }
}

export async function getFileEntityIfPossible(
    context: Context<ServerActionContextModules & {fileEntityDepth?: FileEntityDepthContextModule}>,
    spaceId: SpaceId,
    entityId: FileEntityId,
    options?: {
        /**
         * If the caller already has a `SitePreviewModel` loaded (e.g. the site file entity
         * loader passing its own site down to its first entity) and it matches the inner
         * entity's site, the inner loader can reuse it instead of fetching the same site
         * preview again.
         */
        siteIfAlreadyLoaded?: SitePreviewModel;
    },
): Promise<Result<FileEntityModel, ErrorBase> | null> {
    const depth = context.fileEntityDepth?.depth ?? 0;

    // Cut off file entity loading when we're three entities deep. File entities may
    // recursively load each other (e.g. a document which has a file entity to itself
    // in its preview) so we need some protection to protect against infinite
    // recursion.
    //
    // Also, practically after three levels of depth previews shrink to such a size you
    // can't see what's being rendered.
    if (depth >= fileEntityMaxRecursionDepth) return null;

    // Increment file entity depth.
    context = context.clone({
        fileEntityDepth: new FileEntityDepthContextModule(depth + 1),
    });

    const entityIdObject = parseFileEntityId(entityId);

    switch (entityIdObject.type) {
        case "Document": {
            const result = await getFileDocumentEntityModelIfPossible(
                context,
                entityIdObject.documentId,
                {siteIfAlreadyLoaded: options?.siteIfAlreadyLoaded},
            );
            return mapResult(
                result,
                model => new FileEntityModel(FileDocumentEntityModelSchema, model),
            );
        }
        case "Task": {
            const result = await getFileTaskEntityModelIfPossible(
                context,
                spaceId,
                entityIdObject.taskId,
            );
            return mapResult(
                result,
                model => new FileEntityModel(FileTaskEntityModelSchema, model),
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
                {siteIfAlreadyLoaded: options?.siteIfAlreadyLoaded},
            );
            return mapResult(
                result,
                model => new FileEntityModel(FileChannelEntityModelSchema, model),
            );
        }
        case "Chat": {
            const result = await getFileChatEntityModelIfPossible(context, entityIdObject.chatId, {
                siteIfAlreadyLoaded: options?.siteIfAlreadyLoaded,
            });
            return mapResult(
                result,
                model => new FileEntityModel(FileChatEntityModelSchema, model),
            );
        }
        case "Post": {
            const {postId} = entityIdObject;

            const postResult = await context.forumInjection.getPostIfPossible(postId);

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
        case "Site": {
            const result = await getFileSiteEntityModelIfPossible(context, entityIdObject.siteId);
            return mapResult(
                result,
                model => new FileEntityModel(FileSiteEntityModelSchema, model),
            );
        }
        default:
            throw exhaustive(entityIdObject);
    }
}
