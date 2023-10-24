import {getInteractionModality} from "@react-aria/interactions";
import {DotsThree, LockOpen} from "phosphor-react";
import {RefCallback, useCallback, useRef, useState} from "react";
import {mergeProps, useHover, usePress} from "react-aria";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {FocusRing, useIsFocusRingVisible} from "~/client/design/focus_ring.js";
import {useOutsideInteraction} from "~/client/design/helpers/use_outside_interaction.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuAction, MenuButton} from "~/client/design/menu_button.js";
import {ModalDialog} from "~/client/design/modal_dialog.js";
import {OverlayAnimated} from "~/client/design/overlay_animated.js";
import {Tooltip} from "~/client/design/tooltip.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/design/use_confirm_save_after_losing_focus.js";
import {InputWithAutoGrowingWidth} from "~/client/helpers/input_with_auto_growing_width.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {getTaskCollectionColor} from "~/client/tasks/internal/task_collection_chip_base.js";
import {TaskClientCollectionSubscription} from "~/client/tasks/task_client_collection_subscription.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {ThemeColor} from "~/shared/design/theme_colors.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";
import {colorSchemeVars, greyElevated2ClassName, sprinkles} from "~/shared/styles/styles.js";

export const newTaskCollectionNamePlaceholder = "New collection";

export function TaskCollectionViewHeader({
    isReadOnly,
    store,
    collectionId,
    collectionSubscription,
    createCollection,
}: {
    isReadOnly: boolean;
    store: TaskClientStore;
    collectionId: TaskCollectionId;
    // If `collectionSubscription` is null, that means we are creating a
    // new collection.
    //
    // TODO(calebmer): If the collection is deleted, everything in the header
    // should be read-only.
    collectionSubscription: TaskClientCollectionSubscription | null;
    createCollection: (name: string) => Promise<void>;
}) {
    const context = useAppContext();
    const navigate = useNavigate();
    const {space} = useSpaceContext();

    // Reset `isEditingName` if `collectionSubscription` changes. e.g. If it goes
    // from `null` to a non-null value when we create a collection.
    const [isEditingName, setIsEditingName] = useStateWithDependencies(!collectionSubscription, [
        collectionSubscription,
    ]);

    // If the collection doesn't have a name you need to add one! Only optimistic
    // collections will have an empty name. Empty collection names are not allowed.
    if (!collectionSubscription && !isEditingName) setIsEditingName(true);

    const [colorSelectorState, setColorSelectorState] = useState<
        {isExpanded: true} | {isExpanded: false; isFadingOut: boolean}
    >({isExpanded: false, isFadingOut: false});

    const collectionEntry = useStore(collectionSubscription?.collectionEntryStore ?? null);
    const collection = collectionEntry?.collection ?? null;

    const name = collection?.getName() ?? "";
    const color = collection?.getColor() ?? null;

    const menuActions: Array<ReadonlyArray<MenuAction>> = [];

    menuActions.push([
        {
            label: "Copy link",
            pressErrorTitle: "Couldn’t copy collection link",
            onPress: async () => {
                const url = new URL(
                    `/s/${space.id}/tasks/collections/${collectionId}`,
                    window.location.href,
                );
                await writeTextToClipboard(url.toString());
            },
        },
    ]);

    if (!isReadOnly) {
        // Even though you can edit the collection name by double clicking and the
        // color by clicking on the dot, we still include menu items since these
        // interactions aren't necessarily obvious.
        //
        // Also, the color and name are not focusable. So the only way to edit
        // name/color via keyboard are these menu items.
        menuActions.push([
            {
                label: "Edit name",
                onPress: () => setIsEditingName(true),
            },
            {
                label: "Edit color",
                onPress: () => setColorSelectorState({isExpanded: true}),
            },
        ]);

        // TODO(calebmer): Collections support more involved permission rules than just
        // public/private. Eventually I want a full sharing dialog (like in Google
        // Docs) but I want that sharing dialog to work across all stuff in the space.
        // Including docs and channels.
        menuActions.push([
            {
                label: "Make public",
                icon: <LockOpen />,
                iconPlacement: "end",
                onPress: () => {
                    // NOCOMMIT
                },
            },
        ]);

        menuActions.push([
            {
                label: "Delete",
                onPress: () => {
                    store.commitTaskActionTransaction(context, [
                        {
                            type: "UpdateCollection",
                            time: store.clock.now(),
                            collectionId,
                            collectionAction: {type: "Delete"},
                        },
                    ]);

                    void navigate(-1);
                },
            },
        ]);
    }

    return (
        <Box paddingLeft="1" marginLeft="-1" overflow="hidden" display="flex" alignItems="center">
            {collectionSubscription && (
                <Box flexShrink="0" display="flex" justifyContent="center" width="3">
                    <TaskCollectionViewHeaderColor
                        color={color}
                        onColorSelect={color => {
                            store.commitTaskActionTransaction(context, [
                                {
                                    type: "UpdateCollection",
                                    time: store.clock.now(),
                                    collectionId,
                                    collectionAction: {
                                        type: "UpdateColor",
                                        color,
                                    },
                                },
                            ]);
                        }}
                        colorSelectorState={colorSelectorState}
                        setColorSelectorState={setColorSelectorState}
                    />
                </Box>
            )}
            {!isEditingName ? (
                <Box
                    padding="1"
                    fontSize="200"
                    fontStyle="truncate-semi-bold"
                    userSelect="text"
                    onDoubleClick={event => {
                        if (isReadOnly) return;

                        // Disable selection from double click.
                        event.preventDefault();

                        setIsEditingName(true);
                    }}
                >
                    {name}
                </Box>
            ) : (
                <Box overflow="hidden">
                    <TaskCollectionViewHeaderNameEditor
                        initialName={name}
                        onCancel={() => {
                            // If we cancel editing an optimistic collection with no name then return to
                            // the route we came from.
                            if (name.length === 0) {
                                return navigate(-1);
                            } else {
                                setIsEditingName(false);
                            }
                        }}
                        onSave={name => {
                            // If you try to save an empty name, it cancels editing. Unless the collection
                            // has not been created yet. Then it does nothing. Your collection needs
                            // a name!
                            if (name.length === 0) {
                                if (collectionSubscription) setIsEditingName(false);
                                return;
                            }

                            if (!collectionSubscription) {
                                return createCollection(name);
                            } else {
                                store.commitTaskActionTransaction(context, [
                                    {
                                        type: "UpdateCollection",
                                        time: store.clock.now(),
                                        collectionId,
                                        collectionAction: {
                                            type: "UpdateName",
                                            name,
                                        },
                                    },
                                ]);

                                setIsEditingName(false);
                            }
                        }}
                    />
                </Box>
            )}
            <Box flexShrink="0" paddingLeft="2">
                <MenuButton actions={menuActions}>
                    <IconButton size="sm" description="More" withoutTooltip>
                        <DotsThree />
                    </IconButton>
                </MenuButton>
            </Box>
        </Box>
    );
}

function TaskCollectionViewHeaderNameEditor({
    initialName,
    onCancel,
    onSave,
}: {
    initialName: string;
    onCancel: () => MaybePromise<void>;
    onSave: (name: string) => MaybePromise<void>;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [name, setName] = useState(initialName);
    const [shouldShowConfirmSaveDialog, setShouldShowConfirmSaveDialog] = useState(false);

    const shouldFocusNextRenderRef = useRef(true);

    useLayoutEffectWithoutServerSideWarning(() => {
        // If the close confirmation dialog is open, we can't focus our editor.
        if (shouldShowConfirmSaveDialog) return;

        if (!shouldFocusNextRenderRef.current) return;
        shouldFocusNextRenderRef.current = false;

        const inputElement = assertExists(inputRef.current);
        inputElement.select();
        inputElement.focus({preventScroll: true});
    }, [shouldShowConfirmSaveDialog]);

    return (
        <>
            <Box maxWidth="full" height="7">
                <FocusRing offset="border" isVisibleFromAnyFocus={true}>
                    <InputWithAutoGrowingWidth
                        ref={useMergedRefs(
                            inputRef,
                            useConfirmSaveAfterLosingFocus({
                                shouldConfirmSave:
                                    // If the initial name is empty, we are creating an optimistic collection and
                                    // you must provide a name.
                                    initialName.length === 0 ||
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
                            borderRadius: "base",
                        })}
                        style={{
                            boxShadow: `inset 0 0 0 1px ${colorSchemeVars["grey-10"]}`,
                        }}
                        textClassName={sprinkles({
                            fontSize: "200",
                            fontStyle: "semi-bold",
                            paddingX: "1",
                        })}
                        onKeyDown={event => {
                            switch (event.key) {
                                case "Enter": {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    // TODO(calebmer, #global-loading-indicator): Show a saving indicator until
                                    // save has finished.
                                    void onSave(name);
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
                (initialName.length > 0 ? (
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
                        description="Can’t save your collection until you give it a name."
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

function TaskCollectionViewHeaderColor({
    color,
    onColorSelect,
    colorSelectorState,
    setColorSelectorState,
}: {
    color: ThemeColor | null;
    onColorSelect: (color: ThemeColor | null) => void;
    colorSelectorState: {isExpanded: true} | {isExpanded: false; isFadingOut: boolean};
    setColorSelectorState: (
        colorSelectorState: {isExpanded: true} | {isExpanded: false; isFadingOut: boolean},
    ) => void;
}) {
    const {hoverProps, isHovered} = useHover({});

    const {pressProps, isPressed} = usePress({
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
                    borderRadius="md"
                    boxShadow="elevation-20"
                >
                    <TaskCollectionViewHeaderColorSelector
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
function TaskCollectionViewHeaderColorSelector({
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
            <TaskCollectionViewHeaderColorSelectorButton
                description="None"
                color={null}
                onColorSelect={onColorSelect}
                buttonRef={useCallback(ref => (buttonRefs.current[0] = ref), [])}
                wasLastFocused={lastFocusedIndex === 0}
                onFocus={() => setLastFocusedIndex(0)}
            />
            <TaskCollectionViewHeaderColorSelectorButton
                description="Red"
                color="red"
                onColorSelect={onColorSelect}
                buttonRef={useCallback(ref => (buttonRefs.current[1] = ref), [])}
                wasLastFocused={lastFocusedIndex === 1}
                onFocus={() => setLastFocusedIndex(1)}
            />
            <TaskCollectionViewHeaderColorSelectorButton
                description="Orange"
                color="orange"
                onColorSelect={onColorSelect}
                buttonRef={useCallback(ref => (buttonRefs.current[2] = ref), [])}
                wasLastFocused={lastFocusedIndex === 2}
                onFocus={() => setLastFocusedIndex(2)}
            />
            <TaskCollectionViewHeaderColorSelectorButton
                description="Yellow"
                color="yellow"
                onColorSelect={onColorSelect}
                buttonRef={useCallback(ref => (buttonRefs.current[3] = ref), [])}
                wasLastFocused={lastFocusedIndex === 3}
                onFocus={() => setLastFocusedIndex(3)}
            />
            <TaskCollectionViewHeaderColorSelectorButton
                description="Green"
                color="green"
                onColorSelect={onColorSelect}
                buttonRef={useCallback(ref => (buttonRefs.current[4] = ref), [])}
                wasLastFocused={lastFocusedIndex === 4}
                onFocus={() => setLastFocusedIndex(4)}
            />
            <TaskCollectionViewHeaderColorSelectorButton
                description="Blue"
                color="blue"
                onColorSelect={onColorSelect}
                buttonRef={useCallback(ref => (buttonRefs.current[5] = ref), [])}
                wasLastFocused={lastFocusedIndex === 5}
                onFocus={() => setLastFocusedIndex(5)}
            />
            <TaskCollectionViewHeaderColorSelectorButton
                description="Purple"
                color="purple"
                onColorSelect={onColorSelect}
                buttonRef={useCallback(ref => (buttonRefs.current[6] = ref), [])}
                wasLastFocused={lastFocusedIndex === 6}
                onFocus={() => setLastFocusedIndex(6)}
            />
            <TaskCollectionViewHeaderColorSelectorButton
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

function TaskCollectionViewHeaderColorSelectorButton({
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
                        borderRadius="base"
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
