import {DotsThree} from "phosphor-react";
import {useRef, useState} from "react";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {IconButton} from "~/client/design/icon_button";
import {MenuButton} from "~/client/design/menu_button";
import {ModalDialog} from "~/client/design/modal_dialog";
import {useConfirmSaveAfterLosingFocus} from "~/client/design/use_confirm_save_after_losing_focus";
import {InputWithAutoGrowingWidth} from "~/client/helpers/input_with_auto_growing_width";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs";
import {useNavigate} from "~/client/remix/use_navigate";
import {LocalTaskCollection} from "~/client/tasks/demo_2/local_tasks_state";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise";
import {colorSchemeVars, sprinkles} from "~/shared/styles/styles";

export function TaskCollectionViewHeader({
    collection,
    onCollectionNameChange,
}: {
    collection: Pick<LocalTaskCollection, "id" | "name" | "color">;
    onCollectionNameChange: (name: string) => void;
}) {
    const navigate = useNavigate();
    const [isEditingName, setIsEditingName] = useState(false);

    // If the collection doesn't have a name you need to add one! Only optimistic
    // collections will have an empty name. Empty collection names are not allowed.
    if (collection.name === "" && !isEditingName) setIsEditingName(true);

    return (
        <Box
            paddingTop="5"
            paddingBottom="3"
            paddingX="5"
            display="flex"
            alignItems="center"
            gap="2"
        >
            <Box display="flex" alignItems="center" gap="1">
                <Box display="flex" justifyContent="center" width="3">
                    <Box
                        // Carefully positioned so it aligns with the "+" icon in the
                        // "Add filter" button.
                        width="2"
                        height="2"
                        borderRadius="full"
                        backgroundColor={`${collection.color}-50-const`}
                    />
                </Box>
                {!isEditingName ? (
                    <Box fontSize="200" fontStyle="truncate-semi-bold">
                        {collection.name}
                    </Box>
                ) : (
                    <TaskCollectionViewHeaderTitleEditor
                        initialName={collection.name}
                        onCancel={() => {
                            // If we cancel editing an optimistic collection with no name then return to
                            // the route we came from.
                            if (collection.name.length === 0) {
                                return navigate(-1);
                            } else {
                                setIsEditingName(false);
                            }
                        }}
                        onSave={name => {
                            if (name.length > 0) onCollectionNameChange(name);
                            setIsEditingName(false);
                        }}
                    />
                )}
            </Box>
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
    );
}

function TaskCollectionViewHeaderTitleEditor({
    initialName,
    onCancel,
    onSave,
}: {
    initialName: string;
    onCancel: () => MaybePromise<void>;
    onSave: (name: string) => void;
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
            <Box height="7" margin="-1">
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
                        placeholder={initialName.length > 0 ? initialName : "Collection"}
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
                                    onSave(name);
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
                        onPrimaryButtonPress={() => onSave(name)}
                        cancelButtonLabel="Discard name"
                        cancelButtonPressErrorTitle="Can’t discard name"
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
                        onPrimaryButtonPress={() => onSave(name)}
                        cancelButtonLabel="Discard collection"
                        cancelButtonPressErrorTitle="Can’t discard collection"
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
                        cancelButtonPressErrorTitle="Can’t discard collection"
                        onCancelButtonPress={onCancel}
                    />
                ))}
        </>
    );
}
