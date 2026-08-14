import type {
    NominalChronologicalIdType,
    NominalRandomIdType,
} from "~/shared/id/types/nominal_id.open_source.js";

export type AccountId = NominalRandomIdType<"Account">;
export type TraceId = NominalRandomIdType<"Trace">;
export type TraceSpanId = NominalRandomIdType<"TraceSpan">;
export type RealmId = NominalRandomIdType<"Realm">;
export type SpaceId = NominalRandomIdType<"Space">;
export type DocumentId = NominalRandomIdType<"Document">;
export type DocumentCommentThreadId = NominalRandomIdType<"DocumentCommentThread">;
export type ChannelId = NominalRandomIdType<"Channel">;
export type PostId = NominalRandomIdType<"Post">;
export type ChatId = NominalRandomIdType<"Chat">;
export type TaskId = NominalRandomIdType<"Task">;
export type TaskCollectionId = NominalRandomIdType<"TaskCollection">;
export type FileId = NominalChronologicalIdType<"File">;
export type BotId = NominalRandomIdType<"Bot">;
export type BotWebhookEventId = NominalChronologicalIdType<"BotWebhookEvent">;
export type DatabaseGroupId = NominalRandomIdType<"DatabaseGroup">;
export type DatabaseMutationId = NominalRandomIdType<"DatabaseMutation">;
export type DatabaseReactiveActionId = NominalRandomIdType<"DatabaseReactiveAction">;
export type DatabaseTableId = NominalRandomIdType<"DatabaseTable">;
export type DatabaseFieldId = NominalRandomIdType<"DatabaseField">;
export type DatabaseViewId = NominalRandomIdType<"DatabaseView">;
export type DatabaseRowId = NominalChronologicalIdType<"DatabaseRow">;
export type SiteId = NominalRandomIdType<"Site">;
