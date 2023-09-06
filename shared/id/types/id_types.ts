import type {Id} from "~/shared/id/id.js";

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
type NominalIdType<Type extends string> = Id & {readonly [type]: Type};
declare const type: unique symbol;

export type AccountId = NominalIdType<"Account">;
export type SessionId = NominalIdType<"Session">;
export type BrowserId = NominalIdType<"Browser">;
export type TraceId = NominalIdType<"Trace">;
export type TraceSpanId = NominalIdType<"TraceSpan">;
export type RealmId = NominalIdType<"Realm">;
export type SpaceId = NominalIdType<"Space">;
export type DocumentId = NominalIdType<"Document">;
export type DocumentCommentThreadId = NominalIdType<"DocumentCommentThread">;
export type ChannelId = NominalIdType<"Channel">;
export type PostId = NominalIdType<"Post">;
export type WebSocketConnectionId = NominalIdType<"WebSocketConnection">;
export type WebSocketProcedureRequestId = NominalIdType<"WebSocketProcedureRequest">;
export type ContentEditorClientId = NominalIdType<"ContentEditorClient">;
export type PeekId = NominalIdType<"Peek">;
export type ChatId = NominalIdType<"Chat">;
export type NotificationEventId = NominalIdType<"NotificationEvent">;
export type TaskId = NominalIdType<"Task">;
export type TaskCollectionId = NominalIdType<"TaskCollection">;
export type TaskActionTransactionId = NominalIdType<"TaskActionTransaction">;
export type TaskRealtimeQuerySubscriptionId = NominalIdType<"TaskRealtimeQuerySubscription">;
export type TaskClientQueryId = NominalIdType<"TaskClientQuery">;

/**
 * A specialization of `AccountId`. We use this as the type of a
 * `ContentMention`'s `accountId`.
 *
 * The `AccountId` type is compatible with `ContentMentionAccountId` but the
 * `ContentMentionAccountId` is not compatible with `AccountId`! That's because
 * you need to be careful you don't assume the `accountId` in a mention exists.
 * A mention could be copied across spaces (where one space has access to an
 * account and another doesn't) or environments (where one environment has an
 * account and the other doesn't at all).
 *
 * You shouldn't use `getAccount()` with `ContentMentionAccountId` since it
 * throws on these edge cases. Instead you should use `getAccountIfExists()`.
 * Leveraging TypeScript like this we can make calling `getAccount()` with
 * `ContentMentionAccountId` an error but allow the type with
 * `getAccountIfExists()`.
 */
export type ContentMentionAccountId = NominalIdType<"ContentMentionAccount"> | AccountId;

// NOCOMMIT: All local task ids should be deleted when we build a real
// backend implementation for tasks.
export type LocalTaskId = NominalIdType<"LocalTask">;
export type LocalTaskCollectionId = TaskCollectionId;
