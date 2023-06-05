import {isFocusVisible} from "@react-aria/interactions";
import {Node} from "@react-types/shared";
import {differenceInMonths, differenceInYears} from "date-fns";
import Fuse from "fuse.js";
import {Lock, MagnifyingGlass, Plus} from "phosphor-react";
import {RefObject, cloneElement, isValidElement, useMemo, useRef, useState} from "react";
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
import {Button} from "~/client/design/button";
import {FocusRing} from "~/client/design/focus_ring";
import {ModalDialog} from "~/client/design/modal_dialog";
import {OverlayAnimated} from "~/client/design/overlay_animated";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs";
import {useConfirmSaveAfterLosingFocus} from "~/client/helpers/use_confirm_save_after_losing_focus";
import {useCurrentTimeRoundedToHour} from "~/client/remix/use_current_time_rounded_to_hour";
import {LocalTaskCollection} from "~/client/tasks/demo_2/internal/local_tasks_state";
import {
    TaskCollectionChip,
    taskCollectionChipContainerMaxWidth,
} from "~/client/tasks/demo_2/internal/task_collection_chip";
import {
    TaskCollectionChipBase,
    taskCollectionChipHeight,
    taskCollectionChipPaddingY,
} from "~/client/tasks/demo_2/internal/task_collection_chip_base";
import {parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {ThemeColor, themeColors} from "~/shared/design/theme_colors";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {randomInteger} from "~/shared/helpers/number/random_integer";
import {generateId, isId} from "~/shared/id/id";
import {LocalTaskCollectionId} from "~/shared/id/types/id_types";
import {fontSizes, inputPlaceholderStyles, sprinkles} from "~/shared/styles/styles";

type TaskDetailCollectionsFieldItem = {
    readonly key: LocalTaskCollectionId;
    readonly collection: LocalTaskCollection;
};

// NOCOMMIT: Arrow down when there are no collections should select create
// collection button.

// NOCOMMIT: Create button when some collections exist.

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
    const [isCreatingCollection, setIsCreatingCollection] = useState(false);

    const searchedCollections = useMemo(
        () =>
            inputState.value === ""
                ? allCollectionsWithoutSelection
                : allCollectionsSearchIndex.search(inputState.value).map(({item}) => item),
        [allCollectionsWithoutSelection, allCollectionsSearchIndex, inputState.value],
    );

    const searchedItems: ReadonlyArray<TaskDetailCollectionsFieldItem> = useMemo(
        () => searchedCollections.map(collection => ({key: collection.id, collection})),
        [searchedCollections],
    );

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
        children: item => (
            <Item textValue={item.collection.name}>
                <TaskDetailCollectionsFieldListBoxOptionItem item={item} />
            </Item>
        ),

        // No key is ever selected by the combobox. Instead when a selection occurs we
        // add it to a list of selected values.
        selectedKey: null,
        onSelectionChange: collectionId => {
            if (typeof collectionId !== "string") return;

            assert(isId<LocalTaskCollectionId>(collectionId));
            addCollectionToTask(collectionId);

            setInputState(inputState => {
                if (inputState.type === "Unfocused") return inputState;
                return {type: "Unfocused", value: "", disableAnimationOut: true};
            });

            assertExists(inputRef.current).blur();
        },
    };

    const comboBoxState = useComboBoxState(comboBoxProps);

    const inputRef = useRef<HTMLInputElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const listBoxRef = useRef<HTMLUListElement>(null);

    const {inputProps, listBoxProps} = useComboBox(
        {
            ...comboBoxProps,
            inputRef,
            popoverRef,
            listBoxRef,
            "aria-labelledby": ariaLabelledBy,
        },
        comboBoxState,
    );

    const shouldShowPrivatePlaceholder = !isCreatingCollection && collections.length === 0;

    const inputPlaceholder = shouldShowPrivatePlaceholder ? "Private" : "Add";

    return (
        <Box display="flex" alignItems="center" flexWrap="wrap" gap="3">
            {collections.map(collection => (
                <Box
                    key={collection.id}
                    overflow="hidden"
                    marginY="-0.5"
                    marginLeft="-0.5"
                    style={{maxWidth: taskCollectionChipContainerMaxWidth}}
                >
                    <TaskCollectionChip
                        collection={collection}
                        onRemove={() => removeCollectionFromTask(collection.id)}
                    />
                </Box>
            ))}
            {isCreatingCollection && (
                <Box
                    overflow="hidden"
                    marginY="-0.5"
                    marginLeft="-0.5"
                    style={{maxWidth: taskCollectionChipContainerMaxWidth}}
                >
                    <TaskDetailCollectionsFieldCreateCollectionInput
                        onCancel={() => setIsCreatingCollection(false)}
                        createCollectionAndAddToTask={createCollectionAndAddToTask}
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
                            onCreateCollection={() => {
                                comboBoxState.close();
                                setIsCreatingCollection(true);
                            }}
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
                    <Box height="0" opacity="0" pointerEvents="none" aria-hidden={true}>
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
    onCreateCollection,
}: {
    haveNoCollectionsBeenCreated: boolean;
    comboBoxState: ComboBoxState<TaskDetailCollectionsFieldItem>;
    listBoxRef: RefObject<HTMLUListElement>;
    listBoxProps: AriaListBoxOptions<TaskDetailCollectionsFieldItem>;
    onCreateCollection: () => void;
}) {
    const {listBoxProps} = useListBox(_listBoxProps, comboBoxState, listBoxRef);

    return (
        <Box
            borderRadius="md"
            backgroundColor={{light: "grey-0", dark: "grey-5"}}
            boxShadow="elevation-20"
            width={haveNoCollectionsBeenCreated ? "64" : "48"}
            maxHeight="64"
            overflow="hidden"
            display="flex"
            flexDirection="column"
        >
            {haveNoCollectionsBeenCreated && (
                <TaskDetailCollectionsFieldListBoxInstructionalPlaceholder
                    onCreateCollection={onCreateCollection}
                />
            )}
            <ul
                {...listBoxProps}
                ref={listBoxRef}
                className={sprinkles({
                    flexGrow: "1",
                    width: "full",
                    padding: "1",
                    overflowX: "hidden",
                    overflowY: "scroll",
                    display: haveNoCollectionsBeenCreated ? "none" : undefined,
                })}
            >
                {comboBoxState.collection.size === 0 ? (
                    <Box padding="1.5" display="flex" alignItems="center" gap="1" color="grey-70">
                        <MagnifyingGlass size={spacing["3"]} />
                        <Box>No results</Box>
                    </Box>
                ) : (
                    Array.from(comboBoxState.collection, item => (
                        <TaskDetailCollectionsFieldListBoxOption
                            key={item.key}
                            comboBoxState={comboBoxState}
                            item={item}
                        />
                    ))
                )}
            </ul>
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

function TaskDetailCollectionsFieldListBoxOptionItem({
    item,
    isPressed,
}: {
    item: TaskDetailCollectionsFieldItem;
    isPressed?: boolean;
}) {
    assert(
        typeof isPressed === "boolean",
        "Expected to be rendered by <TaskDetailCollectionsFieldListBoxOption> which provides extra props",
    );

    return (
        <Box display="flex" alignItems="flex-start" gap="1.5">
            <Box
                flexShrink="0"
                height="4"
                paddingX="0.5"
                display="flex"
                justifyContent="center"
                alignItems="center"
            >
                <Box
                    width="1.5"
                    height="1.5"
                    borderRadius="full"
                    backgroundColor={`${item.collection.color}-50-const`}
                />
            </Box>
            <Box flexGrow="1" overflow="hidden">
                <Box
                    maxWidth="full"
                    overflow="hidden"
                    fontSize="75"
                    style={{
                        maxHeight: `${parseRemLengthNumber(fontSizes["75"].lineHeight) * 2}rem`,
                        // Truncate after 2 lines of text. Unofficial syntax that works in all browsers
                        // except IE.
                        // https://stackoverflow.com/questions/3922739/limit-text-length-to-n-lines-using-css
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        lineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        textOverflow: "ellipsis",
                    }}
                >
                    {item.collection.name}
                </Box>
                <Box fontSize="50" color="grey-40">
                    {getTaskCollectionTaskCountSummary(item.collection)},{" "}
                    {getTaskCollectionLastUpdateTimeSummary(
                        item.collection,
                        useCurrentTimeRoundedToHour(),
                    )}
                </Box>
            </Box>
        </Box>
    );
}

function getTaskCollectionTaskCountSummary(collection: LocalTaskCollection) {
    if (collection.taskCount === 0) {
        return "No tasks";
    } else if (collection.taskCount < 100) {
        return "Several tasks";
    } else if (collection.taskCount < 1000) {
        return "Hundreds of tasks";
    } else {
        return "Thousands of tasks";
    }
}

function getTaskCollectionLastUpdateTimeSummary(
    collection: LocalTaskCollection,
    currentTime: Date,
) {
    if (!collection.lastTaskAddedOrRemovedTimeRoundedToDay) {
        const years = differenceInYears(currentTime, collection.createdTime);

        if (years === 1) {
            return "created 1 year ago";
        } else if (years > 1) {
            return `created ${years} year ago`;
        }

        const months = differenceInMonths(currentTime, collection.createdTime);

        if (months === 1) {
            return "created 1 month ago";
        } else if (months > 1) {
            return `created ${months} months ago`;
        } else {
            return "created recently";
        }
    } else {
        const years = differenceInYears(
            currentTime,
            collection.lastTaskAddedOrRemovedTimeRoundedToDay,
        );

        if (years === 1) {
            return "last updated 1 year ago";
        } else if (years > 1) {
            return `last updated ${years} year ago`;
        }

        const months = differenceInMonths(
            currentTime,
            collection.lastTaskAddedOrRemovedTimeRoundedToDay,
        );

        if (months === 1) {
            return "last updated 1 month ago";
        } else if (months > 1) {
            return `last updated ${months} months ago`;
        } else {
            return "updated recently";
        }
    }
}

function TaskDetailCollectionsFieldListBoxInstructionalPlaceholder({
    onCreateCollection,
}: {
    onCreateCollection: () => void;
}) {
    return (
        <Box display="flex" flexDirection="column" padding="3" gap="3">
            <Box display="flex" alignItems="flex-end" gap="1">
                <Box>
                    <Box fontStyle="semi-bold" fontSize="75" color="grey-text" paddingBottom="1">
                        Shared collections
                    </Box>
                    <Box fontSize="50" color="grey-50">
                        Collections help you organize related tasks
                    </Box>
                </Box>
                <Box
                    display="flex"
                    flexDirection="column"
                    justifyContent="flex-start"
                    alignItems="center"
                    gap="1"
                >
                    <Box display="flex" gap="1">
                        <TaskCollectionChipBase color="red" name="Bugs" onRemove={null} />
                        <TaskCollectionChipBase color="green" name="Q3" onRemove={null} />
                    </Box>
                    <Box>
                        <TaskCollectionChipBase color="cyan" name="Marketing" onRemove={null} />
                    </Box>
                </Box>
            </Box>
            <Button
                variant="neutral"
                fullWidth
                height="6"
                icon={<Plus />}
                onPress={onCreateCollection}
            >
                Create
            </Button>
        </Box>
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
                            maxWidth="full"
                            overflow="hidden"
                            // The width of this element is determined by nested text boxes. The `<input>`
                            // then uses the parent width as its own width.
                            display="inline-block"
                            style={{verticalAlign: "bottom"}}
                        >
                            <Box height="0" opacity="0" pointerEvents="none" aria-hidden={true}>
                                {inputPlaceholder}
                            </Box>
                            <Box height="0" opacity="0" pointerEvents="none" aria-hidden={true}>
                                {inputValue}
                            </Box>
                            <input
                                type="text"
                                className={sprinkles({
                                    display: "inline-block",
                                    width: "full",
                                    height: taskCollectionChipHeight,
                                    backgroundColor: "transparent",
                                })}
                                // By default `<input>` elements have a `min-width` determined by the `size`
                                // property. We want our `<input>`s `min-width` to be determined by our CSS
                                // so set it to a small value as not to matter.
                                // https://stackoverflow.com/questions/29470676/why-doesnt-the-input-element-respect-min-width
                                size={1}
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
                                    if (event.key === "Enter") {
                                        confirm();
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
