import {Lock, Plus} from "phosphor-react";
import {RefObject, useRef, useState} from "react";
import {AriaListBoxOptions, useComboBox, useListBox} from "react-aria";
import {ComboBoxState, ComboBoxStateOptions, useComboBoxState} from "react-stately";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {FocusRing} from "~/client/design/focus_ring";
import {ModalDialog} from "~/client/design/modal_dialog";
import {OverlayAnimated} from "~/client/design/overlay_animated";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs";
import {useConfirmSaveAfterLosingFocus} from "~/client/helpers/use_confirm_save_after_losing_focus";
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
import {spacing} from "~/shared/design/spacing";
import {themeColors} from "~/shared/design/theme_colors";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {randomInteger} from "~/shared/helpers/number/random_integer";
import {generateId} from "~/shared/id/id";
import {LocalTaskCollectionId} from "~/shared/id/types/id_types";
import {inputPlaceholderStyles, sprinkles} from "~/shared/styles/styles";

type TaskDetailCollectionsFieldItem = {readonly key: never};

// NOCOMMIT: Arrow down when there are no collections should select create
// collection button.

// NOCOMMIT: Clicking create button shouldn't animate overlay away.

export function TaskDetailCollectionsField({
    collections,
    createCollectionAndAddToTask,
    removeCollectionFromTask,
    "aria-labelledby": ariaLabelledBy,
}: {
    collections: ReadonlyArray<LocalTaskCollection>;
    createCollectionAndAddToTask: (collection: LocalTaskCollection) => void;
    removeCollectionFromTask: (collection: LocalTaskCollectionId) => void;
    "aria-labelledby": string;
}) {
    const [inputValue, setInputValue] = useState("");
    const [isCreatingCollection, setIsCreatingCollection] = useState(false);

    const comboBoxProps: ComboBoxStateOptions<TaskDetailCollectionsFieldItem> = {
        menuTrigger: "focus",
        // Don't close when there are no items.
        allowsEmptyCollection: true,

        inputValue,
        onInputChange: setInputValue,

        items: [],
        children: item => item.key,

        // No key is ever selected by the combobox. Instead when a selection occurs we
        // add it to a list of selected values.
        selectedKey: null,
        onSelectionChange: () => {
            // NOCOMMIT
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
                disableAnimationOut={false}
                placement="bottom-start"
                overlay={
                    <Box ref={popoverRef} position="relative">
                        <TaskDetailCollectionsFieldListBox
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
                            opacity: inputValue.length === 0 ? 1 : 0,
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
                        {inputValue}
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
                                    inputValue.length === 0
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
                            value={inputValue}
                            onChange={event => setInputValue(event.currentTarget.value)}
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
    comboBoxState,
    listBoxRef,
    listBoxProps: _listBoxProps,
    onCreateCollection,
}: {
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
            width="64"
            maxHeight="64"
            overflow="hidden"
        >
            <TaskDetailCollectionsFieldListBoxInstructionalPlaceholder
                onCreateCollection={onCreateCollection}
            />
            <ul
                {...listBoxProps}
                ref={listBoxRef}
                className={sprinkles({
                    padding: "1",
                    overflowX: "hidden",
                    overflowY: "scroll",
                    // NOCOMMIT
                    display: "none",
                })}
            ></ul>
        </Box>
    );
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
    createCollectionAndAddToTask: (collection: LocalTaskCollection) => void;
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
