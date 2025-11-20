import {ApiMentionPathObject, parseApiMentionPath} from "~/shared/api/parse_api_path.js";
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
            break;
        }
        case "ToolCall": {
            switch (part.call.type) {
                case "Read": {
                    const targetObject = parseApiMentionPath(part.call.targetPath);
                    if (targetObject.type === "Account") {
                        referencedIds.accountIds.add(targetObject.id);
                    } else {
                        referencedIds.searchEntityIds.add(
                            intoSearchEntityIdFromApiMentionPathObject(targetObject),
                        );
                    }
                    break;
                }
                case "Search": {
                    // Search tool calls are plain text for now.
                    break;
                }
                default:
            }
            break;
        }
        default:
            throw exhaustive(part);
    }
}

function intoSearchEntityIdFromApiMentionPathObject(
    pathObject: Exclude<ApiMentionPathObject, {readonly type: "Account"}>,
): SearchMentionEntityId {
    switch (pathObject.type) {
        case "Channel":
            return `Channel:${pathObject.id}`;
        case "Document":
            return `Document:${pathObject.id}`;
        case "Post":
            return `Post:${pathObject.id}`;
        case "Task":
            return `Task:${pathObject.id}`;
        case "TaskCollection":
            return `TaskCollection:${pathObject.id}`;
        default:
            throw exhaustive(pathObject);
    }
}
