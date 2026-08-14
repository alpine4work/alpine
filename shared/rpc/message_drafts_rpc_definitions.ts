import {MessageContentSchema} from "~/shared/content/message_content_schema.js";
import {FileIdOrFileEntityIdSchema} from "~/shared/files/file_entity_id.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {
    MessageDraftFileSchema,
    MessageDraftWithFilesSchema,
} from "~/shared/messaging/message_draft_schema.js";
import {MessageDraftSurfaceSchema} from "~/shared/messaging/message_draft_surface.js";
import {MessageContentPayloadParentSchema} from "~/shared/messaging/message_schema.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {Schema} from "~/shared/schema/schema.js";

export const getMessageDraft = defineRpc({
    name: "getMessageDraft",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        surface: MessageDraftSurfaceSchema,
        withAttachFileBeforeCreateMessage: Schema.boolean.optional(),
    },
    output: {
        draft: MessageDraftWithFilesSchema,
    },
});

export const getMessageDraftFiles = defineRpc({
    name: "getMessageDraftFiles",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        surface: MessageDraftSurfaceSchema,
        fileIds: Schema.array(FileIdOrFileEntityIdSchema),
        withAttachFileBeforeCreateMessage: Schema.boolean.optional(),
    },
    output: {
        files: Schema.array(MessageDraftFileSchema),
    },
});

export const updateMessageDraft = defineRpc({
    name: "updateMessageDraft",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        surface: MessageDraftSurfaceSchema,
        content: MessageContentSchema,
        parent: MessageContentPayloadParentSchema.nullable(),
        fileIds: Schema.array(FileIdOrFileEntityIdSchema),
        version: HybridLogicalTimeSchema,
    },
    output: {},
});

export const clearMessageDraft = defineRpc({
    name: "clearMessageDraft",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        surface: MessageDraftSurfaceSchema,
    },
    output: {},
});
