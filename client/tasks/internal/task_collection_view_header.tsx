import {DotsThree, LockOpen} from "phosphor-react";
import {useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuButton} from "~/client/design/menu_button.js";
import {ModalDialog} from "~/client/design/modal_dialog.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/design/use_confirm_save_after_losing_focus.js";
import {InputWithAutoGrowingWidth} from "~/client/helpers/input_with_auto_growing_width.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {getTaskCollectionColor} from "~/client/tasks/internal/task_collection_chip_base.js";
import {TaskClientCollectionSubscription} from "~/client/tasks/task_client_collection_subscription.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";
import {colorSchemeVars, sprinkles} from "~/shared/styles/styles.js";

export const newTaskCollectionNamePlaceholder = "New collection";

export function TaskCollectionViewHeader({
    store,
    collectionId,
    collectionSubscription,
    createCollection,
}: {
    store: TaskClientStore;
    collectionId: TaskCollectionId;
    // If `collectionSubscription` is null, that means we are creating a
    // new collection.
    collectionSubscription: TaskClientCollectionSubscription | null;
    createCollection: (name: string) => Promise<void>;
}) {
    const context = useAppContext();
    const navigate = useNavigate();

    // Reset `isEditingName` if `collectionSubscription` changes. e.g. If it goes
    // from `null` to a non-null value when we create a collection.
    const [isEditingName, setIsEditingName] = useStateWithDependencies(!collectionSubscription, [
        collectionSubscription,
    ]);

    // If the collection doesn't have a name you need to add one! Only optimistic
    // collections will have an empty name. Empty collection names are not allowed.
    if (!collectionSubscription && !isEditingName) setIsEditingName(true);

    const collectionEntry = useStore(collectionSubscription?.collectionEntryStore ?? null);
    const collection = collectionEntry?.collection ?? null;

    const name = collection?.getName() ?? "";
    const color = collection?.getColor() ?? null;

    return (
        <Box
            width="full"
            overflow="hidden"
            paddingTop="4"
            paddingBottom="2"
            paddingX="5"
            display="flex"
            alignItems="center"
        >
            {collectionSubscription && (
                <Box flexShrink="0" display="flex" justifyContent="center" width="3">
                    <Box
                        // Carefully positioned so it aligns with the "+" icon in the
                        // "Add filter" button.
                        width="2"
                        height="2"
                        borderRadius="full"
                        backgroundColor={getTaskCollectionColor(color)}
                    />
                </Box>
            )}
            {!isEditingName ? (
                <Box padding="1" fontSize="200" fontStyle="truncate-semi-bold">
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
                <MenuButton
                    actions={[
                        [
                            {
                                label: "Copy link",
                                onPress: () => {
                                    // NOCOMMIT
                                },
                            },
                        ],
                        [
                            {
                                label: "Edit name",
                                onPress: () => setIsEditingName(true),
                            },
                            {
                                label: "Edit color",
                                onPress: () => {
                                    // NOCOMMIT
                                },
                            },
                        ],
                        [
                            // TODO(calebmer): Collections support more involved permission rules than just
                            // public/private. Eventually I want a full sharing dialog (like in Google
                            // Docs) but I want that sharing dialog to work across all stuff in the space.
                            // Including docs and channels.
                            {
                                label: "Make public",
                                icon: <LockOpen />,
                                iconPlacement: "end",
                                onPress: () => {
                                    // NOCOMMIT
                                },
                            },
                        ],
                        [
                            {
                                label: "Delete",
                                onPress: () => {
                                    // NOCOMMIT
                                },
                            },
                        ],
                    ]}
                >
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
