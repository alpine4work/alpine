import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {SearchFavoriteAffinityEntitiesView} from "~/client/search/search_favorite_affinity_entities_view.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getAllSearchFavoriteAffinityEntities} from "~/server/search/data/index/search_entity_index.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {SearchFavoriteAffinityEntityResultSchema} from "~/shared/search/search_affinity_entity_result.js";

const LoaderSchema = Schema.object({
    results: Schema.array(SearchFavoriteAffinityEntityResultSchema),
});

export async function loader({context, params}: LoaderArgs) {
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? "");

    const results = await getAllSearchFavoriteAffinityEntities(
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

    return <SearchFavoriteAffinityEntitiesView initialResults={initialResults} />;
}
