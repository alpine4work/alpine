import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeChannelAccess} from "~/server/forum/data/authorize_channel_access.js";
import {getChannelPreviewIfPossible} from "~/server/forum/data/get_channel_preview.js";
import {authorizeChannelItemAccessIfPossible} from "~/server/forum/data/internal/authorize_channel_item_access.js";
import {ForumRealtimeTable} from "~/server/forum/data/internal/forum_realtime_table.js";
import {ChannelPreviewItemAuthorizationCache} from "~/server/forum/data/internal/get_channel_preview_item_for_authorization.js";
import {
    DynamoGeneralRealtimeBackfillResult,
    DynamoGeneralRealtimeQueryResult,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {DynamoItemKey, DynamoItemPartitionKey} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {
    DataLossError,
    DeadlineExceededError,
    ErrorBase,
    InternalError,
} from "~/shared/error/error.js";
import {ChannelModel, ChannelOrMetadataModel} from "~/shared/forum/channel_model.js";
import {createChannelNotFoundError} from "~/shared/forum/forum_error_messages.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {Result} from "~/shared/helpers/control/result.js";
import {ChannelId} from "~/shared/id/types/id_types.js";
import {ServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";
/**
 * Get a `ChannelModel` and post files in the channel all at once. Executes a
 * realtime query so the data can be kept up-to-date in realtime.
 */
export function getChannelAndMetadataIfPossible(
    context: ServerActionContext,
    {
        channelId,
        postFilesLimit,
        afterItemKey = null,
        consistency = "Eventual",
    }: {
        channelId: ChannelId;
        postFilesLimit: number;
        afterItemKey?: DynamoItemKey | null;
        consistency?: DynamoReadConsistency;
    },
): Promise<Result<DynamoGeneralRealtimeQueryResult<ChannelOrMetadataModel>, ErrorBase> | null> {
    if (afterItemKey) {
        return (async () => {
            const [channelResult, queryResult] = await runAllPromises([
                // Get the channel preview separately to make sure we're authorized to make this
                // request.
                getChannelPreviewIfPossible(context, channelId, {consistency}),

                ForumRealtimeTable.realtimeQuery(context, {
                    consistency,
                    partitionKey: {partitionType: "Channel", channelId},
                    paginate: {type: "FromStart", afterItemKey},
                    // Plus one for `ChannelModel` and plus one for `ChannelContributorsModel`.
                    limit: postFilesLimit + 2,
                }),
            ]);

            if (channelResult === null) return null;
            if (!channelResult.ok) return channelResult;

            return {ok: true, value: queryResult};
        })();
    } else {
        const channelPromiseResolver = createPromiseResolver<ChannelModel | null>();

        const promise = (async (): Promise<Result<
            DynamoGeneralRealtimeQueryResult<ChannelOrMetadataModel>,
            ErrorBase
        > | null> => {
            const result = await ForumRealtimeTable.realtimeQuery(context, {
                consistency,
                partitionKey: {partitionType: "Channel", channelId},
                paginate: {type: "FromStart", afterItemKey},
                // Plus one for `ChannelModel` and plus one for `ChannelContributorsModel`.
                limit: postFilesLimit + 2,
                onItem: item => {
                    if (item.model instanceof ChannelModel) {
                        channelPromiseResolver.resolve(item.model);
                    }
                },
            });
            if (result.items.length === 0) return null;

            const channel = result.items[0]!;

            if (!(channel.model instanceof ChannelModel)) {
                throw new DataLossError("Expected the first query item to be the channel model");
            }

            // Save the channel item to our authorization cache in case we try to load it again
            // later.
            ChannelPreviewItemAuthorizationCache.set(
                context,
                consistency,
                channelId,
                channel.model,
            );

            const authorizationResult = await authorizeChannelItemAccessIfPossible(
                context,
                channel.model,
                "View",
            );
            if (!authorizationResult.ok) return authorizationResult;

            return {ok: true, value: result};
        })().then(
            result => {
                // All of these promise resolvers MUST have either been resolved or rejected by the
                // end of this promise. So any promise resolvers that haven't been settled yet
                // reject with an error as a safety mechanism.
                if (!channelPromiseResolver.isSettled()) {
                    if (!result) {
                        channelPromiseResolver.resolve(null);
                    } else if (result && !result.ok) {
                        channelPromiseResolver.reject(result.error);
                    } else {
                        channelPromiseResolver.reject(
                            new InternalError("Promise resolver wasn\u2019t resolved"),
                        );
                    }
                }

                return result;
            },
            error => {
                channelPromiseResolver.reject(error);
                throw error;
            },
        );

        // Protect against deadlocks where `ForumRealtimeTable.realtimeQuery()` is waiting
        // for this channel preview promise before it can return. But the channel preview
        // promise is waiting on `ForumRealtimeTable.realtimeQuery()` to finish.
        const timeout = createTimeout(() => {
            channelPromiseResolver.reject(
                new DeadlineExceededError(
                    "Timed out waiting for channel item, possibly deadlocked?",
                ),
            );
        }, 3000);

        channelPromiseResolver.promise.then(
            () => timeout.clear(),
            () => timeout.clear(),
        );

        // If we're loading the channel, we can use the channel item in our
        // `ChannelPreviewModel` cache to avoid extra fetches.
        ChannelPreviewItemAuthorizationCache.set(
            context,
            consistency,
            channelId,
            channelPromiseResolver.promise,
        );

        return promise;
    }
}

/**
 * Get a `ChannelModel` and post files in the channel all at once. Executes a
 * realtime query so the data can be kept up-to-date in realtime.
 */
export async function getChannelAndMetadata(
    context: ServerActionContext,
    options: {
        channelId: ChannelId;
        postFilesLimit: number;
        afterItemKey?: DynamoItemKey | null;
        consistency?: DynamoReadConsistency;
    },
): Promise<DynamoGeneralRealtimeQueryResult<ChannelOrMetadataModel>> {
    const result = await getChannelAndMetadataIfPossible(context, options);
    if (!result) throw createChannelNotFoundError(options.channelId);
    return unwrapResult(result);
}

/**
 * Backfill any realtime updates to catch up our client after it's been
 * disconnected from realtime.
 */
export async function backfillChannelAndMetadata(
    context: ServerActionContext,
    {
        channelId,
        checkpoint,
    }: {
        channelId: ChannelId;
        checkpoint: ServerSynchronizationCheckpoint;
    },
): Promise<DynamoGeneralRealtimeBackfillResult<ChannelOrMetadataModel>> {
    const [, result] = await runAllPromises([
        authorizeChannelAccess(context, channelId, "View"),

        ForumRealtimeTable.backfillRealtimeQuery(context, {
            partitionKey: {partitionType: "Channel", channelId},
            checkpoint,
        }),
    ]);

    return result;
}

export function getChannelAndMetadataPartitionKey(channelId: ChannelId): DynamoItemPartitionKey {
    return ForumRealtimeTable.getRealtimeQueryPartitionKey({partitionType: "Channel", channelId});
}
