import {
    ContentReferencedIds,
    ContentReferencedIdsSchema,
    MutableContentReferencedIds,
    collectContentReferencedIdsInto,
    emptyContentReferencedIds,
} from "~/shared/content/content_referenced_ids.js";
import {ContentReferencesSchema} from "~/shared/content/content_references.js";
import {FileIdOrFileEntityIdSchema} from "~/shared/files/file_entity_id.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {emptySet} from "~/shared/helpers/set/empty_set.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {MessageContentPayloadModelFileSchema} from "~/shared/messaging/message_model.js";
import {
    MessageContentPayload,
    MessageExperimentalApproval,
    MessagePayload,
    MessageStream,
    MessageStreamPartPayload,
    MessageStreamToolCallPartPayloadCall,
} from "~/shared/messaging/message_schema.js";
import {visitProsemirrorNode} from "~/shared/prosemirror/prosemirror_visitor.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
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
        case "ExperimentalApprovals": {
            collectContentReferencesForApprovals(referencedIds, part.approvals);
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
    collectContentReferencedIdsInto(referencedIds, visitor => {
        visitProsemirrorNode(toolCall.content, visitor);
    });
}

function collectContentReferencesForApprovals(
    referencedIds: MutableContentReferencedIds,
    approvals: ReadonlyArray<MessageExperimentalApproval>,
) {
    for (const approval of approvals) {
        collectContentReferencedIdsInto(referencedIds, visitor => {
            visitProsemirrorNode(approval.summary, visitor);
        });

        // Reference the decider so clients can render who made the decision.
        const decisionValue = approval.decision.value;
        if (decisionValue !== undefined) {
            referencedIds.accountIds.add(decisionValue.decider.account.id);
        }

        for (const option of approval.decision.schema.options) {
            switch (option.type) {
                case "Approved":
                case "Rejected": {
                    break;
                }
                case "ApprovedForSession": {
                    const optionSummary = option.summary;
                    if (!optionSummary) break;

                    collectContentReferencedIdsInto(referencedIds, visitor => {
                        visitProsemirrorNode(optionSummary, visitor);
                    });

                    break;
                }
                default: {
                    throw exhaustive(option);
                }
            }
        }
    }
}
