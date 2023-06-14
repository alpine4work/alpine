import {getInteractionModality, isFocusVisible} from "@react-aria/interactions";
import {Node} from "@react-types/shared";
import Fuse from "fuse.js";
import {Lock, MagnifyingGlass, Plus} from "phosphor-react";
import {
    KeyboardEvent,
    ReactNode,
    RefObject,
    cloneElement,
    createRef,
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
import {ComboBoxState, ComboBoxStateOptions, Item, useComboBoxState} from "react-stately";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {ModalDialog} from "~/client/design/modal_dialog";
import {OverlayAnimated} from "~/client/design/overlay_animated";
import {InputWithAutoGrowingWidth} from "~/client/helpers/input_with_auto_growing_width";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs";
import {useConfirmSaveAfterLosingFocus} from "~/client/helpers/use_confirm_save_after_losing_focus";
import {
    TaskCollectionChip,
    taskCollectionChipContainerMaxWidth,
} from "~/client/tasks/demo_2/internal/task_collection_chip";
import {
    TaskCollectionChipBase,
    taskCollectionChipHeight,
    taskCollectionChipPaddingY,
} from "~/client/tasks/demo_2/internal/task_collection_chip_base";
import {TaskCollectionOption} from "~/client/tasks/demo_2/internal/task_collection_option";
import {TaskCollectionsListBoxCreateCollectionOption} from "~/client/tasks/demo_2/internal/task_collections_list_box_create_collection_option";
import {TaskCollectionsListBoxInstructionalPlaceholder} from "~/client/tasks/demo_2/internal/task_collections_list_box_instructional_placeholder";
import {LocalTaskCollection} from "~/client/tasks/demo_2/local_tasks_state";
import {spacing} from "~/shared/design/spacing";
import {ThemeColor, themeColors} from "~/shared/design/theme_colors";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {randomInteger} from "~/shared/helpers/number/random_integer";
import {generateId, isId} from "~/shared/id/id";
import {LocalTaskCollectionId} from "~/shared/id/types/id_types";
import {inputPlaceholderStyles, sprinkles} from "~/shared/styles/styles";

type TaskDetailCollectionsFieldItem =
    | TaskDetailCollectionsFieldCollectionItem
    | TaskDetailCollectionsFieldCreateCollectionItem;

type TaskDetailCollectionsFieldCollectionItem = {
    readonly type: "Collection";
    readonly key: `Collection:${LocalTaskCollectionId}`;
    readonly collection: LocalTaskCollection;
};

type TaskDetailCollectionsFieldCreateCollectionItem = {
    readonly type: "CreateCollection";
    readonly key: "CreateCollection";
};

type TaskDetailCollectionsFieldInputState =
    | {
          readonly type: "Unfocused";
          readonly value: "";
          readonly disableAnimationOut: boolean;
      }
    | {
          readonly type: "Focused";
          readonly value: string;
      };

export function TaskDetailCollectionsField({
    allCollections,
    collections,
    createCollectionAndAddToTask,
    addCollectionToTask,
    removeCollectionFromTask,
    "aria-labelledby": ariaLabelledBy,
}: {
    allCollections: ReadonlyArray<LocalTaskCollection>;
    collections: ReadonlyArray<LocalTaskCollection>;
    createCollectionAndAddToTask: (collection: {
        id: LocalTaskCollectionId;
        name: string;
        color: ThemeColor;
    }) => void;
    addCollectionToTask: (collection: LocalTaskCollectionId) => void;
    removeCollectionFromTask: (collection: LocalTaskCollectionId) => void;
    "aria-labelledby": string;
}) {
    const allCollectionsWithoutSelection = useMemo(
        () =>
            allCollections.filter(otherCollection =>
                collections.every(collection => collection.id !== otherCollection.id),
            ),
        [allCollections, collections],
    );

    const allCollectionsSearchIndex = useMemo(
        () => new Fuse(allCollectionsWithoutSelection, {keys: ["name"]}),
        [allCollectionsWithoutSelection],
    );

    const [inputState, setInputState] = useState<TaskDetailCollectionsFieldInputState>({
        type: "Unfocused",
        value: "",
        disableAnimationOut: false,
    });

    const [createCollectionInputState, setCreateCollectionInputState] = useState<
        {isVisible: false} | {isVisible: true; shouldReturnFocusToInput: boolean}
    >({
        isVisible: false,
    });

    // When the create collection input goes from `isVisible` `true` to `false`
    // then we want to refocus the input ref if we opened the create collection
    // input with the keyboard.
    useEffect(() => {
        return () => {
            if (
                createCollectionInputState.isVisible &&
                createCollectionInputState.shouldReturnFocusToInput
            ) {
                // eslint-disable-next-line react-hooks/exhaustive-deps
                inputRef.current?.focus();
            }
        };
    }, [createCollectionInputState]);

    const searchedCollections = useMemo(
        () =>
            inputState.value === ""
                ? allCollectionsWithoutSelection
                : allCollectionsSearchIndex.search(inputState.value).map(({item}) => item),
        [allCollectionsWithoutSelection, allCollectionsSearchIndex, inputState.value],
    );

    const searchedItems: ReadonlyArray<TaskDetailCollectionsFieldItem> = useMemo(() => {
        const searchedItems: Array<TaskDetailCollectionsFieldItem> = [];

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

    const comboBoxProps: ComboBoxStateOptions<TaskDetailCollectionsFieldItem> = {
        menuTrigger: "focus",
        // Don't close when there are no items.
        allowsEmptyCollection: true,

        inputValue: inputState.value,
        onInputChange: inputValue => {
            setInputState(inputState => {
                if (inputState.type !== "Focused") return inputState;
                return {type: "Focused", value: inputValue};
            });
        },

        onFocus: () => {
            setInputState(inputState => {
                if (inputState.type === "Focused") return inputState;
                return {type: "Focused", value: inputState.value};
            });
        },

        onBlur: () => {
            setInputState(inputState => {
                if (inputState.type === "Unfocused") return inputState;
                return {type: "Unfocused", value: "", disableAnimationOut: false};
            });
        },

        items: searchedItems,
        children: item =>
            item.type === "Collection" ? (
                <Item textValue={item.collection.name}>
                    <TaskCollectionOption collection={item.collection} />
                </Item>
            ) : (
                <Item>
                    {inputState.value.length > 0
                        ? `Create collection “${inputState.value}”`
                        : "Create collection"}
                </Item>
            ),

        // No key is ever selected by the combobox. Instead when a selection occurs we
        // add it to a list of selected values.
        selectedKey: null,
        onSelectionChange: key => {
            if (typeof key !== "string") return;

            const shouldReturnFocusToInput = getInteractionModality() === "pointer";

            if (key.startsWith("Collection:")) {
                const collectionId = key.slice("Collection:".length);
                assert(isId<LocalTaskCollectionId>(collectionId));
                addCollectionToTask(collectionId);

                if (shouldReturnFocusToInput) {
                    setInputState(inputState => {
                        if (inputState.type === "Unfocused") return inputState;
                        return {type: "Unfocused", value: "", disableAnimationOut: true};
                    });

                    assertExists(inputRef.current).blur();
                } else {
                    setInputState(inputState => {
                        if (inputState.type === "Unfocused") return inputState;
                        return {type: "Focused", value: ""};
                    });
                }
            }

            if (key === "CreateCollection") {
                if (inputState.value === "") {
                    setInputState(inputState => {
                        if (inputState.type === "Unfocused") return inputState;
                        return {type: "Unfocused", value: "", disableAnimationOut: true};
                    });

                    comboBoxState.close();

                    setCreateCollectionInputState({
                        isVisible: true,
                        shouldReturnFocusToInput,
                    });
                } else {
                    createCollectionAndAddToTask({
                        id: generateId(),
                        name: inputState.value,
                        color: themeColors[randomInteger(themeColors.length)]!,
                    });

                    if (shouldReturnFocusToInput) {
                        setInputState(inputState => {
                            if (inputState.type === "Unfocused") return inputState;
                            return {type: "Unfocused", value: "", disableAnimationOut: true};
                        });

                        assertExists(inputRef.current).blur();
                    } else {
                        setInputState(inputState => {
                            if (inputState.type === "Unfocused") return inputState;
                            return {type: "Focused", value: ""};
                        });
                    }
                }
            }
        },
    };

    const comboBoxState = useComboBoxState(comboBoxProps);

    const inputRef = useRef<HTMLInputElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const listBoxRef = useRef<HTMLUListElement>(null);

    const collectionRefs = useMemo(
        () => createArrayWithLength(collections.length, () => createRef<HTMLDivElement>()),
        [collections.length],
    );

    const {inputProps, listBoxProps} = useComboBox(
        {
            ...comboBoxProps,
            inputRef,
            popoverRef,
            listBoxRef,
            "aria-labelledby": ariaLabelledBy,
            onKeyDown: event => {
                assert(event.currentTarget instanceof HTMLInputElement);
                switch (event.key) {
                    // If we are at the beginning of the combobox text input, the backspace key
                    // will delete the last collection.
                    case "Backspace": {
                        if (
                            collections.length > 0 &&
                            event.currentTarget.selectionStart ===
                                event.currentTarget.selectionEnd &&
                            event.currentTarget.selectionStart === 0
                        ) {
                            event.preventDefault();
                            removeCollectionFromTask(collections[collections.length - 1]!.id);
                        }
                        break;
                    }
                    // If we are at the beginning of the combobox text input, the arrow left key
                    // will focus a previously selected account if we have one.
                    case "ArrowLeft": {
                        if (
                            collectionRefs.length > 0 &&
                            event.currentTarget.selectionStart ===
                                event.currentTarget.selectionEnd &&
                            event.currentTarget.selectionStart === 0
                        ) {
                            event.preventDefault();
                            collectionRefs[collectionRefs.length - 1]!.current!.focus();
                        }
                        break;
                    }
                }
            },
        },
        comboBoxState,
    );

    const shouldShowPrivatePlaceholder =
        !createCollectionInputState.isVisible && collections.length === 0;

    const inputPlaceholder = shouldShowPrivatePlaceholder ? "Private" : "Add";

    const collectionsChildren = collections.map((collection, index) => {
        const handleKeyDown = (event: KeyboardEvent) => {
            switch (event.key) {
                // Backspace or delete will remove our selected account.
                case "Backspace":
                case "Delete": {
                    event.preventDefault();
                    event.stopPropagation();
                    removeCollectionFromTask(collection.id);
                    if (index + 1 < collectionRefs.length) {
                        collectionRefs[index + 1]?.current?.focus();
                    } else {
                        inputRef.current?.focus();
                    }
                    break;
                }
                // Arrow keys navigate through selected accounts. Only the first selected
                // account is focusable since you use arrow keys to navigate between accounts.
                case "ArrowLeft": {
                    event.preventDefault();
                    event.stopPropagation();
                    collectionRefs[index - 1]?.current?.focus();
                    break;
                }
                // Arrow keys navigate through selected accounts. Only the first selected
                // account is focusable since you use arrow keys to navigate between accounts.
                case "ArrowRight": {
                    event.preventDefault();
                    event.stopPropagation();
                    if (index + 1 < collectionRefs.length) {
                        collectionRefs[index + 1]?.current?.focus();
                    } else {
                        inputRef.current?.focus();
                    }
                    break;
                }
                default: {
                    // If the user presses a letter then interpret that as the user trying to
                    // replace the focused account. So delete the selected account and add the text
                    // to our search input.
                    if (/^[0-9a-zA-Z]$/.test(event.key)) {
                        event.preventDefault();
                        event.stopPropagation();
                        removeCollectionFromTask(collection.id);
                        setInputState({type: "Focused", value: event.key});
                        inputRef.current?.focus();
                    }
                    break;
                }
            }
        };

        return (
            <FocusRing key={collection.id}>
                <Box
                    ref={collectionRefs[index]}
                    overflow="hidden"
                    marginY="-0.5"
                    marginLeft="-0.5"
                    style={{maxWidth: taskCollectionChipContainerMaxWidth}}
                    // The first selected account is focusable via tab and you can use arrow keys
                    // to focus the others.
                    tabIndex={index === 0 ? 0 : -1}
                    onKeyDown={handleKeyDown}
                >
                    <TaskCollectionChip
                        collection={collection}
                        onRemove={() => removeCollectionFromTask(collection.id)}
                    />
                </Box>
            </FocusRing>
        );
    });

    return (
        <Box display="flex" alignItems="center" flexWrap="wrap" gap="3">
            {collectionsChildren}
            {createCollectionInputState.isVisible && (
                <Box
                    overflow="hidden"
                    marginY="-0.5"
                    marginLeft="-0.5"
                    style={{maxWidth: taskCollectionChipContainerMaxWidth}}
                >
                    <TaskDetailCollectionsFieldCreateCollectionInput
                        onCancel={() => setCreateCollectionInputState({isVisible: false})}
                        createCollectionAndAddToTask={collection => {
                            setCreateCollectionInputState({isVisible: false});
                            createCollectionAndAddToTask(collection);
                        }}
                    />
                </Box>
            )}
            <OverlayAnimated
                isVisible={comboBoxState.isOpen}
                offset="2"
                disableAnimationIn={true}
                disableAnimationOut={
                    inputState.type === "Unfocused" && inputState.disableAnimationOut
                }
                placement="bottom-start"
                overlay={
                    <Box ref={popoverRef} position="relative">
                        <TaskDetailCollectionsFieldListBox
                            haveNoCollectionsBeenCreated={allCollections.length === 0}
                            comboBoxState={comboBoxState}
                            listBoxRef={listBoxRef}
                            listBoxProps={listBoxProps}
                        />
                    </Box>
                }
            >
                <Box
                    position="relative"
                    zIndex="0"
                    maxWidth="full"
                    overflow="hidden"
                    // The width of this element is determined by nested text boxes. The `<input>`
                    // then uses the parent width as its own width.
                    display="inline-block"
                >
                    <Box
                        position="relative"
                        zIndex="-10"
                        display="flex"
                        alignItems="center"
                        gap={shouldShowPrivatePlaceholder ? "1" : undefined}
                        pointerEvents="none"
                        // This is accessible through `aria-placeholder` on the `<input>`.
                        aria-hidden={true}
                        style={{
                            ...inputPlaceholderStyles,
                            opacity: inputState.value.length === 0 ? 1 : 0,
                        }}
                    >
                        {shouldShowPrivatePlaceholder ? (
                            <Lock size={spacing["4"]} />
                        ) : (
                            <Box padding="0.5">
                                <Plus size={spacing["3"]} />
                            </Box>
                        )}
                        <Box>{inputPlaceholder}</Box>
                    </Box>
                    <Box
                        height="0"
                        opacity="0"
                        pointerEvents="none"
                        aria-hidden={true}
                        // Leading and trailing spaces should contribute to width.
                        style={{whiteSpace: "pre"}}
                    >
                        {inputState.value}
                    </Box>
                    <FocusRing>
                        <input
                            {...inputProps}
                            ref={inputRef}
                            type="text"
                            className={sprinkles({
                                position: "absolute",
                                inset: "0",
                                display: "inline-block",
                                backgroundColor: "transparent",
                                paddingLeft:
                                    inputState.value.length === 0
                                        ? shouldShowPrivatePlaceholder
                                            ? "5"
                                            : "4"
                                        : undefined,
                            })}
                            // By default `<input>` elements have a `min-width` determined by the `size`
                            // property. We want our `<input>`s `min-width` to be determined by our CSS
                            // so set it to a small value as not to matter.
                            // https://stackoverflow.com/questions/29470676/why-doesnt-the-input-element-respect-min-width
                            size={1}
                            // Use `aria-placeholder` since the placeholder text is rendered by another DOM
                            // element with an icon.
                            aria-placeholder={inputPlaceholder}
                            // Make sure the combobox is always open when the user clicks on the collection
                            // input. We've observed some bugs where `react-aria` doesn't happen to open
                            // the combobox consistently on focus.
                            onPointerDown={() => comboBoxState.open()}
                        />
                    </FocusRing>
                </Box>
            </OverlayAnimated>
        </Box>
    );
}

function TaskDetailCollectionsFieldListBox({
    haveNoCollectionsBeenCreated,
    comboBoxState,
    listBoxRef,
    listBoxProps: _listBoxProps,
}: {
    haveNoCollectionsBeenCreated: boolean;
    comboBoxState: ComboBoxState<TaskDetailCollectionsFieldItem>;
    listBoxRef: RefObject<HTMLUListElement>;
    listBoxProps: AriaListBoxOptions<TaskDetailCollectionsFieldItem>;
}) {
    const {listBoxProps} = useListBox(_listBoxProps, comboBoxState, listBoxRef);

    const {itemsWithoutCreateCollectionButton, createCollectionButtonItem} = useMemo(() => {
        const itemsWithoutCreateCollectionButton: Array<ReactNode> = [];
        let createCollectionButtonItem: Node<TaskDetailCollectionsFieldItem> | null = null;

        for (const item of comboBoxState.collection) {
            if (item.value.type === "CreateCollection") {
                createCollectionButtonItem = item;
            } else {
                itemsWithoutCreateCollectionButton.push(
                    <TaskDetailCollectionsFieldListBoxOption
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
        <Box
            borderRadius="md"
            backgroundColor={{light: "grey-0", dark: "grey-5"}}
            boxShadow="elevation-20"
            width="64"
            maxHeight="64"
            overflow="hidden"
            display="flex"
            flexDirection="column"
        >
            {haveNoCollectionsBeenCreated ? (
                <ul {...listBoxProps} ref={listBoxRef}>
                    <TaskCollectionsListBoxInstructionalPlaceholder
                        createCollectionButton={
                            createCollectionButtonItem ? (
                                <TaskCollectionsListBoxCreateCollectionOption
                                    comboBoxState={comboBoxState}
                                    item={createCollectionButtonItem}
                                    isQuiet={false}
                                />
                            ) : null
                        }
                    />
                </ul>
            ) : (
                <>
                    <ul
                        {...listBoxProps}
                        ref={listBoxRef}
                        className={sprinkles({
                            flexGrow: "1",
                            width: "full",
                            padding: "1",
                            overflowX: "hidden",
                            overflowY: "scroll",
                        })}
                    >
                        {itemsWithoutCreateCollectionButton.length === 0 ? (
                            <Box
                                padding="1.5"
                                display="flex"
                                alignItems="center"
                                gap="1"
                                color="grey-70"
                            >
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
                </>
            )}
        </Box>
    );
}

function TaskDetailCollectionsFieldListBoxOption({
    comboBoxState,
    item,
}: {
    comboBoxState: ComboBoxState<TaskDetailCollectionsFieldItem>;
    item: Node<TaskDetailCollectionsFieldItem>;
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

    assert(isValidElement(item.rendered));

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
                {cloneElement(item.rendered, {isPressed} as any)}
            </li>
        </FocusRing>
    );
}

function TaskDetailCollectionsFieldCreateCollectionInput({
    onCancel,
    createCollectionAndAddToTask,
}: {
    onCancel: () => void;
    createCollectionAndAddToTask: (collection: {
        id: LocalTaskCollectionId;
        name: string;
        color: ThemeColor;
    }) => void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const inputPlaceholder = "Name";
    const [inputValue, setInputValue] = useState("");
    const [color] = useState(() => themeColors[randomInteger(themeColors.length)]!);
    const [shouldShowConfirmSaveDialog, setShouldShowConfirmSaveDialog] = useState(false);

    const shouldFocusNextRenderRef = useRef(true);

    useLayoutEffectWithoutServerSideWarning(() => {
        // If the close confirmation dialog is open, we can't focus our editor.
        if (shouldShowConfirmSaveDialog) return;

        if (!shouldFocusNextRenderRef.current) return;
        shouldFocusNextRenderRef.current = false;

        const inputElement = assertExists(inputRef.current);
        inputElement.focus({preventScroll: true});
    }, [shouldShowConfirmSaveDialog]);

    const confirm = () => {
        if (inputValue.length === 0) {
            onCancel();
            return;
        }

        createCollectionAndAddToTask({
            id: generateId(),
            name: inputValue,
            color,
        });
    };

    return (
        <>
            <FocusRing isVisibleWhenFocusWithin>
                <TaskCollectionChipBase
                    color={color}
                    name={
                        <Box
                            height={taskCollectionChipHeight}
                            marginY={`-${taskCollectionChipPaddingY}`}
                        >
                            <InputWithAutoGrowingWidth
                                type="text"
                                className={sprinkles({
                                    height: taskCollectionChipHeight,
                                    backgroundColor: "transparent",
                                })}
                                placeholder={inputPlaceholder}
                                value={inputValue}
                                onChange={event => setInputValue(event.currentTarget.value)}
                                ref={useMergedRefs(
                                    inputRef,
                                    useConfirmSaveAfterLosingFocus({
                                        shouldConfirmSave: inputValue.length > 0,
                                        isConfirmingSave: shouldShowConfirmSaveDialog,
                                        onCancelSave: onCancel,
                                        onConfirmSave: () => setShouldShowConfirmSaveDialog(true),
                                    }),
                                )}
                                onKeyDown={event => {
                                    switch (event.key) {
                                        case "Enter": {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            confirm();
                                            break;
                                        }
                                        case "Backspace": {
                                            if (
                                                inputValue.length === 0 &&
                                                event.currentTarget.selectionStart ===
                                                    event.currentTarget.selectionEnd &&
                                                event.currentTarget.selectionStart === 0
                                            ) {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                onCancel();
                                                break;
                                            }
                                        }
                                    }
                                }}
                            />
                        </Box>
                    }
                    onRemove={null}
                />
            </FocusRing>
            {shouldShowConfirmSaveDialog && (
                <ModalDialog
                    title="Save collection"
                    description="Would you like to save your new collection?"
                    onClose={() => {
                        // Return focus to the editor if the dialog is closed. This acts as a "cancel"
                        // and lets the user continue writing.
                        shouldFocusNextRenderRef.current = true;
                        setShouldShowConfirmSaveDialog(false);
                    }}
                    primaryButtonLabel="Save"
                    onPrimaryButtonPress={confirm}
                    cancelButtonLabel="Discard collection"
                    onCancelButtonPress={onCancel}
                />
            )}
        </>
    );
}
