import {
    HomeRouteLoaderSchema as LoaderSchema,
    LoaderSchema as SpaceRouteLoaderSchema,
} from "~/app/routes/s.$spaceId.js";
import {Box} from "~/client/design/box.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {SearchResultView, searchResultSideBarWidth} from "~/client/search/search_result_view.js";
import {affinitySearchResultLimit} from "~/client/search/use_search_state.js";
import {
    searchResultViewDefaultMarginX,
    searchResultViewDefaultPaddingX,
} from "~/client/styles/search_shared_styles.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {searchByAffinity} from "~/server/search/data/index/search_entity_index.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

export async function loader({context, params}: LoaderArgs) {
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? "");

    const {results} = await searchByAffinity(
        (await context.actor.authenticate()).actor.authorizeSession(),
        {
            spaceId,
            limit: affinitySearchResultLimit,
        },
    );

    return jsonWithSchema(LoaderSchema, {
        affinityResults: results,
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
            <Box width={searchResultSideBarWidth}>
                <Box paddingX={searchResultViewDefaultMarginX}>
                    <Box
                        fontSize="100"
                        fontStyle="semi-bold"
                        paddingX={searchResultViewDefaultPaddingX}
                    >
                        Suggested
                    </Box>
                </Box>
                {loaderData.affinityResults.map(result => (
                    <SearchResultView key={result.id} result={result} />
                ))}
            </Box>
        </Box>
    );
}
