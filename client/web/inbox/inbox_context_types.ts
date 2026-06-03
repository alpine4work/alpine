import {RynamoItem} from "~/shared/dynamo/rynamo_types.js";
import {DocumentCommentThreadId, PostId} from "~/shared/id/types/id_types.js";
import {InboxEntryStatus} from "~/shared/notifications/inbox_entry_status.js";
import {InboxEntryModel} from "~/shared/notifications/inbox_model.js";

export type InboxContextNavigation = {
    readonly filter: InboxEntryStatus;
    readonly nextEntry: RynamoItem<InboxEntryModel> | null;
    readonly previousEntry: RynamoItem<InboxEntryModel> | null;
    readonly selectEntry: (entry: RynamoItem<InboxEntryModel> | null) => Promise<void>;
};

export type InboxContextCreateMessageOptimisticallyRoom =
    | {readonly type: "Post"; readonly postId: PostId}
    | {readonly type: "DocumentCommentThread"; readonly commentThreadId: DocumentCommentThreadId};

export type InboxContext = {
    readonly entry: RynamoItem<InboxEntryModel> | null;
    readonly navigation: InboxContextNavigation | null;
    readonly onCreateMessageOptimistically: (
        promise: Promise<unknown>,
        room?: InboxContextCreateMessageOptimisticallyRoom,
    ) => void;
    readonly onSetMessageReactionOptimistically: (
        promise: Promise<unknown>,
        roomKey: string,
    ) => void;
};
