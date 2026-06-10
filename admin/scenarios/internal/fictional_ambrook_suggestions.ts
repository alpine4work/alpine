import {DemoSpaceAccounts} from "~/admin/environment/demo_space/create_demo_space.js";
import {createDebug} from "~/admin/helpers/create_debug.js";
import {FictionalAmbrookSprintTasks} from "~/admin/scenarios/internal/fictional_ambrook_sprint_tasks.js";
import {TestBotAccount} from "~/server/bots/test_helpers/test_bot.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {
    addSearchAffinityEntityPointsForTest,
    favoriteSearchEntity,
} from "~/server/search/data/table/search_entity_actions.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";

const debug = createDebug(import.meta.url);

export async function createFictionalAmbrookSuggestions(
    {
        cassCade,
        roseCompas,
        chatGpt,
        mattRHorn,
        cliffWeathers,
        elleKappaTan,
        masonClay,
        hollyEvergreen,
    }: DemoSpaceAccounts & {
        chatGpt: TestBotAccount;
    },
    {
        sprintCollection,
        lastSprintCollection,
        aiCollection,
        integrationsCollection,
        recruitingCollection,
        receiptMobileScannerCollection,
        grantsNavigatorCollection,
        coldEmailCampaignTask,
        interviewTask,
    }: FictionalAmbrookSprintTasks,
) {
    debug("Creating suggestions");

    const {space} = cassCade;

    const spaceId = space.id;
    const accountId = cassCade.account.id;

    await runAllPromises([
        favoriteSearchEntity(cassCade.action(), {
            spaceId,
            entityId: `Account:${roseCompas.account.id}`,
        }),
        TestDocument.create(cassCade, {
            title: "Pitch Deck (Series A)",
        }).then(async pitchDeckDocument => {
            await runAllPromises([
                addSearchAffinityEntityPointsForTest(cassCade.action(), {
                    spaceId,
                    accountId,
                    entityId: `Document:${pitchDeckDocument.id}`,
                    points: 999_000_000,
                }),
                favoriteSearchEntity(cassCade.action(), {
                    spaceId,
                    entityId: `Document:${pitchDeckDocument.id}`,
                }),
            ]);
        }),
        addSearchAffinityEntityPointsForTest(cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Task:${interviewTask.id}`,
            points: 998_000_000,
        }),
        addSearchAffinityEntityPointsForTest(cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Task:${coldEmailCampaignTask.id}`,
            points: 997_000_000,
        }),
        addSearchAffinityEntityPointsForTest(cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Account:${roseCompas.account.id}`,
            points: 996_000_000,
        }),
        TestChannel.create(cassCade, {name: "Fundraising", access: "Private"}).then(
            fundraisingChannel =>
                addSearchAffinityEntityPointsForTest(cassCade.action(), {
                    spaceId,
                    accountId,
                    entityId: `Channel:${fundraisingChannel.id}`,
                    points: 995_000_000,
                }),
        ),
        addSearchAffinityEntityPointsForTest(cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Account:${mattRHorn.account.id}`,
            points: 994_000_000,
        }),
        addSearchAffinityEntityPointsForTest(cassCade.action(), {
            spaceId,
            accountId,
            entityId: "TaskPersonal",
            points: 993_000_000,
        }),
        addSearchAffinityEntityPointsForTest(cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Account:${chatGpt.id}`,
            points: 992_000_000,
        }),
        TestChannel.create(cassCade, {name: "Engineering", access: "Public"}).then(
            engineeringChannel =>
                addSearchAffinityEntityPointsForTest(cassCade.action(), {
                    spaceId,
                    accountId,
                    entityId: `Channel:${engineeringChannel.id}`,
                    points: 991_000_000,
                }),
        ),
        addSearchAffinityEntityPointsForTest(cassCade.action(), {
            spaceId,
            accountId,
            entityId: `TaskCollection:${sprintCollection.id}`,
            points: 990_000_000,
        }),
        TestChat.get(cassCade, elleKappaTan, masonClay)
            .then(async engineeringChat => {
                await engineeringChat.sendMessage(cassCade, "Hello, world!");
                return engineeringChat;
            })
            .then(engineeringChat =>
                addSearchAffinityEntityPointsForTest(cassCade.action(), {
                    spaceId,
                    accountId,
                    entityId: `Chat:${engineeringChat.id}`,
                    points: 989_000_000,
                }),
            ),
        addSearchAffinityEntityPointsForTest(cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Account:${cliffWeathers.account.id}`,
            points: 988_000_000,
        }),
        TestDocument.create(cassCade, {title: "Receipt Mobile Scanner Brainstorm"}).then(
            brainstormDocument =>
                addSearchAffinityEntityPointsForTest(cassCade.action(), {
                    spaceId,
                    accountId,
                    entityId: `Document:${brainstormDocument.id}`,
                    points: 987_000_000,
                }),
        ),
        addSearchAffinityEntityPointsForTest(cassCade.action(), {
            spaceId,
            accountId,
            entityId: `TaskCollection:${aiCollection.id}`,
            points: 986_000_000,
        }),
        addSearchAffinityEntityPointsForTest(cassCade.action(), {
            spaceId,
            accountId,
            entityId: `TaskCollection:${recruitingCollection.id}`,
            points: 985_000_000,
        }),
        TestChat.get(cassCade, roseCompas, cliffWeathers, hollyEvergreen)
            .then(async hrChat => {
                await hrChat.sendMessage(cassCade, "Hello, world!");
                return hrChat;
            })
            .then(hrChat =>
                addSearchAffinityEntityPointsForTest(cassCade.action(), {
                    spaceId,
                    accountId,
                    entityId: `Chat:${hrChat.id}`,
                    points: 984_000_000,
                }),
            ),
        addSearchAffinityEntityPointsForTest(cassCade.action(), {
            spaceId,
            accountId,
            entityId: `TaskCollection:${lastSprintCollection.id}`,
            points: 983_000_000,
        }),
        TestDocument.create(cassCade, {
            title: "[2024-01-17] Assertion failure debugging notes",
        }).then(debuggingNotesDocument =>
            addSearchAffinityEntityPointsForTest(cassCade.action(), {
                spaceId,
                accountId,
                entityId: `Document:${debuggingNotesDocument.id}`,
                points: 982_000_000,
            }),
        ),
        addSearchAffinityEntityPointsForTest(cassCade.action(), {
            spaceId,
            accountId,
            entityId: `TaskCollection:${grantsNavigatorCollection.id}`,
            points: 981_000_000,
        }),
        TestDocument.create(cassCade, {
            title: "Bella Weathers investor meeting notes",
        }).then(investorMeetingNotesDocument =>
            addSearchAffinityEntityPointsForTest(cassCade.action(), {
                spaceId,
                accountId,
                entityId: `Document:${investorMeetingNotesDocument.id}`,
                points: 980_000_000,
            }),
        ),
        TestDocument.create(cassCade, {
            title: "Belief Strength System",
        }).then(beliefStrengthSystemDocument =>
            addSearchAffinityEntityPointsForTest(cassCade.action(), {
                spaceId,
                accountId,
                entityId: `Document:${beliefStrengthSystemDocument.id}`,
                points: 979_000_000,
            }),
        ),
        TestDocument.create(cassCade, {
            title: "Company Values",
        }).then(companyValuesDocument =>
            addSearchAffinityEntityPointsForTest(cassCade.action(), {
                spaceId,
                accountId,
                entityId: `Document:${companyValuesDocument.id}`,
                points: 978_000_000,
            }),
        ),
        addSearchAffinityEntityPointsForTest(cassCade.action(), {
            spaceId,
            accountId,
            entityId: `TaskCollection:${receiptMobileScannerCollection.id}`,
            points: 977_000_000,
        }),
        addSearchAffinityEntityPointsForTest(cassCade.action(), {
            spaceId,
            accountId,
            entityId: `TaskCollection:${integrationsCollection.id}`,
            points: 976_000_000,
        }),
    ]);

    debug("Created suggestions");
}
