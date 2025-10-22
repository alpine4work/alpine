import {ContentReferencedIds} from "~/shared/content/content_referenced_ids.js";
import {AccountId, WebSocketConnectionId} from "~/shared/id/types/id_types.js";
import {MessageContent} from "~/shared/messaging/message_content_schema.js";
import {MessageReferencedIds} from "~/shared/messaging/message_references.js";
import {
    MessageContentPayload,
    MessageContentPayloadContentUpdate,
    MessageStream,
    MessageStreamPartPayload,
} from "~/shared/messaging/message_schema.js";
import {MessagingTypingState} from "~/shared/messaging/messaging_realtime_protocol.js";

/**
 * Same as `MessagingRealtimeEvent` but we haven't loaded any references yet.
 * Each connection will load references independently to make sure we load
 * data with the right permissions.
 */
export type MessagingRealtimeEventStub =
    | {
          readonly type: "NewMessage";
          readonly message: MessagingRealtimeEventStubNewMessage;
          readonly updateOtherTypingState: {
              readonly connectionId: WebSocketConnectionId;
              readonly typingState: MessagingTypingState | null;
          } | null;
      }
    | {
          readonly type: "ChangeMessage";
          readonly change: MessagingRealtimeEventStubChange;
      }
    | {
          readonly type: "UpdateOtherTypingState";
          readonly connectionId: WebSocketConnectionId;
          readonly typingState: MessagingTypingState | null;
      }
    | {
          readonly type: "PutMessageStreamPart";
          readonly index: number;
          readonly partIndex: number;
          readonly part: {
              readonly version: number;
              readonly payload: MessageStreamPartPayload;
          };
          readonly referencedIds: ContentReferencedIds;
      }
    | {
          readonly type: "CompleteMessageStream";
          readonly index: number;
          readonly completedTime: Date;
      };

export type MessagingRealtimeEventStubNewMessage = {
    readonly index: number;
    readonly authorId: AccountId;
    readonly createdTime: Date;
    readonly payload: MessageContentPayload;
    readonly stream: MessageStream | null;
    readonly referencedIds: MessageReferencedIds;
};

/**
 * A `MessageChange` but without loading any references. Specifically the
 * references in `content.references` (for the `UpdateContent` variant).
 */
export type MessagingRealtimeEventStubChange =
    | {
          readonly type: "UpdateContent";
          readonly index: number;
          readonly content: MessageContent;
          readonly contentUpdate: MessageContentPayloadContentUpdate;
      }
    | {
          readonly type: "Delete";
          readonly index: number;
          readonly deletedTime: Date;
      };
