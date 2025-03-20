import {SearchRouteLoaderSchema as LoaderSchema} from "~/app/routes/s.$spaceId.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {SearchMobileView} from "~/client/search/search_mobile_view.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {searchByAffinity} from "~/server/search/data/index/search_entity_index.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

export function meta() {
    return [{title: `Search${metaTitlePostfix}`}];
}

export async function loader({context, params}: LoaderArgs) {
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? "");

    const {results} = await searchByAffinity(
        (await context.actor.authenticate()).actor.authorizeSession(),
        spaceId,
    );

    return jsonWithSchema(LoaderSchema, {affinityResults: results});
}

export default function SearchRoute() {
    const {affinityResults} = useLoaderDataWithSchema(LoaderSchema);

    return <SearchMobileView affinityResults={affinityResults} />;
}
