import {CalendarDateTime, today as getToday, today} from "@internationalized/date";
import {stringifyCookie} from "cookie";
import fs from "fs/promises";
import {
    decode as decodeO200kBaseTokens,
    encode as encodeO200kBaseTokens,
} from "gpt-tokenizer/esm/encoding/o200k_base";
import {join as joinPath} from "path";
import {parseApiContentFromMarkdown} from "~/server/api/markdown/parse_api_content_from_markdown.js";
import {TestBot, TestBotAccount} from "~/server/bots/test_helpers/test_bot.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {getDynamoSeedConstants} from "~/server/dynamo/core/dynamo_seed_constants.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {
    addSearchAffinityEntityPointsForTest,
    favoriteSearchEntity,
} from "~/server/search/data/table/search_entity_actions.js";
import {TestContext} from "~/server/spaces/test_helpers/test_context.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {
    MockAgentRecording,
    MockAgentRecordingAction,
} from "~/shared/agents/mock_agent_recording.js";
import {ApiMessageRoomPath} from "~/shared/api/types/api_specification_convenience_types.js";
import {UploadAvatarResponseSchema} from "~/shared/avatar/protocol/upload_avatar_response_schema.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {UnknownError} from "~/shared/error/error.js";
import {getPathFileContentTypeIfExists} from "~/shared/files/file_content_type.js";
import {
    PostContentProsemirrorSchema,
    assertPostContent,
} from "~/shared/forum/post_content_schema.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.js";
import {
    runAllObjectPromises,
    runAllPromiseThunks,
    runAllPromises,
} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {getCurrentTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {JsonObjectValue} from "~/shared/helpers/types/json_value.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";

export async function createLaunchVideoScenario(
    context: TestContext,
    {tokenAgent}: {tokenAgent: TokenAgent},
): Promise<JsonObjectValue> {
    const space = await TestSpace.create(context, {
        // We use our company name for the space since a fictional product name might
        // not be clear (it may look like an Alpine product name). Plus it's good to
        // get our company name in more screenshots.
        name: "Alpine",
    });

    const accounts = await createFictionalAmbrookAccounts(space);
    const {
        cassCade,
        roseCompas,
        elleKappaTan,
        masonClay,
        mattRHorn,
        cliffWeathers,
        hollyEvergreen,
        chatGpt,
    } = accounts;

    const currentTime = new Date();

    const emailAddressTime =
        currentTime.getFullYear().toString().padStart(4, "0") +
        "." +
        (currentTime.getMonth() + 1).toString().padStart(2, "0") +
        "." +
        currentTime.getDate().toString().padStart(2, "0") +
        "." +
        // Seconds through the day. We use this format instead of `hh.mm.ss` so the
        // date clearly reads as a date. Seconds are added on purely to disambiguate.
        (
            currentTime.getHours() * 60 * 60 +
            currentTime.getMinutes() * 60 +
            currentTime.getSeconds()
        )
            .toString()
            .padStart(5, "0");

    const [
        cassCadeEmailAddress,
        roseCompasEmailAddress,
        {
            sprintCollection,
            lastSprintCollection,
            grantsNavigatorCollection,
            receiptMobileScannerCollection,
            aiCollection,
            integrationsCollection,
            recruitingCollection,
            interviewTask,
            coldEmailCampaignTask,
        },
        {engineeringChannel, fundraisingChannel, brainstormDocument},
        {
            pitchDeckDocument,
            debuggingNotesDocument,
            investorMeetingNotesDocument,
            beliefStrengthSystemDocument,
            companyValuesDocument,
        },
        engineeringChat,
        hrChat,
    ] = await runAllPromises([
        cassCade.account.createEmailAddress(`cass.cade.${emailAddressTime}@test.cyberworlds.dev`),
        roseCompas.account.createEmailAddress(
            `rose.compas.${emailAddressTime}@test.cyberworlds.dev`,
        ),

        createFictionalAmbrookSprintTasks(accounts),
        createLaunchVideoFeed(accounts),
        createLaunchVideoDocuments(accounts),

        (async () => {
            const chat = await TestChat.get(roseCompas, elleKappaTan, masonClay);

            // We need to send a message to the chat for it to be indexed.
            await chat.sendMessage(roseCompas, "Hello, world!");

            return chat;
        })(),

        (async () => {
            const chat = await TestChat.get(roseCompas, cassCade, cliffWeathers, hollyEvergreen);

            // We need to send a message to the chat for it to be indexed.
            await chat.sendMessage(roseCompas, "Hello, world!");

            return chat;
        })(),

        uploadScenarioSpaceAvatar(tokenAgent, cassCade, "light", "scenario_space_avatar_light.svg"),
        uploadScenarioSpaceAvatar(tokenAgent, cassCade, "dark", "scenario_space_avatar_dark.svg"),
        uploadFictionalAmbrookAccountAvatars(tokenAgent, accounts),
    ]);

    await runAllPromises([
        favoriteSearchEntity(roseCompas.action(), {
            spaceId: roseCompas.space.id,
            entityId: `Account:${cassCade.account.id}`,
        }),
        addSearchAffinityEntityPointsForTest(roseCompas.action(), {
            spaceId: roseCompas.space.id,
            accountId: roseCompas.account.id,
            entityId: `Document:${pitchDeckDocument.id}`,
            points: 999_000_000,
        }),
        addSearchAffinityEntityPointsForTest(roseCompas.action(), {
            spaceId: roseCompas.space.id,
            accountId: roseCompas.account.id,
            entityId: `Task:${interviewTask.id}`,
            points: 998_000_000,
        }),
        addSearchAffinityEntityPointsForTest(roseCompas.action(), {
            spaceId: roseCompas.space.id,
            accountId: roseCompas.account.id,
            entityId: `Task:${coldEmailCampaignTask.id}`,
            points: 997_000_000,
        }),
        addSearchAffinityEntityPointsForTest(roseCompas.action(), {
            spaceId: roseCompas.space.id,
            accountId: roseCompas.account.id,
            entityId: `Account:${cassCade.account.id}`,
            points: 996_000_000,
        }),
        addSearchAffinityEntityPointsForTest(roseCompas.action(), {
            spaceId: roseCompas.space.id,
            accountId: roseCompas.account.id,
            entityId: `Channel:${fundraisingChannel.id}`,
            points: 995_000_000,
        }),
        addSearchAffinityEntityPointsForTest(roseCompas.action(), {
            spaceId: roseCompas.space.id,
            accountId: roseCompas.account.id,
            entityId: `Account:${chatGpt.id}`,
            points: 994_000_000,
        }),
        addSearchAffinityEntityPointsForTest(roseCompas.action(), {
            spaceId: roseCompas.space.id,
            accountId: roseCompas.account.id,
            entityId: "TaskPersonal",
            points: 993_000_000,
        }),
        addSearchAffinityEntityPointsForTest(roseCompas.action(), {
            spaceId: roseCompas.space.id,
            accountId: roseCompas.account.id,
            entityId: `Chat:${engineeringChat.id}`,
            points: 992_000_000,
        }),
        addSearchAffinityEntityPointsForTest(roseCompas.action(), {
            spaceId: roseCompas.space.id,
            accountId: roseCompas.account.id,
            entityId: `Channel:${engineeringChannel.id}`,
            points: 991_000_000,
        }),
        addSearchAffinityEntityPointsForTest(roseCompas.action(), {
            spaceId: roseCompas.space.id,
            accountId: roseCompas.account.id,
            entityId: `TaskCollection:${sprintCollection.id}`,
            points: 990_000_000,
        }),
        addSearchAffinityEntityPointsForTest(roseCompas.action(), {
            spaceId: roseCompas.space.id,
            accountId: roseCompas.account.id,
            entityId: `Account:${mattRHorn.account.id}`,
            points: 989_000_000,
        }),
        addSearchAffinityEntityPointsForTest(roseCompas.action(), {
            spaceId: roseCompas.space.id,
            accountId: roseCompas.account.id,
            entityId: `Account:${cliffWeathers.account.id}`,
            points: 988_000_000,
        }),
        addSearchAffinityEntityPointsForTest(roseCompas.action(), {
            spaceId: roseCompas.space.id,
            accountId: roseCompas.account.id,
            entityId: `Document:${brainstormDocument.id}`,
            points: 987_000_000,
        }),
        addSearchAffinityEntityPointsForTest(roseCompas.action(), {
            spaceId: roseCompas.space.id,
            accountId: roseCompas.account.id,
            entityId: `TaskCollection:${aiCollection.id}`,
            points: 986_000_000,
        }),
        addSearchAffinityEntityPointsForTest(roseCompas.action(), {
            spaceId: roseCompas.space.id,
            accountId: roseCompas.account.id,
            entityId: `TaskCollection:${recruitingCollection.id}`,
            points: 985_000_000,
        }),
        addSearchAffinityEntityPointsForTest(roseCompas.action(), {
            spaceId: roseCompas.space.id,
            accountId: roseCompas.account.id,
            entityId: `Chat:${hrChat.id}`,
            points: 984_000_000,
        }),
        addSearchAffinityEntityPointsForTest(roseCompas.action(), {
            spaceId: roseCompas.space.id,
            accountId: roseCompas.account.id,
            entityId: `TaskCollection:${lastSprintCollection.id}`,
            points: 983_000_000,
        }),
        addSearchAffinityEntityPointsForTest(roseCompas.action(), {
            spaceId: roseCompas.space.id,
            accountId: roseCompas.account.id,
            entityId: `Document:${debuggingNotesDocument.id}`,
            points: 982_000_000,
        }),
        addSearchAffinityEntityPointsForTest(roseCompas.action(), {
            spaceId: roseCompas.space.id,
            accountId: roseCompas.account.id,
            entityId: `TaskCollection:${grantsNavigatorCollection.id}`,
            points: 981_000_000,
        }),
        addSearchAffinityEntityPointsForTest(roseCompas.action(), {
            spaceId: roseCompas.space.id,
            accountId: roseCompas.account.id,
            entityId: `Document:${investorMeetingNotesDocument.id}`,
            points: 980_000_000,
        }),
        addSearchAffinityEntityPointsForTest(roseCompas.action(), {
            spaceId: roseCompas.space.id,
            accountId: roseCompas.account.id,
            entityId: `Document:${beliefStrengthSystemDocument.id}`,
            points: 979_000_000,
        }),
        addSearchAffinityEntityPointsForTest(roseCompas.action(), {
            spaceId: roseCompas.space.id,
            accountId: roseCompas.account.id,
            entityId: `Document:${companyValuesDocument.id}`,
            points: 978_000_000,
        }),
        addSearchAffinityEntityPointsForTest(roseCompas.action(), {
            spaceId: roseCompas.space.id,
            accountId: roseCompas.account.id,
            entityId: `TaskCollection:${receiptMobileScannerCollection.id}`,
            points: 977_000_000,
        }),
        addSearchAffinityEntityPointsForTest(roseCompas.action(), {
            spaceId: roseCompas.space.id,
            accountId: roseCompas.account.id,
            entityId: `TaskCollection:${integrationsCollection.id}`,
            points: 976_000_000,
        }),
    ]);

    return {
        spaceId: space.id,
        cassCade: {
            accountId: cassCade.account.id,
            emailAddress: cassCadeEmailAddress,
        },
        roseCompas: {
            accountId: roseCompas.account.id,
            emailAddress: roseCompasEmailAddress,
        },
    };
}

async function uploadScenarioSpaceAvatar(
    tokenAgent: TokenAgent,
    session: TestSpaceSession,
    themeColor: "light" | "dark",
    path: string,
): Promise<void> {
    const contentType = assertExists(getPathFileContentTypeIfExists(path));

    const file = await fs.readFile(
        joinPath(runfilesPath, "cyberworlds/admin/scenarios/fixtures", path),
    );

    const url = new URL(
        `/api/avatar/space/${session.space.id}`,
        session.context.constants.edgeServiceUrl,
    );
    url.searchParams.set("themeColor", themeColor);

    await fetchWithTracer(
        session.context.tracer.getTracer(),
        url,
        {
            serviceName: "EdgeService",
            route: "/api/avatar/space/:spaceId",
            method: "POST",
            headers: {
                "content-type": contentType,
                "content-length": file.length.toString(),
                cookie: stringifyCookie({
                    session: await tokenAgent.privateSide.dangerouslySignShortLivedToken(
                        "EdgeService",
                        session.getTokenPayload(),
                    ),
                }),
            },
            body: new Uint8Array(file),
        },
        async response => {
            const responseData = await response.json();
            const responseBody = UploadAvatarResponseSchema.deserialize(responseData);
            if (!responseBody.ok) throw responseBody.error;
        },
    );
}

async function uploadScenarioAccountAvatar(
    tokenAgent: TokenAgent,
    session: TestSession,
    path: string,
): Promise<void> {
    const contentType = assertExists(getPathFileContentTypeIfExists(path));

    const file = await fs.readFile(
        joinPath(runfilesPath, "cyberworlds/admin/scenarios/fixtures", path),
    );

    await fetchWithTracer(
        session.context.tracer.getTracer(),
        new URL(
            `/api/avatar/account/${session.account.id}`,
            session.context.constants.edgeServiceUrl,
        ),
        {
            serviceName: "EdgeService",
            route: "/api/avatar/account/:accountId",
            method: "POST",
            headers: {
                "content-type": contentType,
                "content-length": file.length.toString(),
                cookie: stringifyCookie({
                    session: await tokenAgent.privateSide.dangerouslySignShortLivedToken(
                        "EdgeService",
                        session.getTokenPayload(),
                    ),
                }),
            },
            body: new Uint8Array(file),
        },
        async response => {
            const responseData = await response.json();
            const responseBody = UploadAvatarResponseSchema.deserialize(responseData);
            if (!responseBody.ok) throw responseBody.error;
        },
    );
}

type FictionalAmbrookAccounts = Awaited<ReturnType<typeof createFictionalAmbrookAccounts>>;

async function createFictionalAmbrookAccounts(space: TestSpace) {
    const roseCompasPromise = space.createSession({
        name: "Rose Compás",
        role: "Owner",
        reactionCharacter: {type: "Tree", variant: "Green"},
    });

    return runAllObjectPromises({
        // Chief of Staff (landing page is from Cass's perspective)
        cassCade: space.createSession({
            name: "Cass Cade",
            role: "Admin",
            reactionCharacter: {type: "Yeti", variant: "Blue"},
        }),

        // CEO (launch video is from Rose's perspective)
        roseCompas: roseCompasPromise,

        // Designer
        mattRHorn: space.createSession({
            name: "Matt R. Horn",
            reactionCharacter: {type: "Cat", variant: "Grey"},
        }),

        // Engineer 1
        masonClay: space.createSession({
            name: "Mason Clay",
            reactionCharacter: {type: "Yeti", variant: "Brown"},
        }),

        // Engineer 2
        elleKappaTan: space.createSession({
            name: "Elle Kappa-Tan",
            reactionCharacter: {type: "Cat", variant: "Yellow"},
        }),

        // Sales
        cliffWeathers: space.createSession({
            name: "Cliff Weathers",
            reactionCharacter: {type: "Tree", variant: "Blue"},
        }),

        // HR
        hollyEvergreen: space.createSession({
            name: "Holly Evergreen",
            reactionCharacter: {type: "Tree", variant: "Pink"},
        }),

        // AI
        chatGpt: (async () => {
            // TODO(calebmer, 2025-12-08): We don't currently have bot avatars set up yet.
            // There's a file in `scenario_chatgpt_avatar.png` that we're not currently
            // using. We need to figure out a way to get avatars uploaded for bots for test
            // scenarios.
            const bot = await TestBot.get(space.context, getDynamoSeedConstants().mockChatGptBotId);

            const roseCompas = await roseCompasPromise;

            return bot.instantiate(roseCompas);
        })(),
    });
}

async function uploadFictionalAmbrookAccountAvatars(
    tokenAgent: TokenAgent,
    accounts: FictionalAmbrookAccounts,
) {
    const upload = (name: Exclude<keyof FictionalAmbrookAccounts, "chatGpt">, path: string) =>
        uploadScenarioAccountAvatar(tokenAgent, accounts[name], path);

    await runAllPromises([
        upload("cassCade", "scenario_cass_cade_avatar.png"),
        upload("roseCompas", "scenario_rose_compas_avatar.png"),
        upload("mattRHorn", "scenario_matt_r_horn_avatar.png"),
        upload("masonClay", "scenario_mason_clay_avatar.png"),
        upload("elleKappaTan", "scenario_elle_kappa_tan_avatar.png"),
        upload("cliffWeathers", "scenario_cliff_weathers_avatar.png"),
        upload("hollyEvergreen", "scenario_holly_evergreen_avatar.png"),
    ]);
}

async function createFictionalAmbrookSprintTasks({
    roseCompas,
    mattRHorn,
    elleKappaTan,
    masonClay,
    cassCade,
}: FictionalAmbrookAccounts) {
    const today = getToday(getCurrentTimeZone());

    const [
        sprintCollection,
        lastSprintCollection,
        receiptMobileScannerCollection,
        grantsNavigatorCollection,
        profitByAcreDashboardCollection,
        aiCollection,
        integrationsCollection,
        designSystemCollection,
        documentationCollection,
        recruitingCollection,
    ] = await runAllPromises([
        TestTaskCollection.create(roseCompas, {
            name: "Sprint (2026 Q2)",
        }),
        TestTaskCollection.create(roseCompas, {
            name: "Sprint (2026 Q1)",
        }),
        TestTaskCollection.create(roseCompas, {
            name: "Receipt Mobile Scanner",
        }),
        TestTaskCollection.create(roseCompas, {
            name: "Grants Navigator",
        }),
        TestTaskCollection.create(roseCompas, {
            name: "Profit by Acre Dashboard",
        }),
        TestTaskCollection.create(roseCompas, {
            name: "AI",
        }),
        TestTaskCollection.create(roseCompas, {
            name: "Integrations",
        }),
        TestTaskCollection.create(roseCompas, {
            name: "Design System",
        }),
        TestTaskCollection.create(roseCompas, {
            name: "Documentation",
        }),
        TestTaskCollection.create(roseCompas, {
            name: "Recruiting",
        }),
    ]);

    await runAllPromises([
        sprintCollection.access.grantDefault(roseCompas),
        sprintCollection.updateColor(roseCompas, "green"),

        lastSprintCollection.access.grantDefault(roseCompas),

        receiptMobileScannerCollection.access.grantDefault(roseCompas),
        receiptMobileScannerCollection.updateColor(roseCompas, "orange"),

        grantsNavigatorCollection.access.grantDefault(roseCompas),
        grantsNavigatorCollection.updateColor(roseCompas, "purple"),

        profitByAcreDashboardCollection.access.grantDefault(roseCompas),
        profitByAcreDashboardCollection.updateColor(roseCompas, "yellow"),

        aiCollection.access.grantDefault(roseCompas),
        integrationsCollection.access.grantDefault(roseCompas),
        designSystemCollection.access.grantDefault(roseCompas),
        documentationCollection.access.grantDefault(roseCompas),

        recruitingCollection.access.grantDefault(roseCompas),
        recruitingCollection.updateColor(roseCompas, "red"),
    ]);

    const [interviewTask, coldEmailCampaignTask] = await runAllPromises([
        (async () => {
            const task = await TestTask.create(roseCompas, {
                title: "Interview Cara Bina",
                collections: [recruitingCollection],
                assignee: roseCompas,
            });

            await task.updateAssigneeStatus(roseCompas, "Active");

            return task;
        })(),
        (async () => {
            const task = await TestTask.create(roseCompas, {
                title: "Cold email campaign",
                collections: [recruitingCollection],
                assignee: roseCompas,
            });

            await task.updateAssigneeStatus(roseCompas, "Active");

            return task;
        })(),
        (async () => {
            const task = await TestTask.create(masonClay, {
                title: "Ship capture flow v1",
                collections: [sprintCollection, receiptMobileScannerCollection],
                priority: "High",
                assignee: masonClay,
                dueDate: today.subtract({days: 1}),
            });

            await task.updateAssigneeStatus(masonClay, "Active");

            await runAllPromises(
                createArrayWithLength(7, async index => {
                    const subtask = await TestTask.create(masonClay, {
                        title: `Subtask ${index + 1}`,
                        parent: task,
                    });

                    if (index + 1 <= 5) {
                        await subtask.updateStatus(masonClay, "Closed");
                    }
                }),
            );
        })(),
        (async () => {
            const task = await TestTask.create(mattRHorn, {
                title: "Design receipt mobile scanner UI",
                collections: [sprintCollection, receiptMobileScannerCollection],
                priority: "High",
                assignee: mattRHorn,
                dueDate: today.subtract({days: 1}),
            });

            await task.updateStatus(mattRHorn, "Closed");
        })(),
        (async () => {
            const task = await TestTask.create(elleKappaTan, {
                title: "Vendor detection service (>95% vendor recall on test set)",
                collections: [sprintCollection, aiCollection, receiptMobileScannerCollection],
                priority: "High",
                assignee: elleKappaTan,
                dueDate: today.add({days: 1}),
            });

            await task.updateAssigneeStatus(elleKappaTan, "Active");

            await runAllPromises(
                createArrayWithLength(5, async index => {
                    const subtask = await TestTask.create(elleKappaTan, {
                        title: `Subtask ${index + 1}`,
                        parent: task,
                    });

                    if (index + 1 <= 2) {
                        await subtask.updateStatus(elleKappaTan, "Closed");
                    }
                }),
            );
        })(),
        (async () => {
            const task = await TestTask.create(masonClay, {
                title: "Bank transaction history matching with conflict flagging and one-tap resolve",
                collections: [
                    sprintCollection,
                    receiptMobileScannerCollection,
                    integrationsCollection,
                ],
                priority: "High",
                assignee: masonClay,
            });

            await task.updateAssigneeStatus(masonClay, "Active");

            await runAllPromises(
                createArrayWithLength(4, index =>
                    TestTask.create(masonClay, {
                        title: `Subtask ${index + 1}`,
                        parent: task,
                    }),
                ),
            );
        })(),
        (async () => {
            const task = await TestTask.create(elleKappaTan, {
                title: "Eligibility questionnaire v1 (operations profile + location)",
                collections: [sprintCollection, grantsNavigatorCollection],
                priority: "High",
                assignee: elleKappaTan,
                dueDate: today.subtract({days: 1}),
            });

            await task.updateStatus(elleKappaTan, "Closed");
        })(),
        (async () => {
            const task = await TestTask.create(cassCade, {
                title: "Pilot farm 1-page training guide",
                collections: [
                    sprintCollection,
                    receiptMobileScannerCollection,
                    grantsNavigatorCollection,
                    documentationCollection,
                ],
                priority: "High",
                assignee: cassCade,
                dueDate: today.subtract({days: 1}),
            });

            await task.updateStatus(cassCade, "Closed");
        })(),
        (async () => {
            const task = await TestTask.create(masonClay, {
                title: "Application pre-fill for Natural Resources Conservation Service + checklist auto-generation",
                collections: [sprintCollection, grantsNavigatorCollection],
                priority: "High",
                assignee: masonClay,
            });

            await runAllPromises(
                createArrayWithLength(3, index =>
                    TestTask.create(masonClay, {
                        title: `Subtask ${index + 1}`,
                        parent: task,
                    }),
                ),
            );
        })(),
        (async () => {
            const task = await TestTask.create(mattRHorn, {
                title: "Status tracker (found, in progress, submitted, awarded)",
                collections: [sprintCollection, grantsNavigatorCollection],
                priority: "High",
                assignee: mattRHorn,
            });

            await task.updateStatus(mattRHorn, "Closed");
        })(),
        (async () => {
            const task = await TestTask.create(elleKappaTan, {
                title: "Tag schema + aggregation jobs for cost per acre",
                collections: [sprintCollection, profitByAcreDashboardCollection],
                priority: "High",
                assignee: elleKappaTan,
                dueDate: today,
            });

            await task.updateAssigneeStatus(elleKappaTan, "Active");

            await runAllPromises(
                createArrayWithLength(4, async index => {
                    const subtask = await TestTask.create(elleKappaTan, {
                        title: `Subtask ${index + 1}`,
                        parent: task,
                    });

                    if (index + 1 <= 1) {
                        await subtask.updateStatus(elleKappaTan, "Closed");
                    }
                }),
            );
        })(),
        (async () => {
            const task = await TestTask.create(mattRHorn, {
                title: "Dashboard cards v1 with “view in ledger” link",
                collections: [
                    sprintCollection,
                    profitByAcreDashboardCollection,
                    designSystemCollection,
                ],
                priority: "High",
                assignee: mattRHorn,
                dueDate: today.subtract({days: 1}),
            });

            await task.updateStatus(mattRHorn, "Closed");

            await runAllPromises(
                createArrayWithLength(2, index =>
                    TestTask.create(mattRHorn, {
                        title: `Subtask ${index + 1}`,
                        parent: task,
                    }),
                ),
            );
        })(),
        (async () => {
            await TestTask.create(elleKappaTan, {
                title: "Duplicate receipt detection and warning flow",
                collections: [sprintCollection, receiptMobileScannerCollection],
                priority: "Medium",
                assignee: elleKappaTan,
            });
        })(),
        (async () => {
            await TestTask.create(elleKappaTan, {
                title: "Auto-split bank transaction suggestions (enterprise/field/practice) learned from history",
                collections: [sprintCollection, receiptMobileScannerCollection, aiCollection],
                priority: "Medium",
                assignee: elleKappaTan,
            });
        })(),
        (async () => {
            const task = await TestTask.create(masonClay, {
                title: "“Approve & post” expenses UX + undo",
                collections: [sprintCollection, receiptMobileScannerCollection],
                priority: "Medium",
                assignee: masonClay,
            });

            await task.updateAssigneeStatus(masonClay, "Active");
        })(),
        (async () => {
            const task = await TestTask.create(cassCade, {
                title: "Program match score + “why this matched” explainer copy",
                collections: [sprintCollection, grantsNavigatorCollection, aiCollection],
                priority: "Medium",
                assignee: cassCade,
                dueDate: today,
            });

            await task.updateStatus(cassCade, "Closed");
        })(),
        (async () => {
            await TestTask.create(masonClay, {
                title: "Grant submission webhooks + status polling (mock USDA endpoints)",
                collections: [sprintCollection, integrationsCollection, grantsNavigatorCollection],
                priority: "Medium",
                assignee: masonClay,
            });
        })(),
        (async () => {
            const task = await TestTask.create(cassCade, {
                title: "“Explain this number” inline notes for primary metrics",
                collections: [sprintCollection, profitByAcreDashboardCollection],
                priority: "Medium",
                assignee: cassCade,
                dueDate: today.subtract({days: 1}),
            });

            await task.updateAssigneeStatus(mattRHorn, "Active");

            await runAllPromises(
                createArrayWithLength(3, async index => {
                    const subtask = await TestTask.create(cassCade, {
                        title: `Subtask ${index + 1}`,
                        parent: task,
                    });

                    if (index + 1 <= 2) {
                        await subtask.updateStatus(cassCade, "Closed");
                    }
                }),
            );
        })(),
        (async () => {
            const task = await TestTask.create(mattRHorn, {
                title: "Ledger table filters: field, practice, channel",
                collections: [sprintCollection, profitByAcreDashboardCollection],
                priority: "Medium",
                assignee: mattRHorn,
            });

            await task.updateAssigneeStatus(mattRHorn, "Active");
        })(),
        (async () => {
            const task = await TestTask.create(elleKappaTan, {
                title: "Performance optimizations, goal is to aggregate 1M transactions in <300ms",
                collections: [sprintCollection, profitByAcreDashboardCollection],
                priority: "Medium",
                assignee: elleKappaTan,
            });

            await task.updateStatus(elleKappaTan, "Closed");
        })(),
        (async () => {
            const task = await TestTask.create(masonClay, {
                title: "Voice natural language processing (e.g. “allocate 73 gal to harvest”)",
                collections: [sprintCollection, receiptMobileScannerCollection, aiCollection],
                priority: "Low",
                assignee: masonClay,
            });

            await runAllPromises(
                createArrayWithLength(5, index =>
                    TestTask.create(masonClay, {
                        title: `Subtask ${index + 1}`,
                        parent: task,
                    }),
                ),
            );
        })(),
        (async () => {
            await TestTask.create(mattRHorn, {
                title: "Accessibility pass (WCAG AA) for grants navigator",
                collections: [sprintCollection, grantsNavigatorCollection],
                priority: "Low",
                assignee: mattRHorn,
            });
        })(),
        (async () => {
            await TestTask.create(cassCade, {
                title: "Empty state copy + error copy",
                collections: [sprintCollection, documentationCollection, grantsNavigatorCollection],
                priority: "Low",
                assignee: cassCade,
            });
        })(),
        (async () => {
            await TestTask.create(mattRHorn, {
                title: "Trendlines and YoY deltas on dashboard cards",
                collections: [sprintCollection, profitByAcreDashboardCollection],
                priority: "Low",
                assignee: mattRHorn,
            });
        })(),
        (async () => {
            const task = await TestTask.create(cassCade, {
                title: "Map 5 pilot programs into schema (EQIP 382, CSP, REAP, state soil health, utility rebate)",
                collections: [sprintCollection, grantsNavigatorCollection, documentationCollection],
                priority: "Low",
                assignee: cassCade,
            });

            await runAllPromises(
                createArrayWithLength(5, index =>
                    TestTask.create(cassCade, {
                        title: `Subtask ${index + 1}`,
                        parent: task,
                    }),
                ),
            );
        })(),
    ]);

    return {
        sprintCollection,
        lastSprintCollection,
        grantsNavigatorCollection,
        receiptMobileScannerCollection,
        aiCollection,
        integrationsCollection,
        recruitingCollection,
        interviewTask,
        coldEmailCampaignTask,
    };
}

async function createLaunchVideoFeed(originalAccounts: FictionalAmbrookAccounts) {
    const originalContext = originalAccounts.cassCade.context;

    const promiseWaiter = new PromiseWaiter();

    // Allow waiting for all `waitUntil()` promises spawned by just this function
    // by calling `promiseWaiter.wait()`.
    const context: TestContext = originalContext.cloneWithHelpers({
        process: new ProcessContextModule({
            waitUntil: promise => {
                promiseWaiter.waitUntil(promise);
                originalContext.process.waitUntil(promise);
            },
        }),
    });

    const accounts = mapObjectValues(originalAccounts, account =>
        account.withContext(context),
    ) as FictionalAmbrookAccounts;

    return actuallyCreateLaunchVideoFeed(promiseWaiter, accounts);
}

async function actuallyCreateLaunchVideoFeed(
    promiseWaiter: PromiseWaiter,
    {
        roseCompas,
        cassCade,
        elleKappaTan,
        masonClay,
        mattRHorn,
        hollyEvergreen,
        cliffWeathers,
        chatGpt,
    }: FictionalAmbrookAccounts,
) {
    const {space} = roseCompas;

    const timeZone = getCurrentTimeZone();
    const currentDate = today(timeZone);
    const baseTime = new CalendarDateTime(currentDate.year, 5, 22, 9);

    const fundraisingChannel = await TestChannel.create(roseCompas, {
        name: "Fundraising",
        access: "Private",
    });

    await fundraisingChannel.access.grant(roseCompas, cassCade);

    const engineeringChannel = await TestChannel.create(elleKappaTan, {
        name: "Engineering",
        access: "Public",
    });

    const designChannel = await TestChannel.create(mattRHorn, {
        name: "Design",
        access: "Public",
    });

    const announcementsChannel = await TestChannel.create(roseCompas, {
        name: "Announcements",
        access: "Public",
    });

    const marketingChannel = await TestChannel.create(cassCade, {
        name: "Marketing",
        access: "Public",
    });

    await promiseWaiter.wait();

    await engineeringChannel.createPost(
        elleKappaTan,
        markdown`
### Incident Retrospective: Upload Backlog

-   **What happened:** Between 02:10-03:05 UTC on May 20, 2026, image uploads queued but didn’t
    process due to a misconfigured worker autoscaler.

-   **Impact:** 7.2% of uploads were delayed up to 55 minutes; no data loss.

-   **Root cause:** Autoscaler min replicas set to 0 after a staging → prod copy.

-   **Fix:** Hot-patched min replicas to 3 and drained the backlog.

Follow-ups:

1. Add Terraform policy check to prevent min=0 on prod pools.
2. Alert on queue age > 5 minutes.
3. Blue/green config promotion with checksum gating.
4. Post-deploy smoke test that enqueues a canary image.

Thanks to Mason and Cass for rapid triage.
        `,
        {
            overrideCreatedTime: baseTime
                .subtract({days: 1})
                .add({hours: 2, minutes: 0})
                .toDate(timeZone),
        },
    );

    // Wait for post feed candidate entry to be added.
    await promiseWaiter.wait();

    await marketingChannel.createPost(
        cliffWeathers,
        markdown`
Some common questions and answers I’m seeing come up in customer calls about our the new receipt
scanner mobile app feature:

**Q: Can I save receipts without signal?**\\\n A: Yes. The mobile app stores images locally and
syncs later.

**Q: How do I know it synced?**\\\n A: Look for the small cloud icon. Grey = pending; blue = synced.

**Q: My receipt is upside down, how do I fix it?**\\\n A: If a receipt looks crooked, tap “Retake”
to auto-straighten.
        `,
        {
            overrideCreatedTime: baseTime
                .subtract({days: 1})
                .add({hours: 5, minutes: 36})
                .toDate(timeZone),
        },
    );

    // Wait for post feed candidate entry to be added.
    await promiseWaiter.wait();

    const brainstormDocument = await TestDocument.create(mattRHorn, {
        access: "Public",

        cover: {
            type: "Blobs",
            themeColor: "green",
            hueSpread: 10,
            seed: "487f856c-25b5-463a-aa4b-8b558958fe18",
        },

        title: "Receipt Mobile Scanner Brainstorm",

        /* eslint-disable string-quotes */
        body: markdown`
Our customers run their entire businesses on receipts. We want to antiquate the box of receipts they
drive to their accountant each year and instead allow them to ingest receipts immediately in the
field when they receive them. Comment on ideas you like!

| Idea<span hidden data-column-widths="3,1,1"/>                                      | Impact                                       | Effort                                   |
| ---------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------- |
| Quick snap with automatic crop and straighten                                      | <mark class="highlight-red">High</mark>      | <mark class="highlight-green">LG</mark>  |
| Real-time text recognition highlights total and date while framing                 | <mark class="highlight-red">High</mark>      | <mark class="highlight-purple">XL</mark> |
| Offline-first capture queue with clear status and auto-retry                       | <mark class="highlight-red">High</mark>      | <mark class="highlight-purple">XL</mark> |
| Background sync continues when the app is in your pocket                           | <mark class="highlight-red">High</mark>      | <mark class="highlight-green">LG</mark>  |
| Photo coach warns for blur, glare, or low light                                    | <mark class="highlight-orange">Medium</mark> | <mark class="highlight-green">LG</mark>  |
| Low-light “night mode” pre-processing for barn/garage lighting                     | <mark class="highlight-orange">Medium</mark> | <mark class="highlight-green">LG</mark>  |
| Batch mode: capture several receipts in one session                                | <mark class="highlight-orange">Medium</mark> | <mark class="highlight-purple">XL</mark> |
| Detect possible duplicates and suggest merge                                       | <mark class="highlight-orange">Medium</mark> | <mark class="highlight-green">LG</mark>  |
| Suggest vendor from text and location; learn aliases over time                     | <mark class="highlight-red">High</mark>      | <mark class="highlight-green">LG</mark>  |
| Smart tag suggestions (enterprise, field, project) from history and GPS            | <mark class="highlight-red">High</mark>      | <mark class="highlight-purple">XL</mark> |
| Auto-categorize line items to tags; improve from user edits                        | <mark class="highlight-red">High</mark>      | <mark class="highlight-purple">XL</mark> |
| Flag suspicious totals (missing currency symbol, extra zeros) and suggest a retake | <mark class="highlight-orange">Medium</mark> | <mark class="highlight-green">LG</mark>  |
| Share extension: “Add to Headwater” from camera roll                               | <mark class="highlight-red">High</mark>      | <mark class="highlight-green">LG</mark>  |
| Email ingest: forward receipts to a workspace address                              | <mark class="highlight-red">High</mark>      | <mark class="highlight-green">LG</mark>  |
| Text a photo to a workspace number; auto-attach to the right account               | <mark class="highlight-orange">Medium</mark> | <mark class="highlight-purple">XL</mark> |
| Voice note attachment with transcription for context (“fuel for hay harvest”)      | <mark class="highlight-blue">Low</mark>      | <mark class="highlight-green">LG</mark>  |
| Review queue for low-confidence extractions so support can fix quickly             | <mark class="highlight-orange">Medium</mark> | <mark class="highlight-green">LG</mark>  |
| Sync status panel with errors and tap-to-retry                                     | <mark class="highlight-orange">Medium</mark> | <mark class="highlight-blue">SM</mark>   |
| Accessibility: larger capture button and high-contrast UI                          | <mark class="highlight-blue">Low</mark>      | <mark class="highlight-blue">SM</mark>   |
| Privacy blur for card numbers and home addresses                                   | <mark class="highlight-orange">Medium</mark> | <mark class="highlight-green">LG</mark>  |
| Audit trail: who captured, when, and where                                         | <mark class="highlight-orange">Medium</mark> | <mark class="highlight-green">LG</mark>  |
| Reprocess older images when text-recognition models improve                        | <mark class="highlight-orange">Medium</mark> | <mark class="highlight-green">LG</mark>  |
| Monthly export: zipped images plus CSV for your accountant                         | <mark class="highlight-orange">Medium</mark> | <mark class="highlight-green">LG</mark>  |
| “First-run” guided capture that teaches framing in three screens                   | <mark class="highlight-blue">Low</mark>      | <mark class="highlight-blue">SM</mark>   |
        `,
        /* eslint-enable string-quotes */
    });

    {
        // Narration: “Yesterday’s brainstorm needs to become a plan. Now”
        const brainstormPost = await designChannel.createPost(
            mattRHorn,
            assertPostContent(
                (() => {
                    const schema = PostContentProsemirrorSchema;

                    return schema.node("doc", {}, [
                        schema.node("paragraph", {}, [
                            schema.text(
                                "Great brainstorm yesterday guys! Here’s the doc again. We’ve got so many great comments (50+!) y’all have a lot of feedback.",
                            ),
                        ]),
                        schema.node("paragraph", {}, [
                            schema.text(
                                "Given we’re pivoting to work on this in Q2 how should we divide up the work ",
                            ),
                            schema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: roseCompas.account.id,
                                    isShort: true,
                                }),
                            }),
                            schema.text("?"),
                        ]),

                        // TODO(calebmer): We don't have a Markdown representation for files yet.
                        // Otherwise I'd use Markdown for this content and attach the file somehow.
                        schema.node("fileRow", {}, [
                            schema.node("file", {fileId: `Document:${brainstormDocument.id}`}),
                        ]),
                    ]);
                })(),
            ),
            {
                overrideCreatedTime: baseTime
                    .subtract({days: 1})
                    .add({hours: 6, minutes: 32})
                    .toDate(timeZone),
            },
        );

        await brainstormPost.setReaction(masonClay, "Celebrate");
        await brainstormPost.setReaction(mattRHorn, "Happy");

        // Add a fixed ChatGPT recording that'll be replayed whenever invoking ChatGPT
        // on this post.
        {
            const recording: Array<MockAgentRecordingAction> = [];

            recording.push({
                type: "Wait",
                milliseconds: 200,
            });

            recording.push({
                type: "PutPart",
                index: 0,
                payload: {
                    type: "ToolCall",
                    call: {
                        type: "Read",
                        target: {path: `/documents/${brainstormDocument.id}`},
                        // TODO(calebmer): This gets removed in the next PR.
                        title: "",
                    },
                },
            });

            const chunkArray = <Value>(array: Array<Value>, n: number): Array<Array<Value>> => {
                const chunks: Array<Array<Value>> = [];

                for (let i = 0; i < array.length; i += n) {
                    chunks.push(array.slice(i, i + n));
                }

                return chunks;
            };

            {
                const part1Text =
                    "Can do! Summarizing the comments and creating follow‑up tasks now.";

                const part1Tokens = chunkArray(encodeO200kBaseTokens(part1Text), 4).map(tokens =>
                    decodeO200kBaseTokens(tokens),
                );

                let incrementalPart1Text = "";

                let hadFirstToken = false;

                for (const part1Token of part1Tokens) {
                    const isFirstToken = !hadFirstToken;
                    hadFirstToken = true;

                    incrementalPart1Text += part1Token;

                    if (isFirstToken) {
                        recording.push({
                            type: "Wait",
                            milliseconds: 500,
                        });
                    }

                    recording.push({
                        type: "PutPart",
                        index: 1,
                        payload: {
                            type: "Content",
                            content: parseApiContentFromMarkdown(incrementalPart1Text, {
                                spaceId: space.id,
                            }),
                        },
                    });
                }
            }

            {
                const part2Text =
                    "Highlights from the comments: The group aligned on an MVP centered on offline‑first capture, real‑time OCR highlighting of totals/dates, and a simple share extension. Commenters emphasized guardrails—duplicate detection, privacy blurring, and a lightweight review queue—plus quick wins on sync status and accessibility.";

                const part2Tokens = chunkArray(encodeO200kBaseTokens(part2Text), 4).map(tokens =>
                    decodeO200kBaseTokens(tokens),
                );

                let incrementalPart2Text = "";

                for (const part2Token of part2Tokens) {
                    incrementalPart2Text += part2Token;

                    recording.push({
                        type: "PutPart",
                        index: 2,
                        payload: {
                            type: "Content",
                            content: parseApiContentFromMarkdown(incrementalPart2Text, {
                                spaceId: space.id,
                            }),
                        },
                    });
                }
            }

            const [followupTask1, followupTask2, followupTask3, followupTask4, followupTask5] =
                await runAllPromises([
                    TestTask.create(roseCompas, {title: "Receipt mobile scanner offline capture"}),
                    TestTask.create(roseCompas, {
                        title: "Vendor alias learning using text + location signals",
                    }),
                    TestTask.create(roseCompas, {
                        title: "Duplicate detection and merge flow with privacy blur rules",
                    }),
                    TestTask.create(roseCompas, {
                        title: "Support review queue and remediation SLA for low‑confidence OCR",
                    }),
                    TestTask.create(roseCompas, {
                        title: "Sync status panel and capture UI accessibility improvements",
                    }),
                ]);

            recording.push({
                type: "PutPart",
                index: 3,
                payload: {
                    type: "Content",
                    content: parseApiContentFromMarkdown(
                        `- [](https://alpine.inc/s/${space.id}/tasks/${followupTask1.id}?mention)`,
                        {spaceId: space.id},
                    ),
                },
            });

            recording.push({
                type: "Wait",
                milliseconds: 20,
            });

            recording.push({
                type: "PutPart",
                index: 4,
                payload: {
                    type: "Content",
                    content: parseApiContentFromMarkdown(
                        `- [](https://alpine.inc/s/${space.id}/tasks/${followupTask2.id}?mention)`,
                        {spaceId: space.id},
                    ),
                },
            });

            recording.push({
                type: "Wait",
                milliseconds: 20,
            });

            recording.push({
                type: "PutPart",
                index: 5,
                payload: {
                    type: "Content",
                    content: parseApiContentFromMarkdown(
                        `- [](https://alpine.inc/s/${space.id}/tasks/${followupTask3.id}?mention)`,
                        {spaceId: space.id},
                    ),
                },
            });

            recording.push({
                type: "Wait",
                milliseconds: 20,
            });

            recording.push({
                type: "PutPart",
                index: 6,
                payload: {
                    type: "Content",
                    content: parseApiContentFromMarkdown(
                        `- [](https://alpine.inc/s/${space.id}/tasks/${followupTask4.id}?mention)`,
                        {spaceId: space.id},
                    ),
                },
            });

            recording.push({
                type: "Wait",
                milliseconds: 20,
            });

            recording.push({
                type: "PutPart",
                index: 7,
                payload: {
                    type: "Content",
                    content: parseApiContentFromMarkdown(
                        `- [](https://alpine.inc/s/${space.id}/tasks/${followupTask5.id}?mention)`,
                        {spaceId: space.id},
                    ),
                },
            });

            await setMockAgentRecording(chatGpt, `/posts/${brainstormPost.id}`, recording);
        }
    }

    // Wait for post feed candidate entry to be added.
    await promiseWaiter.wait();

    await announcementsChannel.createPost(
        elleKappaTan,
        markdown`
We wrapped the final QA pass on Receipt Scanner v2 today and the build is staging clean; pending one
last round of field tests on low-signal routes, we plan to flip the feature flag for 25% of accounts
on June 3 and ramp to 100% by midweek, so please watch for odd crops, slower-than-usual syncs, or
vendor misreads and drop repro steps in release-watch so the team can chase fixes quickly.
        `,
        {
            overrideCreatedTime: baseTime
                .subtract({days: 1})
                .add({hours: 7, minutes: 3})
                .toDate(timeZone),
        },
    );

    // Wait for post feed candidate entry to be added.
    await promiseWaiter.wait();

    await marketingChannel.createPost(
        mattRHorn,
        markdown`
Quick creative pitch for our new profit by acre dashboards.

The objective is to drive awareness of our new dashboards and generate 50 qualified trials by
May 31. Our audience is row-crop producers. Specifically operations with 500-5k acres.

Key messages:

-   “Know your margins per acre and per head”
-   “Drill from dashboard to ledger in one click”

Deliverables:

1. 2x 30-sec product videos (square + 16:9)
2. 3 customer quotes for social cutdowns
3. Landing page hero + 3 feature modules
4. Email sequence (welcome, proof, offer)

Tone and style:

-   Plainspoken, confident, a bit gritty. Avoid buzzwords.

CTA:

-   Start a 14-day trial. No credit card required.
        `,
        {
            overrideCreatedTime: baseTime
                .subtract({days: 1})
                .add({hours: 7, minutes: 42})
                .toDate(timeZone),
        },
    );

    // Wait for channel feed candidate entry to be added.
    await promiseWaiter.wait();

    {
        // Narration: “The app’s down. Your team is stuck”
        const downtimePost = await engineeringChannel.createPost(
            masonClay,
            markdown`
# 🚨 Downtime

We’re seeing 500s for ~70% of all requests to \`AppService\`! A rollback didn’t work. I’m searching
through commits to try and find what changed that could cause this but I’m going to need some help
investigating.

The stack trace:

~~~
InternalError: Assertion failure
    at server/search/data/table/search_entity_actions.ts:2211:13
    at arrayFromAsyncIterable (shared/helpers/iterable/array_from_async_iterable.ts:12:40)
    at async searchByAffinity (server/search/data/index/search_entity_index.ts:2720:52)
    at async loader (app/routes/s.$spaceId._index.tsx:62:36)
    at async callLoaderOrAction (node_modules/@remix-run/router/dist/router.cjs.js:4521:16)
    at async loadRouteData (node_modules/@remix-run/router/dist/router.cjs.js:3904:19)
~~~
            `,
            {
                overrideCreatedTime: baseTime
                    .subtract({hours: 1})
                    .add({minutes: 43})
                    .toDate(timeZone),
            },
        );

        await downtimePost.setReaction(elleKappaTan, "Shock");
        await downtimePost.setReaction(hollyEvergreen, "DeadInside");
        await downtimePost.setReaction(cassCade, "Lolsob");

        const downtimeComment = await downtimePost.createComment(
            elleKappaTan,
            markdown`
wow what a terrible error message. we should add a recommendation to the style guide to add messages
for assertions

i’ll try to reproduce locally…
            `,
            {
                overrideCreatedTime: baseTime
                    .subtract({hours: 1})
                    .add({minutes: 47})
                    .toDate(timeZone),
            },
        );

        await downtimeComment.setReaction(masonClay, "Yes");
    }

    // Wait for post feed candidate entry to be added.
    await promiseWaiter.wait();

    await engineeringChannel.createPost(
        cassCade,
        markdown`
Below are the first five pilot programs we’re mapping, plus owners and key dates.

| Program                               | Launch Tier | Owner                                                                                      | Key Deadline |
| ------------------------------------- | ----------- | ------------------------------------------------------------------------------------------ | ------------ |
| EQIP 382 (Fence)                      | Pilot       | [Cass](https://alpine.inc/s/${space.id}/accounts/${cassCade.account.id}?mention=short)     | June 12      |
| CSP (Conservation Stewardship)        | Pilot       | [Elle](https://alpine.inc/s/${space.id}/accounts/${elleKappaTan.account.id}?mention=short) | June 20      |
| REAP (Energy)                         | Beta        | [Mason](https://alpine.inc/s/${space.id}/accounts/${masonClay.account.id}?mention=short)   | June 26      |
| CA State Soil Health Grant            | Pilot       | [Cass](https://alpine.inc/s/${space.id}/accounts/${cassCade.account.id}?mention=short)     | June 22      |
| Utility Energy Rebate (Midwest Co-op) | Beta        | [Matt](https://alpine.inc/s/${space.id}/accounts/${mattRHorn.account.id}?mention=short)    | June 29      |

Feedback needed

-   Should we default the checklist to “producer view” or “advisor view” first?
-   Any missing fields for operation type or acreage bands?
        `,
        {
            overrideCreatedTime: baseTime.subtract({minutes: 15}).toDate(timeZone),
        },
    );

    // Wait for post feed candidate entry to be added.
    await promiseWaiter.wait();

    await announcementsChannel.createPost(
        hollyEvergreen,
        markdown`
KPI snapshot: May 12-19

-   WAU: 2,940 (+8% w/w)
-   Avg time to log receipt: 2m 14s (goal: < 2m)
-   Grant applications started: 61; submitted: 19
-   Dashboard drill-through rate: 34% (+5pp)

What’s next

-   Trim first-run tooltips by 30% to reduce bounce.
-   Enable “unknown vendor” queue review for CS team.

Small win: a producer in Nebraska cut weekly sorting time from 90 to 25 minutes after adopting tags.
Nice work, team!
        `,
        {
            overrideCreatedTime: baseTime.subtract({minutes: 9}).toDate(timeZone),
        },
    );

    // Wait for post feed candidate entry to be added.
    await promiseWaiter.wait();

    // Narration: “Investor pitch in five minutes. You’re not ready”
    //
    // Stage directions: Protagonist should react with the "oh no" tree when
    // reading this.
    await fundraisingChannel.createPost(
        cassCade,
        markdown`
Remember we’re meeting with Audacious Ventures in _five minutes_. Make sure you’re ready
[Rose](https://alpine.inc/s/${space.id}/accounts/${roseCompas.account.id}?mention=short). This is the
big one! You got this!
        `,
        {
            overrideCreatedTime: baseTime.subtract({minutes: 6}).toDate(timeZone),
        },
    );

    return {
        engineeringChannel,
        fundraisingChannel,
        brainstormDocument,
    };
}

async function setMockAgentRecording(
    chatGpt: TestBotAccount,
    roomPath: ApiMessageRoomPath,
    recording: MockAgentRecording,
) {
    const botItem = await chatGpt.bot.getItem();

    const url = new URL("/mock/recording", assertExists(botItem.webhookUrl));

    url.searchParams.set("accountId", chatGpt.id);
    url.searchParams.set("roomPath", roomPath);

    await fetchWithTracer(
        chatGpt.context.tracer.getTracer(),
        url,
        {
            serviceName: "AgentService",
            route: "/mock/recording",
            method: "PUT",
            headers: {"content-type": "application/json"},
            body: JSON.stringify(recording),
        },
        async request => {
            if (!request.ok) {
                throw new UnknownError(
                    `Failed to put mock agent recording with status code ${request.status}`,
                );
            }
        },
    );
}

async function createLaunchVideoDocuments({
    roseCompas,
    cassCade,
    masonClay,
    elleKappaTan,
    mattRHorn,
    cliffWeathers,
    hollyEvergreen,
}: FictionalAmbrookAccounts) {
    const {space} = roseCompas;

    const [
        pitchDeckDocument,
        debuggingNotesDocument,
        investorMeetingNotesDocument,
        beliefStrengthSystemDocument,
        companyValuesDocument,
    ] = await runAllPromiseThunks(
        async () => {
            const document = await TestDocument.create(roseCompas, {
                access: "Public",

                hasPresentShortcut: true,
                cover: {
                    type: "Blobs",
                    seed: "a3933f46-1c36-473d-8965-8b1332639fd9",
                    themeColor: "blue",
                    hueSpread: 80,
                },

                title: "Pitch Deck (Series A)",
                body: markdown`
Agriculture is a $2T market in the US alone. We’ve demonstrated our accounting software works for
small family business farms. We’re raising a series A to accelerate our move up market.

---

# By the numbers

-   100+ family farms switched their ledger to our platform
-   $1M ARR, as of Q4 2025
-   500% NDR as we expand into other lines of business for our customers

---

# Our team

- [Rose Compás](https://alpine.inc/s/${space.id}/accounts/${roseCompas.account.id}?mention) (founder/CEO)
- [Cass Cade](https://alpine.inc/s/${space.id}/accounts/${cassCade.account.id}?mention) (Chief of Staff)
- [Mason Clay](https://alpine.inc/s/${space.id}/accounts/${masonClay.account.id}?mention) (Founding Engineer)
- [Elle Kappa-Tan](https://alpine.inc/s/${space.id}/accounts/${elleKappaTan.account.id}?mention) (Founding Engineer)
- [Matt R. Horn](https://alpine.inc/s/${space.id}/accounts/${mattRHorn.account.id}?mention) (Founding Designer)
- [Cliff Weathers](https://alpine.inc/s/${space.id}/accounts/${cliffWeathers.account.id}?mention) (Sales)
- [Holly Evergreen](https://alpine.inc/s/${space.id}/accounts/${hollyEvergreen.account.id}?mention) (HR)
        `,
            });

            await document.access.grantUrl(roseCompas);

            return document;
        },
        async () => {
            const document = await TestDocument.create(roseCompas, {
                title: "[2024-01-17] Assertion failure debugging notes",
            });

            return document;
        },
        async () => {
            const document = await TestDocument.create(roseCompas, {
                title: "Bella Weathers investor meeting notes",
            });

            return document;
        },
        async () => {
            const document = await TestDocument.create(roseCompas, {
                title: "Belief Strength System",
            });

            return document;
        },
        async () => {
            const document = await TestDocument.create(roseCompas, {
                title: "Company Values",
            });

            return document;
        },
    );

    return {
        pitchDeckDocument,
        debuggingNotesDocument,
        investorMeetingNotesDocument,
        beliefStrengthSystemDocument,
        companyValuesDocument,
    };
}

// Template string tag that tells Prettier to format the string as Markdown.
function markdown(template: TemplateStringsArray, ...substitutions: Array<string>) {
    let string = template[0] ?? "";

    for (let i = 1; i < template.length; i++) {
        string += substitutions[i - 1] ?? "";
        string += template[i]!;
    }

    return string;
}
