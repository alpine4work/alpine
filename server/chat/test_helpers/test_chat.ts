import {
    deleteChatMessage,
    getOrCreateChatForAccounts,
    sendChatMessage,
    updateChatMessageContent,
} from "~/server/chat/data/chat_actions.js";
import {
    TestContext,
    TestSessionActionContext,
} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestMessageRoomBase} from "~/server/messaging/test_helpers/test_messaging_room_base.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {AccountId, ChatId, FileId} from "~/shared/id/types/id_types.js";
import {MessageContent} from "~/shared/messaging/message_content_schema.js";

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

    protected override _getRoomKey() {
        return this.id;
    }

    protected override _createMessage(
        context: TestSessionActionContext,
        {
            parentMessageIndex,
            content,
            fileIds,
        }: {
            parentMessageIndex: number | null;
            content: MessageContent;
            fileIds: ReadonlyArray<FileId>;
        },
    ) {
        return sendChatMessage(context, {
            chatId: this.id,
            parentMessageIndex,
            content,
            fileIds,
        });
    }

    public override _updateMessageContent(
        context: TestSessionActionContext,
        {messageIndex, content}: {messageIndex: number; content: MessageContent},
    ) {
        return updateChatMessageContent(context, {
            chatId: this.id,
            messageIndex,
            content,
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
}
