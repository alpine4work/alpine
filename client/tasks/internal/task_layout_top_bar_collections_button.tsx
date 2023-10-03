import {isFocusVisible} from "@react-aria/interactions";
import {Node} from "@react-types/shared";
import {CaretDown, MagnifyingGlass} from "phosphor-react";
import {ReactNode, RefObject, cloneElement, isValidElement, useMemo, useRef, useState} from "react";
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
import {useShowToast} from "~/client/design/toast.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {TaskCollectionOption} from "~/client/tasks/internal/task_collection_option.js";
import {TaskCollectionsListBoxCreateCollectionOption} from "~/client/tasks/internal/task_collections_list_box_create_collection_option.js";
import {TaskCollectionsListBoxInstructionalPlaceholder} from "~/client/tasks/internal/task_collections_list_box_instructional_placeholder.js";
import {
    useAffinitiveTaskCollections,
    usePreloadAffinitiveTaskCollections,
} from "~/client/tasks/internal/use_affinitive_task_collections.js";
import {spacing} from "~/shared/design/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {generateId, isId} from "~/shared/id/id.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";
import {greyElevated2ClassName, sprinkles} from "~/shared/styles/styles.js";
import {TaskCollectionModelSearchResult} from "~/shared/tasks/model/task_collection_model_search_result.js";

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
                    {/* NOCOMMIT: {allCollections.length === 0 ? (
                        <TaskCollectionsListBoxInstructionalPlaceholder
                            createCollectionButton={
                                <Button
                                    variant="neutral"
                                    fullWidth={true}
                                    height="7"
                                    icon={<Plus />}
                                    pressErrorTitle="Couldn’t create collection"
                                    onPress={async () => {
                                        await navigate(
                                            `/s/${
                                                space.id
                                            }/tasks/collections/${generateId()}?create`,
                                        );
                                        onCloseWithoutAnimation();
                                    }}
                                >
                                    Create collection
                                </Button>
                            }
                        />
                    ) : ( */}
                    <TaskLayoutTopBarCollectionsComboBoxOverlay
                        onCloseWithoutAnimation={onCloseWithoutAnimation}
                    />
                    {/* )} */}
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

    const [inputValue, setInputValue] = useState("");
    const [pendingKey, setPendingKey] = useState<
        TaskLayoutTopBarCollectionsComboBoxItem["key"] | null
    >(null);

    const affinitiveCollectionResults = useAffinitiveTaskCollections();

    const items: ReadonlyArray<TaskLayoutTopBarCollectionsComboBoxItem> = useMemo(() => {
        const items: Array<TaskLayoutTopBarCollectionsComboBoxItem> = [];

        if (affinitiveCollectionResults) {
            for (const collectionResult of affinitiveCollectionResults) {
                items.push({
                    type: "Collection",
                    key: `Collection:${collectionResult.collection.id}`,
                    collectionResult,
                });
            }
        }

        items.push({
            type: "CreateCollection",
            key: "CreateCollection",
        });

        return items;
    }, [affinitiveCollectionResults]);

    const renderItem = (item: TaskLayoutTopBarCollectionsComboBoxItem) =>
        item.type === "Collection" ? (
            <Item textValue={item.collectionResult.collection.getName()}>
                <TaskCollectionOption collectionResult={item.collectionResult} />
            </Item>
        ) : (
            <Item>
                {inputValue.length > 0 ? `Create collection “${inputValue}”` : "Create collection"}
            </Item>
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

                navigate(`/s/${space.id}/tasks/collections/${generateId()}?create`).then(
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
                            paddingRight: "2.5",
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
            </Box>
            <Box
                ref={popoverRef}
                flexGrow="1"
                overflow="hidden"
                display="flex"
                flexDirection="column"
            >
                <TaskLayoutTopBarCollectionsListBox
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
    comboBoxState,
    listBoxRef,
    listBoxProps: _listBoxProps,
    pendingKey,
}: {
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
                {itemsWithoutCreateCollectionButton.length === 0 ? (
                    // NOCOMMIT: Better UI here
                    <Box padding="1.5" display="flex" alignItems="center" gap="1" color="grey-70">
                        <MagnifyingGlass size={spacing["3"]} />
                        <Box>No results</Box>
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
                {isValidElement(item.rendered)
                    ? cloneElement(item.rendered, {
                          isPending: item.key === pendingKey,
                      } as any)
                    : item.rendered}
            </li>
        </FocusRing>
    );
}
