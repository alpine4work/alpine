import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {getDynamoSeedConstants} from "~/server/dynamo/core/dynamo_seed_constants.js";
import {ForumRealtimeTable} from "~/server/forum/data/internal/forum_realtime_table.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {emptyMessageContent} from "~/shared/content/message_content_schema.js";
import {Context} from "~/shared/context/context.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";

export async function seedTestChannels(
    context: Context<DynamoContextModules & {jobs: JobsContextModule}>,
) {
    assert(process.env.NODE_ENV !== "production");
    const {testChannelId, defaultSpaceId} = getDynamoSeedConstants();

    // We're ok not sending a realtime event when seeding.
    const {wasCreated} = await ForumRealtimeTable.dangerouslyCreateItemIfNoneExistsWithoutEvent(
        context,
        {
            partitionType: "Channel",
            sortRangeType: "Attributes",
            channelId: testChannelId,
            spaceId: defaultSpaceId,
            createdTime: new Date(),
            creator: {accountId: null, from: null},
            name: "Test",
            description: emptyMessageContent,
            accessPolicy: {
                type: "Local",
                accountGrantById: emptyMap,
                defaultGrant: {level: "Manage", generation: 0},
                urlGrant: null,
            },
            // We haven't actually added a feed candidate entry for this channel but we think
            // it'd be weird if you unshared then re-shared this initial channel for the space
            // to get a feed entry.
            hasAddedFeedCandidateEntry: true,
        },
    );

    if (wasCreated) {
        context.jobs.send({
            type: "IndexSearchEntity",
            spaceId: defaultSpaceId,
            update: {
                type: "Channel",
                channelId: testChannelId,
                // Nothing depends on this entity when it's created. Don't bother trying to reindex
                // dependencies.
                updatedTraits: {type: "None"},
            },
        });
    }
}
