import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {ServerContentSessionActionContextModules} from "~/server/context/server_content_action_context.js";
import {authorizeDocumentAccessIfPossible} from "~/server/documents/data/documents_table.js";
import {getFileDocumentEntityModelIfPossible} from "~/server/documents/data/get_file_document_entity_model_if_possible.js";
import {
    InternalFeedReadFunctions,
    internalGetAndUpdateFeedEntries,
    internalGetFeedEntries,
} from "~/server/feed/data/feed_table.js";
import {
    authorizeChannelAccessIfPossible,
    getPostIfPossible,
} from "~/server/forum/data/forum_table.js";
import {getFileChannelEntityModelIfPossible} from "~/server/forum/data/get_file_channel_entity_model_if_possible.js";
import {getAccount} from "~/server/spaces/spaces_table.js";
import {getFileTaskCollectionEntityModelIfPossible} from "~/server/tasks/data/get_file_task_collection_entity_model_if_possible.js";
import {TaskContextModuleBase} from "~/server/tasks/data/task_context_module.js";
import {
    authorizeTaskCollectionAccessIfPossible,
    createTaskCollectionNotFoundError,
} from "~/server/tasks/data/task_table.js";
import {Context} from "~/shared/context/context.js";
import {ErrorBase} from "~/shared/error/error.js";
import {FeedEntryCursor} from "~/shared/feed/feed_entry_cursor.js";
import {
    FeedChannelEntryModel,
    FeedDocumentEntryModel,
    FeedEntryModel,
    FeedPostEntryModel,
    FeedTaskCollectionEntryModel,
    FeedWelcomeEntryModel,
} from "~/shared/feed/feed_entry_model.js";
import {FeedEntry} from "~/shared/feed/feed_entry_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {mapResult} from "~/shared/helpers/control/map_result.js";
import {okResult} from "~/shared/helpers/control/ok_result.js";
import {Result} from "~/shared/helpers/control/result.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

const internalFeedReadFunctions: InternalFeedReadFunctions<
    ServerContentSessionActionContextModules & {tasks: TaskContextModuleBase}
> = {
    authorizeFeedEntryIfPossible,
    createFeedEntryModelIfPossible,
};

async function authorizeFeedEntryIfPossible(
    context: ServerSessionActionContext,
    entry: FeedEntry,
): Promise<Result<unknown, ErrorBase>> {
    switch (entry.type) {
        case "Welcome": {
            return okResult;
        }
        case "Post": {
            return authorizeChannelAccessIfPossible(context, entry.channelId, "View");
        }
        case "Document": {
            return authorizeDocumentAccessIfPossible(context, entry.documentId, "View");
        }
        case "TaskCollection": {
            const result = await authorizeTaskCollectionAccessIfPossible(
                context,
                entry.collectionId,
                "View",
            );
            if (!result) throw createTaskCollectionNotFoundError(entry.collectionId);
            return result;
        }
        case "Channel": {
            return authorizeChannelAccessIfPossible(context, entry.channelId, "View");
        }
        default:
            throw exhaustive(entry);
    }
}

async function createFeedEntryModelIfPossible(
    context: Context<ServerContentSessionActionContextModules & {tasks: TaskContextModuleBase}>,
    spaceId: SpaceId,
    entry: FeedEntry,
): Promise<Result<FeedEntryModel, ErrorBase>> {
    switch (entry.type) {
        case "Welcome": {
            return {ok: true, value: new FeedWelcomeEntryModel({addedTime: entry.addedTime})};
        }
        case "Post": {
            const result = await getPostIfPossible(context, entry.postId);
            return mapResult(result, post => new FeedPostEntryModel({post}));
        }
        case "Document": {
            const [sharer, result] = await runAllPromises([
                getAccount(context, spaceId, entry.sharerId),
                getFileDocumentEntityModelIfPossible(context, entry.documentId),
            ]);

            return mapResult(
                result,
                document =>
                    new FeedDocumentEntryModel({
                        sharer,
                        sharedTime: entry.sharedTime,
                        event: entry.event,
                        document,
                    }),
            );
        }
        case "TaskCollection": {
            const [sharer, result] = await runAllPromises([
                getAccount(context, spaceId, entry.sharerId),
                getFileTaskCollectionEntityModelIfPossible(context, spaceId, entry.collectionId),
            ]);

            return mapResult(
                result,
                collection =>
                    new FeedTaskCollectionEntryModel({
                        sharer,
                        sharedTime: entry.sharedTime,
                        event: entry.event,
                        collection,
                    }),
            );
        }
        case "Channel": {
            const [sharer, result] = await runAllPromises([
                getAccount(context, spaceId, entry.sharerId),
                getFileChannelEntityModelIfPossible(context, entry.channelId),
            ]);

            return mapResult(
                result,
                channel =>
                    new FeedChannelEntryModel({
                        sharer,
                        sharedTime: entry.sharedTime,
                        event: entry.event,
                        channel,
                    }),
            );
        }
        default:
            throw exhaustive(entry);
    }
}

/**
 * Gets the feed entries at the top of the session actor's feed. First we
 * update the actor's feed before returning entries.
 */
export function getAndUpdateFeedEntries(
    context: Context<ServerContentSessionActionContextModules & {tasks: TaskContextModuleBase}>,
    options: {spaceId: SpaceId; limit: number},
): Promise<{
    startCursor: FeedEntryCursor | null;
    endCursor: FeedEntryCursor | null;
    hasMoreEntries: boolean;
    entries: Array<FeedEntryModel>;
}> {
    return internalGetAndUpdateFeedEntries(internalFeedReadFunctions, context, options);
}

/**
 * Paginate through an account's feed from top to bottom without updating the
 * feed. If you're loading the top of the account's feed generally you'll want
 * `getAndUpdateFeedEntries()` to make sure you're showing the latest stuff
 * that's been happening in the space.
 */
export function getFeedEntries(
    context: Context<ServerContentSessionActionContextModules & {tasks: TaskContextModuleBase}>,
    options: {
        spaceId: SpaceId;
        limit: number;
        beforeCursor?: FeedEntryCursor;
        afterCursor?: FeedEntryCursor;
    },
): Promise<{
    startCursor: FeedEntryCursor | null;
    endCursor: FeedEntryCursor | null;
    hasMoreEntries: boolean;
    entries: Array<FeedEntryModel>;
}> {
    return internalGetFeedEntries(internalFeedReadFunctions, context, options);
}
