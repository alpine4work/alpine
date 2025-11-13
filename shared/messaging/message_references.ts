import {
    ContentReferencedIdsSchema,
    emptyContentReferencedIds,
    getContentReferencedIdsForNode,
    getContentReferencedIdsForNodes,
} from "~/shared/content/content_referenced_ids.js";
import {ContentReferencesSchema} from "~/shared/content/content_references.js";
import {FileIdOrFileEntityIdSchema} from "~/shared/files/file_entity_id.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {addToIterable} from "~/shared/helpers/iterable/add_to_iterable.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {emptySet} from "~/shared/helpers/set/empty_set.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {MessageContentPayloadModelFileSchema} from "~/shared/messaging/message_model.js";
import {MessagePayload, MessageStream} from "~/shared/messaging/message_schema.js";
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
                contentReferencedIds:
                    stream === null
                        ? getContentReferencedIdsForNode(payload.content)
                        : getContentReferencedIdsForNodes(
                              addToIterable(
                                  filterMapIterable(stream.parts, part => {
                                      if (part.payload.type !== "Content") return;
                                      return part.payload.content;
                                  }),
                                  payload.content,
                              ),
                          ),
            };
        }
        default:
            throw exhaustive(payload);
    }
}
