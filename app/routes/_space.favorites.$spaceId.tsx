import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix} from "~/client/web/remix/use_update_meta_title.js";
import {SearchFavoritesView} from "~/client/web/search/search_favorites_view.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getAllSearchFavoriteEntities} from "~/server/search/data/index/search_entity_index.js";
import {getSpaceAccountSettings} from "~/server/spaces/get_space_account_settings.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {Schema} from "~/shared/schema/schema.js";
import {SearchFavoriteEntityResultModel} from "~/shared/search/search_entity_result_model.js";

const LoaderSchema = Schema.object({
    shortcutFavoriteEntityCount: Schema.integer,
    results: Schema.array(SearchFavoriteEntityResultModel.schema()),
});

export async function loader({context: unauthenticatedContext, params}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();
    const spaceId = deserializeSpaceIdForLoader(params.spaceId ?? "");

    const [settings, results] = await runAllPromises([
        getSpaceAccountSettings(context, spaceId),
        getAllSearchFavoriteEntities(context, spaceId),
    ]);

    return jsonWithSchema(LoaderSchema, {
        shortcutFavoriteEntityCount: settings.searchShortcutFavoriteEntityCount,
        results,
    });
}

export function meta() {
    return [{title: `Favorites${metaTitlePostfix}`}];
}

export default function FavoritesRoute() {
    const {
        shortcutFavoriteEntityCount: initialShortcutFavoriteEntityCount,
        results: initialResults,
    } = useLoaderDataWithSchema(LoaderSchema);

    return (
        <SearchFavoritesView
            initialShortcutFavoriteEntityCount={initialShortcutFavoriteEntityCount}
            initialResults={initialResults}
        />
    );
}
