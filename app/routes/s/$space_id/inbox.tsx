import {RemixEntryContext, ShouldReloadFunction} from "@remix-run/react";
import {createPath} from "history";
import {useContext} from "react";
import {Box} from "~/client/design/box";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render";
import {inboxEntryViewMinHeight} from "~/client/inbox/inbox_entry_view";
import {InboxView} from "~/client/inbox/inbox_view";
import {createMetaFunction} from "~/client/remix/create_meta_function";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema";
import {getInitialVirtualizedScrollViewRenderedItemCount} from "~/client/virtualized/virtualized_scroll_view";
import {getInboxEntries} from "~/server/dynamo/notifications_table";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {loadInitialPeekDataForServer} from "~/server/remix/load_initial_peek_data_for_server";
import {LoaderArgs} from "~/server/remix/loader_context";
import {createDynamoGeneralRealtimeIndexQuerySchema} from "~/shared/dynamo/dynamo_general_realtime_types";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {decodeBase64, encodeBase64} from "~/shared/helpers/binary/base64";
import {assert} from "~/shared/helpers/control/assert";
import {flatMapIterable} from "~/shared/helpers/iterable/flat_map_iterable";
import {SpaceId} from "~/shared/id/types/id_types";
import {InboxEntryModelSchema} from "~/shared/notifications/inbox_model";
import {Schema, SchemaType} from "~/shared/schema/schema";

export type LoaderData = SchemaType<typeof LoaderSchema>;

const LoaderSchema = Schema.object({
    filter: Schema.enum(["New", "Archive"]),
    entriesResult: createDynamoGeneralRealtimeIndexQuerySchema(InboxEntryModelSchema),
    peekData: Schema.object({
        path: Schema.string,
        loaderData: Schema.unknown,
        loadExtraRouteIds: Schema.array(Schema.string),
    }).nullable(),
});

export const meta = createMetaFunction(LoaderSchema, ({}) => ({
    title: "Inbox",
}));

export async function loader({params, context, request, serverRoutes}: LoaderArgs) {
    const url = new URL(request.url);
    const spaceId = Schema.id<SpaceId>().deserialize(params.space_id ?? null);
    const selectedParam = url.searchParams.get("selected");
    const filter = url.searchParams.get("tab") === "old" ? "Archive" : "New";

    const [entriesResult, _peekData] = await runAllPromises([
        getInboxEntries(await context.actor.authenticate(), {
            spaceId,
            filter,
            limit: getInitialVirtualizedScrollViewRenderedItemCount(
                context.loader.clientInfo,
                inboxEntryViewMinHeight,
            ),
            afterCursor: null,
        }),
        (() => {
            if (!selectedParam) return null;

            const textDecoder = new TextDecoder();
            const selectedPath = textDecoder.decode(decodeBase64(selectedParam, "Rfc4648Url"));

            return loadInitialPeekDataForServer(context, request, serverRoutes, selectedPath);
        })(),
    ]);

    const peekData =
        !_peekData && entriesResult.items.length > 0
            ? await loadInitialPeekDataForServer(
                  context,
                  request,
                  serverRoutes,
                  entriesResult.items[0]!.model.getPath(),
              )
            : _peekData;

    return jsonWithSchema(LoaderSchema, {
        filter,
        entriesResult,
        peekData: peekData
            ? {
                  path: createPath(peekData.path),
                  loaderData: peekData.loaderData,
                  loadExtraRouteIds: peekData.loadExtraRouteIds,
              }
            : null,
    });
}

// We don't need to reload when certain search params change.
export const unstable_shouldReload: ShouldReloadFunction = ({url: _url, prevUrl: _prevUrl}) => {
    const url = new URL(_url);
    const prevUrl = new URL(_prevUrl);

    url.searchParams.delete("selected");
    prevUrl.searchParams.delete("selected");

    return url.toString() !== prevUrl.toString();
};

export default function InboxRoute() {
    const remixEntryContext = useContext(RemixEntryContext);
    assert(remixEntryContext, "Expected Remix entry context");
    const isInitialAppRender = useIsInitialAppRender();
    const {filter, entriesResult, peekData} = useLoaderDataWithSchema(LoaderSchema);

    return (
        // Strange format to override the `<SpaceLayoutTopBar>` bottom border with a
        // lighter color since our `<InboxView>` has a top bar of its own. We use a
        // lighter border so the two top bars look to be made of the same material.
        <Box
            flexGrow="1"
            overflow="hidden"
            position="relative"
            zIndex="20"
            borderTop="grey-5"
            style={{height: "calc(100% + 1px)", marginTop: -1}}
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
                    const url = new URL(window.location.href);
                    if (!peek) {
                        url.searchParams.delete("selected");
                    } else {
                        // base64 encode the initial path to hide the fact that it's a URL.
                        const textEncoder = new TextEncoder();
                        const selectedSearchParam = encodeBase64(
                            textEncoder.encode(peek.initialPath),
                            "Rfc4648Url",
                        );
                        url.searchParams.set("selected", selectedSearchParam);
                    }

                    // Silently update the URL without telling Remix so our component doesn't
                    // re-render unnecessarily.
                    window.history.replaceState(null, "", url);
                }}
            />
            {isInitialAppRender && peekData && (
                // Inject a script that looks like Remix's `<Scripts>` component to load the
                // route modules for our peek when server rendering.
                //
                // `entry.client.js` looks for this global and will wait for these modules to
                // load before beginning React hydration.
                //
                // https://github.com/remix-run/remix/blob/32337757eba981e5d9705e40ad084d9d5c2d2bf2/packages/remix-react/components.tsx#L804
                //
                // IMPORTANT: This only works on server-side rendering! For client-side
                // navigation we patch the client-side loader function. See the
                // `patchRemixEntryContext()` function.
                <>
                    {Array.from(
                        new Set(
                            flatMapIterable(peekData.loadExtraRouteIds, routeId => {
                                const route = remixEntryContext.manifest.routes[routeId]!;
                                return [...(route.imports ?? []), route.module];
                            }),
                        ),
                        path => (
                            <link key={path} rel="modulepreload" href={path} />
                        ),
                    )}
                    <script
                        type="module"
                        dangerouslySetInnerHTML={{
                            __html: `window.__extraRemixRouteModules = window.__extraRemixRouteModules || [];\n${peekData.loadExtraRouteIds
                                .map(
                                    routeId =>
                                        `window.__extraRemixRouteModules.push({id: ${JSON.stringify(
                                            routeId,
                                        )}, modulePromise: import(${JSON.stringify(
                                            remixEntryContext.manifest.routes[routeId]!.module,
                                        )})});\n`,
                                )
                                .join("")}`,
                        }}
                    />
                </>
            )}
        </Box>
    );
}
