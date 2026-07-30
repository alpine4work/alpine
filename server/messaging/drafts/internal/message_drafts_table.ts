import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {MessageContentSchema} from "~/shared/content/message_content_schema.js";
import {FileIdOrFileEntityIdSchema} from "~/shared/files/file_entity_id.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {MessageDraftSurfaceKey} from "~/shared/messaging/message_draft_surface.js";
import {MessageContentPayloadParentSchema} from "~/shared/messaging/message_schema.js";
import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {Schema} from "~/shared/schema/schema.js";

export const MessageDraftsTable = DynamoTableSchema.new({
    name: "MessageDrafts",
    partitions: [
        {
            name: "SpaceAccount",
            partitionKeyAttributes: {
                accountId: DynamoKeyAttributeSchema.id<AccountId>(),
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
            },
            sortRanges: [
                {
                    name: "Draft",
                    sortKeyAttributes: {
                        surfaceKey: DynamoKeyAttributeSchema.labelString<MessageDraftSurfaceKey>({
                            maxLength: null,
                        }),
                    },
                    attributes: Schema.object({
                        createdTime: Schema.date,
                        content: MessageContentSchema,
                        parent: MessageContentPayloadParentSchema.nullable(),
                        fileIds: Schema.array(FileIdOrFileEntityIdSchema).default(emptyArray),
                        version: HybridLogicalTimeSchema,
                    }),
                },
            ],
        },
    ],
});
