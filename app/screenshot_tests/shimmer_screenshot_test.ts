import {TestActualContext} from "~/admin/environment/test/unit/with_unit_test_environment.js";
import {ScreenshotTestRunner} from "~/app/screenshot_tests/helpers/run_screenshot_test.js";
import {screenshotTestEndTime} from "~/app/screenshot_tests/helpers/screenshot_test_time.js";
import {seedScreenshotTestBots} from "~/app/screenshot_tests/helpers/seed_screenshot_test_bots.js";
import {uploadScreenshotTestFixtureFile} from "~/app/screenshot_tests/helpers/upload_screenshot_test_fixture_file.js";
import {
    chatGptKnownBotId,
    cursorKnownBotId,
} from "~/server/bots/settings_default_known_bot_account_model_data.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {getInboxEntries} from "~/server/notifications/data/get_inbox_entries.js";
import {
    addSearchAffinityEntityPointsForTest,
    favoriteSearchEntity,
} from "~/server/search/data/table/search_entity_actions.js";
import {instantiateBotSpaceAccount} from "~/server/spaces/instantiate_bot_space_account.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {updateSpaceAccountSettings} from "~/server/spaces/update_space_account_settings.js";
import {
    refreshTaskCollectionIndexForTest,
    refreshTaskIndexForTest,
} from "~/server/tasks/data/task_index.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {encodeContentDuplicationVariableSchemaForUrl} from "~/shared/content/content_duplication_variable_schema.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {FeedEntry, FeedEntrySchema} from "~/shared/feed/feed_entry_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {encodeBase64} from "~/shared/helpers/binary/base64.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {convertCamelCaseToKebabCase} from "~/shared/helpers/string/convert_camel_case_to_kebab_case.js";
import {convertToUrlPathnameSlug} from "~/shared/helpers/string/convert_to_url_pathname_slug.js";
import {markdown} from "~/shared/helpers/string/markdown.js";
import {generateChronologicalIdWithTime} from "~/shared/id/chronological_id.js";
import {unsafelyGenerateStableId} from "~/shared/id/id.js";
import {AccountId, ChatId, PostDraftId, SpaceId} from "~/shared/id/types/id_types.js";
import {AppSpaceRouteId} from "~/shared/remix/app_space_route_id.js";
import {Schema} from "~/shared/schema/schema.js";
import {SearchAffinityEntityId} from "~/shared/search/search_entity_id.js";
import {serializeTaskQueryFiltersSearchParam} from "~/shared/tasks/task_query_filter.js";

// We don't care about the shimmer rendered by these routes (most don't have
// shimmers). They mostly have some non-UI behavior like redirecting the URL.
//
// Always prefer adding a shimmer for new routes that'll be rendered for users in
// the UI.
type IrrelevantAppSpaceRouteIdWithoutShimmer =
    | "routes/s.$spaceId.accounts.$accountId"
    | "routes/s.$spaceId.dev.empty"
    | "routes/s.$spaceId.dev.feed"
    | "routes/s.$spaceId.integrations.slack.oauth"
    | "routes/s.$spaceId.invite._index"
    | "routes/s.$spaceId.invite.accept"
    | "routes/s.$spaceId.invite.reject-and-mark-as-spam"
    | "routes/s.$spaceId.notifications.unsubscribe"
    | "routes/s.$spaceId.settings"
    | "routes/s.$spaceId.settings._index"
    // TODO(#sites): Add shimmers for these routes.
    | "routes/s.$spaceId.sites.$siteId._index";

type ShimmerScreenshotSetup = () => Promise<ShimmerScreenshotSetupResult>;

type ShimmerScreenshotSetupResult = {
    path: string;
    peekPath?: string;
    session?: TestSpaceSession;
};
const screenshotTestAccountActivationTime = new Date(
    screenshotTestEndTime.getTime() - 24 * 60 * 60 * 1000,
);

const lorem = {
    sentence: "Lorem ipsum dolor sit amet",
    title: "Lorem ipsum dolor",
    shortTitle: "Lorem ipsum",
    messageShort: "Lorem ipsum dolor sit amet.",
    messageMedium: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
    messageLong:
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer nec nulla lorem.",
    messageWidth32: "Lorem",
    messageWidth48: "Lorem ipsum",
    messageWidth64: "Lorem ipsum dolor",
    messageWidth96: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
    messageWidth128:
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Donec sed ornare nibh.",
    messageWidth160TwoLines:
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Fusce egestas posuere eros sit amet tincidunt. Proin vulputate volutpat enim quis gravida.",
    messageWidth160ThreeLines:
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Fusce egestas posuere eros sit amet tincidunt. Proin vulputate volutpat enim quis gravida. Integer nec nulla lorem. Nullam accumsan lorem enim.",
    paragraph: markdown`
Lorem ipsum dolor sit amet, consectetur adipiscing elit. Fusce egestas posuere eros sit amet
tincidunt. Proin vulputate volutpat enim quis gravida. Integer nec nulla lorem. Nullam accumsan
lorem enim.
    `,
    post: markdown`
Lorem ipsum dolor sit amet, consectetur adipiscing elit. Fusce egestas posuere eros sit amet
tincidunt. Proin vulputate volutpat enim quis gravida.

Integer nec nulla lorem. Nullam accumsan lorem enim. Donec sed ornare nibh. Nulla nec sollicitudin
enim. Morbi at venenatis arcu.
    `,
    documentBody: markdown`
Lorem ipsum dolor sit amet, consectetur adipiscing elit. Fusce egestas posuere eros sit amet
tincidunt. Proin vulputate volutpat enim quis gravida. Integer nec nulla lorem. Nullam accumsan
lorem enim.

# Vitae fermentum

Fusce nec aliquet dolor. Nullam sed lacus semper, molestie nunc imperdiet, laoreet lectus. Morbi
semper auctor posuere. Suspendisse potenti.

Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Aliquam
vehicula facilisis vestibulum. Donec sed ornare nibh. Nulla nec sollicitudin enim. Morbi at
venenatis arcu. Donec maximus volutpat ullamcorper. Donec nec sapien ligula. Ut congue volutpat urna
et facilisis.

# Morbi vulputate nisl metus

Duis eget massa ac nulla laoreet tempus. Nullam congue nisi tristique eros consectetur, fringilla
congue sapien pretium. Vivamus elit nibh, bibendum et dapibus at, vehicula sed orci. Integer lorem
felis.

## Vehicula non posuere eu, commodo id lorem

Nulla dignissim, ipsum quis ultricies pulvinar, libero ante lacinia libero, ac porta nunc sapien eu
velit. Donec congue a nulla a tristique. Aliquam malesuada laoreet hendrerit. Donec sit amet velit
finibus, volutpat massa in, ultricies sapien. Sed eleifend odio et massa placerat ornare.

Nullam quis massa eros. Nam venenatis pharetra nisi nec pellentesque. Curabitur ac eros viverra,
mollis mauris in, lobortis velit. Proin vitae ultrices urna, tristique gravida dui.
    `,
} as const;

export async function run(context: TestActualContext, runner: ScreenshotTestRunner) {
    await seedScreenshotTestBots(context, runner.services);

    const space = await TestSpace.create(context, {
        // NOTE(calebmer): The key is `space2` instead of simply `space` to get a space
        // avatar that's nice and aesthetic.
        id: unsafelyGenerateStableId<SpaceId>(runner.stableRandom, "space2"),
        name: "Alpine",
    });

    const session = await space.createSession({
        id: unsafelyGenerateStableId<AccountId>(runner.stableRandom, "account"),
        role: "Admin",
        name: "Alice",
        overrideCreatedTime: screenshotTestAccountActivationTime,
    });

    await runAllPromises([
        instantiateBotSpaceAccount(session.action(), {
            spaceId: session.space.id,
            botId: chatGptKnownBotId,
        }),
        instantiateBotSpaceAccount(session.action(), {
            spaceId: session.space.id,
            botId: cursorKnownBotId,
        }),
    ]);

    const otherSession1 = await space.createSession({
        id: unsafelyGenerateStableId<AccountId>(runner.stableRandom, "otherAccount1"),
        name: "Bob",
        overrideCreatedTime: screenshotTestAccountActivationTime,
    });
    const otherSession2 = await space.createSession({
        id: unsafelyGenerateStableId<AccountId>(runner.stableRandom, "otherAccount2"),
        name: "Carol",
        overrideCreatedTime: screenshotTestAccountActivationTime,
    });
    const otherSession3 = await space.createSession({
        id: unsafelyGenerateStableId<AccountId>(runner.stableRandom, "otherAccount3"),
        name: "Dave",
        overrideCreatedTime: screenshotTestAccountActivationTime,
    });

    const extraSpace = await TestSpace.create(context, {
        id: unsafelyGenerateStableId<SpaceId>(runner.stableRandom, "extraSpace"),
        name: "Lorem Ipsum",
    });
    await extraSpace.addAccount(session, "Admin");

    const screenshots: Record<
        Exclude<AppSpaceRouteId, IrrelevantAppSpaceRouteIdWithoutShimmer>,
        ShimmerScreenshotSetup
    > = {
        // The inbox test is intentionally the very first test. To guarantee our
        // notifications are pristine and not affected by mutations performbed by any other
        // tests.
        "routes/s.$spaceId.inbox": async () => {
            let selectedPath: string | null = null;
            for (let i = 0; i < 5; i++) {
                const channel = await TestChannel.create(session, {
                    name: "Lorem Ipsum",
                    description: lorem.paragraph,
                    access: "Public",
                });
                await channel.subscribe(otherSession3);

                const lastPostOffsetMs = -100 - i * 100;
                await channel.createPost(session, lorem.sentence, {
                    overrideCreatedTime: new Date(
                        screenshotTestEndTime.getTime() + lastPostOffsetMs - 2000,
                    ),
                });

                await ProcessContextModule.waitForTestTasks();
                await runner.services.waitForSqsProcessJobs();

                await channel.createPost(otherSession1, lorem.sentence, {
                    overrideCreatedTime: new Date(
                        screenshotTestEndTime.getTime() + lastPostOffsetMs - 1000,
                    ),
                });

                await ProcessContextModule.waitForTestTasks();
                await runner.services.waitForSqsProcessJobs();

                await channel.createPost(session, lorem.sentence, {
                    overrideCreatedTime: new Date(
                        screenshotTestEndTime.getTime() + lastPostOffsetMs,
                    ),
                });

                await ProcessContextModule.waitForTestTasks();
                await runner.services.waitForSqsProcessJobs();

                if (selectedPath === null) {
                    const {items} = await getInboxEntries(otherSession3.action(), {
                        spaceId: space.id,
                        filter: "New",
                        limit: 100,
                        afterCursor: null,
                    });
                    const inboxEntry = items.find(
                        ({model}) =>
                            model.type === "ChannelPosts" && model.getChannelId() === channel.id,
                    );
                    assert(inboxEntry !== undefined);
                    const key = inboxEntry.model.getKey();
                    assert(key.type === "ChannelPosts");
                    selectedPath = `notifications/channel-posts/${key.channelId}-${key.bucketGeneration}`;
                }
            }
            assert(selectedPath !== null);

            const textEncoder = new TextEncoder();

            const selectedSearchParam = encodeBase64(
                textEncoder.encode(selectedPath),
                "Rfc4648Url",
            );

            return {
                path: `/s/${space.id}/inbox?selected=${selectedSearchParam}`,
                session: otherSession3,
            };
        },

        "routes/s.$spaceId._index": async () => {
            const feedChannel = await TestChannel.create(otherSession1, {
                name: "Lorem Ipsum",
                access: "Public",
            });

            const feedEntries: Array<FeedEntry> = [];
            let feedPostForComments: Awaited<ReturnType<TestChannel["createPost"]>> | null = null;
            for (let i = 0; i < 5; i++) {
                const feedPost = await feedChannel.createPost(
                    i % 2 === 0 ? otherSession1 : otherSession2,
                    lorem.sentence,
                    {
                        overrideCreatedTime: new Date(
                            screenshotTestEndTime.getTime() - (10 - i) * 1000,
                        ),
                    },
                );
                feedPostForComments ??= feedPost;
                feedEntries.push({
                    type: "Post",
                    postId: feedPost.id,
                    channelId: feedChannel.id,
                    authorId: feedPost.author.id,
                    createdTime: feedPost.createdTime,
                });
            }
            assert(feedPostForComments !== null);
            await feedPostForComments.createComment(otherSession1, lorem.messageLong, {
                overrideCreatedTime: new Date(screenshotTestEndTime.getTime() - 500),
            });

            const feedDirectChat = await TestChat.get(
                session,
                otherSession1,
                otherSession2,
                otherSession3,
            );
            const feedRoomChat = await TestChat.createRoom(session, {
                // Pin the chat ID so the account-pile preview (seeded by `Chat:${chatId}`) is
                // identical across runs. Without this the facepile members/order shuffle each run,
                // making the screenshot flaky.
                id: unsafelyGenerateStableId<ChatId>(runner.stableRandom, "feedRoomChat"),
                name: "Lorem Ipsum",
                access: "Public",
            });

            const feedDocument = await TestDocument.create(session, {
                title: lorem.title,
                access: "Public",
                body: lorem.documentBody,
            });
            await feedDocument.updateContentPreview();

            const feedTaskCollection = await TestTaskCollection.create(session, {
                name: "Lorem Ipsum",
                access: "Public",
                color: "blue",
            });
            const feedTask = await TestTask.create(session, {
                title: lorem.title,
                assignee: session,
                assigneeStatus: "Active",
                collections: feedTaskCollection,
                dueDate: null,
                priority: "High",
                notes: lorem.paragraph,
            });

            const feedSearchAffinityRows: Array<{
                entityId: SearchAffinityEntityId;
                points: number;
            }> = [
                {entityId: "TaskPersonal", points: 999_000_000},
                {entityId: `Channel:${feedChannel.id}`, points: 998_000_000},
                {entityId: `Document:${feedDocument.id}`, points: 997_000_000},
                {entityId: `Task:${feedTask.id}`, points: 996_000_000},
                {entityId: `TaskCollection:${feedTaskCollection.id}`, points: 995_000_000},
                {entityId: `Chat:${feedDirectChat.id}`, points: 994_000_000},
                {entityId: `Chat:${feedRoomChat.id}`, points: 993_000_000},
                {entityId: `Account:${otherSession1.account.id}`, points: 992_000_000},
                {entityId: `Account:${otherSession2.account.id}`, points: 991_000_000},
                {entityId: `Account:${otherSession3.account.id}`, points: 990_000_000},
            ];
            await runAllPromises(
                feedSearchAffinityRows.slice(0, 3).map(row =>
                    favoriteSearchEntity(session.action(), {
                        spaceId: space.id,
                        entityId: row.entityId,
                    }),
                ),
            );
            await runAllPromises(
                feedSearchAffinityRows.map(row =>
                    addSearchAffinityEntityPointsForTest(session.action(), {
                        spaceId: space.id,
                        accountId: session.account.id,
                        entityId: row.entityId,
                        points: row.points,
                    }),
                ),
            );

            const feedSearchParams = new URLSearchParams();
            feedSearchParams.set(
                "entries",
                JSON.stringify(Schema.array(FeedEntrySchema).serialize(feedEntries)),
            );

            return {path: `/s/${space.id}/dev/feed?${feedSearchParams}`};
        },
        "routes/s.$spaceId.channels.$channelId._index": async () => {
            const channel = await TestChannel.create(otherSession1, {
                name: "Lorem Ipsum",
                access: "Public",
                description: "Lorem ipsum dolor sit amet",
            });
            let firstPost: Awaited<ReturnType<TestChannel["createPost"]>> | null = null;
            for (let i = 0; i < 5; i++) {
                const post = await channel.createPost(
                    i % 2 === 0 ? otherSession1 : otherSession2,
                    lorem.sentence,
                    {
                        overrideCreatedTime: new Date(
                            screenshotTestEndTime.getTime() - (10 - i) * 1000,
                        ),
                    },
                );
                firstPost ??= post;
            }
            assert(firstPost !== null);
            await firstPost.createComment(otherSession1, lorem.messageLong, {
                overrideCreatedTime: new Date(screenshotTestEndTime.getTime() - 500),
            });

            return {path: `/s/${space.id}/channels/${channel.id}`};
        },
        "routes/s.$spaceId.channels.$channelId.files": async () => {
            const content = new TextEncoder().encode(
                markdown`
# Lorem Ipsum

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Fusce egestas posuere eros sit amet
tincidunt. Proin vulputate volutpat enim quis gravida. Integer nec nulla lorem.
                `.trim() + "\n",
            );

            const tokenAgent = runner.services.getAppServiceTokenAgent();
            const files = await runAllPromises(
                Array.from({length: 9}, () =>
                    uploadScreenshotTestFixtureFile(tokenAgent, session, {
                        contentType: "text/markdown",
                        content,
                    }),
                ),
            );

            const channel = await TestChannel.create(session, {
                name: "Lorem Ipsum",
                description: lorem.paragraph,
                access: "Public",
            });
            await channel.createPost(session, "Lorem ipsum dolor", {
                files,
                overrideCreatedTime: new Date(screenshotTestEndTime.getTime() - 250),
            });

            return {path: `/s/${space.id}/channels/${channel.id}/files`};
        },
        "routes/s.$spaceId.channels.new": async () => {
            return {path: `/s/${space.id}/channels/new`};
        },
        "routes/s.$spaceId.chat.$chatId._index": async () => {
            const chat = await TestChat.get(session, otherSession1, otherSession2, otherSession3);
            const messages = [
                {author: otherSession1, content: lorem.messageWidth48},
                {author: otherSession1, content: lorem.messageWidth64},
                {author: otherSession1, content: lorem.messageWidth128},
                {author: otherSession2, content: lorem.messageWidth128},
                {author: otherSession3, content: lorem.messageWidth160TwoLines},
                {author: session, content: lorem.messageWidth96},
                {author: otherSession1, content: lorem.messageWidth64},
                {author: otherSession1, content: lorem.messageWidth32},
                {author: otherSession1, content: lorem.messageWidth128},
                {author: otherSession2, content: lorem.messageWidth96},
                {author: otherSession2, content: lorem.messageWidth32},
                {author: otherSession3, content: lorem.messageWidth160ThreeLines},
                {author: otherSession1, content: lorem.messageWidth32},
                {author: otherSession1, content: lorem.messageWidth96},
                {author: otherSession2, content: lorem.messageWidth32},
                {author: otherSession3, content: lorem.messageWidth64},
                {author: otherSession3, content: lorem.messageWidth96},
            ];
            let createdTime = screenshotTestEndTime.getTime() - messages.length * 1000;
            for (const message of messages) {
                createdTime += 1000;
                await chat.sendMessage(message.author, message.content, {
                    overrideCreatedTime: new Date(createdTime),
                });
            }

            // Wait for our `NotificationEvent` jobs to finish processing. So we can be
            // absolutely sure the loud notification count is dismissed by the next action.
            await ProcessContextModule.waitForTestTasks();
            await runner.services.waitForSqsProcessJobs();

            createdTime += 1000;
            await chat.sendMessage(session, lorem.messageWidth128, {
                overrideCreatedTime: new Date(createdTime),
            });

            return {path: `/s/${space.id}/chat/${chat.id}`};
        },
        "routes/s.$spaceId.chat.$chatId.messages.$index.reactions": async () => {
            const chat = await TestChat.get(session, otherSession1, otherSession2, otherSession3);
            const reactionMessage = await chat.sendMessage(otherSession1, lorem.sentence, {
                overrideCreatedTime: new Date(screenshotTestEndTime.getTime() - 100),
            });

            // Wait for our `NotificationEvent` jobs to finish processing. So we can be
            // absolutely sure the loud notification count is dismissed by the next action.
            await ProcessContextModule.waitForTestTasks();
            await runner.services.waitForSqsProcessJobs();

            await reactionMessage.setReaction(session, "Happy");
            await reactionMessage.setReaction(otherSession2, "Happy");
            await reactionMessage.setReaction(otherSession3, "Happy");

            const reactionMessageModel = await reactionMessage.get();
            assert(reactionMessageModel.payload.type === "Content");
            const reactionSearchParam = `${reactionMessageModel.payload.content.doc.content.size}@${
                reactionMessageModel.payload.contentUpdate?.mappings.length ?? 0
            }`;

            return {
                path: `/s/${space.id}/dev/empty`,
                peekPath: `/s/${space.id}/chat/${chat.id}/messages/${reactionMessage.index}/reactions?at=${reactionSearchParam}`,
            };
        },
        "routes/s.$spaceId.chat.new": async () => {
            const chat = await TestChat.get(session, otherSession1);
            const messages = [
                {author: session, content: lorem.messageWidth32},
                {author: otherSession1, content: lorem.messageWidth64},
                {author: otherSession1, content: lorem.messageWidth96},
            ];
            let createdTime = screenshotTestEndTime.getTime() - messages.length * 1000;
            for (const message of messages) {
                createdTime += 1000;
                await chat.sendMessage(message.author, message.content, {
                    overrideCreatedTime: new Date(createdTime),
                });
            }

            // Wait for our `NotificationEvent` jobs to finish processing. So we can be
            // absolutely sure the loud notification count is dismissed by the next action.
            await ProcessContextModule.waitForTestTasks();
            await runner.services.waitForSqsProcessJobs();

            createdTime += 1000;
            await chat.sendMessage(session, lorem.messageWidth128, {
                overrideCreatedTime: new Date(createdTime),
            });

            return {
                path: `/s/${space.id}/chat/new?accounts=${otherSession1.account.id}`,
            };
        },
        "routes/s.$spaceId.chat.room.new": async () => {
            return {path: `/s/${space.id}/chat/room/new`};
        },
        "routes/s.$spaceId.chat.with.$accountId": async () => {
            const chat = await TestChat.get(session, otherSession2);
            const mergeBreakGapMs = 6 * 60 * 1000;
            const messages = [
                {author: otherSession2, content: lorem.messageWidth48},
                {author: otherSession2, content: lorem.messageWidth64},
                {author: otherSession2, content: lorem.messageWidth128},
                {author: session, content: lorem.messageWidth128},
                {author: otherSession2, content: lorem.messageWidth160TwoLines},
                {author: session, content: lorem.messageWidth96},
                {author: otherSession2, content: lorem.messageWidth64},
                {author: otherSession2, content: lorem.messageWidth32},
                {author: otherSession2, content: lorem.messageWidth128},
                {author: session, content: lorem.messageWidth96},
                {author: session, content: lorem.messageWidth32},
                {author: otherSession2, content: lorem.messageWidth160ThreeLines},
                {author: session, content: lorem.messageWidth32},
                {author: session, content: lorem.messageWidth96},
                {author: otherSession2, content: lorem.messageWidth32},
                {author: session, content: lorem.messageWidth64},
                {author: session, content: lorem.messageWidth96},
            ];
            let createdTime = screenshotTestEndTime.getTime() - messages.length * 1000;
            for (const message of messages) {
                createdTime += 1000;
                await chat.sendMessage(message.author, message.content, {
                    overrideCreatedTime: new Date(createdTime),
                });
            }

            // Wait for our `NotificationEvent` jobs to finish processing. So we can be
            // absolutely sure the loud notification count is dismissed by the next action.
            await ProcessContextModule.waitForTestTasks();
            await runner.services.waitForSqsProcessJobs();

            createdTime += mergeBreakGapMs;
            await chat.sendMessage(session, lorem.messageWidth128, {
                overrideCreatedTime: new Date(createdTime),
            });

            return {path: `/s/${space.id}/chat/with/${otherSession2.account.id}`};
        },
        "routes/s.$spaceId.create._index": async () => {
            return {path: `/s/${space.id}/create`};
        },
        "routes/s.$spaceId.create.more": async () => {
            return {path: `/s/${space.id}/create/more`};
        },
        "routes/s.$spaceId.documents.$documentId._index": async () => {
            const document = await TestDocument.create(session, {
                title: lorem.title,
                access: "Public",
                body: lorem.documentBody,
            });
            await document.updateContentPreview();

            const commentThread = await document.createCommentThread(
                session,
                {from: 77, to: 90},
                lorem.messageLong,
                {overrideCreatedTime: new Date(screenshotTestEndTime.getTime() - 3000)},
            );
            await commentThread.createComment(session, lorem.messageLong, {
                overrideCreatedTime: new Date(screenshotTestEndTime.getTime() - 2000),
            });
            await commentThread.createComment(session, lorem.messageLong, {
                overrideCreatedTime: new Date(screenshotTestEndTime.getTime() - 1000),
            });

            return {path: `/s/${space.id}/documents/${document.id}`};
        },
        "routes/s.$spaceId.documents.$documentId.comments.$commentThreadId.$index.reactions":
            async () => {
                const document = await TestDocument.create(session, {
                    title: lorem.title,
                    access: "Public",
                    body: lorem.documentBody,
                });
                await document.updateContentPreview();

                const commentThread = await document.createCommentThread(
                    session,
                    {from: 77, to: 90},
                    lorem.messageLong,
                    {overrideCreatedTime: new Date(screenshotTestEndTime.getTime() - 1000)},
                );
                const reactionComment = commentThread.firstComment;
                await reactionComment.setReaction(session, "Yes");
                await reactionComment.setReaction(otherSession1, "Yes");
                await reactionComment.setReaction(otherSession2, "Yes");

                const reactionCommentModel = await reactionComment.get();
                assert(reactionCommentModel.payload.type === "Content");
                const reactionSearchParam = `${
                    reactionCommentModel.payload.content.doc.content.size
                }@${reactionCommentModel.payload.contentUpdate?.mappings.length ?? 0}`;

                return {
                    path: `/s/${space.id}/dev/empty`,
                    peekPath: `/s/${space.id}/documents/${document.id}/comments/${commentThread.id}/${reactionComment.index}/reactions?at=${reactionSearchParam}`,
                };
            },
        "routes/s.$spaceId.documents.$documentId.comments.$commentThreadId._index": async () => {
            const document = await TestDocument.create(session, {
                title: lorem.title,
                access: "Public",
                body: lorem.documentBody,
            });
            await document.updateContentPreview();

            const commentThreadMessages = [
                {author: session, content: lorem.messageShort},
                {author: otherSession1, content: lorem.messageWidth64},
                {author: otherSession1, content: lorem.messageMedium},
                {author: otherSession2, content: lorem.messageShort},
                {author: otherSession2, content: lorem.messageWidth64},
                {author: otherSession2, content: lorem.messageWidth128},
                {author: session, content: lorem.messageMedium},
            ];
            const firstCommentThreadMessage = commentThreadMessages[0];
            assert(firstCommentThreadMessage !== undefined);

            const commentThread = await document.createCommentThread(
                firstCommentThreadMessage.author,
                {from: 77, to: 90},
                firstCommentThreadMessage.content,
                {
                    overrideCreatedTime: new Date(
                        screenshotTestEndTime.getTime() - commentThreadMessages.length * 1000,
                    ),
                },
            );

            for (const [index, commentThreadMessage] of commentThreadMessages.slice(1).entries()) {
                await commentThread.createComment(
                    commentThreadMessage.author,
                    commentThreadMessage.content,
                    {
                        overrideCreatedTime: new Date(
                            screenshotTestEndTime.getTime() -
                                (commentThreadMessages.length - index - 1) * 1000,
                        ),
                    },
                );
            }

            return {
                path: `/s/${space.id}/documents/${document.id}/comments/${commentThread.id}`,
            };
        },
        "routes/s.$spaceId.documents.$documentId.duplicate": async () => {
            const document = await TestDocument.create(session, {
                title: lorem.title,
                access: "Public",
                body: lorem.documentBody,
            });
            await document.updateContentPreview();

            const documentDuplicateSearchParams = new URLSearchParams();
            documentDuplicateSearchParams.set("title", lorem.title);
            const encodedSchema = encodeContentDuplicationVariableSchemaForUrl(
                new Map([
                    ["Lorem ipsum", {type: "Text", marks: []}],
                    ["Dolor sit", {type: "Text", marks: []}],
                    ["Amet consectetur", {type: "Content"}],
                ]),
            );
            if (encodedSchema !== null) {
                documentDuplicateSearchParams.set("schema", encodedSchema);
            }
            return {
                path: `/s/${space.id}/documents/${document.id}/duplicate?${documentDuplicateSearchParams}`,
            };
        },
        "routes/s.$spaceId.favorites": async () => {
            const favoriteChannel = await TestChannel.create(session, {
                name: "Lorem Ipsum",
                description: lorem.paragraph,
                access: "Public",
            });

            const favoriteDocument = await TestDocument.create(otherSession1, {
                title: lorem.title,
                access: "Public",
                body: lorem.documentBody,
            });
            await favoriteDocument.updateContentPreview();

            const favoriteTask = await TestTask.create(otherSession1, {
                title: lorem.title,
                assignee: otherSession1,
                assigneeStatus: "Active",
                dueDate: null,
                priority: "High",
                notes: lorem.paragraph,
            });

            await updateSpaceAccountSettings(otherSession1.action(), space.id, {
                searchShortcutFavoriteEntityCount: 4,
            });
            const favoriteRows: Array<{entityId: SearchAffinityEntityId; points: number}> = [
                {entityId: "TaskPersonal", points: 999_000_000},
                {entityId: `Channel:${favoriteChannel.id}`, points: 998_000_000},
                {entityId: `Document:${favoriteDocument.id}`, points: 997_000_000},
                {entityId: `Task:${favoriteTask.id}`, points: 996_000_000},
            ];
            await runAllPromises(
                favoriteRows.map(row =>
                    favoriteSearchEntity(otherSession1.action(), {
                        spaceId: space.id,
                        entityId: row.entityId,
                    }),
                ),
            );
            await runAllPromises(
                favoriteRows.map(row =>
                    addSearchAffinityEntityPointsForTest(otherSession1.action(), {
                        spaceId: space.id,
                        accountId: otherSession1.account.id,
                        entityId: row.entityId,
                        points: row.points,
                    }),
                ),
            );

            return {path: `/s/${space.id}/favorites`, session: otherSession1};
        },
        "routes/s.$spaceId.notifications.channel-posts.$channelIdAndBucketGeneration": async () => {
            const channel = await TestChannel.create(otherSession1, {
                name: "Lorem Ipsum",
                description: lorem.paragraph,
                access: "Public",
            });
            await channel.subscribe(session);

            await channel.createPost(otherSession1, lorem.sentence, {
                overrideCreatedTime: new Date(screenshotTestEndTime.getTime() - 3000),
            });
            await channel.createPost(otherSession2, lorem.sentence, {
                overrideCreatedTime: new Date(screenshotTestEndTime.getTime() - 2000),
            });
            await channel.createPost(otherSession1, lorem.sentence, {
                overrideCreatedTime: new Date(screenshotTestEndTime.getTime() - 1000),
            });

            await ProcessContextModule.waitForTestTasks();
            await runner.services.waitForSqsProcessJobs();

            const {items} = await getInboxEntries(session.action(), {
                spaceId: space.id,
                filter: "New",
                limit: 100,
                afterCursor: null,
            });
            const inboxEntry = items.find(
                ({model}) => model.type === "ChannelPosts" && model.getChannelId() === channel.id,
            );
            assert(inboxEntry !== undefined);
            const key = inboxEntry.model.getKey();
            assert(key.type === "ChannelPosts");

            return {
                path: `/s/${space.id}/notifications/channel-posts/${key.channelId}-${key.bucketGeneration}?inbox=show`,
            };
        },
        "routes/s.$spaceId.notifications.document-comment-threads.$documentIdAndBucketGeneration":
            async () => {
                const document = await TestDocument.create(otherSession1, {
                    title: lorem.title,
                    access: "Public",
                    body: lorem.documentBody,
                });
                await document.updateContentPreview();

                const commentThreadMessages = [
                    {author: otherSession2, content: lorem.messageShort},
                    {author: session, content: lorem.messageWidth64},
                    {author: session, content: lorem.messageMedium},
                    {author: otherSession2, content: lorem.messageShort},
                    {author: otherSession2, content: lorem.messageWidth64},
                    {author: otherSession2, content: lorem.messageWidth128},
                    {author: otherSession3, content: lorem.messageMedium},
                ];
                const firstCommentThreadMessage = commentThreadMessages[0];
                assert(firstCommentThreadMessage !== undefined);

                const commentThread = await document.createCommentThread(
                    firstCommentThreadMessage.author,
                    {from: 77, to: 90},
                    firstCommentThreadMessage.content,
                    {
                        overrideCreatedTime: new Date(
                            screenshotTestEndTime.getTime() - commentThreadMessages.length * 1000,
                        ),
                    },
                );

                for (const [index, commentThreadMessage] of commentThreadMessages
                    .slice(1)
                    .entries()) {
                    await commentThread.createComment(
                        commentThreadMessage.author,
                        commentThreadMessage.content,
                        {
                            overrideCreatedTime: new Date(
                                screenshotTestEndTime.getTime() -
                                    (commentThreadMessages.length - index - 1) * 1000,
                            ),
                        },
                    );
                }

                await ProcessContextModule.waitForTestTasks();
                await runner.services.waitForSqsProcessJobs();

                const {items} = await getInboxEntries(otherSession1.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                });
                const inboxEntry = items.find(
                    ({model}) =>
                        model.type === "DocumentNewCommentThreads" &&
                        model.getDocumentId() === document.id,
                );
                assert(inboxEntry !== undefined);
                const key = inboxEntry.model.getKey();
                assert(key.type === "DocumentNewCommentThreads");

                return {
                    path: `/s/${space.id}/notifications/document-comment-threads/${key.documentId}-${key.bucketGeneration}?inbox=show`,
                    session: otherSession1,
                };
            },
        "routes/s.$spaceId.more._index": async () => {
            return {path: `/s/${space.id}/more`};
        },
        "routes/s.$spaceId.more.settings": async () => {
            return {path: `/s/${space.id}/more/settings`};
        },
        "routes/s.$spaceId.more.switch-space": async () => {
            return {path: `/s/${space.id}/more/switch-space`};
        },
        "routes/s.$spaceId.posts.$postId._index": async () => {
            const channel = await TestChannel.create(otherSession1, {
                name: "Lorem Ipsum",
                description: lorem.paragraph,
                access: "Public",
            });
            const post = await channel.createPost(
                otherSession1,
                markdown`
Lorem ipsum dolor sit amet, consectetur adipiscing elit. Fusce egestas posuere eros sit amet
tincidunt. Proin vulputate volutpat enim quis gravida. Integer nec nulla lorem. Nullam accumsan
lorem enim. Donec sed ornare nibh. Nulla nec sollicitudin enim. Morbi at venenatis arcu. Donec
maximus volutpat ullamcorper.
                `,
                {overrideCreatedTime: new Date(screenshotTestEndTime.getTime() - 10_000)},
            );
            await post.createComment(otherSession1, lorem.messageShort, {
                overrideCreatedTime: new Date(screenshotTestEndTime.getTime() - 1500),
            });
            await post.createComment(otherSession2, lorem.messageMedium, {
                overrideCreatedTime: new Date(screenshotTestEndTime.getTime() - 1000),
            });
            await post.createComment(otherSession2, lorem.messageLong, {
                overrideCreatedTime: new Date(screenshotTestEndTime.getTime() - 500),
            });

            return {path: `/s/${space.id}/posts/${post.id}`};
        },
        "routes/s.$spaceId.posts.$postId.comments.$index.reactions": async () => {
            const channel = await TestChannel.create(otherSession1, {
                name: "Lorem Ipsum",
                description: lorem.paragraph,
                access: "Public",
            });
            const post = await channel.createPost(otherSession1, lorem.post, {
                overrideCreatedTime: new Date(screenshotTestEndTime.getTime() - 10_000),
            });
            const reactionComment = await post.createComment(otherSession1, lorem.messageLong, {
                overrideCreatedTime: new Date(screenshotTestEndTime.getTime() - 500),
            });
            await reactionComment.setReaction(session, "Celebrate");
            await reactionComment.setReaction(otherSession1, "Celebrate");
            await reactionComment.setReaction(otherSession3, "Celebrate");

            const commentModel = await reactionComment.get();
            assert(commentModel.payload.type === "Content");
            const commentReactionSearchParam = `${commentModel.payload.content.doc.content.size}@${
                commentModel.payload.contentUpdate?.mappings.length ?? 0
            }`;

            return {
                path: `/s/${space.id}/dev/empty`,
                peekPath: `/s/${space.id}/posts/${post.id}/comments/${reactionComment.index}/reactions?at=${commentReactionSearchParam}`,
            };
        },
        "routes/s.$spaceId.posts.$postId.reactions": async () => {
            const channel = await TestChannel.create(otherSession1, {
                name: "Lorem Ipsum",
                description: lorem.paragraph,
                access: "Public",
            });
            const post = await channel.createPost(otherSession1, lorem.post, {
                overrideCreatedTime: new Date(screenshotTestEndTime.getTime() - 10_000),
            });
            await post.setReaction(session, "Happy");
            await post.setReaction(otherSession2, "Happy");
            await post.setReaction(otherSession3, "Happy");

            return {
                path: `/s/${space.id}/dev/empty`,
                peekPath: `/s/${space.id}/posts/${post.id}/reactions`,
            };
        },
        "routes/s.$spaceId.posts.new.$draftId": async () => {
            const channel = await TestChannel.create(session, {
                name: "Lorem Ipsum",
                description: lorem.paragraph,
                access: "Public",
            });

            const postDraftId = generateChronologicalIdWithTime<PostDraftId>(
                screenshotTestEndTime.getTime(),
            );

            return {path: `/s/${space.id}/posts/new/${postDraftId}?channel=${channel.id}`};
        },
        "routes/s.$spaceId.search": async () => {
            const searchSpace = await TestSpace.create(context, {
                id: unsafelyGenerateStableId<SpaceId>(runner.stableRandom, "searchSpace"),
                name: "Lorem Ipsum",
            });

            const [searchSession, searchOtherSession1, searchOtherSession2, searchOtherSession3] =
                await runAllPromises([
                    searchSpace.createSession({
                        id: unsafelyGenerateStableId<AccountId>(
                            runner.stableRandom,
                            "searchSession",
                        ),
                        name: "Carol",
                    }),
                    searchSpace.createSession({
                        id: unsafelyGenerateStableId<AccountId>(
                            runner.stableRandom,
                            "searchOtherSession1",
                        ),
                        name: "Alice",
                        role: "Admin",
                    }),
                    searchSpace.createSession({
                        id: unsafelyGenerateStableId<AccountId>(
                            runner.stableRandom,
                            "searchOtherSession2",
                        ),
                        name: "Bob",
                    }),
                    searchSpace.createSession({
                        id: unsafelyGenerateStableId<AccountId>(
                            runner.stableRandom,
                            "searchOtherSession3",
                        ),
                        name: "Dave",
                    }),
                ]);

            const searchChannel = await TestChannel.create(searchOtherSession1, {
                name: "Lorem Ipsum",
                description: lorem.paragraph,
                access: "Public",
            });

            const searchDirectChat = await TestChat.get(
                searchSession,
                searchOtherSession1,
                searchOtherSession2,
                searchOtherSession3,
            );
            const searchRoomChat = await TestChat.createRoom(searchSession, {
                // Pin the chat ID so the account-pile preview (seeded by `Chat:${chatId}`) is
                // identical across runs. Without this the facepile members/order shuffle each run,
                // making the screenshot flaky.
                id: unsafelyGenerateStableId<ChatId>(runner.stableRandom, "searchRoomChat"),
                name: "Lorem Ipsum",
                access: "Public",
            });

            const searchDocument = await TestDocument.create(searchSession, {
                title: lorem.title,
                access: "Public",
                body: lorem.documentBody,
            });

            const searchTaskCollection = await TestTaskCollection.create(searchSession, {
                name: "Lorem Ipsum",
                access: "Public",
                color: "blue",
            });
            const searchTask = await TestTask.create(searchSession, {
                title: lorem.title,
                assignee: searchSession,
                assigneeStatus: "Active",
                collections: searchTaskCollection,
                dueDate: null,
                priority: "High",
                notes: lorem.paragraph,
            });

            const searchAffinities: Array<{entityId: SearchAffinityEntityId; points: number}> = [
                {entityId: "TaskPersonal", points: 999_000_000},
                {entityId: `Channel:${searchChannel.id}`, points: 998_000_000},
                {entityId: `Document:${searchDocument.id}`, points: 997_000_000},
                {entityId: `Task:${searchTask.id}`, points: 996_000_000},
                {entityId: `TaskCollection:${searchTaskCollection.id}`, points: 995_000_000},
                {entityId: `Chat:${searchDirectChat.id}`, points: 994_000_000},
                {entityId: `Chat:${searchRoomChat.id}`, points: 993_000_000},
                {entityId: `Account:${searchOtherSession1.account.id}`, points: 992_000_000},
            ];

            for (const {entityId} of searchAffinities.slice(0, 2)) {
                await favoriteSearchEntity(searchSession.action(), {
                    spaceId: searchSpace.id,
                    entityId,
                });
            }

            await runAllPromises(
                searchAffinities.map(({entityId, points}) =>
                    addSearchAffinityEntityPointsForTest(searchSession.action(), {
                        spaceId: searchSpace.id,
                        accountId: searchSession.account.id,
                        entityId,
                        points,
                    }),
                ),
            );

            return {path: `/s/${searchSpace.id}/search`, session: searchSession};
        },
        "routes/s.$spaceId.settings.bots.$botId": async () => {
            return {path: `/s/${space.id}/settings/bots/${chatGptKnownBotId}`};
        },
        "routes/s.$spaceId.settings.bots._index": async () => {
            return {path: `/s/${space.id}/settings/bots`};
        },
        "routes/s.$spaceId.settings.general": async () => {
            return {path: `/s/${space.id}/settings/general`};
        },
        "routes/s.$spaceId.settings.integrations._index": async () => {
            return {path: `/s/${space.id}/settings/integrations`};
        },
        "routes/s.$spaceId.settings.integrations.notion": async () => {
            return {path: `/s/${space.id}/settings/integrations/notion`};
        },
        "routes/s.$spaceId.settings.integrations.slack": async () => {
            return {path: `/s/${space.id}/settings/integrations/slack`};
        },
        "routes/s.$spaceId.settings.notifications": async () => {
            return {path: `/s/${space.id}/settings/notifications`};
        },
        "routes/s.$spaceId.settings.people": async () => {
            return {path: `/s/${space.id}/settings/people`};
        },
        "routes/s.$spaceId.settings.profile": async () => {
            return {path: `/s/${space.id}/settings/profile`};
        },
        "routes/s.$spaceId.tasks.$taskId._index": async () => {
            const task = await TestTask.create(session, {
                title: lorem.title,
                assignee: session,
                assigneeStatus: "Active",
                dueDate: null,
                notes: "",
            });

            return {path: `/s/${space.id}/tasks/${task.id}`};
        },
        "routes/s.$spaceId.tasks.$taskId.comments.$index.reactions": async () => {
            const collection = await TestTaskCollection.create(session, {
                name: "Lorem Ipsum",
                access: "Public",
                color: "blue",
            });
            const task = await TestTask.create(session, {
                title: lorem.title,
                assignee: session,
                assigneeStatus: "Active",
                collections: collection,
                dueDate: null,
                notes: "",
            });
            const reactionComment = await task.createComment(session, lorem.messageLong, {
                overrideCreatedTime: new Date(screenshotTestEndTime.getTime() - 1000),
            });
            await reactionComment.setReaction(session, "Happy");
            await reactionComment.setReaction(otherSession2, "Happy");
            await reactionComment.setReaction(otherSession3, "Happy");

            const reactionCommentModel = await reactionComment.get();
            assert(reactionCommentModel.payload.type === "Content");
            const commentReactionSearchParam = `${
                reactionCommentModel.payload.content.doc.content.size
            }@${reactionCommentModel.payload.contentUpdate?.mappings.length ?? 0}`;

            return {
                path: `/s/${space.id}/dev/empty`,
                peekPath: `/s/${space.id}/tasks/${task.id}/comments/${reactionComment.index}/reactions?at=${commentReactionSearchParam}`,
            };
        },
        "routes/s.$spaceId.tasks.$taskId.duplicate": async () => {
            const collection = await TestTaskCollection.create(session, {
                name: "Lorem Ipsum",
                access: "Public",
                color: "blue",
            });
            const task = await TestTask.create(session, {
                title: lorem.title,
                assignee: session,
                assigneeStatus: "Active",
                collections: collection,
                dueDate: null,
                priority: "High",
                notes: lorem.paragraph,
            });

            const taskDuplicateSearchParams = new URLSearchParams();
            taskDuplicateSearchParams.set("title", lorem.title);
            const encodedSchema = encodeContentDuplicationVariableSchemaForUrl(
                new Map([
                    ["Lorem ipsum", {type: "Text", marks: []}],
                    ["Dolor sit", {type: "Text", marks: []}],
                    ["Amet consectetur", {type: "Content"}],
                ]),
            );
            if (encodedSchema !== null) {
                taskDuplicateSearchParams.set("schema", encodedSchema);
            }
            return {
                path: `/s/${space.id}/tasks/${task.id}/duplicate?${taskDuplicateSearchParams}`,
            };
        },
        "routes/s.$spaceId.tasks._index": async () => {
            const collection = await TestTaskCollection.create(otherSession3, {
                name: "Lorem Ipsum",
                access: "Public",
                color: "blue",
            });
            for (let i = 0; i < 14; i++) {
                await TestTask.create(otherSession3, {
                    title: `${lorem.sentence} ${i + 1}`,
                    assignee: otherSession3,
                    assigneeStatus: "Inactive",
                    collections: collection,
                    priority: i % 2 === 0 ? "High" : "Medium",
                });
            }

            return {path: `/s/${space.id}/tasks`, session: otherSession3};
        },
        "routes/s.$spaceId.tasks.collections.$collectionId": async () => {
            const collection = await TestTaskCollection.create(session, {
                name: "Lorem Ipsum",
                access: "Public",
                color: "blue",
            });
            for (let i = 0; i < 14; i++) {
                await TestTask.create(session, {
                    title: `${lorem.sentence} ${i + 1}`,
                    assignee: session,
                    assigneeStatus: i % 2 === 0 ? "Active" : "Inactive",
                    collections: collection,
                    priority: i % 2 === 0 ? "High" : "Medium",
                });
            }

            return {path: `/s/${space.id}/tasks/collections/${collection.id}`};
        },
        "routes/s.$spaceId.tasks.view": async () => {
            const collection = await TestTaskCollection.create(session, {
                name: "Lorem Ipsum",
                access: "Public",
                color: "blue",
            });
            for (let i = 0; i < 14; i++) {
                await TestTask.create(session, {
                    title: `${lorem.sentence} ${i + 1}`,
                    assignee: session,
                    assigneeStatus: i % 2 === 0 ? "Active" : "Inactive",
                    collections: collection,
                    priority: i % 2 === 0 ? "High" : "Medium",
                });
            }

            const taskQuerySearchParams = new URLSearchParams();
            taskQuerySearchParams.set("name", lorem.shortTitle);
            taskQuerySearchParams.set(
                "filter",
                serializeTaskQueryFiltersSearchParam([
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ]),
            );

            return {path: `/s/${space.id}/tasks/view?${taskQuerySearchParams}`};
        },
    };

    const screenshotEntries = Object.entries(screenshots);

    // Double check that the inbox entry test is the first one we'll run.
    assert(screenshotEntries[0]![0] === "routes/s.$spaceId.inbox");

    for (const [name, setup] of screenshotEntries) {
        assert(name.startsWith("routes/s.$spaceId."));

        const screenshotName = convertToUrlPathnameSlug(
            name
                .slice("routes/s.$spaceId.".length)
                .split(".")
                .map(convertCamelCaseToKebabCase)
                .join("."),
        );

        const {path, peekPath, session: screenshotSession = session} = await setup();

        await ProcessContextModule.waitForTestTasks();
        await runner.services.waitForSqsProcessJobs();
        await runAllPromises([
            refreshTaskIndexForTest(context),
            refreshTaskCollectionIndexForTest(context),
        ]);

        await runner.goto(screenshotSession, path, {peekPath});
        await runner.evaluate("dev.files && dev.files.waitForImagePreviewContentsToLoad()");
        await runner.evaluate("dev.shimmer.debugWithOverlay()");
        await runner.screenshot(null, `${screenshotName}-1`);
        await runner.evaluate("dev.shimmer.debug()");
        await runner.screenshot(null, `${screenshotName}-2`);
    }
}
