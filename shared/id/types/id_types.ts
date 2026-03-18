import type {ChronologicalId} from "~/shared/id/chronological_id.js";
import type {RandomId} from "~/shared/id/id.js";

/**
 * Creates a new ID type with the provided name. TypeScript will error if you
 * try to assign two nominal IDs with different types to each other.
 *
 * There is nothing at runtime to validate whether an ID is of a certain type.
 * It is all a type system level safety mechanism.
 *
 * By being a type system only feature of IDs we keep our bundle size small. If
 * there was some runtime check for nominal IDs we'd either need to ship a
 * manifest of all our ID types to the client or we'd need to generate code
 * like `Schema.spaceId` and `generateSpaceId()` for every ID type.
 */
type NominalRandomIdType<Type extends string> = RandomId & {readonly [type]: Type};
type NominalChronologicalIdType<Type extends string> = ChronologicalId & {readonly [type]: Type};
declare const type: unique symbol;

export type AccountId = NominalRandomIdType<"Account">;
export type AvatarId = NominalChronologicalIdType<"Avatar">;
export type SessionId = NominalRandomIdType<"Session">;
export type BrowserId = NominalRandomIdType<"Browser">;
export type TraceId = NominalRandomIdType<"Trace">;
export type TraceSpanId = NominalRandomIdType<"TraceSpan">;
export type RealmId = NominalRandomIdType<"Realm">;
export type SpaceId = NominalRandomIdType<"Space">;
export type DocumentId = NominalRandomIdType<"Document">;
export type DocumentCommentThreadId = NominalRandomIdType<"DocumentCommentThread">;
export type ChannelId = NominalRandomIdType<"Channel">;
export type PostId = NominalRandomIdType<"Post">;
export type WebSocketConnectionId = NominalRandomIdType<"WebSocketConnection">;
export type WebSocketProcedureRequestId = NominalRandomIdType<"WebSocketProcedureRequest">;
export type ContentEditorClientId = NominalRandomIdType<"ContentEditorClient">;
export type PeekId = NominalRandomIdType<"Peek">;
export type ChatId = NominalRandomIdType<"Chat">;
export type NotificationEventId = NominalChronologicalIdType<"NotificationEvent">;
export type TaskId = NominalRandomIdType<"Task">;
export type TaskCollectionId = NominalRandomIdType<"TaskCollection">;
export type TaskActionTransactionId = NominalRandomIdType<"TaskActionTransaction">;
export type TaskRealtimeQuerySubscriptionId = NominalRandomIdType<"TaskRealtimeQuerySubscription">;
export type TaskRealtimeTaskSubscriptionId = NominalRandomIdType<"TaskRealtimeTaskSubscription">;
export type TaskRealtimeCollectionSubscriptionId =
    NominalRandomIdType<"TaskRealtimeCollectionSubscription">;
export type TaskRealtimeClientId = NominalRandomIdType<"TaskRealtimeClient">;
export type TaskActionTransactionLeaseId = NominalRandomIdType<"TaskActionTransactionLease">;
export type ApnsConnectionId = NominalRandomIdType<"ApnsConnectionId">;
export type FileId = NominalChronologicalIdType<"File">;
export type PostDraftId = NominalChronologicalIdType<"PostDraft">;
export type BotId = NominalRandomIdType<"Bot">;
export type BotWebhookEventId = NominalChronologicalIdType<"BotWebhookEvent">;
export type RpcCallId = NominalRandomIdType<"RpcCall">;
export type CursorCloudAgentId = NominalRandomIdType<"CursorCloudAgent">;
export type DatabaseId = NominalRandomIdType<"Database">;
export type DatabaseMutationId = NominalRandomIdType<"DatabaseMutation">;
export type NotionImportId = NominalRandomIdType<"NotionImport">;
export type DatabaseReactiveQueryId = NominalRandomIdType<"DatabaseReactiveQuery">;
export type DatabaseTableId = NominalChronologicalIdType<"DatabaseTable">;
export type DatabaseFieldId = NominalChronologicalIdType<"DatabaseField">;
export type DatabaseViewId = NominalChronologicalIdType<"DatabaseView">;
