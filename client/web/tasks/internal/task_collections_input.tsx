import {getInteractionModality, setInteractionModality, usePress} from "@react-aria/interactions";
import classNames from "classnames";
import {Plus, SpinnerGap} from "phosphor-react";
import {
    KeyboardEvent,
    Ref,
    createRef,
    forwardRef,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {useComboBox} from "react-aria";
import {flushSync} from "react-dom";
import {ComboBoxStateOptions, useComboBoxState} from "react-stately";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {getNextFocusableElementIfExists} from "~/client/web/design/helpers/get_next_focusable_element.js";
import {InputWithAutoGrowingWidth} from "~/client/web/design/input_with_auto_growing_width.js";
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {navigationBarHeight} from "~/client/web/design/navigation_bar_helpers.js";
import {OverlayAnimated} from "~/client/web/design/overlay_animated.js";
import {subscribeToMobileKeyboardFrameChange} from "~/client/web/design/subscribe_to_mobile_keyboard_frame_change.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/web/design/use_confirm_save_after_losing_focus.js";
import {useGetCurrentCoveredHeight} from "~/client/web/design/use_scroll_to_avoid_bottom_bars_and_mobile_keyboard.js";
import {useTouchSlop} from "~/client/web/design/use_touch_slop.js";
import {isMobileWebKit} from "~/client/web/helpers/browser/is_mobile_web_kit.js";
import {isElementOwnedBy} from "~/client/web/helpers/elements/is_element_owned_by.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {getSpacingScaleWithoutListening} from "~/client/web/remix/spacing_scale_context.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {
    inputPlaceholderStyles,
    spinAnimationClassName,
    sprinkles,
    tasksStyles,
} from "~/client/web/styles/styles.js";
import {
    taskCollectionChipBorderRadius,
    taskCollectionChipHeight,
    taskCollectionChipPaddingY,
} from "~/client/web/styles/tasks_shared_styles.js";
import {
    TaskClientReadonlyStore,
    TaskClientStoreCollectionEntry,
} from "~/client/web/tasks/core/task_client_store.js";
import {createDisplayTaskCollectionsStore} from "~/client/web/tasks/internal/create_display_task_collections_store.js";
import {
    TaskCollectionChip,
    taskCollectionChipContainerMaxWidth,
} from "~/client/web/tasks/internal/task_collection_chip.js";
import {
    TaskCollectionComboBoxCollectionItem,
    TaskCollectionComboBoxItem,
    renderTaskCollectionComboBoxItem,
} from "~/client/web/tasks/internal/task_collection_combo_box_item.js";
import {TaskCollectionComboBoxListBox} from "~/client/web/tasks/internal/task_collection_combo_box_list_box.js";
import {useTaskCollectionComboBoxSearchState} from "~/client/web/tasks/internal/task_collection_combo_box_search_state.js";
import {usePreloadSearchTaskCollectionsByAffinity} from "~/client/web/tasks/internal/use_search_task_collections_by_affinity.js";
import {TaskCollectionChipBase} from "~/client/web/tasks/task_collection_chip_base.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {addRemLengths, convertRemLengthToPx, spacing} from "~/shared/design/core/spacing.js";
import {perceivedAsInstantLimitMs} from "~/shared/design/core/timing.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {Rectangle} from "~/shared/helpers/geometry/rectangle.js";
import {generateOrderKeyBetween} from "~/shared/helpers/sort/order_key.js";
import {generateId, isId} from "~/shared/id/id.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {emptyArrayStore} from "~/shared/store/const_store.js";
import {Store} from "~/shared/store/store.js";
import {TaskActionModel} from "~/shared/tasks/actions/task_action_model.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
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

function TaskCollectionChipWithNavigation({
    store,
    collection,
    tabIndex,
    onRemove,
}: {
    store: TaskClientReadonlyStore;
    collection: TaskCollectionModel;
    tabIndex?: number;
    onRemove?: () => void;
}) {
    const {space} = useSpaceContext();
    const navigate = useNavigate();
    const [isPendingNavigation, setIsPendingNavigation] = useState(false);

    return (
        <TaskCollectionChip
            store={store}
            collection={collection}
            tabIndex={tabIndex}
            onPress={() => {
                if (isPendingNavigation) return;

                setIsPendingNavigation(true);

                navigate(`/s/${space.id}/tasks/collections/${collection.id}`).finally(() => {
                    setIsPendingNavigation(false);
                });
            }}
            onRemove={onRemove}
        />
    );
}

function TaskCollectionsInput(
    {
        store,
        referencesSubscription,
        collections,
        isCreatedCollectionPrivate,
        "aria-label": ariaLabel,
        "aria-labelledby": ariaLabelledBy,
        isReadOnly = false,
        areMarginsClickable = false,
        paddingX,
        paddingY,
        isTabbable = true,
        onArrowLeftLeaveKeyDown,
        onReturnFocus,
        shouldAlignWithDetailViewInputsIfEmpty = false,
        commitActionTransaction,
    }: {
        store: TaskClientReadonlyStore;
        referencesSubscription: {
            getReferencedCollectionEntryStore(
                collectionId: TaskCollectionId,
            ): Store<TaskClientStoreCollectionEntry>;
        } | null;
        collections: TaskCollectionSet;
        isCreatedCollectionPrivate: boolean;
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
        shouldAlignWithDetailViewInputsIfEmpty?: boolean;
        commitActionTransaction: (getActions: (taskId: TaskId) => Array<TaskActionModel>) => void;
    },
    ref: Ref<TaskCollectionsInputRef>,
) {
    const platform = usePlatform();
    const {isAppleDevice} = useClientInfo();
    const {currentAccount} = useSpaceContext();

    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const listBoxRef = useRef<HTMLUListElement>(null);

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

    // Preload task collections the account has an affinity for in case they open the
    // collections dropdown.
    usePreloadSearchTaskCollectionsByAffinity({isDisabled: isReadOnly});

    const [shouldLoadItems, setShouldLoadItems] = useState(false);

    const displayCollections = useStore(
        useMemo(
            () =>
                referencesSubscription
                    ? createDisplayTaskCollectionsStore({
                          currentAccount,
                          referencesSubscription,
                          store,
                          collections,
                      })
                    : emptyArrayStore,
            [collections, currentAccount, referencesSubscription, store],
        ),
    );

    const [inputState, setInputState] = useState<TaskDetailCollectionsFieldInputState>({
        type: "Unfocused",
        value: "",
        disableAnimationOut: false,
    });

    const {shouldShowSearchLoadingIndicator, items} = useTaskCollectionComboBoxSearchState({
        store,
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
        // We need to know whether the combobox is open or not to decide whether we should
        // load collection items.
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

        onBlur: event => {
            // Chrome dispatches a "fake" blur event when the user has an element focused but
            // then clicks on another window, focusing that window but leaving our current
            // window visible. `blur` is dispatched but `document.activeElement` doesn't
            // change!
            //
            // Detect this case. If we receive a `blur` event but `document.activeElement`
            // hasn't changed then escalate to a real blur.
            if (event.target === document.activeElement) {
                event.target.blur();
            }

            // If we're focusing an element with a popup (`role="combobox"` [implicitly has
            // `aria-haspopup="listbox"`][1]) then don't animate out. Since the newly focused
            // element will probably open its popup.
            //
            // This happens when you have this input open then switch to another input by
            // tapping in `<TaskGridViewMobileKeyboardToolbar>`.
            //
            // [1]:
            //     https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-haspopup
            const disableAnimationOut =
                event.relatedTarget instanceof HTMLElement
                    ? (event.relatedTarget.ariaHasPopup ??
                          (event.relatedTarget.role === "combobox" ? "listbox" : null)) !== null
                    : false;

            setInputState(inputState => {
                if (inputState.type === "Unfocused") return inputState;
                return {type: "Unfocused", value: "", disableAnimationOut};
            });
        },

        items: items ?? emptyArray,
        children: renderTaskCollectionComboBoxItem,

        // No key is ever selected by the combobox. Instead when a selection occurs we add
        // it to a list of selected values.
        selectedKey: null,
        onSelectionChange: key => {
            if (typeof key !== "string") return;

            // Currently, accounts without space access can't edit tasks. The max permission
            // level of `urlGrant` is `View`.
            assert(currentAccount);

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

                // `flushSync()` so the `commitActionTransaction()` call (which updates some
                // `useSyncExternalStore()`s) and React state updates render together and we don't
                // get UI tearing.
                flushSync(() => {
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
                    }

                    commitActionTransaction(taskId => [
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
                                // Provide the collection model to the store. It might be out of date. The server
                                // will backfill the new collection once our action has been committed.
                                referencedCollection: item.collectionResult.collection,
                            },
                        },
                    ]);
                });
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

                    // `flushSync()` so the `commitActionTransaction()` call (which updates some
                    // `useSyncExternalStore()`s) and React state updates render together and we don't
                    // get UI tearing.
                    flushSync(() => {
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
                        }

                        commitActionTransaction(taskId => [
                            {
                                type: "UpdateCollection",
                                time: store.clock.now(),
                                collectionId,
                                collectionAction: {
                                    type: "Create",
                                    creatorId: currentAccount.id,
                                    name: inputState.value,
                                    accessPolicy: {
                                        type: "Local",
                                        accountGrantById: new Map([
                                            [currentAccount.id, {level: "Manage", generation: 0}],
                                        ]),
                                        defaultGrant: !isCreatedCollectionPrivate
                                            ? // Default grant generation must be larger than current account generation in the
                                              // access policy. So any other accounts that add themselves to the access policy in
                                              // turn have a generation greater than the current account.
                                              {level: "Manage", generation: 1}
                                            : null,
                                        urlGrant: null,
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
                    });
                }
            }
        },
    };

    const comboBoxState = useComboBoxState(comboBoxProps);

    const collectionRefs = useMemo(
        () => createArrayWithLength(displayCollections.length, () => createRef<HTMLDivElement>()),
        [displayCollections.length],
    );

    const {inputProps, listBoxProps} = useComboBox(
        {
            ...comboBoxProps,
            // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
            // the ref correctly but the type is wrong after upgrading to React v19.
            inputRef,
            // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
            // the ref correctly but the type is wrong after upgrading to React v19.
            popoverRef,
            // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
            // the ref correctly but the type is wrong after upgrading to React v19.
            listBoxRef,
            "aria-label": ariaLabel,
            "aria-labelledby": ariaLabelledBy,
            onKeyDown: event => {
                assert(event.currentTarget instanceof HTMLInputElement);
                assert(event.target instanceof Element);

                switch (event.key) {
                    case "ArrowDown":
                    case "Home":
                    case "End": {
                        setInteractionModality("keyboard");
                        break;
                    }
                    // If we are at the beginning of the combobox text input, the backspace key will
                    // delete the last collection.
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

                            commitActionTransaction(taskId => [
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
                    // If we are at the beginning of the combobox text input, the arrow left key will
                    // focus a previously selected account if we have one.
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
                                const collectionChipElement = collectionRefs[0]!.current!
                                    .firstElementChild! as HTMLElement;
                                collectionChipElement.focus();
                            } else {
                                const collectionChipElement = collectionRefs[
                                    collectionRefs.length - 1
                                ]!.current!.firstElementChild! as HTMLElement;
                                collectionChipElement.focus();
                            }
                        }
                        break;
                    }
                    // If the user presses `ArrowUp` they probably got here by pressing `ArrowDown` on
                    // a collection chip. `ArrowUp` will return them to the previous collection chip if
                    // they're pressing Cmd-ArrowUp or they don't currently have a selected option.
                    case "ArrowUp": {
                        if (isAppleDevice ? event.metaKey : event.ctrlKey) {
                            event.preventDefault();
                            event.stopPropagation();

                            setInteractionModality("keyboard");

                            const collectionChipElement = collectionRefs[0]?.current
                                ?.firstElementChild as HTMLElement | undefined;
                            collectionChipElement?.focus();
                            break;
                        } else if (!inputProps["aria-activedescendant"]) {
                            event.preventDefault();
                            event.stopPropagation();

                            setInteractionModality("keyboard");

                            const currentRect = event.target.getBoundingClientRect();
                            const currentCenter = Rectangle.from(currentRect).center();

                            const candidates: Array<{
                                distance: number;
                                rect: DOMRect;
                                element: HTMLElement;
                            }> = [];

                            for (let i = collectionRefs.length - 1; i >= 0; i--) {
                                const collectionRef = collectionRefs[i]!;

                                const element = collectionRef.current?.firstElementChild as
                                    | HTMLElement
                                    | undefined;
                                if (!element) continue;

                                const rect = element.getBoundingClientRect();
                                if (!(Math.round(rect.bottom) <= Math.round(currentRect.top)))
                                    continue;

                                const distance = Rectangle.from(rect)
                                    .center()
                                    .distanceTo(currentCenter);

                                if (candidates.length === 0) {
                                    candidates.push({distance, rect, element});
                                } else {
                                    const lastCandidate = candidates[candidates.length - 1]!;

                                    // Break once we're on a new line of collection elements.
                                    if (
                                        Math.round(lastCandidate.rect.bottom) !==
                                        Math.round(rect.bottom)
                                    ) {
                                        break;
                                    }

                                    candidates.push({distance, rect, element});
                                }
                            }

                            candidates.sort((a, b) => a.distance - b.distance);

                            if (candidates.length > 0) {
                                candidates[0]!.element.focus();
                            } else {
                                // If there are no candidates for navigating up, focus the first element.
                                const collectionChipElement = collectionRefs[0]?.current
                                    ?.firstElementChild as HTMLElement | undefined;
                                collectionChipElement?.focus();
                            }
                            break;
                        }
                        break;
                    }
                }
            },
        },
        comboBoxState,
    );

    const getCurrentCoveredHeight = useGetCurrentCoveredHeight();

    // When our collections input opens on mobile we need to scroll it into view if
    // it's rendered offscreen.
    //
    // `useScrollToAvoidBottomBarsAndMobileKeyboard()` does nothing when the task date
    // input is focused. Since that hooks is designed to avoid the mobile keyboard when
    // the mobile keyboard opens. However, if the mobile keyboard is already open and
    // the user focuses a date input then we still need to scroll the date input into
    // view. Instead of competing with `useScrollToAvoidBottomBarsAndMobileKeyboard()`
    // we fully implement scroll logic for when the date input is focused here.
    //
    // We have a hook that does basically the same thing in `<TaskDateInput>`. If you
    // make a change here you should also probably make a change there.
    const lastIsOpenRef = useRef(comboBoxState.isOpen);
    useEffect(() => {
        if (lastIsOpenRef.current === comboBoxState.isOpen) return;
        lastIsOpenRef.current = comboBoxState.isOpen;

        if (platform !== "mobile") return;
        if (!comboBoxState.isOpen) return;

        const popoverElement = assertExists(popoverRef.current);
        const popoverRectForMobileWebKit =
            isMobileWebKit && !NativeMobileBridge ? popoverElement.getBoundingClientRect() : null;

        const run = () => {
            // If component has unmounted, don't continue.
            if (!inputRef.current) return;

            const inputElement = inputRef.current;
            const popoverElement = assertExists(popoverRef.current);

            let scrollableElement: HTMLElement | null = inputElement.parentElement;
            while (scrollableElement !== null) {
                const {overflowY} = getComputedStyle(scrollableElement);

                // We found our scrollable element!
                if (overflowY === "scroll" || overflowY === "auto") break;

                scrollableElement = scrollableElement.parentElement;
            }

            if (scrollableElement === null) return;

            const viewportHeight = document.documentElement.getBoundingClientRect().height;

            // NOTE(calebmer, #mobile-webkit-weirdness): For some reason, and I have truly no
            // idea, in Safari (but not in the native app!) when we call
            // `getBoundingClientRect()` for overlay here it gives us the position before
            // Popper.js positioning is applied. But if we call `getBoundingClientRect()`
            // directly in the effect all is fine...
            const popoverRect =
                popoverRectForMobileWebKit ?? popoverElement.getBoundingClientRect();

            const clearanceBottom =
                viewportHeight -
                getCurrentCoveredHeight() -
                convertRemLengthToPx("1", getSpacingScaleWithoutListening());

            if (popoverRect.bottom <= clearanceBottom) return;

            const scrollDelta = popoverRect.bottom - clearanceBottom;

            scrollableElement.scrollTo({
                top: scrollableElement.scrollTop + scrollDelta,
                behavior: "smooth",
            });
        };

        // This effect needs to run after `NativeMobileBridge` calls
        // `keyboard.subscribeToFrameChange` subscribers. That way we can properly avoid
        // the keyboard.
        const cleanup = subscribeToMobileKeyboardFrameChange(() => {
            cleanup();
            timeout.clear();
            run();
        });

        const timeout = createTimeout(() => {
            cleanup();
            timeout.clear();
            run();
        }, perceivedAsInstantLimitMs);
    }, [comboBoxState.isOpen, getCurrentCoveredHeight, platform]);

    const inputPlaceholder = "Add";

    const collectionsChildren = displayCollections.map((collection, index) => {
        const handleKeyDown = (event: KeyboardEvent) => {
            switch (event.key) {
                // Backspace or delete will remove our selected account.
                case "Backspace":
                case "Delete": {
                    event.preventDefault();
                    event.stopPropagation();

                    setInteractionModality("keyboard");

                    commitActionTransaction(taskId => [
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
                        const collectionChipElement = collectionRefs[index + 1]?.current
                            ?.firstElementChild as HTMLElement | undefined;
                        collectionChipElement?.focus();
                    } else {
                        inputRef.current?.focus();
                    }
                    break;
                }
                // Arrow keys navigate through selected accounts. Only the first selected account
                // is focusable since you use arrow keys to navigate between accounts.
                case "ArrowLeft": {
                    event.preventDefault();
                    event.stopPropagation();

                    setInteractionModality("keyboard");

                    if (index === 0) {
                        onArrowLeftLeaveKeyDown?.();
                    } else if (isAppleDevice ? event.metaKey : event.ctrlKey) {
                        const collectionChipElement = collectionRefs[0]?.current
                            ?.firstElementChild as HTMLElement | undefined;
                        collectionChipElement?.focus();
                    } else {
                        const collectionChipElement = collectionRefs[index - 1]?.current
                            ?.firstElementChild as HTMLElement | undefined;
                        collectionChipElement?.focus();
                    }
                    break;
                }
                // Arrow keys navigate through selected accounts. Only the first selected account
                // is focusable since you use arrow keys to navigate between accounts.
                case "ArrowRight": {
                    event.preventDefault();
                    event.stopPropagation();

                    setInteractionModality("keyboard");

                    if (isAppleDevice ? event.metaKey : event.ctrlKey) {
                        inputRef.current?.focus();
                    } else if (index + 1 < collectionRefs.length) {
                        const collectionChipElement = collectionRefs[index + 1]?.current
                            ?.firstElementChild as HTMLElement | undefined;
                        collectionChipElement?.focus();
                    } else {
                        inputRef.current?.focus();
                    }
                    break;
                }
                // Navigate to the collection chip directly below this one. If there are multiple
                // collection chips below this one then we pick the one closest to our current
                // collection chip.
                case "ArrowDown": {
                    event.preventDefault();
                    event.stopPropagation();

                    setInteractionModality("keyboard");

                    if (isAppleDevice ? event.metaKey : event.ctrlKey) {
                        inputRef.current?.focus();
                        break;
                    }

                    const currentElement = collectionRefs[index]?.current?.firstElementChild as
                        | HTMLElement
                        | undefined;
                    if (!currentElement) break;

                    const currentRect = currentElement.getBoundingClientRect();
                    const currentCenter = Rectangle.from(currentRect).center();

                    const candidates: Array<{
                        distance: number;
                        rect: DOMRect;
                        element: HTMLElement;
                    }> = [];

                    for (const collectionRef of collectionRefs.slice(index + 1)) {
                        const element = collectionRef.current?.firstElementChild as
                            | HTMLElement
                            | undefined;
                        if (!element) continue;

                        const rect = element.getBoundingClientRect();
                        if (!(Math.round(rect.top) >= Math.round(currentRect.bottom))) continue;

                        const distance = Rectangle.from(rect).center().distanceTo(currentCenter);

                        if (candidates.length === 0) {
                            candidates.push({distance, rect, element});
                        } else {
                            const lastCandidate = candidates[candidates.length - 1]!;

                            // Break once we're on a new line of collection elements.
                            if (Math.round(lastCandidate.rect.top) !== Math.round(rect.top)) break;

                            candidates.push({distance, rect, element});
                        }
                    }

                    // Add the input to our `candidates` array so it can be navigated to with
                    // `ArrowUp`/`ArrowDown`.
                    if (inputRef.current) {
                        const element = inputRef.current;
                        const rect = element.getBoundingClientRect();

                        if (Math.round(rect.top) >= Math.round(currentRect.bottom)) {
                            const distance = Rectangle.from(rect)
                                .center()
                                .distanceTo(currentCenter);

                            if (candidates.length === 0) {
                                candidates.push({distance, rect, element});
                            } else {
                                const lastCandidate = candidates[candidates.length - 1]!;

                                // Break once we're on a new line of collection elements.
                                if (Math.round(lastCandidate.rect.top) === Math.round(rect.top)) {
                                    candidates.push({distance, rect, element});
                                }
                            }
                        }
                    }

                    candidates.sort((a, b) => a.distance - b.distance);

                    if (candidates.length > 0) {
                        candidates[0]!.element.focus();
                    } else {
                        // If there are no candidates for navigating down, focus the last element.
                        inputRef.current?.focus();
                    }
                    break;
                }
                // Navigate to the collection chip directly above this one. If there are multiple
                // collection chips above this one then we pick the one closest to our current
                // collection chip.
                case "ArrowUp": {
                    event.preventDefault();
                    event.stopPropagation();

                    setInteractionModality("keyboard");

                    if (isAppleDevice ? event.metaKey : event.ctrlKey) {
                        const collectionChipElement = collectionRefs[0]?.current
                            ?.firstElementChild as HTMLElement | undefined;
                        collectionChipElement?.focus();
                        break;
                    }

                    const currentElement = collectionRefs[index]?.current?.firstElementChild as
                        | HTMLElement
                        | undefined;
                    if (!currentElement) break;

                    const currentRect = currentElement.getBoundingClientRect();
                    const currentCenter = Rectangle.from(currentRect).center();

                    const candidates: Array<{
                        distance: number;
                        rect: DOMRect;
                        element: HTMLElement;
                    }> = [];

                    const slicedCollectionRefs = collectionRefs.slice(0, index);
                    for (let i = slicedCollectionRefs.length - 1; i >= 0; i--) {
                        const collectionRef = slicedCollectionRefs[i]!;

                        const element = collectionRef.current?.firstElementChild as
                            | HTMLElement
                            | undefined;
                        if (!element) continue;

                        const rect = element.getBoundingClientRect();
                        if (!(Math.round(rect.bottom) <= Math.round(currentRect.top))) continue;

                        const distance = Rectangle.from(rect).center().distanceTo(currentCenter);

                        if (candidates.length === 0) {
                            candidates.push({distance, rect, element});
                        } else {
                            const lastCandidate = candidates[candidates.length - 1]!;

                            // Break once we're on a new line of collection elements.
                            if (Math.round(lastCandidate.rect.bottom) !== Math.round(rect.bottom))
                                break;

                            candidates.push({distance, rect, element});
                        }
                    }

                    candidates.sort((a, b) => a.distance - b.distance);

                    if (candidates.length > 0) {
                        candidates[0]!.element.focus();
                    } else {
                        // If there are no candidates for navigating up, focus the first element.
                        const collectionChipElement = collectionRefs[0]?.current
                            ?.firstElementChild as HTMLElement | undefined;
                        collectionChipElement?.focus();
                    }
                    break;
                }
                default: {
                    // If the user presses a letter then interpret that as the user trying to replace
                    // the focused account. So delete the selected account and add the text to our
                    // search input.
                    if (
                        /^[0-9a-zA-Z]$/.test(event.key) &&
                        // cmd-z and cmd-shift-z shouldn't remove collection. But shift-z should.
                        !event.metaKey &&
                        !event.altKey &&
                        !event.ctrlKey
                    ) {
                        event.preventDefault();
                        event.stopPropagation();

                        setInteractionModality("keyboard");

                        commitActionTransaction(taskId => [
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
            <FocusRing key={collection.id} isVisibleWhenFocusWithin>
                <Box
                    ref={collectionRefs[index]}
                    overflow="hidden"
                    height={taskCollectionChipHeight}
                    // Chips have a height of 5 (on desktop, 7 on mobile) but a single-line field input
                    // should have a height of 4. Use negative margin to position correctly.
                    marginY={{desktop: "-0.5", mobile: "-1.5"}}
                    // Use horizontal margin to properly align collection ships vertically with other
                    // detail view input fields like assignee and due date.
                    marginLeft="-0.5"
                    borderRadius={taskCollectionChipBorderRadius}
                    style={{maxWidth: taskCollectionChipContainerMaxWidth}}
                    onKeyDown={handleKeyDown}
                >
                    <TaskCollectionChipWithNavigation
                        store={store}
                        collection={collection}
                        // The first selected account is focusable via tab and you can use arrow keys to
                        // focus the others.
                        tabIndex={isReadOnly ? undefined : index === 0 && isTabbable ? 0 : -1}
                        onRemove={
                            !isReadOnly
                                ? () => {
                                      commitActionTransaction(taskId => [
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

    const inputHeight = "4";
    const inputTouchSlop = useTouchSlop(inputHeight);

    return (
        <Box
            ref={containerRef}
            data-testid={process.env.NODE_ENV !== "production" ? "TaskCollectionsInput" : undefined}
            position="relative"
            zIndex="0"
            display="flex"
            alignItems="center"
            flexWrap="wrap"
            rowGap={{desktop: "3", mobile: "5"}}
            columnGap="2.5"
            paddingX={paddingX}
            paddingY={paddingY}
            onBlur={event => {
                if (
                    !event.relatedTarget ||
                    !isElementOwnedBy(event.currentTarget, event.relatedTarget)
                ) {
                    onReturnFocus?.();
                }
            }}
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
            {isReadOnly && displayCollections.length === 0 ? (
                <Box style={inputPlaceholderStyles}>None</Box>
            ) : (
                collectionsChildren
            )}
            {createCollectionInputState.isVisible && (
                <Box
                    overflow="hidden"
                    height={taskCollectionChipHeight}
                    // Chips have a height of 5 (on desktop, 7 on mobile) but a single-line field input
                    // should have a height of 4. Use negative margin to position correctly.
                    marginY={{desktop: "-0.5", mobile: "-1.5"}}
                    marginLeft="-0.5"
                    borderRadius={taskCollectionChipBorderRadius}
                    style={{maxWidth: taskCollectionChipContainerMaxWidth}}
                >
                    <TaskCollectionInputCreateCollectionInput
                        isCreatedCollectionPrivate={isCreatedCollectionPrivate}
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
                            // Currently, accounts without space access can't edit tasks. The max permission
                            // level of `urlGrant` is `View`.
                            assert(currentAccount);

                            const collectionId = generateId<TaskCollectionId>();

                            commitActionTransaction(taskId => [
                                {
                                    type: "UpdateCollection",
                                    time: store.clock.now(),
                                    collectionId,
                                    collectionAction: {
                                        type: "Create",
                                        creatorId: currentAccount.id,
                                        name: inputValue,
                                        accessPolicy: {
                                            type: "Local",
                                            accountGrantById: new Map([
                                                [
                                                    currentAccount.id,
                                                    {level: "Manage", generation: 0},
                                                ],
                                            ]),
                                            defaultGrant: !isCreatedCollectionPrivate
                                                ? // Default grant generation must be larger than current account generation in the
                                                  // access policy. So any other accounts that add themselves to the access policy in
                                                  // turn have a generation greater than the current account.
                                                  {level: "Manage", generation: 1}
                                                : null,
                                            urlGrant: null,
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
            {!isReadOnly && (
                <OverlayAnimated
                    isVisible={comboBoxState.isOpen}
                    // Mobile collection chips are bigger so add more offset.
                    offset={platform === "mobile" ? "2.5" : "1.5"}
                    disableAnimationIn={true}
                    disableAnimationOut={
                        inputState.type === "Unfocused" && inputState.disableAnimationOut
                    }
                    placement="bottom-start"
                    // If we're approaching the edge of the screen (like in a row cell) don't allow
                    // flipping horizontally but still allow flipping vertically.
                    //
                    // Don't allow flipping vertically on mobile. Instead
                    // `useScrollToAvoidBottomBarsAndMobileKeyboard()` should kick in to make sure the
                    // overlay is visible.
                    fallbackPlacements={platform !== "mobile" ? ["top-start"] : []}
                    // The overlay blocks interaction with everything outside the overlay. Except the
                    // combobox input. We still want to render the overlay in our current overlay scope
                    // so that it animates smoothly with scroll animations (important on mobile when we
                    // need to avoid the keyboard).
                    isBlocking={true}
                    withoutRootBlockingScope={true}
                    withoutBlockingTarget={true}
                    onBlockingCoverPointerDown={() => {
                        if (document.activeElement instanceof HTMLElement)
                            document.activeElement.blur();
                    }}
                    // Set a constant `overflowBottom` value instead of relying on the current keyboard
                    // height (which will be updated asynchronously after `isEditing` is true). This
                    // stops the overlay placement from jumping around while the keyboard opens. The
                    // value was calculated based on the keyboard height in iOS. We may need to change
                    // this constant if the keyboard height for iOS changes or the Android keyboard
                    // height is bigger.
                    overflowBottom={platform === "mobile" ? "18rem" : undefined}
                    overflowTop={navigationBarHeight}
                    overlay={
                        <Box
                            ref={popoverRef}
                            className={greyElevated2ClassName}
                            position="relative"
                            borderRadius="1.5"
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
                        minWidth="flex-fit"
                        maxWidth="full"
                        display="flex"
                        alignItems="center"
                        gap="2"
                    >
                        <Box
                            position="relative"
                            zIndex="0"
                            maxWidth="full"
                            height={inputTouchSlop.sizeWithSlop}
                            paddingY={inputTouchSlop.slop}
                            marginY={`-${inputTouchSlop.slop}`}
                            // The width of this element is determined by nested text boxes when `inline`. The
                            // `<input>` then uses the parent width as its own width.
                            //
                            // We don't use `<InputWithAutoGrowingWidth>` because we want to render a custom
                            // icon with the placeholder. Though our implementation here should closely follow
                            // `<InputWithAutoGrowingWidth>`.
                            display="inline-block"
                            onKeyDown={event => {
                                if (event.key === "Escape") {
                                    event.preventDefault();
                                    event.stopPropagation();

                                    assert(event.target instanceof HTMLElement);
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
                            <FocusRing insetY={inputTouchSlop.slop}>
                                <input
                                    {...inputProps}
                                    ref={inputRef}
                                    type="text"
                                    tabIndex={!isTabbable ? -1 : undefined}
                                    className={classNames(
                                        tasksStyles.collectionsInputAddInputClassName,
                                        sprinkles({
                                            position: "absolute",
                                            inset: "0",
                                            display: "inline-block",
                                            backgroundColor: "transparent",
                                            borderRadius: "none",
                                        }),
                                    )}
                                    style={{
                                        paddingLeft:
                                            inputState.value.length === 0
                                                ? shouldAlignWithDetailViewInputsIfEmpty &&
                                                  displayCollections.length === 0
                                                    ? spacing["5"]
                                                    : addRemLengths("3", "0.5")
                                                : undefined,
                                    }}
                                    // By default `<input>` elements have a `min-width` determined by the `size`
                                    // property. We want our `<input>`s `min-width` to be determined by our CSS so set
                                    // it to a small value as not to matter.
                                    // https://stackoverflow.com/questions/29470676/why-doesnt-the-input-element-respect-min-width
                                    size={1}
                                    // Use `aria-placeholder` since the placeholder text is rendered by another DOM
                                    // element with an icon.
                                    aria-placeholder={inputPlaceholder}
                                    // Allow iOS and MacOS autocorrect and spell checking. By default `react-aria`
                                    // disables these capabilities because the user has combobox suggestions. However,
                                    // fixing typos at the OS level when typos are common (like on iOS) is really
                                    // useful.
                                    autoCorrect={undefined}
                                    spellCheck={undefined}
                                    onKeyDown={event => {
                                        if (
                                            event.key === "Enter" &&
                                            comboBoxState.selectionManager.focusedKey == null
                                        ) {
                                            // NOTE(calebmer): By default, `@react-aria/combobox` [calls `state.commit()`
                                            // whenever `Enter` is pressed][1] whether or not an option is focused. If an
                                            // option isn't focused this just closes the combobox and leaves the user confused.
                                            // Is what they typed the new value or not? It's not, you can tell since the avatar
                                            // doesn't change. This is particularly confusing on mobile where the user may hit
                                            // the return key expecting the first value in the menu to be selected. But that
                                            // won't happen, the menu will just close.
                                            //
                                            // So intercept this case and don't call into `@react-aria/combobox`.
                                            //
                                            // [1]:
                                            //     https://github.com/adobe/react-spectrum/blob/e7b1c7fa869fbf3f03194f98c3e2f35c9861a613/packages/%40react-aria/combobox/src/useComboBox.ts#L132
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
    isCreatedCollectionPrivate,
    onCancel,
    onConfirm,
}: {
    isCreatedCollectionPrivate: boolean;
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
                    isPrivate={isCreatedCollectionPrivate}
                    name={
                        <Box
                            minWidth="flex-fit"
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
                        // Return focus to the editor if the dialog is closed. This acts as a "cancel" and
                        // lets the user continue writing.
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
