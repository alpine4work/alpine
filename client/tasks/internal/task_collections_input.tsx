import {getInteractionModality, usePress} from "@react-aria/interactions";
import classNames from "classnames";
import {Plus, SpinnerGap} from "phosphor-react";
import {
    KeyboardEvent,
    Ref,
    createRef,
    forwardRef,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {useComboBox} from "react-aria";
import {ComboBoxStateOptions, useComboBoxState} from "react-stately";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {getNextFocusableElementIfExists} from "~/client/design/helpers/get_next_focusable_element.js";
import {ModalDialog} from "~/client/design/modal_dialog.js";
import {OverlayAnimated} from "~/client/design/overlay_animated.js";
import {useShowToast} from "~/client/design/toast.js";
import {defaultTooltipOffset} from "~/client/design/tooltip.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/design/use_confirm_save_after_losing_focus.js";
import {isElementOwnedBy} from "~/client/helpers/elements/is_element_owned_by.js";
import {InputWithAutoGrowingWidth} from "~/client/helpers/input_with_auto_growing_width.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useRootNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {createDisplayTaskCollectionsStore} from "~/client/tasks/internal/create_display_task_collections_store.js";
import {
    TaskCollectionChip,
    taskCollectionChipContainerMaxWidth,
} from "~/client/tasks/internal/task_collection_chip.js";
import {
    TaskCollectionChipBase,
    taskCollectionChipBorderRadius,
    taskCollectionChipHeight,
    taskCollectionChipPaddingY,
} from "~/client/tasks/internal/task_collection_chip_base.js";
import {
    TaskCollectionComboBoxCollectionItem,
    TaskCollectionComboBoxItem,
    TaskCollectionComboBoxListBox,
    renderTaskCollectionComboBoxItem,
    useTaskCollectionComboBoxSearchState,
} from "~/client/tasks/internal/task_collection_combo_box_base.js";
import {usePreloadAffinitiveTaskCollections} from "~/client/tasks/internal/use_affinitive_task_collections.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {
    TaskClientStoreSearchAffinityManager,
    TaskClientStoreUndoManager,
} from "~/client/tasks/task_client_store.js";
import {TaskClientTaskSubscription} from "~/client/tasks/task_client_task_subscription.js";
import {addRemLengths, spacing} from "~/shared/design/spacing.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateOrderKeyBetween} from "~/shared/helpers/sort/order_key.js";
import {generateId, isId} from "~/shared/id/id.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {
    greyElevated2ClassName,
    inputPlaceholderStyles,
    spinAnimationClassName,
    sprinkles,
    tasksStyles,
} from "~/shared/styles/styles.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";

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

export type TaskCollectionsInputRef = {
    isFocusWithin(): boolean;
    focusStart(): void;
};

const TaskCollectionsInputForwardRef = forwardRef(TaskCollectionsInput);
export {TaskCollectionsInputForwardRef as TaskCollectionsInput};

function TaskCollectionsInput(
    {
        referencesSubscription,
        undoManager,
        affinityManager,
        task,
        "aria-label": ariaLabel,
        "aria-labelledby": ariaLabelledBy,
        isReadOnly = false,
        shouldNotRenderInput = false,
        areMarginsClickable = false,
        paddingX,
        paddingY,
        isTabbable = true,
        onArrowLeftLeaveKeyDown,
        onReturnFocus,
        commitActionTransactionEvenIfGhost: _commitActionTransactionEvenIfGhost,
        shouldAlignWithDetailViewInputsIfEmpty = false,
    }: {
        referencesSubscription: TaskClientQuery | TaskClientTaskSubscription;
        undoManager: TaskClientStoreUndoManager;
        affinityManager: TaskClientStoreSearchAffinityManager;
        task: TaskModel | null;
        "aria-label"?: string;
        "aria-labelledby"?: string;
        isReadOnly?: boolean;
        shouldNotRenderInput?: boolean;
        areMarginsClickable?: boolean;
        paddingX?: "3";
        paddingY?: "3";
        isTabbable?: boolean;
        onArrowLeftLeaveKeyDown?: () => void;
        onReturnFocus?: () => void;
        commitActionTransactionEvenIfGhost?: (
            getActions: (taskId: TaskId) => Array<TaskAction>,
            options?: {referencedCollections?: ReadonlyArray<TaskCollectionModel>},
        ) => void;
        shouldAlignWithDetailViewInputsIfEmpty?: boolean;
    },
    ref: Ref<TaskCollectionsInputRef>,
) {
    const isMobile = useIsMobile();
    const {isAppleDevice} = useClientInfo();
    const context = useAppContext();
    const rootNavigate = useRootNavigate();
    const showToast = useShowToast();
    const {space, currentAccount} = useSpaceContext();
    const {store} = referencesSubscription;

    const containerRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(
        ref,
        () => ({
            isFocusWithin: () =>
                !!document.activeElement &&
                isElementOwnedBy(assertExists(containerRef.current), document.activeElement),
            focusStart: () => {
                getNextFocusableElementIfExists(null, {
                    withinElement: assertExists(containerRef.current),
                })?.focus();
            },
        }),
        [],
    );

    const collections = task?.getCollections() ?? TaskCollectionSet.empty;

    const commitActionTransactionEvenIfGhost =
        _commitActionTransactionEvenIfGhost ??
        ((
            getActions: (taskId: TaskId) => Array<TaskAction>,
            options?: {referencedCollections?: ReadonlyArray<TaskCollectionModel>},
        ) => {
            if (!task) return;
            store.commitTaskActionTransaction(context, getActions(task.id), {
                ...options,
                undoManager,
                affinityManager,
            });
        });

    // Preload task collections the account has an affinity for in case they open
    // the collections dropdown.
    usePreloadAffinitiveTaskCollections();

    const [shouldLoadItems, setShouldLoadItems] = useState(false);

    const displayCollections = useStore(
        useMemo(
            () =>
                createDisplayTaskCollectionsStore({
                    currentAccount,
                    referencesSubscription,
                    collections,
                }),
            [collections, currentAccount, referencesSubscription],
        ),
    );

    const [inputState, setInputState] = useState<TaskDetailCollectionsFieldInputState>({
        type: "Unfocused",
        value: "",
        disableAnimationOut: false,
    });

    const {shouldShowSearchLoadingIndicator, items} = useTaskCollectionComboBoxSearchState({
        store: referencesSubscription.store,
        inputValue: inputState.value,
        // Only load items when our overlay is open.
        shouldLoadItems,
        excludeCollectionIds: useMemo(
            () => new Set(displayCollections.map(collection => collection.id)),
            [displayCollections],
        ),
    });

    const [createCollectionInputState, setCreateCollectionInputState] = useState<
        {isVisible: false} | {isVisible: true; shouldReturnFocusToInput: boolean}
    >({
        isVisible: false,
    });

    const comboBoxProps: ComboBoxStateOptions<TaskCollectionComboBoxItem> = {
        // We need to know whether the combobox is open or not to decide whether we
        // should load collection items.
        onOpenChange: setShouldLoadItems,

        menuTrigger: "focus",
        // Don't close when there are no items.
        allowsEmptyCollection: true,
        isDisabled: isReadOnly,

        inputValue: inputState.value,
        onInputChange: inputValue => {
            setInputState(inputState => {
                if (inputState.type !== "Focused") return inputState;
                return {type: "Focused", value: inputValue};
            });
        },

        onFocus: () => {
            // Open the combobox on focus.
            comboBoxState.open();

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

        items: items ?? emptyArray,
        children: renderTaskCollectionComboBoxItem,

        // No key is ever selected by the combobox. Instead when a selection occurs we
        // add it to a list of selected values.
        selectedKey: null,
        onSelectionChange: key => {
            if (typeof key !== "string") return;

            const shouldReturnFocusToInput = getInteractionModality() !== "pointer";

            if (key.startsWith("Collection:")) {
                const collectionId = key.slice("Collection:".length);
                assert(isId<TaskCollectionId>(collectionId));

                const item = assertExists(
                    items?.find(
                        (item): item is TaskCollectionComboBoxCollectionItem =>
                            item.type === "Collection" &&
                            item.collectionResult.collection.id === collectionId,
                    ),
                );

                commitActionTransactionEvenIfGhost(
                    taskId => [
                        {
                            type: "UpdateTask",
                            time: store.clock.now(),
                            taskId,
                            taskAction: {
                                type: "AddCollection",
                                collectionId,
                                orderKey: generateOrderKeyBetween(
                                    collections.getLastOrderKey(),
                                    null,
                                ),
                            },
                        },
                    ],
                    {
                        // Provide the collection model to the store. It might be out of date. The
                        // server will backfill the new collection once our action has been committed.
                        referencedCollections: [item.collectionResult.collection],
                    },
                );

                if (shouldReturnFocusToInput) {
                    setInputState(inputState => {
                        if (inputState.type === "Unfocused") return inputState;
                        return {type: "Focused", value: ""};
                    });
                } else {
                    setInputState(inputState => {
                        if (inputState.type === "Unfocused") return inputState;
                        return {type: "Unfocused", value: "", disableAnimationOut: true};
                    });

                    assertExists(inputRef.current).blur();

                    onReturnFocus?.();
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
                    const collectionId = generateId<TaskCollectionId>();

                    commitActionTransactionEvenIfGhost(taskId => [
                        {
                            type: "UpdateCollection",
                            time: store.clock.now(),
                            collectionId,
                            collectionAction: {
                                type: "Create",
                                creatorId: currentAccount.id,
                                name: inputState.value,
                                accessPolicy: {
                                    accountGrantById: new Map([
                                        [currentAccount.id, {level: "Manage"}],
                                    ]),
                                    defaultGrant: null,
                                },
                            },
                        },
                        {
                            type: "UpdateTask",
                            time: store.clock.now(),
                            taskId,
                            taskAction: {
                                type: "AddCollection",
                                collectionId,
                                orderKey: generateOrderKeyBetween(
                                    collections.getLastOrderKey(),
                                    null,
                                ),
                            },
                        },
                    ]);

                    if (shouldReturnFocusToInput) {
                        setInputState(inputState => {
                            if (inputState.type === "Unfocused") return inputState;
                            return {type: "Focused", value: ""};
                        });
                    } else {
                        setInputState(inputState => {
                            if (inputState.type === "Unfocused") return inputState;
                            return {type: "Unfocused", value: "", disableAnimationOut: true};
                        });

                        assertExists(inputRef.current).blur();

                        onReturnFocus?.();
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
        () => createArrayWithLength(displayCollections.length, () => createRef<HTMLDivElement>()),
        [displayCollections.length],
    );

    const {inputProps, listBoxProps} = useComboBox(
        {
            ...comboBoxProps,
            inputRef,
            popoverRef,
            listBoxRef,
            "aria-label": ariaLabel,
            "aria-labelledby": ariaLabelledBy,
            onKeyDown: event => {
                assert(event.currentTarget instanceof HTMLInputElement);
                switch (event.key) {
                    // If we are at the beginning of the combobox text input, the backspace key
                    // will delete the last collection.
                    case "Backspace": {
                        if (
                            displayCollections.length > 0 &&
                            event.currentTarget.selectionStart ===
                                event.currentTarget.selectionEnd &&
                            event.currentTarget.selectionStart === 0
                        ) {
                            event.preventDefault();
                            event.stopPropagation();

                            const collection = displayCollections[displayCollections.length - 1]!;

                            commitActionTransactionEvenIfGhost(taskId => [
                                {
                                    type: "UpdateTask",
                                    time: store.clock.now(),
                                    taskId,
                                    taskAction: {
                                        type: "RemoveCollection",
                                        collectionId: collection.id,
                                    },
                                },
                            ]);
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
                            event.stopPropagation();

                            if (isAppleDevice ? event.metaKey : event.ctrlKey) {
                                collectionRefs[0]!.current!.focus();
                            } else {
                                collectionRefs[collectionRefs.length - 1]!.current!.focus();
                            }
                        }
                        break;
                    }
                }
            },
        },
        comboBoxState,
    );

    const inputPlaceholder = "Add";

    const collectionsChildren = displayCollections.map((collection, index) => {
        const handleKeyDown = (event: KeyboardEvent) => {
            switch (event.key) {
                // Backspace or delete will remove our selected account.
                case "Backspace":
                case "Delete": {
                    event.preventDefault();
                    event.stopPropagation();

                    commitActionTransactionEvenIfGhost(taskId => [
                        {
                            type: "UpdateTask",
                            time: store.clock.now(),
                            taskId,
                            taskAction: {
                                type: "RemoveCollection",
                                collectionId: collection.id,
                            },
                        },
                    ]);

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

                    if (index === 0) {
                        onArrowLeftLeaveKeyDown?.();
                    } else if (isAppleDevice ? event.metaKey : event.ctrlKey) {
                        collectionRefs[0]?.current?.focus();
                    } else {
                        collectionRefs[index - 1]?.current?.focus();
                    }
                    break;
                }
                // Arrow keys navigate through selected accounts. Only the first selected
                // account is focusable since you use arrow keys to navigate between accounts.
                case "ArrowRight": {
                    event.preventDefault();
                    event.stopPropagation();
                    if (isAppleDevice ? event.metaKey : event.ctrlKey) {
                        inputRef.current?.focus();
                    } else if (index + 1 < collectionRefs.length) {
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
                    if (
                        /^[0-9a-zA-Z]$/.test(event.key) &&
                        // cmd-z and cmd-shift-z shouldn't remove collection. But shift-z should.
                        !event.metaKey &&
                        !event.altKey &&
                        !event.ctrlKey
                    ) {
                        event.preventDefault();
                        event.stopPropagation();

                        commitActionTransactionEvenIfGhost(taskId => [
                            {
                                type: "UpdateTask",
                                time: store.clock.now(),
                                taskId,
                                taskAction: {
                                    type: "RemoveCollection",
                                    collectionId: collection.id,
                                },
                            },
                        ]);

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
                    // Chips have a height of 5 but a single-line field input should have a height
                    // of 4. Use negative margin to position correctly.
                    marginY="-0.5"
                    // Use horizontal margin to properly align collection ships vertically with
                    // other detail view input fields like assignee and due date.
                    marginLeft="-0.5"
                    borderRadius={taskCollectionChipBorderRadius}
                    style={{maxWidth: taskCollectionChipContainerMaxWidth}}
                    // The first selected account is focusable via tab and you can use arrow keys
                    // to focus the others.
                    tabIndex={isReadOnly ? undefined : index === 0 && isTabbable ? 0 : -1}
                    onKeyDown={handleKeyDown}
                >
                    <TaskCollectionChip
                        collection={collection}
                        onPress={() => {
                            // TODO(calebmer, #global-loading-indicator): Some global loading indicator?
                            rootNavigate(`/s/${space.id}/tasks/collections/${collection.id}`).catch(
                                error => {
                                    showToast({
                                        type: "Error",
                                        title: "Can’t open collection",
                                        error,
                                    });
                                },
                            );
                        }}
                        onRemove={
                            !isReadOnly
                                ? () => {
                                      commitActionTransactionEvenIfGhost(taskId => [
                                          {
                                              type: "UpdateTask",
                                              time: store.clock.now(),
                                              taskId,
                                              taskAction: {
                                                  type: "RemoveCollection",
                                                  collectionId: collection.id,
                                              },
                                          },
                                      ]);
                                  }
                                : undefined
                        }
                    />
                </Box>
            </FocusRing>
        );
    });

    const {pressProps: backdropPressProps} = usePress({
        // Backdrop doesn't receive focus.
        preventFocusOnPress: true,

        onPressStart: event => {
            // Focus on `pointerdown` if this is the mouse. Focus on `pointerup` if this is
            // touch. Because a touch press gesture might actually be a scroll. If the user
            // starts scrolling that cancels our press.
            if (event.pointerType === "mouse") {
                assertExists(inputRef.current).focus({preventScroll: true});
            }
        },
        onPress: event => {
            // Focus on `pointerdown` if this is the mouse. Focus on `pointerup` if this is
            // touch. Because a touch press gesture might actually be a scroll. If the user
            // starts scrolling that cancels our press.
            if (event.pointerType !== "mouse") {
                assertExists(inputRef.current).focus({preventScroll: true});
            }
        },
    });

    return (
        <Box
            ref={containerRef}
            data-testid={process.env.NODE_ENV !== "production" ? "TaskCollectionsInput" : undefined}
            position="relative"
            zIndex="0"
            display="flex"
            alignItems="center"
            flexWrap="wrap"
            rowGap="3"
            columnGap="2.5"
            paddingX={paddingX}
            paddingY={paddingY}
        >
            {!isReadOnly && areMarginsClickable && (
                <div
                    {...backdropPressProps}
                    className={sprinkles({
                        position: "absolute",
                        zIndex: "-10",
                        inset: "0",
                        cursor: "text",
                    })}
                />
            )}
            {collectionsChildren}
            {createCollectionInputState.isVisible && (
                <Box
                    overflow="hidden"
                    marginY="-0.5"
                    marginLeft="-0.5"
                    style={{maxWidth: taskCollectionChipContainerMaxWidth}}
                >
                    <TaskCollectionInputCreateCollectionInput
                        onCancel={() => {
                            setCreateCollectionInputState({isVisible: false});

                            if (
                                createCollectionInputState.shouldReturnFocusToInput &&
                                getInteractionModality() === "keyboard"
                            ) {
                                assertExists(inputRef.current).focus({preventScroll: true});
                            } else {
                                onReturnFocus?.();
                            }
                        }}
                        onConfirm={inputValue => {
                            const collectionId = generateId<TaskCollectionId>();

                            commitActionTransactionEvenIfGhost(taskId => [
                                {
                                    type: "UpdateCollection",
                                    time: store.clock.now(),
                                    collectionId,
                                    collectionAction: {
                                        type: "Create",
                                        creatorId: currentAccount.id,
                                        name: inputValue,
                                        accessPolicy: {
                                            accountGrantById: new Map([
                                                [currentAccount.id, {level: "Manage"}],
                                            ]),
                                            defaultGrant: null,
                                        },
                                    },
                                },
                                {
                                    type: "UpdateTask",
                                    time: store.clock.now(),
                                    taskId,
                                    taskAction: {
                                        type: "AddCollection",
                                        collectionId,
                                        orderKey: generateOrderKeyBetween(
                                            collections.getLastOrderKey(),
                                            null,
                                        ),
                                    },
                                },
                            ]);

                            setCreateCollectionInputState({isVisible: false});

                            if (
                                createCollectionInputState.shouldReturnFocusToInput &&
                                getInteractionModality() === "keyboard"
                            ) {
                                assertExists(inputRef.current).focus({preventScroll: true});
                            } else {
                                onReturnFocus?.();
                            }
                        }}
                    />
                </Box>
            )}
            {!shouldNotRenderInput && (
                <OverlayAnimated
                    isVisible={comboBoxState.isOpen}
                    offset={defaultTooltipOffset}
                    disableAnimationIn={true}
                    disableAnimationOut={
                        inputState.type === "Unfocused" && inputState.disableAnimationOut
                    }
                    placement="bottom-start"
                    // If we're approaching the edge of the screen (like in a row cell) don't allow
                    // flipping horizontally but still allow flipping vertically.
                    //
                    // Don't allow flipping vertically on mobile. Instead
                    // `useScrollToAvoidBottomBarsAndMobileKeyboard()` should kick in to make sure
                    // the overlay is visible.
                    fallbackPlacements={!isMobile ? ["top-start"] : []}
                    overlay={
                        <Box
                            ref={popoverRef}
                            className={greyElevated2ClassName}
                            position="relative"
                            borderRadius="md"
                            backgroundColor="grey-0"
                            boxShadow="elevation-20"
                            width="64"
                            maxHeight="64"
                            overflow="hidden"
                            display="flex"
                            flexDirection="column"
                        >
                            <TaskCollectionComboBoxListBox
                                comboBoxState={comboBoxState}
                                listBoxRef={listBoxRef}
                                listBoxProps={listBoxProps}
                            />
                        </Box>
                    }
                >
                    <Box
                        maxWidth="full"
                        overflow="hidden"
                        display="flex"
                        alignItems="center"
                        gap="2"
                    >
                        <Box
                            position="relative"
                            zIndex="0"
                            maxWidth="full"
                            overflow="hidden"
                            // The width of this element is determined by nested text boxes when `inline`.
                            // The `<input>` then uses the parent width as its own width.
                            //
                            // We don't use `<InputWithAutoGrowingWidth>` because we want to render a custom
                            // icon with the placeholder. Though our implementation here should closely
                            // follow `<InputWithAutoGrowingWidth>`.
                            display="inline-block"
                            onKeyDown={event => {
                                if (event.key === "Escape") {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    event.target.blur();
                                    return;
                                }
                            }}
                        >
                            <Box
                                position="relative"
                                zIndex="-10"
                                display="flex"
                                alignItems="center"
                                gap={
                                    shouldAlignWithDetailViewInputsIfEmpty &&
                                    displayCollections.length === 0
                                        ? "1"
                                        : "0.5"
                                }
                                pointerEvents="none"
                                // This is accessible through `aria-placeholder` on the `<input>`.
                                aria-hidden={true}
                                style={{
                                    ...inputPlaceholderStyles,
                                    opacity: inputState.value.length === 0 ? 1 : 0,
                                }}
                            >
                                <Box
                                    paddingX={
                                        shouldAlignWithDetailViewInputsIfEmpty &&
                                        displayCollections.length === 0
                                            ? "0.5"
                                            : undefined
                                    }
                                >
                                    <Plus size={spacing["3"]} />
                                </Box>
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
                                    tabIndex={!isTabbable ? -1 : undefined}
                                    className={classNames(
                                        tasksStyles.taskCollectionsInputAddInputClassName,
                                        sprinkles({
                                            position: "absolute",
                                            inset: "0",
                                            display: "inline-block",
                                            backgroundColor: "transparent",
                                        }),
                                    )}
                                    style={{
                                        paddingLeft:
                                            inputState.value.length === 0
                                                ? shouldAlignWithDetailViewInputsIfEmpty &&
                                                  displayCollections.length === 0
                                                    ? spacing["5"]
                                                    : addRemLengths(spacing["3"], spacing["0.5"])
                                                : undefined,
                                    }}
                                    // By default `<input>` elements have a `min-width` determined by the `size`
                                    // property. We want our `<input>`s `min-width` to be determined by our CSS
                                    // so set it to a small value as not to matter.
                                    // https://stackoverflow.com/questions/29470676/why-doesnt-the-input-element-respect-min-width
                                    size={1}
                                    // Use `aria-placeholder` since the placeholder text is rendered by another DOM
                                    // element with an icon.
                                    aria-placeholder={inputPlaceholder}
                                    onKeyDown={event => {
                                        if (
                                            event.key === "Enter" &&
                                            comboBoxState.selectionManager.focusedKey == null
                                        ) {
                                            // NOTE(calebmer): By default, `@react-aria/combobox` [calls `state.commit()`
                                            // whenever `Enter` is pressed][1] whether or not an option is focused. If an
                                            // option isn't focused this just closes the combobox and leaves the user
                                            // confused. Is what they typed the new value or not? It's not, you can tell
                                            // since the avatar doesn't change. This is particularly confusing on mobile
                                            // where the user may hit the return key expecting the first value in the menu
                                            // to be selected. But that won't happen, the menu will just close.
                                            //
                                            // So intercept this case and don't call into `@react-aria/combobox`.
                                            //
                                            // [1]: https://github.com/adobe/react-spectrum/blob/e7b1c7fa869fbf3f03194f98c3e2f35c9861a613/packages/%40react-aria/combobox/src/useComboBox.ts#L132
                                        } else {
                                            inputProps.onKeyDown?.(event);
                                        }
                                    }}
                                />
                            </FocusRing>
                        </Box>
                        {shouldShowSearchLoadingIndicator && (
                            <Box flexShrink="0">
                                <SpinnerGap
                                    className={spinAnimationClassName}
                                    size={spacing["3"]}
                                />
                            </Box>
                        )}
                    </Box>
                </OverlayAnimated>
            )}
        </Box>
    );
}

function TaskCollectionInputCreateCollectionInput({
    onCancel,
    onConfirm,
}: {
    onCancel: () => void;
    onConfirm: (inputValue: string) => void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const inputPlaceholder = "Name";
    const [inputValue, setInputValue] = useState("");
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

        onConfirm(inputValue);
    };

    return (
        <>
            <FocusRing isVisibleWhenFocusWithin>
                <TaskCollectionChipBase
                    color={null}
                    name={
                        <Box
                            height={taskCollectionChipHeight}
                            marginY={`-${taskCollectionChipPaddingY}`}
                        >
                            <InputWithAutoGrowingWidth
                                type="text"
                                tabIndex={-1}
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
                                            }
                                            break;
                                        }
                                        case "Escape": {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            onCancel();
                                            break;
                                        }
                                    }
                                }}
                            />
                        </Box>
                    }
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
