import {Step} from "prosemirror-transform";
import {TestAccessPolicy} from "~/server/access/test_helpers/test_access_policy.js";
import {
    completeChatMessageStream,
    deleteChatMessage,
    deleteChatMessageReaction,
    getChatMessage,
    putChatMessageStreamPartAndBroadcastEvent,
    sendChatMessage,
    setChatMessageReaction,
    updateChatMessageContent,
} from "~/server/chat/data/chat_messaging.js";
import {convertDirectChatToRoomChat} from "~/server/chat/data/convert_direct_chat_to_room_chat.js";
import {createRoomChat} from "~/server/chat/data/create_room_chat.js";
import {getChatDefinition} from "~/server/chat/data/get_chat_definition.js";
import {getOrCreateChatForAccounts} from "~/server/chat/data/get_or_create_chat_for_accounts.js";
import {updateRoomChatAccessPolicy} from "~/server/chat/data/update_room_chat_access_policy.js";
import {updateRoomChatName} from "~/server/chat/data/update_room_chat_name.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {ServerSessionActionContextWithPush} from "~/server/context/server_session_action_context_with_push.js";
import {TestMessageRoomBase} from "~/server/messaging/test_helpers/test_messaging_room_base.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {
    TestAccountActionContext,
    TestBotActionContext,
    TestContext,
    TestSessionActionContext,
} from "~/server/spaces/test_helpers/test_context.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {CreateOrUpdateAccessPolicy} from "~/shared/access/model/create_or_update_access_policy_schema.js";
import {BotTokenScope} from "~/shared/bots/bot_token_scope.js";
import {MessageContent} from "~/shared/content/message_content_schema.js";
import {FailedPreconditionError} from "~/shared/error/error.open_source.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {TimeZone, defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.open_source.js";
import {AccountId, ChatId, FileId} from "~/shared/id/types/id_types.open_source.js";
import {
    MessageContentPayloadParent,
    MessageStreamPartPayload,
} from "~/shared/messaging/message_schema.js";
import {Reaction} from "~/shared/reactions/reaction.js";

let testRoomChatCount = 1;

export class TestChat extends TestMessageRoomBase {
    public readonly context: TestContext;
    public readonly space: TestSpace;
    public readonly id: ChatId;
    public readonly accounts: ReadonlyArray<TestAccount>;

    private constructor(
        context: TestContext,
        space: TestSpace,
        id: ChatId,
        accounts: ReadonlyArray<TestAccount>,
    ) {
        super();
        this.context = context;
        this.space = space;
        this.id = id;
        this.accounts = accounts;
    }

    public static async get(
        session: TestSpaceSession,
        ...otherAccounts: ReadonlyArray<TestSession | TestAccount | AccountId>
    ) {
        const chatId = await getOrCreateChatForAccounts(session.action(), {
            spaceId: session.space.id,
            otherAccountIds: otherAccounts.map(otherAccount =>
                otherAccount instanceof TestSession
                    ? otherAccount.account.id
                    : typeof otherAccount === "string"
                      ? otherAccount
                      : otherAccount.id,
            ),
        });

        const accountById = new Map<AccountId, TestAccount>();
        accountById.set(session.account.id, session.account);

        await runAllPromises(
            otherAccounts.map(async otherAccount => {
                if (otherAccount instanceof TestSession) {
                    accountById.set(otherAccount.account.id, otherAccount.account);
                } else if (typeof otherAccount === "string") {
                    const actualOtherAccount = await TestAccount.get(session.context, otherAccount);
                    accountById.set(otherAccount, actualOtherAccount);
                } else {
                    accountById.set(otherAccount.id, otherAccount);
                }
            }),
        );

        const accounts = Array.from(accountById.values()).sort((account1, account2) =>
            defaultCompareStrings(account1.id, account2.id),
        );

        return new TestChat(session.context, session.space, chatId, accounts);
    }

    public static async createRoom(
        session: TestSpaceSession,
        {
            id,
            name = `Test Chat ${testRoomChatCount++}`,
            access,
        }: {
            id?: ChatId;
            name?: string;
            access?: "Public" | "Private" | CreateOrUpdateAccessPolicy;
        } = {},
    ) {
        let accessPolicy: CreateOrUpdateAccessPolicy;
        if (access === "Public" || access === undefined) {
            accessPolicy = {
                type: "Local",
                accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
                defaultGrant: {level: "Manage", generation: 1},
                urlGrant: null,
            };
        } else if (access === "Private") {
            accessPolicy = {
                type: "Local",
                accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            };
        } else {
            accessPolicy = access;
        }

        const {id: actualId} = await createRoomChat(session.action(), {
            spaceId: session.space.id,
            chatId: id,
            name,
            accessPolicy,
        });

        return new TestChat(session.context, session.space, actualId, []);
    }

    protected override _getRoomKey() {
        return this.id;
    }

    public override getBotScope(): BotTokenScope {
        return {type: "Chat", chatId: this.id};
    }

    public async convertToRoom(
        session: TestSpaceSession,
        name: string = `Test Chat ${testRoomChatCount++}`,
    ) {
        await convertDirectChatToRoomChat(session.action(), {
            chatId: this.id,
            name,
        });
    }

    public readonly roomAccess = new TestAccessPolicy({
        get: async () => {
            const {definition} = await getChatDefinition(
                this.context.systemAction(this.space.id),
                this.id,
            );

            if (definition.type !== "Room") {
                throw new FailedPreconditionError("Can only read a room chat\u2019s access policy");
            }

            return definition.accessPolicy;
        },
        set: async (session, accessPolicy) => {
            await updateRoomChatAccessPolicy(session.action(), {
                chatId: this.id,
                accessPolicy,
                notification: null,
            });
        },
    });

    public async updateRoomName(session: TestSpaceSession, name: string) {
        await updateRoomChatName(session.action(), {
            chatId: this.id,
            name,
        });
    }

    public override _getMessage(context: TestSessionActionContext, messageIndex: number) {
        return getChatMessage(context, {
            chatId: this.id,
            messageIndex,
        });
    }

    protected override _createMessage(
        context: TestAccountActionContext,
        {
            parent,
            content,
            fileIds,
            createdTimeZone,
            overrideCreatedTime,
            isStream,
        }: {
            parent: MessageContentPayloadParent | null;
            content: MessageContent;
            fileIds: ReadonlyArray<FileId | FileEntityId>;
            createdTimeZone?: TimeZone;
            overrideCreatedTime?: Date;
            isStream?: boolean;
        },
    ) {
        return sendChatMessage(context, {
            chatId: this.id,
            parent,
            content,
            fileIds,
            isStream,
            createdTimeZone: createdTimeZone ?? defaultTimeZone,
            overrideCreatedTimeForTest: overrideCreatedTime,
        });
    }

    public override _updateMessageContent(
        context: TestSessionActionContext,
        {
            messageIndex,
            contentVersion,
            steps,
        }: {
            messageIndex: number;
            contentVersion: number;
            steps: ReadonlyArray<Step>;
        },
    ) {
        return updateChatMessageContent(context, {
            chatId: this.id,
            messageIndex,
            contentVersion,
            steps,
        });
    }

    public override _deleteMessage(
        context: TestSessionActionContext,
        {messageIndex}: {messageIndex: number},
    ) {
        return deleteChatMessage(context, {
            chatId: this.id,
            messageIndex,
        });
    }

    public override async _putMessageStreamPart(
        context: TestBotActionContext,
        {
            messageIndex,
            partIndex,
            payload,
            overrideCreatedTime,
        }: {
            messageIndex: number;
            partIndex: number;
            payload: MessageStreamPartPayload;
            overrideCreatedTime?: Date;
        },
    ) {
        await putChatMessageStreamPartAndBroadcastEvent(context, {
            chatId: this.id,
            messageIndex,
            partIndex,
            payload,
            overrideCreatedTimeForTest: overrideCreatedTime,
        });
    }

    public override async _completeMessageStream(
        context: TestBotActionContext,
        {messageIndex}: {messageIndex: number},
    ) {
        await completeChatMessageStream(context, {
            chatId: this.id,
            messageIndex,
        });
    }

    public override async _setMessageReaction(
        context: ServerSessionActionContextWithPush,
        {
            messageIndex,
            contentVersion,
            pos,
            reaction,
        }: {
            messageIndex: number;
            contentVersion: number;
            pos: number | "Files";
            reaction: Reaction | "GenericLike";
        },
    ) {
        await setChatMessageReaction(context, {
            chatId: this.id,
            messageIndex,
            contentVersion,
            pos,
            reaction,
        });
    }

    public override async _deleteMessageReaction(
        context: ServerSessionActionContext,
        {
            messageIndex,
            contentVersion,
            pos,
        }: {
            messageIndex: number;
            contentVersion: number;
            pos: number;
        },
    ) {
        await deleteChatMessageReaction(context, {
            chatId: this.id,
            messageIndex,
            contentVersion,
            pos,
        });
    }
}
