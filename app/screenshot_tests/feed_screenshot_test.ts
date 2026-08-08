import {DemoSpaceAccounts} from "~/admin/environment/demo_space/create_demo_space.js";
import {TestActualContext} from "~/admin/environment/test/unit/with_unit_test_environment.js";
import {ScreenshotTestRunner} from "~/app/screenshot_tests/helpers/run_screenshot_test.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {
    addSearchAffinityEntityPointsForTest,
    favoriteSearchEntity,
} from "~/server/search/data/table/search_entity_actions.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {FeedEntry, FeedEntrySchema} from "~/shared/feed/feed_entry_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.open_source.js";
import {markdown} from "~/shared/helpers/string/markdown.js";
import {unsafelyGenerateStableId} from "~/shared/id/id.open_source.js";
import {ChatId, PostId, SiteId} from "~/shared/id/types/id_types.open_source.js";
import {Schema} from "~/shared/schema/schema.open_source.js";
import {SearchAffinityEntityId} from "~/shared/search/search_entity_id.js";

const screenshotTime = new Date("2025-10-14T17:30:00.000Z");

export async function run(context: TestActualContext, runner: ScreenshotTestRunner) {
    const {space, accounts} = await runner.createDemoSpace(context);

    const [craftChannel, marketingChannel] = await runAllPromises([
        TestChannel.create(accounts.mattRHorn, {
            name: "Craft",
            access: "Public",
        }),
        TestChannel.create(accounts.mattRHorn, {
            name: "Marketing",
            access: "Public",
        }),
    ]);

    const [feedEntries, suggestionEntities] = await runAllPromises([
        createFeedEntries(runner.stableRandom, accounts, craftChannel, marketingChannel),
        createSuggestionEntities(accounts, runner.stableRandom),
    ]);

    await createSearchAffinity(accounts.cassCade, accounts, suggestionEntities);

    await ProcessContextModule.waitForTestTasks();
    await runner.services.waitForSqsProcessJobs();

    const searchParams = new URLSearchParams();
    searchParams.set(
        "entries",
        JSON.stringify(Schema.array(FeedEntrySchema).serialize(feedEntries)),
    );

    await runner.goto(accounts.cassCade, `/dev/feed/${space.id}?${searchParams.toString()}`, {
        fixedTime: screenshotTime,
    });
    await runner.screenshot("a0", "basic");

    await runner.goto(accounts.cassCade, `/dev/feed/${space.id}?${searchParams.toString()}`, {
        fixedTime: screenshotTime,
        viewport: "wide",
    });
    await runner.screenshot("a1", "wide");
}

async function createFeedEntries(
    stableRandom: StableRandom,
    accounts: DemoSpaceAccounts,
    craftChannel: TestChannel,
    marketingChannel: TestChannel,
): Promise<Array<FeedEntry>> {
    const codeBlockPost = await craftChannel.createPost(
        accounts.masonClay,
        markdown`
While I was testing tables I kept playing with our code block UI and I want to revisit it. Right now
the copy button only shows up on hover. It\u2019s clean when you\u2019re reading but every time I
want to copy I have to remember the button is even there and aim my mouse at the right corner.

Two questions for the channel:

1. Should the copy button be always-visible?
2. If yes, where does it sit so it doesn\u2019t fight with the language label?

Proposal: copy button is always-visible in the top-right corner. Move the language label to
top-left. Copy is an action people use _a lot_ for shareable code snippets (which is basically every
doc in our engineering wiki).
        `,
        {
            // A stable `Id` here is important for `<ReactionParty>`'s `randomSeed` prop. This
            // makes sure the reaction party on any messages is stable across renders.
            id: unsafelyGenerateStableId<PostId>(stableRandom, "codeBlockPost"),
            overrideCreatedTime: new Date("2025-10-03T14:12:00.000Z"),
        },
    );

    await codeBlockPost.sendMessage(
        accounts.mattRHorn,
        markdown`
I\u2019ve been on the fence on this for a year. Hover-reveal is cleaner visually but the cost (as
you mention) is discoverability. Half the customers I\u2019ve talked to in research didn\u2019t
realize we _had_ a copy button.
        `,
        {overrideCreatedTime: new Date("2025-10-03T13:31:00.000Z")},
    );
    await codeBlockPost.sendMessage(
        accounts.elleKappaTan,
        markdown`
+1 always visible. also the hover thing is straight up broken on touch devices
        `,
        {overrideCreatedTime: new Date("2025-10-03T13:48:00.000Z")},
    );
    const shippedComment = await codeBlockPost.sendMessage(
        accounts.masonClay,
        markdown`
shipped. landed in production this morning
        `,
        {overrideCreatedTime: new Date("2025-10-04T16:30:00.000Z")},
    );

    await codeBlockPost.setReaction(accounts.mattRHorn, "Yes");
    await codeBlockPost.setReaction(accounts.elleKappaTan, "Yes");
    await codeBlockPost.setReaction(accounts.cassCade, "ThankYou");
    await codeBlockPost.setReaction(accounts.cliffWeathers, "Celebrate");

    await shippedComment.setReaction(accounts.mattRHorn, "Celebrate");
    await shippedComment.setReaction(accounts.elleKappaTan, "Celebrate");

    const document = await createQ3PlanningDocument(accounts);

    const filesPost = await marketingChannel.createPost(
        accounts.mattRHorn,
        markdown`
Was supposed to be reading a book this weekend and instead spent four hours in a rabbit hole on
small farm cottages in mountain environments. I think these are some good vibes we should
incorporate into our brand.
        `,
        {
            // A stable `Id` here is important for `<ReactionParty>`'s `randomSeed` prop. This
            // makes sure the reaction party on any messages is stable across renders.
            id: unsafelyGenerateStableId<PostId>(stableRandom, "filesPost"),
            overrideCreatedTime: new Date("2025-09-10T14:38:00.000Z"),
        },
    );

    return [
        {
            type: "Post",
            postId: codeBlockPost.id,
            channelId: craftChannel.id,
            authorId: accounts.masonClay.account.id,
            createdTime: codeBlockPost.createdTime,
        },
        {
            type: "Document",
            documentId: document.id,
            sharedTime: new Date("2025-10-06T15:15:00.000Z"),
            sharerId: accounts.cassCade.account.id,
            creator: {id: accounts.cassCade.account.id, from: null},
            event: "SharedWithAccessPolicyDefaultGrant",
        },
        {
            type: "Post",
            postId: filesPost.id,
            channelId: craftChannel.id,
            authorId: accounts.mattRHorn.account.id,
            createdTime: filesPost.createdTime,
        },
    ];
}

async function createQ3PlanningDocument(accounts: DemoSpaceAccounts) {
    const document = await TestDocument.create(accounts.cassCade, {
        title: "Q3 Planning",
        access: "Public",
        body: markdown`
Everything in here is WIP. I want input from each of you in your section by Friday. Rose and I will
finalize the week after.

A few notes coming in:

- The sync deploy incident at the end of August is the reason Elle\u2019s reliability work is P0
  this quarter. We don\u2019t want a repeat of that.
- Mason has tables far enough along that we can credibly commit to a ship date. We\u2019ve spent
  weeks on the design, and the remaining open questions are small.
- Holly\u2019s first case study just published and Cliff\u2019s pipeline is in the best shape
  it\u2019s been all year. We should keep that flywheel turning.
        `,
    });

    await document.updateContentPreview();

    return document;
}

async function createSuggestionEntities(accounts: DemoSpaceAccounts, stableRandom: StableRandom) {
    const collections = await createTaskCollections(accounts.cassCade);
    const {projectTask, featuredProjectTask} = await createTablesProject(accounts, collections);

    // Additional tasks that exercise the remaining `displayStatus` variants in the
    // sidebar. `featuredProjectTask` / `projectTask` cover `OpenActive`; these add
    // `OpenInactive` and `Closed`.
    const [backlogTask, postmortemTask] = await runAllPromises([
        TestTask.create(accounts.cassCade, {
            title: "Audit help-doc screenshots before launch",
        }),
        TestTask.create(accounts.cassCade, {
            title: "Postmortem for August sync outage",
            status: "Closed",
            assignee: accounts.elleKappaTan,
            assigneeStatus: "Active",
        }),
    ]);

    const [
        customerFeedbackDocument,
        q3PlanningDocument,
        designSpecDocument,
        editorInteractionAuditDocument,
        salesEnablementDocument,
        helpDocVisualReviewDocument,
        onboardingPlanDocument,
        ssoScopingDocument,
        tablesLaunchCoordinationDocument,
        engineeringChannel,
        marketingChannel,
        teamChat,
        releasesRoomChat,
        handbookSite,
    ] = await runAllPromises([
        TestDocument.create(accounts.cassCade, {
            title: "Customer Feedback from Sales",
            access: "Public",
        }),
        TestDocument.create(accounts.cassCade, {
            title: "Q3 Planning",
            access: "Public",
        }),
        TestDocument.create(accounts.cassCade, {
            title: "Design spec v1",
            access: "Public",
        }),
        TestDocument.create(accounts.cassCade, {
            title: "Editor interaction audit",
            access: "Public",
        }),
        TestDocument.create(accounts.cassCade, {
            title: "Sales enablement (one-pager + demo script)",
            access: "Public",
        }),
        TestDocument.create(accounts.cassCade, {
            title: "Help doc visual review",
            access: "Public",
        }),
        TestDocument.create(accounts.cassCade, {
            title: "Onboarding plan for new backend hire",
            access: "Public",
        }),
        TestDocument.create(accounts.cassCade, {
            title: "SSO scoping doc",
            access: "Public",
        }),
        TestDocument.create(accounts.cassCade, {
            title: "Tables launch coordination",
            access: "Public",
        }),
        TestChannel.create(accounts.cassCade, {name: "Engineering", access: "Public"}),
        TestChannel.create(accounts.cassCade, {name: "Marketing", access: "Public"}),
        TestChat.get(
            accounts.cassCade,
            accounts.hollyEvergreen,
            accounts.cliffWeathers,
            accounts.elleKappaTan,
        ).then(async teamChat => {
            await teamChat.sendMessage(accounts.cassCade, "Keeping launch notes here.");
            return teamChat;
        }),
        // RoomChat that only Cass has posted in. The search entity's media is `Account`
        // (single contributor) instead of `AccountPile` — different rendering path from
        // `teamChat`.
        (async () => {
            const releasesRoomChat = await TestChat.createRoom(accounts.cassCade, {
                id: unsafelyGenerateStableId<ChatId>(stableRandom, "releasesRoomChat"),
                name: "Releases",
                access: "Public",
            });
            await releasesRoomChat.sendMessage(
                accounts.cassCade,
                "Posting release notes here as we ship.",
            );
            return releasesRoomChat;
        })(),
        TestSite.create(accounts.cassCade, {
            id: unsafelyGenerateStableId<SiteId>(stableRandom, "handbookSite"),
            name: "Alpine Handbook",
            access: "Public",
        }),
    ]);

    const documents = {
        customerFeedback: customerFeedbackDocument,
        q3Planning: q3PlanningDocument,
        designSpec: designSpecDocument,
        editorInteractionAudit: editorInteractionAuditDocument,
        salesEnablement: salesEnablementDocument,
        helpDocVisualReview: helpDocVisualReviewDocument,
        onboardingPlan: onboardingPlanDocument,
        ssoScoping: ssoScopingDocument,
        tablesLaunchCoordination: tablesLaunchCoordinationDocument,
    };

    await runAllPromises(Object.values(documents).map(document => document.updateContentPreview()));

    return {
        collections,
        projectTask,
        featuredProjectTask,
        backlogTask,
        postmortemTask,
        documents,
        channels: {engineering: engineeringChannel, marketing: marketingChannel},
        teamChat,
        releasesRoomChat,
        handbookSite,
    };
}

async function createTaskCollections(session: TestSpaceSession) {
    return {
        sprintOct6: await TestTaskCollection.create(session, {
            name: "Sprint (Oct 6)",
            access: "Public",
            color: "green",
        }),
        tables: await TestTaskCollection.create(session, {
            name: "Tables",
            access: "Public",
            color: "blue",
        }),
        // No color set — sidebar renders the collection title without a color swatch.
        inbox: await TestTaskCollection.create(session, {
            name: "Inbox",
            access: "Public",
        }),
    };
}

async function createTablesProject(
    accounts: DemoSpaceAccounts,
    collections: Awaited<ReturnType<typeof createTaskCollections>>,
) {
    const projectTask = await TestTask.create(accounts.cassCade, {
        title: "Tables",
        assignee: accounts.masonClay,
        assigneeStatus: "Active",
        collections: collections.sprintOct6,
        layout: "Project",
        notes: markdown`
Tables in our rich text editor. Insert, edit, navigate, resize, paste in from a spreadsheet. The
bulk of the work is a custom cell selection model sitting on top of the document\u2019s existing
selection state.
        `,
        priority: "High",
    });

    await TestTask.create(accounts.cassCade, {
        title: "Column resizing: snap default, alt keydown for smooth",
        parent: projectTask,
        assignee: accounts.masonClay,
        assigneeStatus: "Active",
        collections: [collections.sprintOct6],
        notes: "Snap to a 12-column grid by default, hold Alt while dragging for continuous resize.",
        priority: "High",
    });

    const featuredProjectTask = await TestTask.create(accounts.cassCade, {
        title: "Keyboard navigation between cells",
        parent: projectTask,
        assignee: accounts.masonClay,
        assigneeStatus: "Active",
        collections: [collections.sprintOct6],
        priority: "High",
        notes: markdown`
The obvious arrow key navigation model breaks once cells can have multiple lines: should up/down in
a cell move within the paragraph or should it move between cells?
        `,
    });

    await TestTask.create(accounts.cassCade, {
        title: "Help doc visual review",
        parent: projectTask,
        assignee: accounts.mattRHorn,
        assigneeStatus: "Active",
        notes: "Holly\u2019s draft is in good shape. Make sure screenshots match the final UI and the snap-to-grid language stays practical.",
    });

    return {projectTask, featuredProjectTask};
}

async function createSearchAffinity(
    cassCade: TestSpaceSession,
    accounts: DemoSpaceAccounts,
    suggestionEntities: Awaited<ReturnType<typeof createSuggestionEntities>>,
) {
    const {space} = cassCade;
    const spaceId = space.id;
    const accountId = cassCade.account.id;

    await favoriteSearchEntity(cassCade.action(), {spaceId, entityId: "TaskPersonal"});

    const {documents, channels} = suggestionEntities;

    const rows: Array<{entityId: SearchAffinityEntityId; points: number}> = [
        {entityId: "TaskPersonal", points: 999_000_000},
        {entityId: `Account:${accounts.roseCompas.account.id}`, points: 998_000_000},
        {entityId: `Account:${accounts.elleKappaTan.account.id}`, points: 997_000_000},
        {entityId: `Account:${accounts.mattRHorn.account.id}`, points: 996_500_000},
        {entityId: `Task:${suggestionEntities.featuredProjectTask.id}`, points: 996_000_000},
        {entityId: `Task:${suggestionEntities.backlogTask.id}`, points: 995_750_000},
        {entityId: `Task:${suggestionEntities.postmortemTask.id}`, points: 995_500_000},
        {entityId: `Task:${suggestionEntities.projectTask.id}`, points: 995_000_000},
        {entityId: `Site:${suggestionEntities.handbookSite.id}`, points: 994_500_000},
        {entityId: `Document:${documents.customerFeedback.id}`, points: 994_000_000},
        {entityId: `Channel:${channels.engineering.id}`, points: 993_000_000},
        {entityId: `Document:${documents.q3Planning.id}`, points: 992_000_000},
        {entityId: `Chat:${suggestionEntities.teamChat.id}`, points: 991_000_000},
        {entityId: `Chat:${suggestionEntities.releasesRoomChat.id}`, points: 990_500_000},
        {entityId: `Document:${documents.designSpec.id}`, points: 990_000_000},
        {
            entityId: `TaskCollection:${suggestionEntities.collections.sprintOct6.id}`,
            points: 989_000_000,
        },
        {
            entityId: `TaskCollection:${suggestionEntities.collections.inbox.id}`,
            points: 988_500_000,
        },
        {entityId: `Document:${documents.editorInteractionAudit.id}`, points: 988_000_000},
        {entityId: `Channel:${channels.marketing.id}`, points: 987_000_000},
        {entityId: `Document:${documents.salesEnablement.id}`, points: 986_000_000},
        {
            entityId: `TaskCollection:${suggestionEntities.collections.tables.id}`,
            points: 985_000_000,
        },
        {entityId: `Document:${documents.helpDocVisualReview.id}`, points: 984_000_000},
        {entityId: `Document:${documents.ssoScoping.id}`, points: 983_000_000},
        {entityId: `Document:${documents.tablesLaunchCoordination.id}`, points: 982_000_000},
        {entityId: `Document:${documents.onboardingPlan.id}`, points: 981_000_000},
    ];

    await runAllPromises(
        rows.map(row =>
            addSearchAffinityEntityPointsForTest(cassCade.action(), {
                spaceId,
                accountId,
                entityId: row.entityId,
                points: row.points,
            }),
        ),
    );
}
