import {
    AccountId,
    ChatId,
    DocumentId,
    PostId,
    TaskId,
} from "~/shared/id/types/id_types.open_source.js";

// TODO(calebmer, #api): Don't allow bots to be added to `AccessPolicy`'s
// `accountGrantById`. Bots get access to stuff in different ways.
export type BotTokenScope =
    // The bot has access to everything this account has access to.
    //
    // Theoretically, this is the same as `Chat` for a 1:1 chat between just the bot
    // and the account.
    | {readonly type: "Account"; readonly accountId: AccountId}
    // The bot has access to everything that everyone with view access to these
    // entities has access to.
    | {readonly type: "Chat"; readonly chatId: ChatId}
    | {readonly type: "Document"; readonly documentId: DocumentId}
    | {readonly type: "Post"; readonly postId: PostId}
    | {readonly type: "Task"; readonly taskId: TaskId}
    // The bot has access to only things that are shared with everyone in the space. So
    // only what's been shared with `AccessPolicy`'s `defaultGrant`.
    | {readonly type: "Space"};
