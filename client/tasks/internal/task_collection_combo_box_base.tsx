import {isFocusVisible} from "@react-aria/interactions";
import {Node} from "@react-types/shared";
import {MagnifyingGlass, SpinnerGap} from "phosphor-react";
import {ReactNode, RefObject, cloneElement, isValidElement, useMemo, useRef, useState} from "react";
import {AriaListBoxOptions, useListBox, useOption} from "react-aria";
import {ComboBoxState, Item} from "react-stately";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {useDelayLoadingIndicator} from "~/client/design/use_delay_loading_indicator.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {computeStore} from "~/client/helpers/store/compute_store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {useLazyLoadRpc} from "~/client/rpc/use_lazy_load_rpc.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {TaskClientStore} from "~/client/tasks/core/task_client_store.js";
import {TaskCollectionComboBoxCreateCollectionOption} from "~/client/tasks/internal/task_collection_combo_box_create_collection_option.js";
import {TaskCollectionComboBoxInstructionalPlaceholder} from "~/client/tasks/internal/task_collection_combo_box_instructional_placeholder.js";
import {
    TaskCollectionOption,
    taskCollectionOptionSecondaryTextColor,
} from "~/client/tasks/internal/task_collection_option.js";
import {useSearchTaskCollectionsByAffinity} from "~/client/tasks/internal/use_search_task_collections_by_affinity.js";
import {addRemLengths, spacing} from "~/shared/design/spacing.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";
import {searchTaskCollections} from "~/shared/rpc/tasks_rpc_definitions.js";
import {fontSizes, spinAnimationClassName, sprinkles} from "~/shared/styles/styles.js";
import {
    TaskCollectionModelSearchResult,
    taskCollectionSearchResultLimit,
} from "~/shared/tasks/model/task_collection_model_search_result.js";

export type TaskCollectionComboBoxItem =
    | TaskCollectionComboBoxCollectionItem
    | TaskCollectionComboBoxCreateCollectionItem;

export type TaskCollectionComboBoxCollectionItem = {
    readonly type: "Collection";
    readonly key: `Collection:${TaskCollectionId}`;
    readonly collectionResult: TaskCollectionModelSearchResult & {readonly score: number};
};

export type TaskCollectionComboBoxCreateCollectionItem = {
    readonly type: "CreateCollection";
    readonly key: "CreateCollection";
    readonly isInputValueEmpty: boolean;
};

export function renderTaskCollectionComboBoxItem(item: TaskCollectionComboBoxItem) {
    return item.type === "Collection" ? (
        <Item textValue={item.collectionResult.collection.getName()}>
            <TaskCollectionOption collectionResult={item.collectionResult} />
        </Item>
    ) : (
        <Item>Create collection</Item>
    );
}

export function useTaskCollectionComboBoxSearchState({
    store,
    inputValue,
    shouldLoadItems,
    excludeCollectionIds,
}: {
    store: TaskClientStore;
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
        searchTaskCollections,
        !shouldLoadItems || currentlyLoadingInputValue.length === 0
            ? null
            : {
                  spaceId: space.id,
                  nameQuery: currentlyLoadingInputValue,
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
                // If we have no item data available then return null which should render a
                // loading spinner.
                if (!searchByAffinityCollectionResults && !searchCollectionsOutput) {
                    return null;
                }

                const items: Array<TaskCollectionComboBoxItem> = [];

                // Show search results if we have them, otherwise show collections the account
                // has some affinity for.
                if (searchCollectionsOutput) {
                    const searchByAffinityCollectionIndexById = new Map(
                        filterMapArray(searchByAffinityCollectionResults ?? [], (result, index) =>
                            // Only use results from the account's affinity when re-ranking collection
                            // results. Don't re-rank with results from the space's affinity.
                            result.origin === "Account" ? [result.collection.id, index] : null,
                        ),
                    );

                    for (const collectionResult of searchCollectionsOutput.collectionResults) {
                        if (excludeCollectionIds?.has(collectionResult.collection.id)) {
                            continue;
                        }

                        // If the same collection exists in our store and is kept up-to-date in
                        // realtime then let's merge our realtime data with the searched data from the
                        // server. We don't put our searched data in the store because it's not kept
                        // up-to-date in realtime.
                        const collectionEntryStore = store.getCollectionEntryStoreIfExists(
                            collectionResult.collection.id,
                        );

                        const collectionFromStore = collectionEntryStore
                            ? get(collectionEntryStore).collection
                            : null;

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

                    // Re-sort items using affinity scores if we have them. Any searched
                    // collections with equal score will be re-ranked by affinity if it's in the
                    // account's top 30 affinitive collections.
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

                        // If the same collection exists in our store and is kept up-to-date in
                        // realtime then let's merge our realtime data with the searched data from the
                        // server. We don't put our searched data in the store because it's not kept
                        // up-to-date in realtime.
                        const collectionEntryStore = store.getCollectionEntryStoreIfExists(
                            collectionResult.collection.id,
                        );

                        const collection = collectionEntryStore
                            ? get(collectionEntryStore).collection
                            : null;

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
                  nameQuery: searchCollectionsOutput?.input.nameQuery ?? currentlyLoadingInputValue,
              })
            : null,
    };
}

export function TaskCollectionComboBoxListBox({
    comboBoxState,
    listBoxRef,
    listBoxProps: _listBoxProps,
    pendingKey = null,
    autoFocus,
    shouldHideNoResultsIcon,
}: {
    comboBoxState: ComboBoxState<TaskCollectionComboBoxItem>;
    listBoxRef: RefObject<HTMLUListElement>;
    listBoxProps: AriaListBoxOptions<TaskCollectionComboBoxItem>;
    pendingKey?: TaskCollectionComboBoxItem["key"] | null;
    autoFocus?: boolean;
    shouldHideNoResultsIcon?: boolean;
}) {
    const {listBoxProps} = useListBox(
        autoFocus !== undefined && autoFocus !== _listBoxProps.autoFocus
            ? {..._listBoxProps, autoFocus}
            : _listBoxProps,
        comboBoxState,
        listBoxRef,
    );

    const {itemsWithoutCreateCollectionButton, createCollectionButtonItem} = useMemo(() => {
        const itemsWithoutCreateCollectionButton: Array<ReactNode> = [];
        let createCollectionButtonItem: Node<TaskCollectionComboBoxCreateCollectionItem> | null =
            null;

        for (const item of comboBoxState.collection) {
            if (item.value!.type === "CreateCollection") {
                createCollectionButtonItem =
                    item as Node<TaskCollectionComboBoxCreateCollectionItem>;
            } else {
                itemsWithoutCreateCollectionButton.push(
                    <TaskCollectionComboBoxListBoxOption
                        key={item.key}
                        comboBoxState={comboBoxState}
                        item={item}
                        pendingKey={pendingKey}
                    />,
                );
            }
        }

        return {itemsWithoutCreateCollectionButton, createCollectionButtonItem};
    }, [comboBoxState, pendingKey]);

    // If there are 0 items then we're in a loading state. If there's 1 item (the
    // create button) then we either have no search results (input value is
    // non-empty) or we should render our instructional placeholder as the
    // empty state.
    const shouldShowInstructionalPlaceholder =
        comboBoxState.collection.size > 0 &&
        createCollectionButtonItem &&
        // NOTE(calebmer): We need to use `isInputValueEmpty` from items since when
        // react-aria closes a combobox overlay it renders the old set of items. If we
        // use `comboBoxState.inputValue` with the old items of an empty search result
        // then we'll flash the instructional placeholder.
        createCollectionButtonItem.value!.isInputValueEmpty &&
        itemsWithoutCreateCollectionButton.length === 0;

    return (
        <Box flexGrow="1" overflow="hidden" display="flex" flexDirection="column">
            <div
                ref={useScrollbar()}
                className={sprinkles({
                    position: "relative",
                    flexGrow: "1",
                    padding: "1",
                    overflowX: "hidden",
                    overflowY: "auto",
                    display: shouldShowInstructionalPlaceholder ? "none" : undefined,
                })}
            >
                <ul {...listBoxProps} ref={listBoxRef}>
                    {comboBoxState.collection.size === 0 ? (
                        <Box
                            padding="1.5"
                            display="flex"
                            justifyContent="center"
                            alignItems="center"
                            style={{
                                height: addRemLengths(
                                    spacing["1.5"],
                                    fontSizes["75"].lineHeight,
                                    fontSizes["50"].lineHeight,
                                    spacing["1.5"],
                                ),
                            }}
                        >
                            <SpinnerGap className={spinAnimationClassName} size={spacing["4"]} />
                        </Box>
                    ) : itemsWithoutCreateCollectionButton.length === 0 ? (
                        // Mimic the structure of a `<TaskCollectionOption>`
                        <Box padding="1.5" display="flex" alignItems="flex-start" gap="1.5">
                            <Box
                                flexShrink="0"
                                height="4"
                                display="flex"
                                justifyContent="center"
                                alignItems="center"
                            >
                                <Box
                                    width="3"
                                    height="3"
                                    color={taskCollectionOptionSecondaryTextColor}
                                >
                                    {!shouldHideNoResultsIcon && (
                                        <MagnifyingGlass size={spacing["3"]} />
                                    )}
                                </Box>
                            </Box>
                            <Box>
                                <Box
                                    fontStyle="truncate"
                                    color={taskCollectionOptionSecondaryTextColor}
                                >
                                    No results
                                </Box>
                                <Box style={{height: fontSizes["50"].lineHeight}}></Box>
                            </Box>
                        </Box>
                    ) : (
                        itemsWithoutCreateCollectionButton
                    )}
                </ul>
            </div>
            {shouldShowInstructionalPlaceholder ? (
                <TaskCollectionComboBoxInstructionalPlaceholder
                    createCollectionButton={
                        <TaskCollectionComboBoxCreateCollectionOption
                            comboBoxState={comboBoxState}
                            item={createCollectionButtonItem}
                            isQuiet={false}
                            isPending={createCollectionButtonItem.key === pendingKey}
                        />
                    }
                />
            ) : (
                createCollectionButtonItem && (
                    <Box borderTop="grey-10" padding="1">
                        <TaskCollectionComboBoxCreateCollectionOption
                            comboBoxState={comboBoxState}
                            item={createCollectionButtonItem}
                            isQuiet={true}
                            isPending={createCollectionButtonItem.key === pendingKey}
                        />
                    </Box>
                )
            )}
        </Box>
    );
}

function TaskCollectionComboBoxListBoxOption({
    comboBoxState,
    item,
    pendingKey,
}: {
    comboBoxState: ComboBoxState<TaskCollectionComboBoxItem>;
    item: Node<TaskCollectionComboBoxItem>;
    pendingKey: TaskCollectionComboBoxItem["key"] | null;
}) {
    const optionRef = useRef(null);
    const {optionProps, isFocused, isPressed, isHovered} = useOption(
        {
            key: item.key,
            // By default `@react-aria/listbox` allows you to press on the combobox trigger
            // then drag up and release to select an item. This is not a common interaction
            // and not something we want to support (our `<MenuButton>` doesn't support
            // this). Furthermore, on mobile it means if you press an option in a combobox
            // then scroll and release that option will be selected! Instead the scroll
            // should cancel the press. We really want to disable that behavior since it
            // feels broken.
            disallowsDifferentPressOrigin: true,
        },
        comboBoxState,
        optionRef,
    );

    const [wasFocusVisibleWhenFocused, setWasFocusVisibleWhenFocused] = useState(false);
    useLayoutEffectWithoutServerSideWarning(() => {
        if (isFocused) setWasFocusVisibleWhenFocused(isFocusVisible());
    }, [isFocused]);

    return (
        <FocusRing offset="0" isVisible={isFocused && wasFocusVisibleWhenFocused}>
            <li
                {...optionProps}
                ref={optionRef}
                className={sprinkles({
                    width: "full",
                    padding: "1.5",
                    borderRadius: "base",
                    color: "grey-100",
                    backgroundColor: isPressed ? "grey-10" : isHovered ? "grey-5" : undefined,
                })}
            >
                {useMemo(
                    () =>
                        isValidElement(item.rendered)
                            ? cloneElement(item.rendered, {
                                  isPending: item.key === pendingKey,
                              } as any)
                            : item.rendered,
                    [item.key, item.rendered, pendingKey],
                )}
            </li>
        </FocusRing>
    );
}
