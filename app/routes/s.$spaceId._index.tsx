import {ShouldRevalidateFunction} from "react-router";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {LoaderSchema as SpaceRouteLoaderSchema} from "~/app/routes/s.$spaceId.js";
import {FeedView} from "~/client/feed/feed_view.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {getInitialAppRenderSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {feedEntryHeight, postContentViewMinHeightPx} from "~/client/styles/forum_shared_styles.js";
import {getInitialVirtualizedScrollViewRenderedItemCount} from "~/client/virtualized/get_initial_virtualized_scroll_view_rendered_item_count.js";
import {getAndUpdateFeedEntries} from "~/server/feed/feed_actions.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {searchByAffinity} from "~/server/search/data/index/search_entity_index.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {FeedEntryCursorSchema} from "~/shared/feed/feed_entry_cursor.js";
import {FeedEntryModelSchema} from "~/shared/feed/feed_entry_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import * as searchRpcDefinitions from "~/shared/rpc/search_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";

const LoaderSchema = Schema.object({
    affinitySearch: searchRpcDefinitions.searchByAffinity.outputSchema,
    feed: Schema.object({
        endCursor: FeedEntryCursorSchema.nullable(),
        hasMoreEntries: Schema.boolean,
        entries: Schema.array(FeedEntryModelSchema),
    }),
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
    const spaceId = deserializeSpaceIdForLoader(params.spaceId ?? "");

    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const clientInfo = context.loader.getClientInfo();
    const spacingScale = getInitialAppRenderSpacingScale(clientInfo);

    const feedEntryLimit = getInitialVirtualizedScrollViewRenderedItemCount(
        clientInfo,
        Math.min(
            convertRemLengthToPx(feedEntryHeight, spacingScale),
            postContentViewMinHeightPx[spacingScale],
        ),
    );

    const [affinitySearch, feed] = await runAllPromises([
        searchByAffinity(context, spaceId),
        getAndUpdateFeedEntries(context, {
            spaceId,
            limit: feedEntryLimit,
        }),
    ]);

    return jsonWithSchema(LoaderSchema, {affinitySearch, feed});
}

export const meta = createMetaFunction(LoaderSchema, ({getParentData}) => {
    const spaceRouteData = getParentData("routes/s.$spaceId", SpaceRouteLoaderSchema);

    return [{title: spaceRouteData?.space.name ?? "Home"}];
});

export default function HomeRoute() {
    const {affinitySearch, feed} = useLoaderDataWithSchema(LoaderSchema);

    return <FeedView initialAffinitySearch={affinitySearch} initialFeed={feed} />;
}
