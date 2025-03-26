import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {SearchAffinityFavoritesView} from "~/client/search/search_affinity_favorites_view.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getAllSearchAffinityFavorites} from "~/server/search/data/index/search_entity_index.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {OrderKeySchema} from "~/shared/schema/helpers/order_key_schema.js";
import {Schema} from "~/shared/schema/schema.js";
import {SearchAffinityIdSchema} from "~/shared/search/search_affinity_id.js";
import {SearchResultMediaSchema} from "~/shared/search/search_result.js";

const LoaderSchema = Schema.object({
    results: Schema.array(
        Schema.object({
            id: SearchAffinityIdSchema,
            title: Schema.string.nullable(),
            media: SearchResultMediaSchema.nullable(),
            orderKey: OrderKeySchema,
        }),
    ),
});

export async function loader({context, params}: LoaderArgs) {
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? "");

    const results = await getAllSearchAffinityFavorites(
        (await context.actor.authenticate()).actor.authorizeSession(),
        spaceId,
    );

    return jsonWithSchema(LoaderSchema, {results});
}

export function meta() {
    return [{title: `Favorites${metaTitlePostfix}`}];
}

export default function FavoritesRoute() {
    const {results: initialResults} = useLoaderDataWithSchema(LoaderSchema);

    return <SearchAffinityFavoritesView initialResults={initialResults} />;
}
