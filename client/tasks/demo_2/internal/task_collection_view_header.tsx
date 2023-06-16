import {DotsThree} from "phosphor-react";
import {useRef, useState} from "react";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {IconButton} from "~/client/design/icon_button";
import {MenuButton} from "~/client/design/menu_button";
import {ModalDialog} from "~/client/design/modal_dialog";
import {InputWithAutoGrowingWidth} from "~/client/helpers/input_with_auto_growing_width";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs";
import {useConfirmSaveAfterLosingFocus} from "~/client/helpers/use_confirm_save_after_losing_focus";
import {LocalTaskCollection} from "~/client/tasks/demo_2/local_tasks_state";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {colorSchemeVars, sprinkles} from "~/shared/styles/styles";

export function TaskCollectionViewHeader({
    collection,
    onCollectionNameChange,
}: {
    collection: LocalTaskCollection;
    onCollectionNameChange: (name: string) => void;
}) {
    const [isEditingName, setIsEditingName] = useState(false);

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
                        onCancel={() => setIsEditingName(false)}
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
    onCancel: () => void;
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
                                shouldConfirmSave: name.length > 0 && name !== initialName,
                                isConfirmingSave: shouldShowConfirmSaveDialog,
                                onCancelSave: onCancel,
                                onConfirmSave: () => setShouldShowConfirmSaveDialog(true),
                            }),
                        )}
                        placeholder={initialName}
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
                            }
                        }}
                    />
                </FocusRing>
            </Box>
            {shouldShowConfirmSaveDialog && (
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
                    onCancelButtonPress={onCancel}
                />
            )}
        </>
    );
}
