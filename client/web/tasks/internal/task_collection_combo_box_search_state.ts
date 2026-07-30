import {useMemo, useState} from "react";
import {useDelayLoadingIndicator} from "~/client/web/design/use_delay_loading_indicator.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {useLazyLoadRpc} from "~/client/web/rpc/use_lazy_load_rpc.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {TaskClientReadonlyStore} from "~/client/web/tasks/core/task_client_store.js";
import {TaskCollectionComboBoxItem} from "~/client/web/tasks/internal/task_collection_combo_box_item.js";
import {useSearchTaskCollectionsByAffinity} from "~/client/web/tasks/internal/use_search_task_collections_by_affinity.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";
import {searchTaskCollectionsByKeywords} from "~/shared/rpc/search_rpc_definitions.js";
import {computeStore} from "~/shared/store/compute_store.js";
import {taskCollectionSearchResultLimit} from "~/shared/tasks/model/task_collection_model_search_result.js";

export function useTaskCollectionComboBoxSearchState({
    store,
    inputValue,
    shouldLoadItems,
    excludeCollectionIds,
}: {
    store: TaskClientReadonlyStore;
    inputValue: string;
    shouldLoadItems: boolean;
    excludeCollectionIds?: ReadonlySet<TaskCollectionId>;
}) {
    const {space} = useSpaceContext();

    const searchByAffinityCollectionResults = useSearchTaskCollectionsByAffinity({
        isDisabled: !shouldLoadItems,
    });

    const trimmedInputValue = inputValue.trim();
    const isInputValueEmpty = trimmedInputValue.length === 0;

    const [currentlyLoadingInputValue, setCurrentlyLoadingInputValue] =
        useState<string>(trimmedInputValue);

    const {isLoading: originalIsSearchLoading, output: searchCollectionsOutput} = useLazyLoadRpc(
        searchTaskCollectionsByKeywords,
        !shouldLoadItems || currentlyLoadingInputValue.length === 0
            ? null
            : {
                  spaceId: space.id,
                  queryText: currentlyLoadingInputValue,
                  limit: taskCollectionSearchResultLimit,
              },
        {keepPreviousData: true},
    );

    let isSearchLoading = originalIsSearchLoading;

    // Throttle our RPC call. Only load search results for a new input value after
    // we're done loading search results for the old one.
    if (!isSearchLoading && currentlyLoadingInputValue !== trimmedInputValue) {
        isSearchLoading = true;
        setCurrentlyLoadingInputValue(trimmedInputValue);
    }

    const shouldShowSearchLoadingIndicator = useDelayLoadingIndicator(isSearchLoading);

    const items: ReadonlyArray<TaskCollectionComboBoxItem> | null = useStore(
        useMemo(() => {
            return computeStore(get => {
                // If we have no item data available then return null which should render a loading
                // spinner.
                if (!searchByAffinityCollectionResults && !searchCollectionsOutput) {
                    return null;
                }

                const items: Array<TaskCollectionComboBoxItem> = [];

                // Show search results if we have them, otherwise show collections the account has
                // some affinity for.
                if (searchCollectionsOutput) {
                    const searchByAffinityCollectionIndexById = new Map(
                        filterMapArray(searchByAffinityCollectionResults ?? [], (result, index) =>
                            // Only use results from the account's affinity when re-ranking collection results.
                            // Don't re-rank with results from the space's affinity.
                            result.origin === "Account" ? [result.collection.id, index] : undefined,
                        ),
                    );

                    for (const collectionResult of searchCollectionsOutput.results) {
                        if (excludeCollectionIds?.has(collectionResult.collection.id)) {
                            continue;
                        }

                        // If the same collection exists in our store and is kept up-to-date in realtime
                        // then let's merge our realtime data with the searched data from the server. We
                        // don't put our searched data in the store because it's not kept up-to-date in
                        // realtime.
                        const collectionEntryStore = store.getCollectionEntryStore(
                            collectionResult.collection.id,
                        );

                        const collectionFromStore = get(collectionEntryStore)?.collection;

                        items.push({
                            type: "Collection",
                            key: `Collection:${collectionResult.collection.id}`,
                            collectionResult: {
                                ...collectionResult,
                                collection: collectionFromStore
                                    ? collectionResult.collection.merge(collectionFromStore)
                                    : collectionResult.collection,
                            },
                        });
                    }

                    // Re-sort items using affinity scores if we have them. Any searched collections
                    // with equal score will be re-ranked by affinity if it's in the account's top 30
                    // affinitive collections.
                    items.sort((item1, item2) => {
                        if (item1.type !== "Collection" && item2.type !== "Collection") return 0;
                        if (item1.type !== "Collection") return 1;
                        if (item2.type !== "Collection") return -1;

                        if (item1.collectionResult.score !== item2.collectionResult.score) {
                            return item2.collectionResult.score - item1.collectionResult.score;
                        }

                        const searchByAffinityCollectionIndex1 =
                            searchByAffinityCollectionIndexById.get(
                                item1.collectionResult.collection.id,
                            );
                        const searchByAffinityCollectionIndex2 =
                            searchByAffinityCollectionIndexById.get(
                                item2.collectionResult.collection.id,
                            );

                        if (
                            searchByAffinityCollectionIndex1 === undefined &&
                            searchByAffinityCollectionIndex2 === undefined
                        ) {
                            return 0;
                        }
                        if (searchByAffinityCollectionIndex1 === undefined) return 1;
                        if (searchByAffinityCollectionIndex2 === undefined) return -1;
                        return searchByAffinityCollectionIndex2 - searchByAffinityCollectionIndex1;
                    });
                } else if (searchByAffinityCollectionResults) {
                    for (const collectionResult of searchByAffinityCollectionResults) {
                        if (excludeCollectionIds?.has(collectionResult.collection.id)) {
                            continue;
                        }

                        // If the same collection exists in our store and is kept up-to-date in realtime
                        // then let's merge our realtime data with the searched data from the server. We
                        // don't put our searched data in the store because it's not kept up-to-date in
                        // realtime.
                        const collectionEntryStore = store.getCollectionEntryStore(
                            collectionResult.collection.id,
                        );

                        const collection = get(collectionEntryStore)?.collection;

                        items.push({
                            type: "Collection",
                            key: `Collection:${collectionResult.collection.id}`,
                            collectionResult: {
                                ...collectionResult,
                                collection: collection
                                    ? collectionResult.collection.merge(collection)
                                    : collectionResult.collection,
                                score: 0,
                            },
                        });
                    }
                }

                items.push({
                    type: "CreateCollection",
                    key: "CreateCollection",
                    isInputValueEmpty,
                });

                return items;
            });
        }, [
            searchByAffinityCollectionResults,
            excludeCollectionIds,
            isInputValueEmpty,
            searchCollectionsOutput,
            store,
        ]),
    );

    return {
        shouldShowSearchLoadingIndicator,
        items: items
            ? Object.assign(items, {
                  nameQuery: searchCollectionsOutput?.input.queryText ?? currentlyLoadingInputValue,
              })
            : null,
    };
}
