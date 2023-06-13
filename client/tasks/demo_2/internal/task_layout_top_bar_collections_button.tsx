import {isFocusVisible} from "@react-aria/interactions";
import {Node} from "@react-types/shared";
import Fuse from "fuse.js";
import {CaretDown, MagnifyingGlass, Plus} from "phosphor-react";
import {ReactNode, RefObject, useMemo, useRef, useState} from "react";
import {
    AriaListBoxOptions,
    mergeProps,
    useComboBox,
    useHover,
    useListBox,
    useOption,
} from "react-aria";
import {ComboBoxState, Item, useListState} from "react-stately";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {FocusRing} from "~/client/design/focus_ring";
import {OverlayTriggerButton} from "~/client/design/overlay_trigger";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {TaskCollectionOption} from "~/client/tasks/demo_2/internal/task_collection_option";
import {TaskCollectionsListBoxCreateCollectionOption} from "~/client/tasks/demo_2/internal/task_collections_list_box_create_collection_option";
import {TaskCollectionsListBoxInstructionalPlaceholder} from "~/client/tasks/demo_2/internal/task_collections_list_box_instructional_placeholder";
import {LocalTaskCollection, LocalTasksState} from "~/client/tasks/demo_2/local_tasks_state";
import {spacing} from "~/shared/design/spacing";
import {noop} from "~/shared/helpers/control/noop";
import {LocalTaskCollectionId} from "~/shared/id/types/id_types";
import {sprinkles} from "~/shared/styles/styles";

export function TaskLayoutTopBarCollectionsButton({state}: {state: LocalTasksState}) {
    const allCollections = useMemo(
        () =>
            state.database
                .getAllTaskCollections()
                .sort((collection1, collection2) =>
                    collection1.name.localeCompare(collection2.name),
                ),
        [state.database],
    );

    return (
        <OverlayTriggerButton
            aria-haspopup="listbox"
            overlay={({onCloseWithoutAnimation}) => (
                <Box
                    width="64"
                    maxHeight="96"
                    overflow="hidden"
                    borderRadius="md"
                    backgroundColor={{light: "grey-0", dark: "grey-5"}}
                    boxShadow="elevation-20"
                    display="flex"
                    flexDirection="column"
                >
                    {allCollections.length === 0 ? (
                        <TaskCollectionsListBoxInstructionalPlaceholder
                            createCollectionButton={
                                <Button
                                    variant="neutral"
                                    fullWidth={true}
                                    height="7"
                                    icon={<Plus />}
                                    onPress={() => {
                                        // NOCOMMIT
                                    }}
                                >
                                    Create collection
                                </Button>
                            }
                        />
                    ) : (
                        <TaskLayoutTopBarCollectionsComboBoxOverlay
                            allCollections={allCollections}
                            onCloseWithoutAnimation={onCloseWithoutAnimation}
                        />
                    )}
                </Box>
            )}
        >
            <Button
                variant="quieter"
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
    readonly key: `Collection:${LocalTaskCollectionId}`;
    readonly collection: LocalTaskCollection;
};

type TaskLayoutTopBarCollectionsComboBoxCreateCollectionItem = {
    readonly type: "CreateCollection";
    readonly key: "CreateCollection";
};

function TaskLayoutTopBarCollectionsComboBoxOverlay({
    allCollections,
    onCloseWithoutAnimation,
}: {
    allCollections: ReadonlyArray<LocalTaskCollection>;
    onCloseWithoutAnimation: () => void;
}) {
    const [inputValue, setInputValue] = useState("");

    const allCollectionsSearchIndex = useMemo(
        () => new Fuse(allCollections, {keys: ["name"]}),
        [allCollections],
    );

    const searchedCollections = useMemo(
        () =>
            inputValue === ""
                ? allCollections
                : allCollectionsSearchIndex.search(inputValue).map(({item}) => item),
        [inputValue, allCollections, allCollectionsSearchIndex],
    );

    const searchedItems: ReadonlyArray<TaskLayoutTopBarCollectionsComboBoxItem> = useMemo(() => {
        const searchedItems: Array<TaskLayoutTopBarCollectionsComboBoxItem> = [];

        for (const collection of searchedCollections) {
            searchedItems.push({
                type: "Collection",
                key: `Collection:${collection.id}`,
                collection,
            });
        }

        searchedItems.push({
            type: "CreateCollection",
            key: "CreateCollection",
        });

        return searchedItems;
    }, [searchedCollections]);

    const renderItem = (item: TaskLayoutTopBarCollectionsComboBoxItem) =>
        item.type === "Collection" ? (
            <Item textValue={item.collection.name}>
                <TaskCollectionOption collection={item.collection} />
            </Item>
        ) : (
            <Item>
                {inputValue.length > 0 ? `Create collection “${inputValue}”` : "Create collection"}
            </Item>
        );

    const {collection, selectionManager, disabledKeys} = useListState({
        items: searchedItems,
        children: renderItem,

        selectionMode: "single",
        onSelectionChange: keys => {
            // NOCOMMIT
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
            items: searchedItems,
            children: renderItem,
        },
        comboBoxState,
    );

    return (
        <>
            <FocusRing offset="border">
                <input
                    {...inputProps}
                    ref={inputRef}
                    className={sprinkles({
                        flexShrink: "0",
                        display: "block",
                        width: "full",
                        height: "8",
                        paddingX: "2.5",
                        backgroundColor: "transparent",
                        borderTopRadius: "md",
                        borderBottom: "grey-10",
                    })}
                    placeholder="Collection"
                    onKeyDown={event => {
                        // Don't handle a tab keypress with `react-aria`. Instead let our
                        // `<OverlayTriggerButton>` handle it.
                        if (event.key === "Tab") return;

                        inputProps.onKeyDown?.(event);
                    }}
                />
            </FocusRing>
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
                />
            </Box>
        </>
    );
}

function TaskLayoutTopBarCollectionsListBox({
    comboBoxState,
    listBoxRef,
    listBoxProps: _listBoxProps,
}: {
    comboBoxState: ComboBoxState<TaskLayoutTopBarCollectionsComboBoxItem>;
    listBoxRef: RefObject<HTMLUListElement>;
    listBoxProps: AriaListBoxOptions<TaskLayoutTopBarCollectionsComboBoxItem>;
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
            if (item.value.type === "CreateCollection") {
                createCollectionButtonItem = item;
            } else {
                itemsWithoutCreateCollectionButton.push(
                    <TaskLayoutTopBarCollectionsListBoxOption
                        key={item.key}
                        comboBoxState={comboBoxState}
                        item={item}
                    />,
                );
            }
        }

        return {itemsWithoutCreateCollectionButton, createCollectionButtonItem};
    }, [comboBoxState]);

    return (
        <Box flexGrow="1" overflow="hidden" display="flex" flexDirection="column">
            <ul
                {...listBoxProps}
                ref={listBoxRef}
                className={sprinkles({
                    flexGrow: "1",
                    padding: "1",
                    overflowX: "hidden",
                    overflowY: "scroll",
                })}
            >
                {itemsWithoutCreateCollectionButton.length === 0 ? (
                    <Box padding="1.5" display="flex" alignItems="center" gap="1" color="grey-70">
                        <MagnifyingGlass size={spacing["3"]} />
                        <Box>No results</Box>
                    </Box>
                ) : (
                    itemsWithoutCreateCollectionButton
                )}
            </ul>
            {createCollectionButtonItem && (
                <Box borderTop="grey-10" padding="1">
                    <TaskCollectionsListBoxCreateCollectionOption
                        comboBoxState={comboBoxState}
                        item={createCollectionButtonItem}
                        isQuiet={true}
                    />
                </Box>
            )}
        </Box>
    );
}

function TaskLayoutTopBarCollectionsListBoxOption({
    comboBoxState,
    item,
}: {
    comboBoxState: ComboBoxState<TaskLayoutTopBarCollectionsComboBoxItem>;
    item: Node<TaskLayoutTopBarCollectionsComboBoxItem>;
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
                    backgroundColor: isPressed
                        ? {light: "grey-10", dark: "grey-20"}
                        : isHovered
                        ? {light: "grey-5", dark: "grey-10"}
                        : undefined,
                })}
            >
                {item.rendered}
            </li>
        </FocusRing>
    );
}
