import {apiForumPaths} from "~/server/api/internal/forum/api_forum_paths.js";
import {createTestApiServer} from "~/server/api/internal/test_helpers/create_test_api_server.js";
import {
    testMessagingApiImplementation,
    testMessagingApiImplementationSearchInjection,
} from "~/server/api/internal/test_helpers/test_messaging_api_implementation.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {forumInjection} from "~/server/forum/data/forum_injection.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {generateId} from "~/shared/id/id.js";
import {PostId} from "~/shared/id/types/id_types.js";

const context = createTestContext({
    forumInjection,
    searchInjection: testMessagingApiImplementationSearchInjection,
});

const server = createTestApiServer(context, apiForumPaths);

testMessagingApiImplementation(context, server, {
    generateMissingRoomPath: () => `/posts/${generateId<PostId>()}`,
    createPrivateRoom: async session => {
        const channel = await TestChannel.create(session, {access: "Private"});
        const post = await channel.createPost(session);
        return {roomPath: `/posts/${post.id}`, room: post};
    },
});
