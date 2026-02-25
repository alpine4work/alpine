// To update generated snapshots run:
//
// ```
// bazel run //client/web/content/file_entity:internal/content_file_chat_entity_preview_test -- --updateSnapshot
// ```

import {CalendarDate} from "@internationalized/date";
import {getAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {ContentFileEntityRenderers} from "~/client/web/content/content_file_entity_renderers_context.js";
import {renderContentFileChatEntityPreview} from "~/client/web/content/file_entity/internal/content_file_chat_entity_preview.js";
import {normalizeHtmlForFileEntityTest} from "~/client/web/content/file_entity/internal/test_helpers/normalize_html_for_file_entity_test.js";
import {getFileRegistry} from "~/client/web/content/file_registry_context.js";
import {AppContext} from "~/client/web/context/app_context.js";
import {getSearchEntityRegistry} from "~/client/web/search/core/search_entity_registry_context.js";
import {ChatMessageModel} from "~/shared/chat/chat_model.js";
import {FileChatEntityModelSchema} from "~/shared/chat/file_chat_entity_model_schema.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/content/message_content_schema.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {HtmlElementGenerator} from "~/shared/helpers/html/html_generator.js";
import {assertTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {assertId} from "~/shared/id/id.js";
import {AccountId, ChatId, SpaceId} from "~/shared/id/types/id_types.js";
import {emptyReactionSet} from "~/shared/reactions/reaction_set.js";
import {defaultClientInfo} from "~/shared/remix/client_info.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {createTestAccountModel} from "~/shared/spaces/test_helpers/account_model_test_helpers.js";

const spaceId = assertId<SpaceId>("2pm2pfcv5b2r52nkz2yy1r2x4c");
const chatId = assertId<ChatId>("rkb0rfnty8jc5p5trcp3nmwq68");
const currentDate = new CalendarDate(2025, 5, 1);

function getContext(): AppContext {
    throw new UnimplementedError("`getContext()` is unimplemented in this test file");
}

function createMessageContent(text: string) {
    return assertMessageContent(
        MessageContentProsemirrorSchema.node("doc", {}, [
            MessageContentProsemirrorSchema.node(
                "paragraph",
                {},
                text.length > 0 ? [MessageContentProsemirrorSchema.text(text)] : [],
            ),
        ]),
    );
}

function createChatMessageModel({
    index,
    author,
    text,
    createdTime,
    parent,
}: {
    index: number;
    author: AccountModel;
    text: string;
    createdTime: Date;
    parent?: {type: "Message"; index: number};
}): ChatMessageModel {
    return new ChatMessageModel({
        chatId,
        index,
        version: 1,
        author,
        createdTime,
        createdTimeZone: assertTimeZone("America/Los_Angeles"),
        payload: {
            type: "Content",
            parent: parent ?? null,
            content: {
                doc: createMessageContent(text),
                references: emptyContentReferences,
            },
            contentUpdate: null,
            files: [],
            reactionsByPos: new Map(),
            filesReactions: emptyReactionSet,
        },
        stream: null,
    });
}

function createDeletedChatMessageModel({
    index,
    author,
    createdTime,
}: {
    index: number;
    author: AccountModel;
    createdTime: Date;
}): ChatMessageModel {
    return new ChatMessageModel({
        chatId,
        index,
        version: 1,
        author,
        createdTime,
        createdTimeZone: assertTimeZone("America/Los_Angeles"),
        payload: {
            type: "Deleted",
            deletedTime: createdTime,
        },
        stream: null,
    });
}

function createDirectFileChatEntityModel({
    account1,
    account2,
}: {
    account1: AccountModel;
    account2: AccountModel;
}): FileEntityModel {
    const messages = [
        createChatMessageModel({
            index: 1,
            author: account2,
            text: "Can we sync after lunch?",
            createdTime: new Date("2025-01-01T12:00:00Z"),
        }),
        createChatMessageModel({
            index: 2,
            author: account2,
            text: "😀 😀",
            createdTime: new Date("2025-01-01T12:01:00Z"),
        }),
    ];

    return new FileEntityModel(FileChatEntityModelSchema, {
        type: "Chat",
        versions: [1],
        id: chatId,
        definition: {
            type: "Direct",
            accounts: [account1, account2],
        },
        isSubscribed: false,
        messages,
        otherReferencedMessages: [],
    });
}

function createRoomFileChatEntityModel({
    account1,
    account2,
    isPrivate = false,
}: {
    account1: AccountModel;
    account2: AccountModel;
    isPrivate?: boolean;
}): FileEntityModel {
    const parentMessage = createChatMessageModel({
        index: 0,
        author: account1,
        text: "We should update the milestone plan before review.",
        createdTime: new Date("2025-01-01T10:00:00Z"),
    });

    const messages = [
        createChatMessageModel({
            index: 3,
            author: account2,
            text: "Replying to that now with some edits.",
            createdTime: new Date("2025-01-01T12:10:00Z"),
            parent: {type: "Message", index: 0},
        }),
        createDeletedChatMessageModel({
            index: 4,
            author: account1,
            createdTime: new Date("2025-01-01T12:12:00Z"),
        }),
    ];

    return new FileEntityModel(FileChatEntityModelSchema, {
        type: "Chat",
        versions: [1],
        id: chatId,
        definition: {
            type: "Room",
            name: "Design Review",
            isPrivate,
        },
        isSubscribed: true,
        messages,
        otherReferencedMessages: [parentMessage],
    });
}

const account1 = createTestAccountModel({
    id: assertId<AccountId>("ne9xp93dwgcwccj661x3ntdb9w"),
    name: "Taylor Johnson",
    reactionCharacter: null,
});

const account2 = createTestAccountModel({
    id: assertId<AccountId>("pkm9xk784w3h3f6s1w02rb9khm"),
    name: "Casey Miller",
    reactionCharacter: null,
});

const basicParams = {
    getContext,
    clientInfo: defaultClientInfo,
    spaceId,
    accountRegistry: getAccountRegistry(spaceId),
    searchEntityRegistry: getSearchEntityRegistry(spaceId),
    fileRegistry: getFileRegistry(spaceId),
    currentAccount: account1,
    transformScale: 1,
    routeLayout: "wide" as const,
    isInitialAppRender: false,
    currentDate,
    fileEntityRenderers: null as ContentFileEntityRenderers | null,
};

const testCases = [
    {
        name: "direct-chat-with-big-emoji-and-merge",
        createEntity: () =>
            createDirectFileChatEntityModel({
                account1,
                account2,
            }),
    },
    {
        name: "room-chat-with-parent-and-deleted-message",
        createEntity: () =>
            createRoomFileChatEntityModel({
                account1,
                account2,
            }),
    },
    {
        name: "private-room-chat-with-parent-and-deleted-message",
        createEntity: () =>
            createRoomFileChatEntityModel({
                account1,
                account2,
                isPrivate: true,
            }),
    },
] as const;

const platforms = ["desktop", "mobile"] as const;

platforms.forEach(platform => {
    testCases.forEach(testCase => {
        test(`${platform} ${testCase.name}`, async () => {
            const fileEntity = testCase.createEntity();
            const html = new HtmlElementGenerator("div");

            renderContentFileChatEntityPreview(store => store.getSnapshot(), html, {
                ...basicParams,
                fileEntity,
                layout: {
                    width: 320,
                    widthFr: 1,
                    height: 380,
                },
                platform,
                spacingScale: "medium",
                suppressHydrationWarning: noop,
            });

            expect(await normalizeHtmlForFileEntityTest(html.generateHtml())).toMatchSnapshot();
        });
    });
});
