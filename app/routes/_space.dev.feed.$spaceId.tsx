import {ShouldRevalidateFunction} from "react-router";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {LoaderSchema as SpaceRouteLoaderSchema} from "~/app/routes/_space.js";
import {FeedView} from "~/client/web/feed/feed_view.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {createFeedEntryModelIfPossible} from "~/server/feed/feed_actions.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {searchByAffinity} from "~/server/search/data/index/search_entity_index.js";
import {InvalidArgumentError, PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {FeedEntryCursorSchema} from "~/shared/feed/feed_entry_cursor.js";
import {FeedEntryModelSchema} from "~/shared/feed/feed_entry_model.js";
import {FeedEntry, FeedEntrySchema} from "~/shared/feed/feed_entry_schema.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
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

// NOTE(calebmer): Remix hot reloading always tries to revalidate the loader on hot
// update unless there's a `shouldRevalidate` function. So if loading is slow we
// flash the loading shimmer which defeats the purpose of hot reloading.
export const shouldRevalidate: ShouldRevalidateFunction = ({
    currentUrl: _currentUrl,
    nextUrl: _nextUrl,
}) => {
    const currentUrl = new URL(_currentUrl);
    const nextUrl = new URL(_nextUrl);

    return nextUrl.toString() !== currentUrl.toString();
};

export const meta = createMetaFunction(LoaderSchema, ({getParentData}) => {
    const spaceRouteData = getParentData("routes/_space", SpaceRouteLoaderSchema);

    return [{title: spaceRouteData?.space.name ?? "Home"}];
});

export async function loader({request, context: unauthenticatedContext, params}: LoaderArgs) {
    // This route renders the same thing as `/home/:spaceId` but you list the entries
    // using an `entries` search param instead of the user's actual feed. Useful for
    // testing the feed UI without dealing with feed entries being added for every last
    // little action.
    if (process.env.NODE_ENV === "production") {
        throw new PermissionDeniedError(
            "Mock feed route is only for use in development and test environments",
        );
    }

    const spaceId = deserializeSpaceIdForLoader(params.spaceId);

    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const url = new URL(request.url);

    let entries: ReadonlyArray<FeedEntry>;
    try {
        entries = Schema.array(FeedEntrySchema).deserialize(
            JSON.parse(url.searchParams.get("entries") ?? ""),
        );
    } catch (error) {
        throw new InvalidArgumentError(
            "Expected URL search param `entries` to be a valid array of feed entries",
            {cause: error},
        );
    }

    const [affinitySearch, actualEntries] = await runAllPromises([
        searchByAffinity(context, spaceId),
        runAllPromises(
            entries.map(entry => createFeedEntryModelIfPossible(context, spaceId, entry)),
        ),
    ]);

    const filteredEntries = filterMapArray(actualEntries, entry =>
        entry.ok ? entry.value : undefined,
    );

    return jsonWithSchema(LoaderSchema, {
        affinitySearch,
        feed: {
            endCursor: null,
            hasMoreEntries: false,
            entries: filteredEntries,
        },
    });
}

export default function HomeRoute() {
    // This route renders the same thing as `/home/:spaceId` but you list the entries
    // using an `entries` search param instead of the user's actual feed. Useful for
    // testing the feed UI without dealing with feed entries being added for every last
    // little action.
    if (process.env.NODE_ENV === "production") {
        throw new PermissionDeniedError(
            "Mock feed route is only for use in development and test environments",
        );
    }

    const {affinitySearch, feed} = useLoaderDataWithSchema(LoaderSchema);

    return (
        <FeedView
            initialAffinitySearch={affinitySearch}
            initialFeed={feed}
            // Add margin bottom to the dev feed route since it won't have the welcome feed
            // entry to end the view.
            withMarginBottom
        />
    );
}
