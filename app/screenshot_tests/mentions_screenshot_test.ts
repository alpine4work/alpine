import {Node} from "prosemirror-model";
import {DemoSpaceAccounts} from "~/admin/environment/demo_space/create_demo_space.js";
import {TestActualContext} from "~/admin/environment/test/unit/with_unit_test_environment.js";
import {ScreenshotTestRunner} from "~/app/screenshot_tests/helpers/run_screenshot_test.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {DocumentContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {cast} from "~/shared/helpers/control/cast.open_source.js";
import {markdown} from "~/shared/helpers/string/markdown.js";
import {unsafelyGenerateStableId} from "~/shared/id/id.open_source.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    DocumentId,
    PostId,
    SiteId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.open_source.js";
import {SearchMentionEntityId} from "~/shared/search/search_entity_id.js";

const schema = DocumentContentProsemirrorSchema;

const screenshotTime = new Date("2025-10-14T17:30:00.000Z");

export async function run(context: TestActualContext, runner: ScreenshotTestRunner) {
    const {space, accounts} = await runner.createDemoSpace(context);

    // `RoomChat` with only one sender (Cass) — exercises the `Chat.media: Account`
    // rendering path. Direct 1:1 chats are not indexed as `Chat` search entities so
    // they can't be used here (see `prepareSearchEntityDataForResult`).
    const singleSenderRoomChatPromise = (async () => {
        const roomChat = await TestChat.createRoom(accounts.cassCade, {
            id: unsafelyGenerateStableId<ChatId>(runner.stableRandom, "decisionLogRoomChat"),
            name: "Decision log",
            access: "Public",
        });
        await roomChat.sendMessage(accounts.cassCade, "Logging decisions here as they get made.");
        return roomChat;
    })();

    const [
        singleSenderRoomChat,
        groupChat,
        craftChannel,
        q3PlanningDocument,
        sprintCollection,
        inboxCollection,
        handbookSite,
    ] = await runAllPromises([
        singleSenderRoomChatPromise,
        // Group chat — `AccountPile` media (multiple contributors).
        TestChat.get(
            accounts.cassCade,
            accounts.elleKappaTan,
            accounts.masonClay,
            accounts.mattRHorn,
        ),
        TestChannel.create(accounts.mattRHorn, {name: "Craft", access: "Public"}),
        TestDocument.create(accounts.cassCade, {
            id: unsafelyGenerateStableId<DocumentId>(runner.stableRandom, "q3PlanningDocument"),
            title: "Q3 Planning",
            access: "Public",
        }),
        TestTaskCollection.create(accounts.cassCade, {
            name: "Sprint (Oct 6)",
            access: "Public",
            color: "green",
        }),
        TestTaskCollection.create(accounts.cassCade, {name: "Inbox", access: "Public"}),
        TestSite.create(accounts.cassCade, {
            id: unsafelyGenerateStableId<SiteId>(runner.stableRandom, "handbookSite"),
            name: "Alpine Handbook",
            access: "Public",
        }),
    ]);

    const [openInactiveTask, openActiveTask, closedTask, columnResizingPost] = await runAllPromises(
        [
            TestTask.create(accounts.cassCade, {
                title: "Audit help-doc screenshots before launch",
            }),
            TestTask.create(accounts.cassCade, {
                title: "Tables in the rich text editor",
                assignee: accounts.masonClay,
                assigneeStatus: "Active",
            }),
            TestTask.create(accounts.cassCade, {
                title: "Postmortem for August sync outage",
                status: "Closed",
            }),
            craftChannel.createPost(
                accounts.masonClay,
                markdown`
Shipped column resizing. Snap by default, hold Alt for smooth. Two weeks of debate well spent.
                `,
                {
                    id: unsafelyGenerateStableId<PostId>(runner.stableRandom, "columnResizingPost"),
                },
            ),
        ],
    );

    // IDs that don't correspond to any real entity — each exercises the ghost mention
    // path for its entity type.
    const missingIds = {
        account: unsafelyGenerateStableId<AccountId>(runner.stableRandom, "missingAccount"),
        document: unsafelyGenerateStableId<DocumentId>(runner.stableRandom, "missingDocument"),
        channel: unsafelyGenerateStableId<ChannelId>(runner.stableRandom, "missingChannel"),
        chat: unsafelyGenerateStableId<ChatId>(runner.stableRandom, "missingChat"),
        task: unsafelyGenerateStableId<TaskId>(runner.stableRandom, "missingTask"),
        taskCollection: unsafelyGenerateStableId<TaskCollectionId>(
            runner.stableRandom,
            "missingTaskCollection",
        ),
        post: unsafelyGenerateStableId<PostId>(runner.stableRandom, "missingPost"),
        site: unsafelyGenerateStableId<SiteId>(runner.stableRandom, "missingSite"),
    };

    // Wait for search-entity indexing jobs so mention rendering can resolve every
    // entity's title and media.
    await ProcessContextModule.waitForTestTasks();
    await runner.services.waitForSqsProcessJobs();

    const tasksAndCollectionsDocument = await TestDocument.create(accounts.cassCade, {
        id: unsafelyGenerateStableId<DocumentId>(
            runner.stableRandom,
            "tasksAndCollectionsDocument",
        ),
        content: [
            title("Tasks and task collections"),
            heading("Tasks"),
            bullet("Open + no active assignee: ", mention(`Task:${openInactiveTask.id}`)),
            bullet("Open + active assignee: ", mention(`Task:${openActiveTask.id}`)),
            bullet("Closed: ", mention(`Task:${closedTask.id}`)),
            heading("Task collections"),
            bullet("Colored: ", mention(`TaskCollection:${sprintCollection.id}`)),
            bullet("Uncolored: ", mention(`TaskCollection:${inboxCollection.id}`)),
        ],
    });

    const chatsDocument = await TestDocument.create(accounts.cassCade, {
        id: unsafelyGenerateStableId<DocumentId>(runner.stableRandom, "chatsDocument"),
        content: [
            title("Chats"),
            bullet(
                "Account media (single contributor): ",
                mention(`Chat:${singleSenderRoomChat.id}`),
            ),
            bullet("AccountPile media (multiple contributors): ", mention(`Chat:${groupChat.id}`)),
        ],
    });

    const accountsAndMissingDocument = await TestDocument.create(accounts.cassCade, {
        id: unsafelyGenerateStableId<DocumentId>(runner.stableRandom, "accountsAndMissingDocument"),
        content: [
            title("Accounts and missing entities"),
            heading("Accounts"),
            bullet("Default: ", accountMention(accounts.roseCompas.account.id)),
            bullet(
                "Short (used inline like ",
                accountMention(accounts.cassCade.account.id, {short: true}),
                ": for a quick attribution)",
            ),
            heading("Missing"),
            bullet("Account: ", accountMention(missingIds.account)),
            bullet("Document: ", mention(`Document:${missingIds.document}`)),
            bullet("Channel: ", mention(`Channel:${missingIds.channel}`)),
            bullet("Chat: ", mention(`Chat:${missingIds.chat}`)),
            bullet("Task: ", mention(`Task:${missingIds.task}`)),
            bullet("Task collection: ", mention(`TaskCollection:${missingIds.taskCollection}`)),
            bullet("Post: ", mention(`Post:${missingIds.post}`)),
            bullet("Site: ", mention(`Site:${missingIds.site}`)),
        ],
    });

    const documentsChannelsPostsSitesDocument = await TestDocument.create(accounts.cassCade, {
        id: unsafelyGenerateStableId<DocumentId>(
            runner.stableRandom,
            "documentsChannelsPostsSitesDocument",
        ),
        content: [
            title("Documents, channels, posts, sites"),
            bullet("Document: ", mention(`Document:${q3PlanningDocument.id}`)),
            bullet("Channel: ", mention(`Channel:${craftChannel.id}`)),
            bullet("Post: ", mention(`Post:${columnResizingPost.id}`)),
            bullet("Site: ", mention(`Site:${handbookSite.id}`)),
        ],
    });

    await screenshot(
        runner,
        accounts,
        space.id,
        tasksAndCollectionsDocument.id,
        "a0",
        "tasks-and-collections",
    );
    await screenshot(runner, accounts, space.id, chatsDocument.id, "a1", "chats");
    await screenshot(
        runner,
        accounts,
        space.id,
        accountsAndMissingDocument.id,
        "a2",
        "accounts-and-missing",
    );
    await screenshot(
        runner,
        accounts,
        space.id,
        documentsChannelsPostsSitesDocument.id,
        "a3",
        "documents-channels-posts-sites",
    );
}

async function screenshot(
    runner: ScreenshotTestRunner,
    accounts: DemoSpaceAccounts,
    spaceId: string,
    documentId: DocumentId,
    orderKey: string,
    name: string,
) {
    await runner.goto(accounts.cassCade, `/doc/${documentId}`, {
        fixedTime: screenshotTime,
    });
    await runner.screenshot(orderKey, name);
}

function title(text: string): Node {
    return schema.node("title", {}, [schema.text(text)]);
}

function heading(text: string): Node {
    return schema.node("heading", {level: 2}, [schema.text(text)]);
}

function bullet(...children: ReadonlyArray<Node | string>): Node {
    return schema.node("unorderedListItem", {}, [
        schema.node(
            "paragraph",
            {},
            children.map(child => (typeof child === "string" ? schema.text(child) : child)),
        ),
    ]);
}

function accountMention(accountId: AccountId, {short = false}: {short?: boolean} = {}): Node {
    return schema.node("mention", {
        mention: cast<ContentMention>({type: "Account", accountId, isShort: short}),
    });
}

function mention(entityId: SearchMentionEntityId): Node {
    return schema.node("mention", {
        mention: cast<ContentMention>({type: "SearchEntity", entityId}),
    });
}
