import type {Id} from "~/shared/id/id";

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
export type WebSocketMessageId = NominalIdType<"WebSocketMessage">;
export type ContentEditorClientId = NominalIdType<"ContentEditorClient">;
export type PeekId = NominalIdType<"Peek">;
export type ChatId = NominalIdType<"Chat">;
