import {
    createMockAgentKingKongRecording,
    mockAgentKingKongRecordingDocumentTitles,
} from "~/admin/scenarios/internal/mock_agent_king_kong_recording.js";
import {putMockAgentRecording} from "~/admin/scenarios/internal/put_mock_agent_recording.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {getDynamoSeedConstants} from "~/server/dynamo/core/dynamo_seed_constants.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestContext} from "~/server/spaces/test_helpers/test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {runAllObjectPromises} from "~/shared/helpers/async/run_all_promises.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {JsonObjectValue} from "~/shared/helpers/types/json_value.js";

export async function createMockAgentPlaygroundScenario(context: TestContext) {
    const space = await TestSpace.create(context, {name: "Mock Agent Playground"});

    const session = await space.createSession({name: "Test Testerson", role: "Owner"});
    const ownerEmailAddress = await session.account.createEmailAddress();

    const bot = await TestBot.get(context, getDynamoSeedConstants().mockChatGptBotId);
    const botAccount = await bot.instantiate(session);

    const documents = await runAllObjectPromises(
        mapObjectValues(mockAgentKingKongRecordingDocumentTitles, title =>
            TestDocument.create(session, {title}),
        ),
    );

    const recording = createMockAgentKingKongRecording(
        mapObjectValues(documents, document => document.id),
    );

    const channel = await TestChannel.create(session, {name: "Playground"});
    const post = await channel.createPost(session, "King Kong");

    await putMockAgentRecording(botAccount, `/posts/${post.id}`, recording);

    return {
        log: cast<JsonObjectValue>({
            spaceId: space.id,
            ownerEmailAddress,
        }),
    };
}
