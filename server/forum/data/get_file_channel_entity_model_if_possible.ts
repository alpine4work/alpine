import {ServerContentActionContext} from "~/server/context/server_content_action_context.js";
import {
    createChannelNotFoundError,
    getChannelAndMetadataIfPossible,
    isSubscribedToChannel,
} from "~/server/forum/data/forum_table.js";
import {ErrorBase} from "~/shared/error/error.js";
import {ChannelContributorsModel, ChannelModel} from "~/shared/forum/channel_model.js";
import {FileChannelEntityModel} from "~/shared/forum/file_channel_entity_model_schema.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {Result} from "~/shared/helpers/control/result.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {ChannelId} from "~/shared/id/types/id_types.js";

export async function getFileChannelEntityModelIfPossible(
    context: ServerContentActionContext,
    channelId: ChannelId,
): Promise<Result<FileChannelEntityModel, ErrorBase>> {
    const [channelQueryResult, isSubscribedResult] = await runAllPromises([
        getChannelAndMetadataIfPossible(context, {
            channelId,
            postFilesLimit: 0,
        }),
        context.actor.type === "Session"
            ? captureResultPromise(
                  isSubscribedToChannel(context.actor.authorizeSession(), channelId),
              )
            : null,
    ]);

    if (!channelQueryResult) return {ok: false, error: createChannelNotFoundError(channelId)};

    if (!channelQueryResult.ok) return channelQueryResult;
    const channelQuery = channelQueryResult.value;

    // Only throw error from `isSubscribedToChannel()` if we're authorized to view
    // the channel.
    const isSubscribed = isSubscribedResult ? unwrapResult(isSubscribedResult) : false;

    const channel = assertExists(
        findMapIterable(channelQuery.items, item =>
            item.model instanceof ChannelModel
                ? (item as {readonly version: number; readonly model: ChannelModel})
                : undefined,
        ),
    );
    const channelContributors = findMapIterable(channelQuery.items, item =>
        item.model instanceof ChannelContributorsModel ? item.model : undefined,
    );

    return {
        ok: true,
        value: {
            type: "Channel",
            versions: [channel.version],
            id: channelId,
            createdTime: channel.model.createdTime,
            name: channel.model.name,
            description: channel.model.description,
            isSubscribed,
            contributorCount: channelContributors?.contributorCount ?? 0,
            topContributors: channelContributors?.topContributors ?? emptyArray,
        },
    };
}
