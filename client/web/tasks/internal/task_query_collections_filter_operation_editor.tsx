import _Fuse from "fuse.js";
import {Fragment, ReactNode, Ref, useEffect, useMemo, useRef, useState} from "react";
import {Box} from "~/client/web/design/box.js";
import {OverlayTriggerButtonRef} from "~/client/web/design/overlay_trigger_button.js";
import {PrettyNumber} from "~/client/web/design/pretty_number.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {getTaskCollectionColor} from "~/client/web/styles/get_task_collection_color.js";
import {inputPlaceholderStyles} from "~/client/web/styles/styles.js";
import {TaskClientCollectionSubscription} from "~/client/web/tasks/core/task_client_collection_subscription.js";
import {TaskClientStore} from "~/client/web/tasks/core/task_client_store.js";
import {createTaskQueryCollectionsFilterCollectionResultsStore} from "~/client/web/tasks/internal/create_task_query_collections_filter_collection_results_store.js";
import {useTaskCollectionComboBoxSearchState} from "~/client/web/tasks/internal/task_collection_combo_box_search_state.js";
import {TaskCollectionOption} from "~/client/web/tasks/internal/task_collection_option.js";
import {TaskQueryFilterEditorMultiSelectComboBox} from "~/client/web/tasks/internal/task_query_filter_editor_multi_select_combo_box.js";
import {TaskQueryFilterOperatorEditor} from "~/client/web/tasks/internal/task_query_filter_operator_editor.js";
import {TaskQueryReferencesForUrlGrantFilterEditor} from "~/client/web/tasks/internal/task_query_references_for_url_grant_filter_editor.js";
import {usePreloadSearchTaskCollectionsByAffinity} from "~/client/web/tasks/internal/use_search_task_collections_by_affinity.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {iterableFindIndex} from "~/shared/helpers/iterable/iterable_find_index.js";
import {sliceIterable} from "~/shared/helpers/iterable/slice_iterable.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {splitGraphemes} from "~/shared/helpers/string/iterate_graphemes.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";
import {TaskCollectionModelSearchResult} from "~/shared/tasks/model/task_collection_model_search_result.js";
import {TaskQueryCollectionsFilter} from "~/shared/tasks/task_query_filter.js";
import {
    TaskQueryFilterReferences,
    emptyTaskQueryFilterReferences,
    getTaskQueryFilterReferencedIds,
} from "~/shared/tasks/task_query_filter_references.js";

// Node.js ESM interop (#node-esm-migration)
const Fuse = typeof _Fuse === "function" ? _Fuse : _Fuse.default;

type TaskQueryCollectionsFilterOperationEditorMultiSelectComboBoxItem = {
    readonly key: TaskCollectionId;
    readonly textValue: string;
    readonly collectionResult: TaskCollectionModelSearchResult;
    readonly node: ReactNode;
};

export function TaskQueryCollectionsFilterOperationEditor({
    store,
    queryReferencesForUrlGrant,
    filter,
    filterReferences,
    onFilterChange,
    valueTriggerButtonRef,
}: {
    store: TaskClientStore;
    queryReferencesForUrlGrant: TaskQueryReferencesForUrlGrantFilterEditor | null;
    filter: TaskQueryCollectionsFilter;
    filterReferences: TaskQueryFilterReferences;
    onFilterChange: (
        filter: TaskQueryCollectionsFilter,
        options?: {mergeFilterReferences?: TaskQueryFilterReferences},
    ) => void;
    valueTriggerButtonRef: Ref<OverlayTriggerButtonRef> | null;
}) {
    usePreloadSearchTaskCollectionsByAffinity();

    const collectionSubscriptionByIdRef = useRef(
        new Map<TaskCollectionId, TaskClientCollectionSubscription>(),
    );

    // Subscribe to all `TaskCollectionId`s in the filter so they're kept
    // up-to-date in realtime.
    useEffect(() => {
        const addCollectionIds = new Set(getTaskQueryFilterReferencedIds(filter).collectionIds);

        for (const [
            collectionId,
            collectionSubscription,
        ] of collectionSubscriptionByIdRef.current) {
            if (addCollectionIds.delete(collectionId)) continue;

            collectionSubscriptionByIdRef.current.delete(collectionId);
            collectionSubscription.release();
        }

        for (const collectionId of addCollectionIds) {
            collectionSubscriptionByIdRef.current.set(
                collectionId,
                store.createAndRetainCollectionSubscription(collectionId),
            );
        }
    }, [filter, store]);

    // When the component unmounts, release all our collection subscriptions.
    useEffect(() => {
        return () => {
            const oldCollectionSubscriptionById = collectionSubscriptionByIdRef.current;
            collectionSubscriptionByIdRef.current = new Map();

            for (const collectionSubscription of oldCollectionSubscriptionById.values()) {
                collectionSubscription.release();
            }
        };
    }, []);

    const collectionResultsStore = useMemo(
        () =>
            createTaskQueryCollectionsFilterCollectionResultsStore({
                store,
                filter,
                filterReferences,
            }),
        [filter, filterReferences, store],
    );

    const collectionResults = useStore(collectionResultsStore);

    // Simplify operator label if there is just one collection and the operators do
    // the same thing.
    const includesOneOfOperatorLabel =
        filter.operation.type !== "IsEmpty" && filter.operation.collectionIds.size <= 1
            ? "has"
            : "has any of";
    const includesAllOfOperatorLabel =
        filter.operation.type !== "IsEmpty" && filter.operation.collectionIds.size <= 1
            ? "has"
            : "has all of";

    const excludesAllOfOperatorLabel = "has none of";
    const isEmptyOperatorLabel = "is empty";

    return (
        <>
            <TaskQueryFilterOperatorEditor
                operatorLabel={
                    filter.operation.type === "IncludesOneOf"
                        ? includesOneOfOperatorLabel
                        : filter.operation.type === "IncludesAllOf"
                        ? includesAllOfOperatorLabel
                        : filter.operation.type === "ExcludesAllOf"
                        ? excludesAllOfOperatorLabel
                        : isEmptyOperatorLabel
                }
                allOperators={[
                    ...(filter.operation.type !== "IsEmpty" &&
                    filter.operation.collectionIds.size <= 1
                        ? [
                              {
                                  label: includesAllOfOperatorLabel,
                                  isSelected:
                                      filter.operation.type === "IncludesOneOf" ||
                                      filter.operation.type === "IncludesAllOf",
                                  onPress: () => {
                                      onFilterChange({
                                          type: "Collections",
                                          operation: {
                                              type:
                                                  filter.operation.type === "IncludesOneOf"
                                                      ? "IncludesOneOf"
                                                      : "IncludesAllOf",
                                              collectionIds:
                                                  filter.operation.type !== "IsEmpty"
                                                      ? filter.operation.collectionIds
                                                      : new Set(),
                                          },
                                      });
                                  },
                              },
                          ]
                        : [
                              {
                                  label: includesAllOfOperatorLabel,
                                  isSelected: filter.operation.type === "IncludesAllOf",
                                  onPress: () => {
                                      onFilterChange({
                                          type: "Collections",
                                          operation: {
                                              type: "IncludesAllOf",
                                              collectionIds:
                                                  filter.operation.type !== "IsEmpty"
                                                      ? filter.operation.collectionIds
                                                      : new Set(),
                                          },
                                      });
                                  },
                              },
                              {
                                  label: includesOneOfOperatorLabel,
                                  isSelected: filter.operation.type === "IncludesOneOf",
                                  onPress: () => {
                                      onFilterChange({
                                          type: "Collections",
                                          operation: {
                                              type: "IncludesOneOf",
                                              collectionIds:
                                                  filter.operation.type !== "IsEmpty"
                                                      ? filter.operation.collectionIds
                                                      : new Set(),
                                          },
                                      });
                                  },
                              },
                          ]),
                    {
                        label: excludesAllOfOperatorLabel,
                        isSelected: filter.operation.type === "ExcludesAllOf",
                        onPress: () => {
                            onFilterChange({
                                type: "Collections",
                                operation: {
                                    type: "ExcludesAllOf",
                                    collectionIds:
                                        filter.operation.type !== "IsEmpty"
                                            ? filter.operation.collectionIds
                                            : new Set(),
                                },
                            });
                        },
                    },
                    {
                        label: isEmptyOperatorLabel,
                        isSelected: filter.operation.type === "IsEmpty",
                        onPress: () => {
                            onFilterChange({
                                type: "Collections",
                                operation: {type: "IsEmpty"},
                            });
                        },
                    },
                ]}
            />
            {filter.operation.type !== "IsEmpty" && (
                <TaskQueryFilterEditorMultiSelectComboBox<TaskQueryCollectionsFilterOperationEditorMultiSelectComboBoxItem>
                    inputLabel="Collection"
                    triggerButtonRef={valueTriggerButtonRef}
                    preview={
                        <TaskQueryCollectionsFilterOperationEditorPreview
                            conjunction={filter.operation.type === "IncludesOneOf" ? "or" : "and"}
                            collectionResults={collectionResults}
                        />
                    }
                    selectedKeys={filter.operation.collectionIds}
                    onSelectedKeysChange={(newCollectionIds, searchedItems) => {
                        assert(filter.operation.type !== "IsEmpty");

                        const addedCollectionIds = new Set(newCollectionIds);
                        for (const collectionId of filter.operation.collectionIds)
                            addedCollectionIds.delete(collectionId);

                        const addedCollectionResultById = new Map<
                            TaskCollectionId,
                            TaskCollectionModelSearchResult
                        >();

                        for (const item of searchedItems) {
                            if (!addedCollectionIds.delete(item.key)) continue;

                            addedCollectionResultById.set(item.key, item.collectionResult);

                            // Once we've found all the added collections we can exit our loop.
                            if (addedCollectionIds.size === 0) break;
                        }

                        // All `addedCollectionIds` should have been found in `searchedItems`.
                        assert(addedCollectionIds.size === 0);

                        onFilterChange(
                            {
                                type: "Collections",
                                operation: {
                                    type: filter.operation.type,
                                    collectionIds: newCollectionIds,
                                },
                            },
                            {
                                mergeFilterReferences: {
                                    ...emptyTaskQueryFilterReferences,
                                    collectionResultById: addedCollectionResultById,
                                },
                            },
                        );
                    }}
                    useSearchedItems={searchInputValue => {
                        assert(filter.operation.type !== "IsEmpty");

                        // The `useSearchedItems()` callback follows the rules of hooks.
                        // eslint-disable-next-line react-compiler/react-compiler
                        // eslint-disable-next-line react-hooks/rules-of-hooks
                        return useTaskQueryCollectionsFilterOperationEditorSearchedItems({
                            store,
                            queryReferencesForUrlGrant,
                            searchInputValue,
                            collectionResults,
                        });
                    }}
                    optionCheckboxMarginTop="0.5"
                />
            )}
        </>
    );
}

function TaskQueryCollectionsFilterOperationEditorPreview({
    conjunction,
    collectionResults,
}: {
    conjunction: "or" | "and";
    collectionResults: ReadonlyArray<TaskCollectionModelSearchResult>;
}) {
    const routeLayout = useRouteLayout();

    const previewCollections = useMemo(() => {
        return Array.from(
            sliceIterable(collectionResults, 0, routeLayout === "narrow" ? 1 : 2),
            collectionResult => {
                const collectionNameGraphemes = splitGraphemes(
                    collectionResult.collection.getName(),
                );
                const collectionNameGraphemeLimit = 30;

                return (
                    <Fragment key={collectionResult.collection.id}>
                        <Box
                            flexShrink="0"
                            width="1.5"
                            height="1.5"
                            borderRadius="full"
                            backgroundColor={getTaskCollectionColor(
                                collectionResult.collection.getColor(),
                            )}
                        />
                        <Box paddingLeft="1" fontStyle="truncate">
                            {collectionNameGraphemes.length > collectionNameGraphemeLimit
                                ? `${collectionNameGraphemes
                                      .slice(0, collectionNameGraphemeLimit)
                                      .join("")}…`
                                : collectionResult.collection.getName()}
                        </Box>
                    </Fragment>
                );
            },
        );
    }, [collectionResults, routeLayout]);

    if (collectionResults.length === 0) {
        return <Box style={inputPlaceholderStyles}>any collection</Box>;
    } else if (collectionResults.length === 1) {
        return <>{previewCollections[0]}</>;
    } else if (routeLayout === "narrow") {
        return (
            <>
                {previewCollections[0]}
                <Box color="grey-60" paddingX="1" style={{whiteSpace: "nowrap"}}>
                    {conjunction}
                </Box>
                <Box style={{whiteSpace: "nowrap"}}>
                    <PrettyNumber number={collectionResults.length - 1} label="other" />
                </Box>
            </>
        );
    } else if (collectionResults.length === 2) {
        return (
            <>
                {previewCollections[0]}
                <Box paddingLeft="1" paddingRight="1.5" color="grey-60">
                    {conjunction}
                </Box>
                {previewCollections[1]}
            </>
        );
    } else {
        return (
            <>
                {previewCollections[0]}
                <Box color="grey-60" paddingRight="1.5" style={{whiteSpace: "nowrap"}}>
                    ,
                </Box>
                {previewCollections[1]}
                <Box color="grey-60" paddingRight="1" style={{whiteSpace: "nowrap"}}>
                    , {conjunction}
                </Box>
                <Box style={{whiteSpace: "nowrap"}}>
                    <PrettyNumber number={collectionResults.length - 2} label="other" />
                </Box>
            </>
        );
    }
}

function useTaskQueryCollectionsFilterOperationEditorSearchedItems({
    store,
    queryReferencesForUrlGrant,
    searchInputValue,
    collectionResults,
}: {
    store: TaskClientStore;
    queryReferencesForUrlGrant: TaskQueryReferencesForUrlGrantFilterEditor | null;
    searchInputValue: string;
    collectionResults: ReadonlyArray<TaskCollectionModelSearchResult>;
}) {
    const {currentAccount} = useSpaceContext();

    // If `currentAccount` is non-null then `queryReferencesForUrlGrant` should be
    // null. Since the list of accounts we show the user should be loaded from the
    // server. Not from query references.
    if (currentAccount !== null) {
        assert(queryReferencesForUrlGrant === null);
    }

    // Remember the initial collections for a search. If the user selects a new
    // collection then we don't want to immediately move that collection to the top
    // of the search list and re-execute a search RPC with new
    // `excludeCollectionIds`.
    const [initialCollectionResults] = useState(collectionResults);

    const initialCollectionIds = useMemo(
        () =>
            new Set(
                initialCollectionResults.map(collectionResult => collectionResult.collection.id),
            ),
        [initialCollectionResults],
    );

    const shouldLoadItems = !!currentAccount;

    const {shouldShowSearchLoadingIndicator, items} = useTaskCollectionComboBoxSearchState({
        store,
        inputValue: searchInputValue,
        shouldLoadItems,
    });

    const collectionsForUrlGrant = useMemo(() => {
        if (queryReferencesForUrlGrant === null) return null;

        return Array.from(queryReferencesForUrlGrant.collectionById.values()).sort(
            (collection1, collection2) =>
                defaultCompareStrings(collection1.getName(), collection2.getName()),
        );
    }, [queryReferencesForUrlGrant]);

    const collectionsForUrlGrantSearchIndex = useMemo(
        () =>
            collectionsForUrlGrant !== null
                ? new Fuse(collectionsForUrlGrant, {
                      keys: [{name: "name", getFn: item => item.getName()}],
                  })
                : null,
        [collectionsForUrlGrant],
    );

    const searchedCollectionsForUrlGrant = useMemo(
        () =>
            searchInputValue === ""
                ? collectionsForUrlGrant
                : collectionsForUrlGrantSearchIndex
                      ?.search(searchInputValue)
                      .map(({item}) => item) ?? null,
        [collectionsForUrlGrant, collectionsForUrlGrantSearchIndex, searchInputValue],
    );

    const searchedItems = useMemo(() => {
        // We use `items.nameQuery` instead of `searchInputValue` in case we are
        // showing the user stale `items` while we load fresh items.
        const isEmptyNameQuery = !items || items.nameQuery.length === 0;

        const searchedItems: Array<TaskQueryCollectionsFilterOperationEditorMultiSelectComboBoxItem> =
            [];

        // If the user is not searching, add the selected collections results to
        // the top.
        if (isEmptyNameQuery) {
            for (const collectionResult of initialCollectionResults) {
                searchedItems.push({
                    key: collectionResult.collection.id,
                    textValue: collectionResult.collection.getName(),
                    collectionResult,
                    node: <TaskCollectionOption collectionResult={collectionResult} />,
                });
            }
        }

        if (searchedCollectionsForUrlGrant) {
            for (const collection of searchedCollectionsForUrlGrant) {
                // If the collection also appears in our search items, ignore it since it's
                // already been included in our selected items above.
                if (isEmptyNameQuery && initialCollectionIds.has(collection.id)) {
                    continue;
                }

                // The collection model doesn't include the open task count. To avoid an
                // additional network request we decide to not show task count collections
                // referenced by the query for a URL granted view.
                const collectionResult: TaskCollectionModelSearchResult = {
                    openTaskCount: 0,
                    lastTaskAddedTime: null,
                    collection,
                };

                searchedItems.push({
                    key: collection.id,
                    textValue: collection.getName(),
                    collectionResult,
                    node: (
                        <TaskCollectionOption collectionResult={collectionResult} withoutSnippet />
                    ),
                });
            }
        } else if (items) {
            for (const item of items) {
                // Can't create a collection from our filter editor
                if (item.type === "CreateCollection") continue;

                // If the collection also appears in our search items, ignore it since it's
                // already been included in our selected items above.
                if (
                    isEmptyNameQuery &&
                    initialCollectionIds.has(item.collectionResult.collection.id)
                ) {
                    continue;
                }

                searchedItems.push({
                    key: item.collectionResult.collection.id,
                    textValue: item.collectionResult.collection.getName(),
                    collectionResult: item.collectionResult,
                    node: <TaskCollectionOption collectionResult={item.collectionResult} />,
                });
            }
        }

        // If we are searching then sort collections in our initial collection set at
        // the top of the search. Regardless of their natural position in the search.
        if (!isEmptyNameQuery) {
            searchedItems.sort((item1, item2) => {
                const isInitialCollection1 = initialCollectionIds.has(
                    item1.collectionResult.collection.id,
                );
                const isInitialCollection2 = initialCollectionIds.has(
                    item2.collectionResult.collection.id,
                );

                if (isInitialCollection1 && isInitialCollection2) {
                    return (
                        iterableFindIndex(
                            initialCollectionIds,
                            collectionId => collectionId === item1.collectionResult.collection.id,
                        ) -
                        iterableFindIndex(
                            initialCollectionIds,
                            collectionId => collectionId === item2.collectionResult.collection.id,
                        )
                    );
                }
                if (isInitialCollection1) return -1;
                if (isInitialCollection2) return 1;

                return 0;
            });
        }

        return searchedItems;
    }, [initialCollectionIds, initialCollectionResults, items, searchedCollectionsForUrlGrant]);

    return shouldLoadItems && items === null
        ? {isLoading: true as const}
        : {isLoading: false as const, shouldShowSearchLoadingIndicator, searchedItems};
}
