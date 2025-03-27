import {LoaderSchema as SpaceRouteLoaderSchema} from "~/app/routes/s.$spaceId.js";
import {Box} from "~/client/design/box.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {SearchAffinityEntityView} from "~/client/search/search_affinity_entity_view.js";
import {searchEntitySideBarWidth} from "~/client/search/search_entity_view.js";
import {
    searchEntityViewDefaultMarginX,
    searchEntityViewDefaultPaddingX,
} from "~/client/styles/search_shared_styles.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {searchByAffinity} from "~/server/search/data/index/search_entity_index.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {SearchAffinityEntityResultSchema} from "~/shared/search/search_affinity_entity_result.js";

const LoaderSchema = Schema.object({
    results: Schema.array(SearchAffinityEntityResultSchema),
});

export async function loader({context, params}: LoaderArgs) {
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? "");

    const {results} = await searchByAffinity(
        (await context.actor.authenticate()).actor.authorizeSession(),
        spaceId,
    );

    return jsonWithSchema(LoaderSchema, {
        results,
    });
}

export const meta = createMetaFunction(LoaderSchema, ({getParentData}) => {
    const spaceRouteData = getParentData("routes/s.$spaceId", SpaceRouteLoaderSchema);

    return [{title: spaceRouteData?.space.name ?? "Home"}];
});

export default function HomeRoute() {
    const loaderData = useLoaderDataWithSchema(LoaderSchema);

    return (
        <Box>
            <Box width={searchEntitySideBarWidth}>
                <Box paddingX={searchEntityViewDefaultMarginX}>
                    <Box
                        fontSize="100"
                        fontStyle="semi-bold"
                        paddingX={searchEntityViewDefaultPaddingX}
                    >
                        Suggested
                    </Box>
                </Box>
                {loaderData.results.map(result => (
                    <SearchAffinityEntityView key={result.id} result={result} />
                ))}
            </Box>
        </Box>
    );
}
