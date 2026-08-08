import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix} from "~/client/web/remix/use_update_meta_title.js";
import {SearchMobileView} from "~/client/web/search/search_mobile_view.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {searchByAffinity} from "~/server/search/data/index/search_entity_index.js";
import * as searchRpcDefinitions from "~/shared/rpc/search_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.open_source.js";

const LoaderSchema = Schema.object({
    affinitySearch: searchRpcDefinitions.searchByAffinity.outputSchema,
});

export function meta() {
    return [{title: `Search${metaTitlePostfix}`}];
}

export async function loader({context, params}: LoaderArgs) {
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);

    const affinitySearch = await searchByAffinity(
        (await context.actor.authenticate()).actor.authorizeSession(),
        spaceId,
    );

    return jsonWithSchema(LoaderSchema, {affinitySearch});
}

export default function SearchRoute() {
    const {affinitySearch} = useLoaderDataWithSchema(LoaderSchema);

    return <SearchMobileView initialAffinitySearch={affinitySearch} />;
}
