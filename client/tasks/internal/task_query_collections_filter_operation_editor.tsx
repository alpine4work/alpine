import GraphemeSplitter from "grapheme-splitter";
import {Fragment, ReactNode, Ref, useEffect, useMemo, useRef, useState} from "react";
import {Box} from "~/client/design/box.js";
import {OverlayTriggerButtonRef} from "~/client/design/overlay_trigger_button.js";
import {PrettyNumber} from "~/client/design/pretty_number.js";
import {nullStore} from "~/client/helpers/store/null_store.js";
import {Store} from "~/client/helpers/store/store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {useTaskCollectionComboBoxSearchState} from "~/client/tasks/internal/task_collection_combo_box_base.js";
import {TaskCollectionOption} from "~/client/tasks/internal/task_collection_option.js";
import {TaskQueryFilterEditorMultiSelectComboBox} from "~/client/tasks/internal/task_query_filter_editor_multi_select_combo_box.js";
import {TaskQueryFilterOperatorEditor} from "~/client/tasks/internal/task_query_filter_operator_editor.js";
import {usePreloadAffinitiveTaskCollections} from "~/client/tasks/internal/use_affinitive_task_collections.js";
import {TaskClientCollectionSubscription} from "~/client/tasks/task_client_collection_subscription.js";
import {TaskClientStore, TaskClientStoreCollectionEntry} from "~/client/tasks/task_client_store.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {zeroHybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {iterableFindIndex} from "~/shared/helpers/iterable/iterable_find_index.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";
import {sliceIterable} from "~/shared/helpers/iterable/slice_iterable.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";
import {getTaskCollectionColor} from "~/shared/styles/get_task_collection_color.js";
import {inputPlaceholderStyles} from "~/shared/styles/styles.js";
import {TaskCollectionModelSearchResult} from "~/shared/tasks/model/task_collection_model_search_result.js";
import {TaskQueryCollectionsFilter} from "~/shared/tasks/task_query_filter.js";
import {
    TaskQueryFilterReferences,
    emptyTaskQueryFilterReferences,
    getTaskQueryFilterReferencedIds,
} from "~/shared/tasks/task_query_filter_references.js";
import {TaskAuthorizationStateRegister} from "~/shared/tasks/task_realtime_protocol.js";

/**
 * Get the collection result objects for all the `collectionIds` in our filter
 * operation. We expect that `<TaskQueryCollectionsFilterOperationEditor>` will
 * setup a subscription to all collections referenced by our filters. But it
 * may take a second since the subscriptions are setup in a `useEffect()`. So
 * subscribe to our subscription store and wait for the collection
 * subscriptions to become available.
 *
 * Returns both a `TaskCollectionModelSearchResult` object and a
 * `TaskClientStoreCollectionEntry` object depending on what you're
 * looking for.
 */
export function createTaskQueryCollectionsFilterCollectionResultsStore({
    store,
    filter,
    filterReferences,
}: {
    store: TaskClientStore;
    filter: TaskQueryCollectionsFilter;
    filterReferences: TaskQueryFilterReferences;
}): Store<
    ReadonlyArray<TaskCollectionModelSearchResult & {entry: TaskClientStoreCollectionEntry}>
> {
    const collectionIds =
        filter.operation.type !== "IsEmpty" ? filter.operation.collectionIds : emptyArray;

    return Store.many(
        Array.from(collectionIds, collectionId => {
            const collectionResult = assertExists(
                filterReferences.collectionResultById.get(collectionId),
            );

            return (
                store
                    .getSubscriptionsStore()
                    // Optimization: If subscriptions change but our `collectionEntryStore` stays
                    // the same then we don't want to recompute the full collection results array.
                    .flatMap(
                        ({collectionSubscriptionsById}) =>
                            iterableFirst(
                                collectionSubscriptionsById.get(collectionId)?.keys() ?? [],
                            )?.collectionEntryStore ?? nullStore,
                    )
                    .map(
                        (
                            collectionEntry,
                        ): TaskCollectionModelSearchResult & {
                            entry: TaskClientStoreCollectionEntry;
                        } => {
                            const collection = collectionEntry?.collection
                                ? collectionResult.collection.merge(collectionEntry.collection)
                                : collectionResult.collection;

                            return {
                                ...collectionResult,
                                collection,
                                entry: collectionEntry?.collection
                                    ? collectionEntry
                                    : {
                                          collection,
                                          actions: null,
                                          optimisticState: null,
                                          authorizationState: new TaskAuthorizationStateRegister(
                                              "Authorized",
                                              // Any authorization state change from the server should override us.
                                              zeroHybridLogicalTime,
                                          ),
                                      },
                            };
                        },
                    )
            );
        }),
    );
}

type TaskQueryCollectionsFilterOperationEditorMultiSelectComboBoxItem = {
    readonly key: TaskCollectionId;
    readonly textValue: string;
    readonly collectionResult: TaskCollectionModelSearchResult;
    readonly node: ReactNode;
};

export function TaskQueryCollectionsFilterOperationEditor({
    withMobileLayout,
    store,
    filter,
    filterReferences,
    onFilterChange,
    valueTriggerButtonRef,
}: {
    withMobileLayout: boolean;
    store: TaskClientStore;
    filter: TaskQueryCollectionsFilter;
    filterReferences: TaskQueryFilterReferences;
    onFilterChange: (
        filter: TaskQueryCollectionsFilter,
        options?: {mergeFilterReferences?: TaskQueryFilterReferences},
    ) => void;
    valueTriggerButtonRef: Ref<OverlayTriggerButtonRef> | null;
}) {
    usePreloadAffinitiveTaskCollections();

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
                withMobileLayout={withMobileLayout}
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
                    withMobileLayout={withMobileLayout}
                    inputLabel="Collection"
                    triggerButtonRef={valueTriggerButtonRef}
                    preview={
                        <TaskQueryCollectionsFilterOperationEditorPreview
                            withMobileLayout={withMobileLayout}
                            conjunction={filter.operation.type === "IncludesOneOf" ? "or" : "and"}
                            collectionResults={collectionResults}
                        />
                    }
                    selectedKeys={filter.operation.collectionIds}
                    onSelectedKeysChange={(newCollectionIds, searchedItems) => {
                        assert(filter.operation.type !== "IsEmpty");

                        const addedCollectionIds = new Set(newCollectionIds);
                        for (const accountId of filter.operation.collectionIds)
                            addedCollectionIds.delete(accountId);

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
                        // eslint-disable-next-line react-hooks/rules-of-hooks
                        return useTaskQueryCollectionsFilterOperationEditorSearchedItems({
                            store,
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
    withMobileLayout,
    conjunction,
    collectionResults,
}: {
    withMobileLayout: boolean;
    conjunction: "or" | "and";
    collectionResults: ReadonlyArray<TaskCollectionModelSearchResult>;
}) {
    const previewCollections = useMemo(() => {
        const graphemeSplitter = new GraphemeSplitter();

        return Array.from(sliceIterable(collectionResults, 0, 2), collectionResult => {
            const collectionNameGraphemes = graphemeSplitter.splitGraphemes(
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
                            ? `“${collectionNameGraphemes
                                  .slice(0, collectionNameGraphemeLimit)
                                  .join("")}…”`
                            : collectionResult.collection.getName()}
                    </Box>
                </Fragment>
            );
        });
    }, [collectionResults]);

    if (collectionResults.length === 0) {
        return <Box style={inputPlaceholderStyles}>any collection</Box>;
    } else if (collectionResults.length === 1) {
        return <>{previewCollections[0]}</>;
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
    } else if (withMobileLayout) {
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
    searchInputValue,
    collectionResults,
}: {
    store: TaskClientStore;
    searchInputValue: string;
    collectionResults: ReadonlyArray<TaskCollectionModelSearchResult>;
}) {
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

    const {shouldShowSearchLoadingIndicator, items} = useTaskCollectionComboBoxSearchState({
        store,
        inputValue: searchInputValue,
        shouldLoadItems: true,
    });

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

        if (items) {
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
    }, [initialCollectionIds, initialCollectionResults, items]);

    return items === null
        ? {isLoading: true as const}
        : {isLoading: false as const, shouldShowSearchLoadingIndicator, searchedItems};
}
