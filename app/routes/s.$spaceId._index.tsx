import {ShouldRevalidateFunction} from "react-router";
import {LoaderSchema as SpaceRouteLoaderSchema} from "~/app/routes/s.$spaceId.js";
import {FeedView} from "~/client/feed/feed_view.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {searchByAffinity} from "~/server/search/data/index/search_entity_index.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import * as searchRpcDefinitions from "~/shared/rpc/search_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";

const LoaderSchema = Schema.object({
    affinitySearch: searchRpcDefinitions.searchByAffinity.outputSchema,
});

// NOTE(calebmer): Remix hot reloading always tries to revalidate the loader on
// hot update unless there's a `shouldRevalidate` function. So if loading is
// slow we flash the loading shimmer which defeats the purpose of hot reloading.
export const shouldRevalidate: ShouldRevalidateFunction = ({
    currentUrl: _currentUrl,
    nextUrl: _nextUrl,
}) => {
    const currentUrl = new URL(_currentUrl);
    const nextUrl = new URL(_nextUrl);

    return nextUrl.toString() !== currentUrl.toString();
};

export async function loader({context: unauthenticatedContext, params}: LoaderArgs) {
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? "");

    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const affinitySearch = await searchByAffinity(context, spaceId);

    return jsonWithSchema(LoaderSchema, {affinitySearch});
}

export const meta = createMetaFunction(LoaderSchema, ({getParentData}) => {
    const spaceRouteData = getParentData("routes/s.$spaceId", SpaceRouteLoaderSchema);

    return [{title: spaceRouteData?.space.name ?? "Home"}];
});

export default function HomeRoute() {
    const {affinitySearch} = useLoaderDataWithSchema(LoaderSchema);

    return <FeedView initialAffinitySearch={affinitySearch} />;
}
