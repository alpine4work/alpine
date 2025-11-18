import {ContentReferencedIdsSchema} from "~/shared/content/content_referenced_ids.js";
import {ContentReferencesSchema} from "~/shared/content/content_references.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {Schema} from "~/shared/schema/schema.js";

export const getContentReferencesWithoutFiles = defineRpc({
    name: "getContentReferencesWithoutFiles",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        referencedIds: ContentReferencedIdsSchema,
    },
    output: {
        references: ContentReferencesSchema,
    },
});
