import type {
    NominalChronologicalIdType,
    NominalRandomIdType,
} from "~/shared/id/types/nominal_id.open_source.js";

export type AvatarId = NominalChronologicalIdType<"Avatar">;
export type SessionId = NominalRandomIdType<"Session">;
export type BrowserId = NominalRandomIdType<"Browser">;
export type ContentEditorClientId = NominalRandomIdType<"ContentEditorClient">;
export type WebSocketConnectionId = NominalRandomIdType<"WebSocketConnection">;
export type WebSocketProcedureRequestId = NominalRandomIdType<"WebSocketProcedureRequest">;
export type PeekId = NominalRandomIdType<"Peek">;
export type NotificationEventId = NominalChronologicalIdType<"NotificationEvent">;
export type TaskActionTransactionId = NominalRandomIdType<"TaskActionTransaction">;
export type TaskActivityEntryId = NominalChronologicalIdType<"TaskActivityEntry">;
export type TaskActivityWindowChunkId = NominalChronologicalIdType<"TaskActivityWindowChunk">;
export type TaskRealtimeQuerySubscriptionId = NominalRandomIdType<"TaskRealtimeQuerySubscription">;
export type TaskRealtimeTaskSubscriptionId = NominalRandomIdType<"TaskRealtimeTaskSubscription">;
export type TaskRealtimeCollectionSubscriptionId =
    NominalRandomIdType<"TaskRealtimeCollectionSubscription">;
export type TaskRealtimeClientId = NominalRandomIdType<"TaskRealtimeClient">;
export type TaskActionTransactionLeaseId = NominalRandomIdType<"TaskActionTransactionLease">;
export type ApnsConnectionId = NominalRandomIdType<"ApnsConnectionId">;
export type PostDraftId = NominalChronologicalIdType<"PostDraft">;
export type RpcCallId = NominalRandomIdType<"RpcCall">;
export type CursorCloudAgentId = NominalRandomIdType<"CursorCloudAgent">;
export type NotionImportId = NominalRandomIdType<"NotionImport">;
export type SiteTopBarId = NominalRandomIdType<"SiteTopBar">;
export type SiteSideBarId = NominalRandomIdType<"SiteSideBar">;
export type SiteSideBarSectionId = NominalRandomIdType<"SiteSideBarSection">;
