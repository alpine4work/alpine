import {getInteractionModality} from "@react-aria/interactions";
import {
    Ref,
    RefCallback,
    forwardRef,
    useCallback,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {mergeProps, useHover, usePress} from "react-aria";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {useOutsideInteraction} from "~/client/design/helpers/use_outside_interaction.js";
import {InputWithAutoGrowingWidth} from "~/client/design/input_with_auto_growing_width.js";
import {ModalDialog} from "~/client/design/modal_dialog.js";
import {OverlayAnimated} from "~/client/design/overlay_animated.js";
import {scheduleAfterNavigationAnimation} from "~/client/design/schedule_after_navigation_animation.js";
import {Tooltip} from "~/client/design/tooltip.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/design/use_confirm_save_after_losing_focus.js";
import {useInputWithAutoGrowingWidthSafeSpacerElement} from "~/client/design/use_input_with_auto_growing_width_safe_spacer_element.js";
import {useIsFocusRingVisible} from "~/client/design/use_is_focus_ring_visible.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useAddGlobalLoadingIndicator} from "~/client/spaces/global_loading_indicator.js";
import {getTaskCollectionColor} from "~/client/styles/get_task_collection_color.js";
import {colorSchemeVars, greyElevated2ClassName, sprinkles} from "~/client/styles/styles.js";
import {newTaskCollectionNamePlaceholder} from "~/client/styles/tasks_shared_styles.js";
import {
    TaskClientStore,
    TaskClientStoreSearchAffinityManager,
} from "~/client/tasks/core/task_client_store.js";
import {AccessLevel, hasAccessLevel} from "~/shared/access/access_policy.js";
import {ThemeColor} from "~/shared/design/core/theme_colors.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";

export type TaskCollectionViewDesktopHeaderNameRef = {
    editName(): void;
    editColor(): void;
};

const TaskCollectionViewDesktopHeaderNameForwardRef = forwardRef(
    TaskCollectionViewDesktopHeaderName,
);
export {TaskCollectionViewDesktopHeaderNameForwardRef as TaskCollectionViewDesktopHeaderName};

function TaskCollectionViewDesktopHeaderName(
    {
        accessLevel,
        store,
        collectionId,
        isCreatingCollection,
        shouldInitiallyFocusEditableName: shouldInitiallyFocusEditableNameProp,
        collection,
        createCollection,
        affinityManager,
    }: {
        accessLevel: AccessLevel | null;
        store: TaskClientStore;
        collectionId: TaskCollectionId;
        isCreatingCollection: boolean;
        shouldInitiallyFocusEditableName: boolean;
        collection: TaskCollectionModel | null;
        createCollection: (name: string) => Promise<void>;
        affinityManager: TaskClientStoreSearchAffinityManager;
    },
    ref: Ref<TaskCollectionViewDesktopHeaderNameRef>,
) {
    const context = useAppContext();
    const navigate = useNavigate();

    const hasManageAccessLevel = useMemo(
        () => hasAccessLevel(accessLevel, "Manage"),
        [accessLevel],
    );

    // Reset `isEditingName` if `collectionSubscription` changes. e.g. If it goes
    // from `null` to a non-null value when we create a collection.
    const [editingNameState, setEditingNameState] = useState<{
        shouldInitiallyFocusEditableName: boolean;
    } | null>(
        isCreatingCollection
            ? {shouldInitiallyFocusEditableName: shouldInitiallyFocusEditableNameProp}
            : null,
    );

    // If the collection doesn't have a name you need to add one! Only optimistic
    // collections will have an empty name. Empty collection names are not allowed.
    if (isCreatingCollection && !editingNameState) {
        setEditingNameState({shouldInitiallyFocusEditableName: true});
    }

    if (!hasManageAccessLevel && !isCreatingCollection && editingNameState) {
        setEditingNameState(null);
    }

    const [colorSelectorState, setColorSelectorState] = useState<
        {isExpanded: true} | {isExpanded: false; isFadingOut: boolean}
    >({isExpanded: false, isFadingOut: false});

    if (!hasManageAccessLevel && colorSelectorState.isExpanded) {
        setColorSelectorState({isExpanded: false, isFadingOut: true});
    }

    useImperativeHandle(
        ref,
        () => ({
            editName: () => setEditingNameState({shouldInitiallyFocusEditableName: true}),
            editColor: () => setColorSelectorState({isExpanded: true}),
        }),
        [],
    );

    const name = collection?.getName() ?? "";
    const color = collection?.getColor() ?? null;

    const inputWithAutoGrowingWidthSafeSpacerElement =
        useInputWithAutoGrowingWidthSafeSpacerElement();

    return (
        <Box
            overflow="hidden"
            // The `paddingLeft`/`marginLeft` does nothing but is there so the color hover
            // overlay isn't clipped by `overflow="hidden"`.
            paddingLeft="1"
            marginLeft="-1"
            display="flex"
            alignItems="center"
        >
            {!isCreatingCollection && (
                <Box flexShrink="0" display="flex" justifyContent="center" width="3">
                    <TaskCollectionViewDesktopHeaderColor
                        hasManageAccessLevel={hasManageAccessLevel}
                        color={color}
                        onColorSelect={color => {
                            store.commitTaskActionTransaction(
                                context,
                                [
                                    {
                                        type: "UpdateCollection",
                                        time: store.clock.now(),
                                        collectionId,
                                        collectionAction: {
                                            type: "UpdateColor",
                                            color,
                                        },
                                    },
                                ],
                                {
                                    // Collection name changes can't be undone.
                                    undoManager: null,
                                    affinityManager,
                                },
                            );
                        }}
                        colorSelectorState={colorSelectorState}
                        setColorSelectorState={setColorSelectorState}
                    />
                </Box>
            )}
            {!editingNameState ? (
                <h1
                    className={sprinkles({
                        padding: "1",
                        fontSize: "200",
                        fontStyle: "truncate-semi-bold",
                        userSelect: "text",
                    })}
                    style={{
                        // Render contextual alternate glyphs. User text may be rendered here. Helpful
                        // for consistency if the user types anything like 2x2 or an @ mention.
                        // eslint-disable-next-line string-quotes
                        fontFeatureSettings: '"calt" on',
                    }}
                    onDoubleClick={event => {
                        if (!hasManageAccessLevel) return;

                        // Disable selection from double click.
                        event.preventDefault();

                        setEditingNameState({shouldInitiallyFocusEditableName: true});
                    }}
                >
                    {name}
                    {inputWithAutoGrowingWidthSafeSpacerElement}
                </h1>
            ) : (
                <Box overflow="hidden">
                    <TaskCollectionViewDesktopHeaderNameEditor
                        isCreatingCollection={isCreatingCollection}
                        shouldInitiallyFocus={editingNameState.shouldInitiallyFocusEditableName}
                        initialName={name}
                        onCancel={() => {
                            // If we cancel editing an optimistic collection with no name then return to
                            // the route we came from.
                            if (isCreatingCollection) {
                                return navigate(-1);
                            } else {
                                setEditingNameState(null);
                            }
                        }}
                        onSave={name => {
                            // If you try to save an empty name, it cancels editing. Unless the collection
                            // has not been created yet. Then it does nothing. Your collection needs
                            // a name!
                            if (name.length === 0) {
                                if (!isCreatingCollection) setEditingNameState(null);
                                return;
                            }

                            if (isCreatingCollection) {
                                return createCollection(name).then(() => {
                                    setEditingNameState(null);
                                });
                            } else {
                                store.commitTaskActionTransaction(
                                    context,
                                    [
                                        {
                                            type: "UpdateCollection",
                                            time: store.clock.now(),
                                            collectionId,
                                            collectionAction: {
                                                type: "UpdateName",
                                                name,
                                            },
                                        },
                                    ],
                                    // Collection changes can't be undone.
                                    {undoManager: null, affinityManager},
                                );

                                setEditingNameState(null);
                            }
                        }}
                    />
                </Box>
            )}
        </Box>
    );
}

function TaskCollectionViewDesktopHeaderNameEditor({
    isCreatingCollection,
    shouldInitiallyFocus,
    initialName,
    onCancel,
    onSave,
}: {
    isCreatingCollection: boolean;
    shouldInitiallyFocus: boolean;
    initialName: string;
    onCancel: () => MaybePromise<void>;
    onSave: (name: string) => MaybePromise<void>;
}) {
    const addGlobalLoadingIndicator = useAddGlobalLoadingIndicator();

    const inputRef = useRef<HTMLInputElement>(null);
    const [name, setName] = useState(initialName);
    const [shouldShowConfirmSaveDialog, setShouldShowConfirmSaveDialog] = useState(false);

    const shouldFocusNextRenderRef = useRef(shouldInitiallyFocus);

    useLayoutEffectWithoutServerSideWarning(() => {
        // If the close confirmation dialog is open, we can't focus our editor.
        if (shouldShowConfirmSaveDialog) return;

        if (!shouldFocusNextRenderRef.current) return;
        shouldFocusNextRenderRef.current = false;

        return scheduleAfterNavigationAnimation(() => {
            const inputElement = assertExists(inputRef.current);
            inputElement.select();
            inputElement.focus({preventScroll: true});
        });
    }, [shouldShowConfirmSaveDialog]);

    return (
        <>
            <Box maxWidth="full" height="8">
                <FocusRing offset="border" isVisibleFromAnyFocus={true}>
                    <InputWithAutoGrowingWidth
                        ref={useMergedRefs(
                            inputRef,
                            useConfirmSaveAfterLosingFocus({
                                // It's ok to unfocus while creating a collection and nothing has been input.
                                // This will happen when you create a collection, a peek opens, then you
                                // immediately close the peek.
                                //
                                // We won't auto-focus this input when create a task collection through search.
                                isDisabled: isCreatingCollection && name.length === 0,

                                shouldConfirmSave:
                                    // If the initial name is empty, we are creating an optimistic collection and
                                    // you must provide a name.
                                    isCreatingCollection ||
                                    // Otherwise if you delete all of the collection name it will revert back to
                                    // the initial name.
                                    (name.length > 0 && name !== initialName),
                                isConfirmingSave: shouldShowConfirmSaveDialog,
                                onCancelSave: () => void onCancel(),
                                onConfirmSave: () => setShouldShowConfirmSaveDialog(true),
                            }),
                        )}
                        placeholder={
                            initialName.length > 0 ? initialName : newTaskCollectionNamePlaceholder
                        }
                        autoComplete="false"
                        value={name}
                        onChange={event => setName(event.currentTarget.value)}
                        className={sprinkles({
                            paddingY: "1",
                            borderRadius: "1",
                        })}
                        style={{
                            boxShadow: `inset 0 0 0 1px ${colorSchemeVars["grey-10"]}`,
                        }}
                        textClassName={sprinkles({
                            fontSize: "200",
                            fontStyle: "semi-bold",
                            paddingX: "1",
                        })}
                        textStyle={{
                            // Render contextual alternate glyphs. User text may be rendered here. Helpful
                            // for consistency if the user types anything like 2x2 or an @ mention.
                            // eslint-disable-next-line string-quotes
                            fontFeatureSettings: '"calt" on',
                        }}
                        onKeyDown={event => {
                            switch (event.key) {
                                case "Enter": {
                                    event.preventDefault();
                                    event.stopPropagation();

                                    const savingPromise = onSave(name);

                                    if (savingPromise)
                                        addGlobalLoadingIndicator(savingPromise, {type: "Saving"});
                                    break;
                                }
                                case "Escape": {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    void onCancel();
                                    break;
                                }
                            }
                        }}
                    />
                </FocusRing>
            </Box>
            {shouldShowConfirmSaveDialog &&
                (!isCreatingCollection ? (
                    <ModalDialog
                        title="Save collection name"
                        description="Would you like to save your new collection name?"
                        onClose={() => {
                            // Return focus to the editor if the dialog is closed. This acts as a "cancel"
                            // and lets the user continue writing.
                            shouldFocusNextRenderRef.current = true;
                            setShouldShowConfirmSaveDialog(false);
                        }}
                        primaryButtonLabel="Save"
                        primaryButtonPressErrorTitle="Couldn’t save name"
                        onPrimaryButtonPress={() => onSave(name)}
                        cancelButtonLabel="Discard name"
                        cancelButtonPressErrorTitle="Couldn’t discard name"
                        onCancelButtonPress={onCancel}
                    />
                ) : name.length !== 0 ? (
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
                        primaryButtonPressErrorTitle="Couldn’t save collection"
                        onPrimaryButtonPress={() => onSave(name)}
                        cancelButtonLabel="Discard collection"
                        cancelButtonPressErrorTitle="Couldn’t discard collection"
                        onCancelButtonPress={onCancel}
                    />
                ) : (
                    <ModalDialog
                        title="Save collection"
                        description="You can’t save your collection until you give it a name."
                        onClose={() => {
                            // Return focus to the editor if the dialog is closed. This acts as a "cancel"
                            // and lets the user continue writing.
                            shouldFocusNextRenderRef.current = true;
                            setShouldShowConfirmSaveDialog(false);
                        }}
                        primaryButtonLabel="Save"
                        isPrimaryButtonDisabled={true}
                        onPrimaryButtonPress={() => {}}
                        cancelButtonLabel="Discard collection"
                        cancelButtonPressErrorTitle="Couldn’t discard collection"
                        onCancelButtonPress={onCancel}
                    />
                ))}
        </>
    );
}

function TaskCollectionViewDesktopHeaderColor({
    hasManageAccessLevel,
    color,
    onColorSelect,
    colorSelectorState,
    setColorSelectorState,
}: {
    hasManageAccessLevel: boolean;
    color: ThemeColor | null;
    onColorSelect: (color: ThemeColor | null) => void;
    colorSelectorState: {isExpanded: true} | {isExpanded: false; isFadingOut: boolean};
    setColorSelectorState: (
        colorSelectorState: {isExpanded: true} | {isExpanded: false; isFadingOut: boolean},
    ) => void;
}) {
    const {hoverProps, isHovered} = useHover({
        isDisabled: !hasManageAccessLevel,
    });

    const {pressProps, isPressed} = usePress({
        isDisabled: !hasManageAccessLevel,
        onPress: () => setColorSelectorState({isExpanded: true}),
    });

    return (
        <OverlayAnimated
            isBlocking={true}
            offset="2.5"
            isVisible={colorSelectorState.isExpanded}
            disableAnimationIn={true}
            disableAnimationOut={!colorSelectorState.isExpanded && !colorSelectorState.isFadingOut}
            placement="bottom"
            overlay={
                <Box
                    ref={useOutsideInteraction(() =>
                        setColorSelectorState({isExpanded: false, isFadingOut: true}),
                    )}
                    className={greyElevated2ClassName}
                    backgroundColor="grey-0"
                    borderRadius="1.5"
                    boxShadow="elevation-20"
                >
                    <TaskCollectionViewDesktopHeaderColorSelector
                        onColorSelect={color => {
                            setColorSelectorState({isExpanded: false, isFadingOut: false});
                            onColorSelect(color);
                        }}
                    />
                </Box>
            }
        >
            <Box
                // This element isn't focusable (no `tabindex`, no `<FocusRing>`) since it's
                // purely an affordance for mouse users only. Keyboard users should go through
                // the option in our menu.
                {...mergeProps(hoverProps, pressProps)}
                width="4"
                height="4"
                margin="-1"
                borderRadius="full"
                display="flex"
                justifyContent="center"
                alignItems="center"
                backgroundColor={
                    isPressed
                        ? "grey-10"
                        : isHovered || colorSelectorState.isExpanded
                        ? "grey-5"
                        : undefined
                }
            >
                <Box
                    // Carefully positioned so it aligns with the "+" icon in the
                    // "Add filter" button.
                    width="2"
                    height="2"
                    borderRadius="full"
                    backgroundColor={getTaskCollectionColor(color)}
                />
            </Box>
        </OverlayAnimated>
    );
}

// This component implements the toolbar role:
// https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/toolbar_role
function TaskCollectionViewDesktopHeaderColorSelector({
    onColorSelect,
}: {
    onColorSelect: (color: ThemeColor | null) => void;
}) {
    const buttonRefs = useRef<Array<HTMLDivElement | null>>([]);
    const [lastFocusedIndex, setLastFocusedIndex] = useState(0);

    const hasInitiallyMountedRef = useRef(false);
    useLayoutEffectWithoutServerSideWarning(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        if (getInteractionModality() === "keyboard") {
            assertExists(buttonRefs.current[0]).focus();
        }
    }, []);

    return (
        <Box
            paddingX="1"
            display="flex"
            role="toolbar"
            aria-label="Collection color selector"
            aria-orientation="horizontal"
            onKeyDown={event => {
                switch (event.key) {
                    case "ArrowLeft": {
                        event.preventDefault();
                        event.stopPropagation();

                        assertExists(
                            buttonRefs.current[
                                lastFocusedIndex !== 0
                                    ? lastFocusedIndex - 1
                                    : buttonRefs.current.length - 1
                            ],
                        ).focus();
                        break;
                    }
                    case "ArrowRight": {
                        event.preventDefault();
                        event.stopPropagation();

                        assertExists(
                            buttonRefs.current[
                                lastFocusedIndex !== buttonRefs.current.length - 1
                                    ? lastFocusedIndex + 1
                                    : 0
                            ],
                        ).focus();
                        break;
                    }
                    case "Home": {
                        event.preventDefault();
                        event.stopPropagation();

                        assertExists(buttonRefs.current[0]).focus();
                        break;
                    }
                    case "End": {
                        event.preventDefault();
                        event.stopPropagation();

                        assertExists(buttonRefs.current[buttonRefs.current.length - 1]).focus();
                        break;
                    }
                }
            }}
        >
            <TaskCollectionViewDesktopHeaderColorSelectorButton
                description="None"
                color={null}
                onColorSelect={onColorSelect}
                buttonRef={useCallback(ref => (buttonRefs.current[0] = ref), [])}
                wasLastFocused={lastFocusedIndex === 0}
                onFocus={() => setLastFocusedIndex(0)}
            />
            <TaskCollectionViewDesktopHeaderColorSelectorButton
                description="Red"
                color="red"
                onColorSelect={onColorSelect}
                buttonRef={useCallback(ref => (buttonRefs.current[1] = ref), [])}
                wasLastFocused={lastFocusedIndex === 1}
                onFocus={() => setLastFocusedIndex(1)}
            />
            <TaskCollectionViewDesktopHeaderColorSelectorButton
                description="Orange"
                color="orange"
                onColorSelect={onColorSelect}
                buttonRef={useCallback(ref => (buttonRefs.current[2] = ref), [])}
                wasLastFocused={lastFocusedIndex === 2}
                onFocus={() => setLastFocusedIndex(2)}
            />
            <TaskCollectionViewDesktopHeaderColorSelectorButton
                description="Yellow"
                color="yellow"
                onColorSelect={onColorSelect}
                buttonRef={useCallback(ref => (buttonRefs.current[3] = ref), [])}
                wasLastFocused={lastFocusedIndex === 3}
                onFocus={() => setLastFocusedIndex(3)}
            />
            <TaskCollectionViewDesktopHeaderColorSelectorButton
                description="Green"
                color="green"
                onColorSelect={onColorSelect}
                buttonRef={useCallback(ref => (buttonRefs.current[4] = ref), [])}
                wasLastFocused={lastFocusedIndex === 4}
                onFocus={() => setLastFocusedIndex(4)}
            />
            <TaskCollectionViewDesktopHeaderColorSelectorButton
                description="Blue"
                color="blue"
                onColorSelect={onColorSelect}
                buttonRef={useCallback(ref => (buttonRefs.current[5] = ref), [])}
                wasLastFocused={lastFocusedIndex === 5}
                onFocus={() => setLastFocusedIndex(5)}
            />
            <TaskCollectionViewDesktopHeaderColorSelectorButton
                description="Purple"
                color="purple"
                onColorSelect={onColorSelect}
                buttonRef={useCallback(ref => (buttonRefs.current[6] = ref), [])}
                wasLastFocused={lastFocusedIndex === 6}
                onFocus={() => setLastFocusedIndex(6)}
            />
            <TaskCollectionViewDesktopHeaderColorSelectorButton
                description="Pink"
                color="pink"
                onColorSelect={onColorSelect}
                buttonRef={useCallback(ref => (buttonRefs.current[7] = ref), [])}
                wasLastFocused={lastFocusedIndex === 7}
                onFocus={() => setLastFocusedIndex(7)}
            />
        </Box>
    );
}

function TaskCollectionViewDesktopHeaderColorSelectorButton({
    description,
    color,
    onColorSelect,
    buttonRef,
    wasLastFocused,
    onFocus,
}: {
    description: string;
    color: ThemeColor | null;
    onColorSelect: (color: ThemeColor | null) => void;
    buttonRef: RefCallback<HTMLDivElement>;
    wasLastFocused: boolean;
    onFocus: () => void;
}) {
    const {hoverProps, isHovered} = useHover({});

    const {pressProps, isPressed} = usePress({
        onPress: () => onColorSelect(color),
    });

    const [isVisible, targetRef] = useIsFocusRingVisible();

    return (
        <Tooltip placement="bottom" fallbackPlacements={[]} content={description}>
            <Box
                {...mergeProps(hoverProps, pressProps)}
                ref={useMergedRefs<HTMLDivElement>(buttonRef, targetRef)}
                paddingY="1"
                tabIndex={wasLastFocused ? 0 : -1}
                onFocus={onFocus}
            >
                <FocusRing isVisible={isVisible} offset="border">
                    <Box
                        padding="2"
                        borderRadius="1"
                        backgroundColor={isPressed ? "grey-10" : isHovered ? "grey-5" : undefined}
                    >
                        <Box
                            width="2"
                            height="2"
                            borderRadius="full"
                            backgroundColor={getTaskCollectionColor(color)}
                        />
                    </Box>
                </FocusRing>
            </Box>
        </Tooltip>
    );
}
