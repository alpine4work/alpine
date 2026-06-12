import {parseApiMentionTarget} from "~/shared/api/specification/parse_api_path.js";
import {ApiMentionTarget} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {
    ContentReferencedIds,
    ContentReferencedIdsSchema,
    MutableContentReferencedIds,
    collectContentReferencedIdsInto,
    emptyContentReferencedIds,
} from "~/shared/content/content_referenced_ids.js";
import {ContentReferencesSchema} from "~/shared/content/content_references.js";
import {FileIdOrFileEntityIdSchema} from "~/shared/files/file_entity_id.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {emptySet} from "~/shared/helpers/set/empty_set.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {MessageContentPayloadModelFileSchema} from "~/shared/messaging/message_model.js";
import {
    MessageContentPayload,
    MessagePayload,
    MessageStream,
    MessageStreamPartPayload,
    MessageStreamToolCallPartPayloadCall,
} from "~/shared/messaging/message_schema.js";
import {visitProsemirrorNode} from "~/shared/prosemirror/prosemirror_visitor.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {SearchMentionEntityId} from "~/shared/search/search_entity_id.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export type MessageReferencedIds = SchemaType<typeof MessageReferencedIdsSchema>;

export const MessageReferencedIdsSchema = Schema.object({
    authorId: Schema.id<AccountId>().nullable(),
    contentReferencedIds: ContentReferencedIdsSchema,
    fileIds: Schema.set(FileIdOrFileEntityIdSchema),
});

export type MessageReferences = SchemaType<typeof MessageReferencesSchema>;

export const MessageReferencesSchema = Schema.object({
    author: AccountModel.schema.nullable(),
    contentReferences: ContentReferencesSchema,
    fileById: Schema.map(FileIdOrFileEntityIdSchema, MessageContentPayloadModelFileSchema),
});

export function getMessageReferencedIds({
    authorId,
    payload,
    stream,
}: {
    authorId: AccountId;
    payload: MessagePayload;
    stream: MessageStream | null;
}): MessageReferencedIds {
    switch (payload.type) {
        case "Deleted": {
            assert(stream === null);

            return {
                authorId,
                fileIds: emptySet,
                contentReferencedIds: emptyContentReferencedIds,
            };
        }
        case "Content": {
            return {
                authorId,
                fileIds: new Set(payload.fileIds),
                contentReferencedIds: getMessageContentPayloadReferencedIds(payload, stream),
            };
        }
        default:
            throw exhaustive(payload);
    }
}

export function getMessageContentPayloadReferencedIds(
    payload: MessageContentPayload,
    stream: MessageStream | null,
): ContentReferencedIds {
    const referencedIds: MutableContentReferencedIds = {
        accountIds: new Set(),
        searchEntityIds: new Set(),
        fileIds: new Set(),
        fileEntityIds: new Set(),
    };

    collectContentReferencedIdsInto(referencedIds, visitor => {
        visitProsemirrorNode(payload.content, visitor);
    });

    if (stream) {
        for (const part of stream.parts) {
            collectContentReferencedIdsForStreamPartInto(referencedIds, part.payload);
        }
    }

    return referencedIds;
}

export function collectContentReferencedIdsForStreamPart(part: MessageStreamPartPayload) {
    const referencedIds: MutableContentReferencedIds = {
        accountIds: new Set(),
        searchEntityIds: new Set(),
        fileIds: new Set(),
        fileEntityIds: new Set(),
    };

    collectContentReferencedIdsForStreamPartInto(referencedIds, part);

    return referencedIds;
}

function collectContentReferencedIdsForStreamPartInto(
    referencedIds: MutableContentReferencedIds,
    part: MessageStreamPartPayload,
) {
    switch (part.type) {
        case "Content":
        case "Reasoning": {
            collectContentReferencedIdsInto(referencedIds, visitor => {
                visitProsemirrorNode(part.content, visitor);
            });
            return;
        }
        case "ToolCall": {
            collectContentReferencesForToolCall(referencedIds, part.call);
            return;
        }
        default:
            throw exhaustive(part);
    }
}

function collectContentReferencesForToolCall(
    referencedIds: MutableContentReferencedIds,
    toolCall: MessageStreamToolCallPartPayloadCall,
) {
    switch (toolCall.type) {
        case "Read": {
            const targetObject = parseApiMentionTarget(toolCall.targetPath);
            if (targetObject.type === "Account") {
                referencedIds.accountIds.add(targetObject.id);
            } else {
                referencedIds.searchEntityIds.add(
                    intoSearchEntityIdFromApiMentionTarget(targetObject),
                );
            }
            return;
        }
        case "Create": {
            referencedIds.searchEntityIds.add(
                intoSearchEntityIdFromApiMentionTarget(toolCall.target),
            );
            return;
        }
        case "Search": {
            // Search tool calls are plain text for now.
            return;
        }
        default: {
            throw exhaustive(toolCall);
        }
    }
}

function intoSearchEntityIdFromApiMentionTarget(
    target: Exclude<ApiMentionTarget, {readonly type: "Account"}>,
): SearchMentionEntityId {
    switch (target.type) {
        case "Channel":
            return `Channel:${target.id}`;
        case "Chat":
            return `Chat:${target.id}`;
        case "Document":
            return `Document:${target.id}`;
        case "Post":
            return `Post:${target.id}`;
        case "Task":
            return `Task:${target.id}`;
        case "TaskCollection":
            return `TaskCollection:${target.id}`;
        case "Site":
            return `Site:${target.id}`;
        default:
            throw exhaustive(target);
    }
}
