import {isFocusVisible} from "@react-aria/interactions";
import {Node} from "@react-types/shared";
import {CaretDown, MagnifyingGlass, SpinnerGap} from "phosphor-react";
import {
    ReactNode,
    RefObject,
    cloneElement,
    isValidElement,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    AriaListBoxOptions,
    mergeProps,
    useComboBox,
    useHover,
    useListBox,
    useOption,
} from "react-aria";
import {ComboBoxState, Item, useSingleSelectListState} from "react-stately";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {OverlayTriggerButton} from "~/client/design/overlay_trigger_button.js";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants.js";
import {useShowToast} from "~/client/design/toast.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {computeStore} from "~/client/helpers/store/compute_store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useLazyLoadLoadRpc} from "~/client/rpc/use_lazy_load_rpc.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    TaskCollectionOption,
    taskCollectionOptionSecondaryTextColor,
} from "~/client/tasks/internal/task_collection_option.js";
import {TaskCollectionsListBoxCreateCollectionOption} from "~/client/tasks/internal/task_collections_list_box_create_collection_option.js";
import {TaskCollectionsListBoxInstructionalPlaceholder} from "~/client/tasks/internal/task_collections_list_box_instructional_placeholder.js";
import {
    useAffinitiveTaskCollections,
    usePreloadAffinitiveTaskCollections,
} from "~/client/tasks/internal/use_affinitive_task_collections.js";
import {useTaskClientStore} from "~/client/tasks/task_realtime_client_context_provider.js";
import {addRemLengths, spacing} from "~/shared/design/spacing.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {generateId, isId} from "~/shared/id/id.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";
import {searchTaskCollections} from "~/shared/rpc/tasks_rpc_definitions.js";
import {
    fontSizes,
    greyElevated2ClassName,
    spinAnimationClassName,
    sprinkles,
} from "~/shared/styles/styles.js";
import {
    TaskCollectionModelSearchResult,
    taskCollectionSearchResultLimit,
} from "~/shared/tasks/model/task_collection_model_search_result.js";

export function TaskLayoutTopBarCollectionsButton({
    isCollectionsTabActive,
}: {
    isCollectionsTabActive: boolean;
}) {
    // Preload task collections the account has an affinity for in case they open
    // the collections dropdown.
    usePreloadAffinitiveTaskCollections();

    return (
        <OverlayTriggerButton
            aria-haspopup="listbox"
            overlay={({onCloseWithoutAnimation}) => (
                <Box
                    className={greyElevated2ClassName}
                    width="64"
                    maxHeight="96"
                    overflow="hidden"
                    borderRadius="md"
                    backgroundColor="grey-0"
                    boxShadow="elevation-20"
                    display="flex"
                    flexDirection="column"
                >
                    <TaskLayoutTopBarCollectionsComboBoxOverlay
                        onCloseWithoutAnimation={onCloseWithoutAnimation}
                    />
                </Box>
            )}
        >
            <Button
                variant={isCollectionsTabActive ? "quiet-on" : "quieter"}
                height="6"
                paddingX="2"
                icon={<CaretDown />}
                iconPlacement="end"
            >
                Collections
            </Button>
        </OverlayTriggerButton>
    );
}

type TaskLayoutTopBarCollectionsComboBoxItem =
    | TaskLayoutTopBarCollectionsComboBoxCollectionItem
    | TaskLayoutTopBarCollectionsComboBoxCreateCollectionItem;

type TaskLayoutTopBarCollectionsComboBoxCollectionItem = {
    readonly type: "Collection";
    readonly key: `Collection:${TaskCollectionId}`;
    readonly collectionResult: TaskCollectionModelSearchResult;
};

type TaskLayoutTopBarCollectionsComboBoxCreateCollectionItem = {
    readonly type: "CreateCollection";
    readonly key: "CreateCollection";
};

function TaskLayoutTopBarCollectionsComboBoxOverlay({
    onCloseWithoutAnimation,
}: {
    onCloseWithoutAnimation: () => void;
}) {
    const navigate = useNavigate();
    const showToast = useShowToast();
    const {space} = useSpaceContext();
    const store = useTaskClientStore();

    const [inputValue, setInputValue] = useState("");
    const [pendingKey, setPendingKey] = useState<
        TaskLayoutTopBarCollectionsComboBoxItem["key"] | null
    >(null);

    const affinitiveCollectionResults = useAffinitiveTaskCollections();

    const [currentlyLoadingInputValue, setCurrentlyLoadingInputValue] = useState<string>(
        inputValue.trim(),
    );

    const {isLoading: isSearchLoading, output: searchCollectionsOutput} = useLazyLoadLoadRpc(
        searchTaskCollections,
        currentlyLoadingInputValue.length === 0
            ? null
            : {
                  spaceId: space.id,
                  nameQuery: currentlyLoadingInputValue,
                  limit: taskCollectionSearchResultLimit,
              },
        {keepPreviousData: true},
    );

    // In an effect so React renders intermediate results as it receives them.
    useLayoutEffectWithoutServerSideWarning(() => {
        // Throttle our RPC call. Only load search results for a new input value after
        // we're done loading search results for the old one.
        if (!isSearchLoading && currentlyLoadingInputValue !== inputValue.trim()) {
            setCurrentlyLoadingInputValue(inputValue.trim());
        }
    }, [currentlyLoadingInputValue, inputValue, isSearchLoading]);

    const isEverythingLoading = !affinitiveCollectionResults && !searchCollectionsOutput;

    const [shouldShowSearchLoadingIndicator, setShouldShowSearchLoadingIndicator] = useState(false);

    useEffect(() => {
        if (!isSearchLoading) {
            let isCancelled = false;

            // Set to `false` after a microtask in case React immediately re-renders from
            // `isSearchLoading: false` back to `isSearchLoading: true` (happens when we're
            // throttling search requests). We don't want to clear the spinner and wait for
            // another timeout in this case.
            scheduleMicrotask(() => {
                if (isCancelled) return;
                setShouldShowSearchLoadingIndicator(false);
            });

            return () => {
                isCancelled = true;
            };
        } else {
            const timeout = createTimeout(() => {
                setShouldShowSearchLoadingIndicator(true);
            }, delayLoadingIndicatorLimitMs);

            return () => timeout.clear();
        }
    }, [isSearchLoading]);

    const items: ReadonlyArray<TaskLayoutTopBarCollectionsComboBoxItem> = useStore(
        useMemo(() => {
            return computeStore(get => {
                const items: Array<TaskLayoutTopBarCollectionsComboBoxItem> = [];

                // Show search results if we have them, otherwise show collections the account
                // has some affinity for.
                if (searchCollectionsOutput) {
                    const affinitiveCollectionResultById = new Map(
                        affinitiveCollectionResults?.map(collectionResult => [
                            collectionResult.collection.id,
                            collectionResult.score,
                        ]),
                    );

                    for (const collectionResult of searchCollectionsOutput.collectionResults) {
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

                        const affinitiveCollectionResult1 = affinitiveCollectionResultById.get(
                            item1.collectionResult.collection.id,
                        );
                        const affinitiveCollectionResult2 = affinitiveCollectionResultById.get(
                            item2.collectionResult.collection.id,
                        );

                        if (
                            affinitiveCollectionResult1 === undefined &&
                            affinitiveCollectionResult2 === undefined
                        ) {
                            return 0;
                        }
                        if (affinitiveCollectionResult1 === undefined) return 1;
                        if (affinitiveCollectionResult2 === undefined) return -1;
                        return affinitiveCollectionResult2 - affinitiveCollectionResult1;
                    });
                } else if (affinitiveCollectionResults) {
                    for (const collectionResult of affinitiveCollectionResults) {
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
                            },
                        });
                    }
                }

                items.push({
                    type: "CreateCollection",
                    key: "CreateCollection",
                });

                return items;
            });
        }, [affinitiveCollectionResults, searchCollectionsOutput, store]),
    );

    const renderItem = (item: TaskLayoutTopBarCollectionsComboBoxItem) =>
        item.type === "Collection" ? (
            <Item textValue={item.collectionResult.collection.getName()}>
                <TaskCollectionOption collectionResult={item.collectionResult} />
            </Item>
        ) : (
            <Item>Create collection</Item>
        );

    const {collection, selectionManager, disabledKeys} = useSingleSelectListState({
        items,
        children: renderItem,

        selectedKey: null,
        onSelectionChange: key => {
            if (!key) return;

            assert(typeof key === "string");

            if (key.startsWith("Collection:")) {
                const collectionId = key.slice("Collection:".length);
                assert(isId<TaskCollectionId>(collectionId));

                setPendingKey(`Collection:${collectionId}`);

                navigate(`/s/${space.id}/tasks/collections/${collectionId}`).then(
                    () => {
                        setPendingKey(pendingKey => {
                            if (pendingKey !== `Collection:${collectionId}`) return pendingKey;
                            return null;
                        });

                        onCloseWithoutAnimation();
                    },
                    error => {
                        setPendingKey(pendingKey => {
                            if (pendingKey !== `Collection:${collectionId}`) return pendingKey;
                            return null;
                        });

                        showToast({
                            type: "Error",
                            title: "Couldn’t open collection",
                            error,
                        });
                    },
                );
            } else {
                assert(key === "CreateCollection");

                setPendingKey("CreateCollection");

                navigate(
                    `/s/${space.id}/tasks/collections/${generateId()}?create${
                        inputValue.length > 0 ? `=${encodeURIComponent(inputValue)}` : ""
                    }`,
                ).then(
                    () => {
                        setPendingKey(pendingKey => {
                            if (pendingKey !== "CreateCollection") return pendingKey;
                            return null;
                        });

                        onCloseWithoutAnimation();
                    },
                    error => {
                        setPendingKey(pendingKey => {
                            if (pendingKey !== "CreateCollection") return pendingKey;
                            return null;
                        });

                        showToast({
                            type: "Error",
                            title: "Couldn’t create collection",
                            error,
                        });
                    },
                );
            }
        },
    });

    const inputRef = useRef<HTMLInputElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const listBoxRef = useRef<HTMLUListElement>(null);

    const comboBoxState: ComboBoxState<TaskLayoutTopBarCollectionsComboBoxItem> = {
        inputValue,
        setInputValue,

        commit: () => {
            selectionManager.select(selectionManager.focusedKey);
        },
        revert: () => {
            setInputValue("");
            onCloseWithoutAnimation();
        },

        // Always open
        isOpen: true,
        setOpen: noop,
        open: noop,
        close: noop,
        toggle: noop,
        focusStrategy: "first",

        isFocused: selectionManager.isFocused,
        setFocused: isFocused => selectionManager.setFocused(isFocused),

        // We use multiple selection, there is never one selected key.
        selectedKey: null as any,
        selectedItem: null as any,
        setSelectedKey: key => selectionManager.select(key),

        collection,
        selectionManager,
        disabledKeys,
    };

    const {inputProps, listBoxProps} = useComboBox(
        {
            "aria-label": "Collection",
            inputRef,
            popoverRef,
            listBoxRef,
            autoFocus: false,
            shouldFocusWrap: false,
            items,
        },
        comboBoxState,
    );

    return (
        <>
            <Box position="relative">
                <Box position="absolute" top="2.5" left="2.5" pointerEvents="none" color="grey-70">
                    <MagnifyingGlass size={spacing["3"]} />
                </Box>
                <FocusRing offset="border">
                    <input
                        {...inputProps}
                        ref={inputRef}
                        className={sprinkles({
                            flexShrink: "0",
                            display: "block",
                            width: "full",
                            height: "8",
                            paddingLeft: "7",
                            paddingRight: shouldShowSearchLoadingIndicator ? "7" : "2.5",
                            backgroundColor: "transparent",
                            borderTopRadius: "md",
                            borderBottom: "grey-10",
                        })}
                        placeholder="Search all collections"
                        onKeyDown={event => {
                            // Don't handle a tab keypress with `react-aria`. Instead let our
                            // `<OverlayTriggerButton>` handle it.
                            if (event.key === "Tab") return;

                            inputProps.onKeyDown?.(event);
                        }}
                    />
                </FocusRing>
                {shouldShowSearchLoadingIndicator && (
                    <Box position="absolute" top="2.5" right="2.5" pointerEvents="none">
                        <SpinnerGap className={spinAnimationClassName} size={spacing["3"]} />
                    </Box>
                )}
            </Box>
            <Box
                ref={popoverRef}
                flexGrow="1"
                overflow="hidden"
                display="flex"
                flexDirection="column"
            >
                <TaskLayoutTopBarCollectionsListBox
                    isEverythingLoading={isEverythingLoading}
                    comboBoxState={comboBoxState}
                    listBoxRef={listBoxRef}
                    listBoxProps={listBoxProps}
                    pendingKey={pendingKey}
                />
            </Box>
        </>
    );
}

function TaskLayoutTopBarCollectionsListBox({
    isEverythingLoading,
    comboBoxState,
    listBoxRef,
    listBoxProps: _listBoxProps,
    pendingKey,
}: {
    isEverythingLoading: boolean;
    comboBoxState: ComboBoxState<TaskLayoutTopBarCollectionsComboBoxItem>;
    listBoxRef: RefObject<HTMLUListElement>;
    listBoxProps: AriaListBoxOptions<TaskLayoutTopBarCollectionsComboBoxItem>;
    pendingKey: TaskLayoutTopBarCollectionsComboBoxItem["key"] | null;
}) {
    const {listBoxProps} = useListBox(
        {..._listBoxProps, autoFocus: false},
        comboBoxState,
        listBoxRef,
    );

    const {itemsWithoutCreateCollectionButton, createCollectionButtonItem} = useMemo(() => {
        const itemsWithoutCreateCollectionButton: Array<ReactNode> = [];
        let createCollectionButtonItem: Node<TaskLayoutTopBarCollectionsComboBoxItem> | null = null;

        for (const item of comboBoxState.collection) {
            if (item.value!.type === "CreateCollection") {
                createCollectionButtonItem = item;
            } else {
                itemsWithoutCreateCollectionButton.push(
                    <TaskLayoutTopBarCollectionsListBoxOption
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

    const shouldShowInstructionalPlaceholder =
        !isEverythingLoading &&
        createCollectionButtonItem &&
        comboBoxState.inputValue.length === 0 &&
        itemsWithoutCreateCollectionButton.length === 0;

    return (
        <Box flexGrow="1" overflow="hidden" display="flex" flexDirection="column">
            <ul
                {...listBoxProps}
                ref={listBoxRef}
                className={sprinkles({
                    flexGrow: "1",
                    padding: "1",
                    overflowX: "hidden",
                    overflowY: "auto",
                    display: shouldShowInstructionalPlaceholder ? "none" : undefined,
                })}
            >
                {isEverythingLoading ? (
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
                            paddingLeft="1"
                            paddingRight="0.5"
                            display="flex"
                            justifyContent="center"
                            alignItems="center"
                        >
                            <Box width="1.5" height="1.5" borderRadius="full" />
                        </Box>
                        <Box>
                            <Box
                                fontStyle="truncate"
                                color={taskCollectionOptionSecondaryTextColor}
                            >
                                No results, try a different search
                            </Box>
                            <Box style={{height: fontSizes["50"].lineHeight}}></Box>
                        </Box>
                    </Box>
                ) : (
                    itemsWithoutCreateCollectionButton
                )}
            </ul>
            {shouldShowInstructionalPlaceholder ? (
                <TaskCollectionsListBoxInstructionalPlaceholder
                    createCollectionButton={
                        <TaskCollectionsListBoxCreateCollectionOption
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
                        <TaskCollectionsListBoxCreateCollectionOption
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

function TaskLayoutTopBarCollectionsListBoxOption({
    comboBoxState,
    item,
    pendingKey,
}: {
    comboBoxState: ComboBoxState<TaskLayoutTopBarCollectionsComboBoxItem>;
    item: Node<TaskLayoutTopBarCollectionsComboBoxItem>;
    pendingKey: TaskLayoutTopBarCollectionsComboBoxItem["key"] | null;
}) {
    const optionRef = useRef(null);
    const {isHovered, hoverProps} = useHover({});
    const {optionProps, isFocused, isPressed} = useOption(
        {key: item.key},
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
                {...mergeProps(optionProps, hoverProps)}
                ref={optionRef}
                className={sprinkles({
                    width: "full",
                    padding: "1.5",
                    borderRadius: "base",
                    color: "grey-text",
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
