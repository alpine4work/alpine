import {SpaceId} from "~/shared/id/types/id_types.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {Schema} from "~/shared/schema/schema.js";
import {SearchEntityIdSchema} from "~/shared/search/search_entity_id.js";

export const searchByKeyword = defineRpc({
    name: "searchByKeyword",
    input: {
        spaceId: Schema.id<SpaceId>(),
        queryText: Schema.string,
        limit: Schema.integer,
    },
    output: {
        results: Schema.array(
            Schema.object({
                entityId: SearchEntityIdSchema,
                title: Schema.string.nullable(),
                bodyHighlight: Schema.string.nullable(),
            }),
        ),
    },
});
