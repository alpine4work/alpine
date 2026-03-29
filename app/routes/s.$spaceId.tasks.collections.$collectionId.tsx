import {useEffect, useState} from "react";
import {ShouldRevalidateFunction, useParams} from "react-router";
import {useSearchParams} from "react-router-dom";
import {createHeadMetaForTaskCollection} from "~/app/helpers/create_head_meta.js";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {useTaskClientStoreSearchAffinityManager} from "~/app/helpers/use_task_client_store_search_entity_affinity_manager.js";
import {Box} from "~/client/web/design/box.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {getCurrentDate} from "~/client/web/remix/use_current_time_rounded_to_hour.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {metaTitlePostfix, useUpdateMetaTitle} from "~/client/web/remix/use_update_meta_title.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {newTaskCollectionNamePlaceholder} from "~/client/web/styles/tasks_shared_styles.js";
import {useTaskStoreLoaderDataWithoutRetaining} from "~/client/web/tasks/core/task_realtime_client_context_provider.js";
import {getTaskGridViewLoadQueryLimit} from "~/client/web/tasks/get_task_grid_view_load_query_limit.js";
import {TaskCollectionMobileEditor} from "~/client/web/tasks/task_collection_mobile_editor.js";
import {TaskCollectionView} from "~/client/web/tasks/task_collection_view.js";
import {TaskGridViewDndContext} from "~/client/web/tasks/task_grid_view_dnd_context.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {isSearchFavoriteEntity} from "~/server/search/data/table/search_entity_actions.js";
import {authorizeSpaceAccessIfPossible} from "~/server/spaces/authorize_space_access.js";
import {getTaskQueryFilterReferences} from "~/server/tasks/data/get_task_query_filter_references.js";
import {
    authorizeTaskCollectionAccess,
    commitTaskActionTransaction,
} from "~/server/tasks/data/task_table.js";
import {isThemeColor} from "~/shared/design/core/theme_colors.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {generateId, isId} from "~/shared/id/id.js";
import {BrowserId, TaskCollectionId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskGridViewExpansionStateSchema} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {
    deserializeTaskQueryFiltersSearchParam,
    serializeTaskQueryFiltersSearchParam,
} from "~/shared/tasks/task_query_filter.js";
import {
    TaskQueryFilterReferencesSchema,
    emptyTaskQueryFilterReferences,
} from "~/shared/tasks/task_query_filter_references.js";
import {
    TaskQueryNormalizedFilters,
    normalizeTaskQueryFilters,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {
    TaskQueryNormalizedSort,
    normalizeTaskQuerySorts,
} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    deserializeTaskQuerySortsSearchParam,
    serializeTaskQuerySortsSearchParam,
} from "~/shared/tasks/task_query_sort.js";
import {TaskRealtimeUpdateEventBackfillCollection} from "~/shared/tasks/task_realtime_protocol.js";

const LoaderSchema = Schema.object({
    key: Schema.id(),
    collectionState: Schema.union({
        NotExists: Schema.object({
            type: Schema.value("NotExists"),
        }),
        Exists: Schema.object({
            type: Schema.value("Exists"),
            initialMetaTitleText: Schema.string,
            initialGridViewExpansionState: TaskGridViewExpansionStateSchema,
            initialIsFavorite: Schema.boolean,
            hasUrlGrant: Schema.boolean,
        }),
    }),
    filterReferences: TaskQueryFilterReferencesSchema,
});

export const meta = createMetaFunction(LoaderSchema, ({data: {collectionState}}) =>
    createHeadMetaForTaskCollection(
        collectionState.type === "Exists"
            ? {
                  name: collectionState.initialMetaTitleText,
                  hasUrlGrant: collectionState.hasUrlGrant,
              }
            : null,
    ),
);

export async function loader({request, params, context: unauthenticatedContext}: LoaderArgs) {
    const context = await unauthenticatedContext.actor.authenticate();

    const url = new URL(request.url);
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);
    const collectionId = Schema.id<TaskCollectionId>().deserialize(params.collectionId ?? null);

    const createSearchParam = url.searchParams.get("create");

    if (createSearchParam === "") {
        return jsonWithSchema(LoaderSchema, {
            key: generateId(),
            collectionState: {
                type: "NotExists",
            },
            filterReferences: emptyTaskQueryFilterReferences,
        });
    }

    if (createSearchParam !== null) {
        const sessionContext = context.actor.authorizeSession();

        try {
            const colorSearchParam = url.searchParams.get("color");

            const currentTime = Date.now();

            const actions: Array<TaskAction> = [
                {
                    type: "UpdateCollection",
                    time: [currentTime, 0],
                    collectionId,
                    collectionAction: {
                        type: "Create",
                        creatorId: sessionContext.actor.getAccountId(),
                        name: createSearchParam,
                        accessPolicy: {
                            type: "Local",
                            accountGrantById: new Map([
                                [
                                    sessionContext.actor.getAccountId(),
                                    {level: "Manage", generation: 0},
                                ],
                            ]),
                            defaultGrant: null,
                            urlGrant: null,
                        },
                    },
                },
            ];

            if (colorSearchParam && isThemeColor(colorSearchParam)) {
                actions.push({
                    type: "UpdateCollection",
                    time: [currentTime, 1],
                    collectionId,
                    collectionAction: {
                        type: "UpdateColor",
                        color: colorSearchParam,
                    },
                });
            }

            await commitTaskActionTransaction(sessionContext, spaceId, actions);
        } catch (error) {
            if (!(error instanceof FailedPreconditionError)) {
                throw error;
            }

            // If there was an issue creating our collection, it might be because the
            // collection already exists. Attempt to authorize, if that fails we believe the
            // issue was with collection creation.
            //
            // This check makes this `GET` endpoint idempotent. You can hit the endpoint
            // multiple times and if our collection is already created we'll noop.
            try {
                await authorizeTaskCollectionAccess(sessionContext, collectionId, "View", null);
            } catch {
                throw error;
            }
        }
    }

    const filtersString = url.searchParams.get("filter");
    const filters = filtersString ? deserializeTaskQueryFiltersSearchParam(filtersString) : [];
    const sortsString = url.searchParams.get("sort");
    const sorts = sortsString ? deserializeTaskQuerySortsSearchParam(sortsString) : [];

    // Always include collection filter in our list of filters.
    const normalizedFiltersResult = normalizeTaskQueryFilters(
        [
            {
                type: "Collections",
                operation: {type: "IncludesOneOf", collectionIds: new Set([collectionId])},
            },
            ...filters,
        ],
        {
            currentDate: getCurrentDate(context),
            currentAccountId:
                context.actor.type === "Session" ? context.actor.getAccountId() : null,
        },
    );

    // If no filters or sorts have been explicitly set then the user can manually sort
    // by collection position.
    //
    // If the collection view is filtered we automatically apply a sort since there can
    // be some weirdness creating a task and expecting it to be in one place when
    // there's no filter but instead it goes to another place.
    const normalizedSorts: ReadonlyArray<TaskQueryNormalizedSort> =
        filters.length === 0 && sorts.length === 0
            ? [
                  {
                      type: "CollectionPosition",
                      direction: "Ascending",
                      missing: "Last",
                      collectionId,
                  },
                  {
                      type: "CreatedTime",
                      direction: "Ascending",
                      missing: "Last",
                  },
              ]
            : normalizeTaskQuerySorts(sorts);

    const [filterReferences, loadQueryResult, isFavorite] = await runAllPromises([
        getTaskQueryFilterReferences(context, spaceId, filters),
        (async () => {
            if (normalizedFiltersResult.type !== "Possible") {
                const result = await context.tasks.loadQueries(spaceId, {
                    queries: [],
                    taskIds: [],
                    collectionIds: [collectionId],
                });

                return Object.assign(result, {input: {query: null}});
            }

            const isSpaceAccessAuthorized = (await authorizeSpaceAccessIfPossible(context, spaceId))
                .ok;

            const {normalizedFilters} = normalizedFiltersResult;

            const query: {
                limit: number;
                filters: TaskQueryNormalizedFilters;
                sorts: ReadonlyArray<TaskQueryNormalizedSort>;
                shouldLoadGridViewExpandedChildTasksForBrowserId?: BrowserId;
            } = {
                limit: getTaskGridViewLoadQueryLimit(context.loader.getClientInfo()),
                filters: normalizedFilters,
                sorts: normalizedSorts,

                // We only store grid view expansion state for accounts with space access.
                shouldLoadGridViewExpandedChildTasksForBrowserId: isSpaceAccessAuthorized
                    ? context.loader.getBrowserId()
                    : undefined,
            };

            const result = await context.tasks.loadQueries(spaceId, {
                queries: [query],
                taskIds: [],
                collectionIds: [collectionId],
            });

            return Object.assign(result, {input: {query}});
        })(),
        isSearchFavoriteEntity(context, {
            spaceId,
            entityId: `TaskCollection:${collectionId}`,
        }),
    ]);

    const backfillCollection = loadQueryResult?.updateEvent.backfillCollections.find(
        (
            backfillCollection,
        ): backfillCollection is TaskRealtimeUpdateEventBackfillCollection & {type: "Authorized"} =>
            backfillCollection.type === "Authorized" &&
            backfillCollection.collection.id === collectionId,
    );
    const queryOutput = loadQueryResult.input.query
        ? assertExists(loadQueryResult.queries[0])
        : null;

    const accessPolicy = backfillCollection?.collection.getAccessPolicy() ?? {
        type: "Local",
        accountGrantById: new Map(),
        defaultGrant: null,
        urlGrant: null,
    };

    let hasUrlGrant: boolean;
    switch (accessPolicy.type) {
        case "Local": {
            hasUrlGrant = accessPolicy.urlGrant !== null;
            break;
        }
        case "Site": {
            const siteResult = loadQueryResult?.updateEvent.referencedSites.find(
                site => site.ok && site.value.id === accessPolicy.siteId,
            );
            assert(siteResult && siteResult.ok);

            hasUrlGrant = assertExists(siteResult.value).initialData.accessPolicy.urlGrant !== null;
            break;
        }
        default:
            throw exhaustive(accessPolicy);
    }

    return jsonWithSchema(
        LoaderSchema,
        {
            key: generateId(),
            collectionState: {
                type: "Exists",
                initialMetaTitleText: backfillCollection?.collection.getName() ?? "",
                initialGridViewExpansionState: queryOutput?.gridViewExpansionState ?? null,
                initialIsFavorite: isFavorite,
                hasUrlGrant,
            },
            filterReferences,
        },
        {
            taskStoreLoaderData: loadQueryResult
                ? {
                      queries: [
                          ...(loadQueryResult.input.query
                              ? [
                                    {
                                        limit: loadQueryResult.input.query.limit,
                                        filters: loadQueryResult.input.query.filters,
                                        sorts: loadQueryResult.input.query.sorts,
                                        loadedState: assertExists(queryOutput).loadedState,
                                    },
                                ]
                              : []),
                          ...loadQueryResult.extraQueries,
                      ],
                      taskIds: [],
                      collectionIds: [collectionId],
                      updateEvent: loadQueryResult.updateEvent,
                  }
                : undefined,
        },
    );
}

export const shouldRevalidate: ShouldRevalidateFunction = ({
    currentUrl: _currentUrl,
    nextUrl: _nextUrl,
    defaultShouldRevalidate,
}) => {
    const currentUrl = new URL(_currentUrl);
    const nextUrl = new URL(_nextUrl);

    // When switching from `/s/:spaceId/tasks/collections/:collectionId?create` to
    // `/s/:spaceId/tasks/collections/:collectionId?create=:collectionName` we need to
    // revalidate since the server will actually create the collection.
    if (currentUrl.searchParams.get("create") !== "") currentUrl.searchParams.delete("create");
    if (nextUrl.searchParams.get("create") !== "") nextUrl.searchParams.delete("create");

    currentUrl.searchParams.delete("focus");
    nextUrl.searchParams.delete("focus");

    currentUrl.searchParams.delete("color");
    nextUrl.searchParams.delete("color");

    // The client removes the `create` and `focus` search params. Don't revalidate when
    // the client does this.
    if (currentUrl.toString() === nextUrl.toString()) {
        return false;
    }

    return defaultShouldRevalidate;
};

export default function TaskCollectionRoute() {
    const {key} = useLoaderDataWithSchema(LoaderSchema);

    return (
        <TaskCollectionRouteInner
            // Completely re-mount the route when we get new data from the server.
            key={key}
        />
    );
}

function TaskCollectionRouteInner() {
    const platform = usePlatform();
    const navigate = useNavigate();
    const {space} = useSpaceContext();

    const [searchParams, setSearchParams] = useSearchParams();
    const {collectionId} = useParams();
    assert(collectionId && isId<TaskCollectionId>(collectionId));

    const {collectionState, filterReferences: initialFilterReferences} =
        useLoaderDataWithSchema(LoaderSchema);
    const {
        store,
        queries: [initialQuery],
        collectionSubscriptions: [collectionSubscription],
    } = useTaskStoreLoaderDataWithoutRetaining();

    // Retain our `collectionSubscription` so it isn't destroyed while we're using it.
    // But we don't retain `initialQuery`! Instead `initialQuery` is retained by
    // `<TaskCollectionView>`. That way when the query changes we can release the query
    // and retain a new one.
    useEffect(() => {
        collectionSubscription?.retain();

        return () => {
            // Release after a microtask in case the component is re-rendering which will
            // synchronously call `retain()` again.
            scheduleMicrotask(() => {
                collectionSubscription?.release();
            });
        };
    }, [collectionSubscription]);

    const [initialFilters] = useState(() => {
        const filtersString = searchParams.get("filter");
        if (!filtersString) return [];
        return deserializeTaskQueryFiltersSearchParam(filtersString);
    });

    const [initialSorts] = useState(() => {
        const sortsString = searchParams.get("sort");
        if (!sortsString) return [];
        return deserializeTaskQuerySortsSearchParam(sortsString);
    });

    const [shouldInitiallyFocusEditableCollectionName] = useState(() => {
        const focusString = searchParams.get("focus");
        if (!focusString) return true;
        return focusString !== "none";
    });

    // Remove the `create` search param if we have a subscription to an existing
    // collection.
    useEffect(() => {
        if (!collectionSubscription) return;

        if (searchParams.has("create") || searchParams.has("focus") || searchParams.has("color")) {
            setSearchParams(
                oldSearchParams => {
                    const newSearchParams = new URLSearchParams(oldSearchParams);
                    newSearchParams.delete("create");
                    newSearchParams.delete("focus");
                    newSearchParams.delete("color");
                    return newSearchParams;
                },
                {replace: true},
            );
        }
    }, [collectionSubscription, searchParams, setSearchParams]);

    const updateMetaTitle = useUpdateMetaTitle();

    // Update our document's title whenever the collection's title changes.
    useEffect(() => {
        const update = () => {
            const collectionEntryStore = collectionSubscription?.collectionEntryStore;

            updateMetaTitle(
                `${
                    collectionEntryStore
                        ? (collectionEntryStore.getSnapshot().collection?.getName() ?? "")
                        : newTaskCollectionNamePlaceholder
                }${metaTitlePostfix}`,
            );
        };

        update();
        return collectionSubscription?.collectionEntryStore.subscribe(update);
    }, [collectionSubscription?.collectionEntryStore, updateMetaTitle]);

    const affinityManager = useTaskClientStoreSearchAffinityManager(
        collectionSubscription ? `TaskCollection:${collectionSubscription.collectionId}` : null,
    );

    const createCollection = useEvent(async (name: string) => {
        const newSearchParams = new URLSearchParams(searchParams);
        newSearchParams.set("create", name);

        await navigate(
            `/s/${store.spaceId}/tasks/collections/${collectionId}?${newSearchParams.toString()}`,
            {replace: true},
        );
    });

    if (platform === "mobile" && !collectionSubscription) {
        return (
            <Box flexGrow="1" overflow="hidden" position="relative" height="full">
                <TaskCollectionMobileEditor
                    title="Create collection"
                    initiallyFocusName={true}
                    getInitialName={() => ""}
                    getInitialColor={() => null}
                    onCloseWithAnimation={({hasSaved}) => {
                        if (hasSaved) return;
                        void navigate(-1);
                    }}
                    onSave={async ({name, color, hasColorChanged}) => {
                        const newSearchParams = new URLSearchParams(searchParams);
                        newSearchParams.set("create", name);

                        if (hasColorChanged && color !== null) {
                            newSearchParams.set("color", color);
                        }

                        await navigate(
                            `/s/${
                                space.id
                            }/tasks/collections/${collectionId}?${newSearchParams.toString()}`,
                            {
                                replace: true,
                                // In our native mobile app, we want to call
                                // `NativeMobileBridge.navigation.replaceWithPushAnimation()` to run the native
                                // push animation while replacing in the history stack.
                                state: NativeMobileBridge ? {withPushAnimation: true} : undefined,
                            },
                        );
                    }}
                />
            </Box>
        );
    }

    return (
        <TaskGridViewDndContext store={store}>
            <TaskCollectionView
                store={store}
                collectionId={collectionId}
                collectionSubscription={collectionSubscription ?? null}
                shouldInitiallyFocusEditableCollectionName={
                    shouldInitiallyFocusEditableCollectionName
                }
                affinityManager={affinityManager}
                initialQuery={
                    initialQuery && collectionState.type === "Exists"
                        ? {
                              query: initialQuery,
                              initialGridViewExpansionState:
                                  collectionState.initialGridViewExpansionState,
                          }
                        : null
                }
                initialFilters={initialFilters}
                initialFilterReferences={initialFilterReferences}
                initialSorts={initialSorts}
                onFiltersChange={filters => {
                    const newSearchParams = new URLSearchParams(searchParams);

                    if (filters.length === 0) {
                        newSearchParams.delete("filter");
                    } else {
                        newSearchParams.set(
                            "filter",
                            serializeTaskQueryFiltersSearchParam(filters),
                        );
                    }

                    setSearchParams(newSearchParams, {
                        replace: true,
                        // Don't revalidate when updating search params from here. We can't use the stable
                        // `shouldRevalidate` route function because if the user navigates to a new URL we
                        // want to load new data and re-render the route.
                        unstable_shouldRevalidate: false,
                    });
                }}
                onSortsChange={sorts => {
                    const newSearchParams = new URLSearchParams(searchParams);

                    if (sorts.length === 0) {
                        newSearchParams.delete("sort");
                    } else {
                        newSearchParams.set("sort", serializeTaskQuerySortsSearchParam(sorts));
                    }

                    setSearchParams(newSearchParams, {
                        replace: true,
                        // Don't revalidate when updating search params from here. We can't use the stable
                        // `shouldRevalidate` route function because if the user navigates to a new URL we
                        // want to load new data and re-render the route.
                        unstable_shouldRevalidate: false,
                    });
                }}
                initialIsFavorite={
                    collectionState.type === "Exists" ? collectionState.initialIsFavorite : false
                }
                createCollection={createCollection}
            />
        </TaskGridViewDndContext>
    );
}
