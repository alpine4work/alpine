import {
    UNSAFE_RemixContext as RemixContext,
    ShouldRevalidateFunction,
    useSearchParams,
} from "@remix-run/react";
import {HydrationState, createPath} from "@remix-run/router";
import {ServerRoute} from "@remix-run/server-runtime";
import {useContext} from "react";
import {resolvePath} from "react-router";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {Box} from "~/client/design/box.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/initial_app_render.js";
import {InboxMobileView} from "~/client/inbox/inbox_mobile_view.js";
import {InboxView} from "~/client/inbox/inbox_view.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {getInitialAppRenderPlatform, usePlatform} from "~/client/remix/platform_context.js";
import {getDefaultRouteLayoutForPlatform} from "~/client/remix/route_layout_context.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {inboxEntryViewMinHeight} from "~/client/styles/inbox_shared_styles.js";
import {getInitialVirtualizedScrollViewRenderedItemCount} from "~/client/virtualized/get_initial_virtualized_scroll_view_rendered_item_count.js";
import {getInboxEntries} from "~/server/notifications/data/notifications_actions.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {loadInitialPeekDataForServer} from "~/server/remix/load_initial_peek_data_for_server.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {createDynamoGeneralRealtimeIndexQuerySchema} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {decodeBase64, encodeBase64} from "~/shared/helpers/binary/base64.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {flatMapIterable} from "~/shared/helpers/iterable/flat_map_iterable.js";
import {InboxEntryModelSchema, getInboxEntryPath} from "~/shared/notifications/inbox_model.js";
import {Schema} from "~/shared/schema/schema.js";

const LoaderSchema = Schema.object({
    filter: Schema.enum(["New", "Archive"]),
    entriesResult: createDynamoGeneralRealtimeIndexQuerySchema(InboxEntryModelSchema),
    peekData: Schema.object({
        spacePath: Schema.string,
        hydrationData: Schema.object({
            loaderData: Schema.unknown(),
            errors: Schema.unknown(),
        }) as Schema<HydrationState>,
        loadExtraRouteIds: Schema.array(Schema.string),
    }).nullable(),
});

export const meta = createMetaFunction(LoaderSchema, ({}) => [{title: "Inbox"}]);

export async function loader({params, context, request, serverRoutes: routes}: LoaderArgs) {
    const url = new URL(request.url);
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);
    const selectedParam = url.searchParams.get("selected");
    const filter = url.searchParams.get("tab") === "old" ? "Archive" : "New";

    assert(routes.length === 1);
    const rootRoute = routes[0]!;
    assert(rootRoute.id === "root");
    const spaceRoute = assertExists(
        rootRoute.children?.find(route => route.id === "routes/s.$spaceId"),
    );
    const spacePeekRoute = assertExists(
        spaceRoute.children?.find(route => route.id === "routes/s.$spaceId.peek"),
    );
    const peekRoutes: Array<ServerRoute> = [
        {
            id: spaceRoute.id,
            path: spaceRoute.path,
            children: [spacePeekRoute],
            module: {default: () => null},
        },
    ];

    const clientInfo = context.loader.getClientInfo();
    const platform = getInitialAppRenderPlatform(clientInfo);

    const [entriesResult, peekDataFromSelectedParam] = await runAllPromises([
        (async () =>
            getInboxEntries((await context.actor.authenticate()).actor.authorizeSession(), {
                spaceId,
                filter,
                limit: getInitialVirtualizedScrollViewRenderedItemCount(
                    clientInfo,
                    inboxEntryViewMinHeight,
                ),
                afterCursor: null,
            }))(),
        (() => {
            if (platform === "mobile") return null;
            if (!selectedParam) return null;

            const textDecoder = new TextDecoder();
            const selectedSpacePath = resolvePath(
                `/s/${spaceId}/${textDecoder.decode(decodeBase64(selectedParam, "Rfc4648Url"))}`,
            );

            const searchParams = new URLSearchParams(selectedSpacePath.search);
            searchParams.set("inbox", "show");
            selectedSpacePath.search = searchParams.toString();

            return loadInitialPeekDataForServer(context, request, peekRoutes, selectedSpacePath);
        })(),
    ]);

    const peekData =
        platform !== "mobile" && !peekDataFromSelectedParam && entriesResult.items.length > 0
            ? await loadInitialPeekDataForServer(
                  context,
                  request,
                  peekRoutes,
                  resolvePath(
                      getInboxEntryPath(
                          entriesResult.items[0]!.model,
                          getDefaultRouteLayoutForPlatform(platform),
                      ),
                  ),
              )
            : peekDataFromSelectedParam;

    return jsonWithSchema(LoaderSchema, {
        filter,
        entriesResult,
        peekData: peekData
            ? {
                  spacePath: createPath(peekData.spacePath),
                  hydrationData: peekData.hydrationData,
                  loadExtraRouteIds: peekData.loadExtraRouteIds,
              }
            : null,
    });
}

// We don't need to reload when certain search params change.
export const shouldRevalidate: ShouldRevalidateFunction = ({
    currentUrl: _currentUrl,
    nextUrl: _nextUrl,
}) => {
    const currentUrl = new URL(_currentUrl);
    const nextUrl = new URL(_nextUrl);

    nextUrl.searchParams.delete("selected");
    currentUrl.searchParams.delete("selected");

    return nextUrl.toString() !== currentUrl.toString();
};

export default function InboxRouteWrapper() {
    const platform = usePlatform();

    if (platform === "mobile") {
        return <InboxMobileRoute />;
    }

    return <InboxRoute />;
}

function InboxRoute() {
    const remixContext = useContext(RemixContext);
    assert(remixContext, "Expected Remix context");
    const isInitialAppRender = useIsInitialAppRender();
    const {filter, entriesResult, peekData} = useLoaderDataWithSchema(LoaderSchema);
    const [, setSearchParams] = useSearchParams();

    return (
        <Box
            flexGrow="1"
            overflow="hidden"
            position="relative"
            zIndex="20"
            height="full"
            display="flex"
            flexDirection="column"
        >
            <InboxView
                // Remount if the filter changes...
                key={filter}
                filter={filter}
                initialEntriesResult={entriesResult}
                initialPeekData={peekData}
                onPeekChange={peek => {
                    setSearchParams(
                        oldSearchParams => {
                            const newSearchParams = new URLSearchParams(oldSearchParams);

                            if (!peek) {
                                newSearchParams.delete("selected");
                            } else {
                                // base64 encode the initial path to hide the fact that it's a URL.
                                const textEncoder = new TextEncoder();

                                const selectedSearchParam = encodeBase64(
                                    textEncoder.encode(
                                        peek.initialSpacePath
                                            .replace(/^(\/s\/[^/]+\/)/, "")
                                            .replace(/&inbox=show(&|$)/, "$1")
                                            .replace(/\?inbox=show&/, "?")
                                            .replace(/\?inbox=show$/, ""),
                                    ),
                                    "Rfc4648Url",
                                );

                                newSearchParams.set("selected", selectedSearchParam);
                            }

                            return newSearchParams;
                        },
                        {
                            replace: true,
                        },
                    );
                }}
            />
            {isInitialAppRender && peekData && (
                <>
                    {
                        // Preload modules we need to `import()` for rendering the inbox's peek. We
                        // `import()` these modules in our `clientLoader` function. This only works on
                        // initial render, on subsequent renders we'll have a request waterfall.
                        //
                        // Inspired by the Remix `<Scripts>` component.
                        //
                        // https://github.com/remix-run/remix/blob/40a4d7d5e25eb5edc9a622278ab111d881c7c155/packages/remix-react/components.tsx#L895
                        Array.from(
                            new Set(
                                flatMapIterable(peekData.loadExtraRouteIds, routeId => {
                                    const route = remixContext.manifest.routes[routeId]!;
                                    return [...(route.imports ?? []), route.module];
                                }),
                            ),
                            path => (
                                <link key={path} rel="modulepreload" href={path} />
                            ),
                        )
                    }
                    <script
                        // `window.__remixLoadExtraRouteIds` is used in `entry.client.tsx` to stop
                        // hydration until some additional route modules have been imported.
                        dangerouslySetInnerHTML={{
                            __html: `window.__remixLoadExtraRouteIds = window.__remixLoadExtraRouteIds || []; ${peekData.loadExtraRouteIds
                                .map(
                                    routeId =>
                                        `window.__remixLoadExtraRouteIds.push(${JSON.stringify(
                                            routeId,
                                        )})`,
                                )
                                .join("; ")}`,
                        }}
                    />
                </>
            )}
        </Box>
    );
}

function InboxMobileRoute() {
    const isInitialAppRender = useIsInitialAppRender();
    const {filter, entriesResult, peekData} = useLoaderDataWithSchema(LoaderSchema);

    // Double check that we don't load `peekData` when rendering the mobile inbox
    // route.
    if (isInitialAppRender) {
        assert(!peekData);
    }

    return (
        <InboxMobileView
            // Remount if the filter changes...
            key={filter}
            filter={filter}
            initialEntriesResult={entriesResult}
        />
    );
}
