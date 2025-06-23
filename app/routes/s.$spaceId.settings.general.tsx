import {useId, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {ModalDialog} from "~/client/design/modal_dialog.js";
import {TextInputWithoutLabel} from "~/client/design/text_input.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/design/use_confirm_save_after_losing_focus.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {
    InlineEditorToolbar,
    InlineEditorToolbarRef,
} from "~/client/messaging/inline_editor_toolbar.js";
import {SpaceAvatarUploader} from "~/client/spaces/layout/settings/space_avatar_uploader.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/spaces/space_context.js";
import {sprinkles} from "~/client/styles/styles.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {updateSpaceName} from "~/shared/rpc/spaces_rpc_definitions.js";

export default function GeneralSettings() {
    if (process.env.NODE_ENV === "production")
        throw new UnimplementedError("Shouldn’t be able to open general settings in production");

    const context = useAppContext();
    const {space: originalSpace, updateSpace} = useSpaceContextAndRequireSpaceAccess();

    const inputRef = useRef<HTMLInputElement>(null);
    const nameInlineEditorToolbarRef = useRef<InlineEditorToolbarRef>(null);

    const idBase = useId();
    const nameTextInputId = `${idBase}-name`;

    const [name, setName] = useState<string | null>(null);
    const [shouldShowConfirmSaveNameDialog, setShouldShowConfirmSaveNameDialog] = useState(false);

    const handleSaveName = async () => {
        if (name === null) return;

        const {space: updatedSpace} = await updateSpaceName(context, {
            spaceId: originalSpace.id,
            name: name,
        });

        updateSpace(updatedSpace);
        setName(null);
    };

    const handleCancelNameEditing = () => {
        // After we cancel editing, select all content in the text input. So the
        // selection doesn't move somewhere weird.
        shouldSelectAllAfterCancelRef.current = true;

        setName(null);
    };

    const shouldSelectAllAfterCancelRef = useRef(false);
    useLayoutEffectWithoutServerSideWarning(() => {
        if (name !== null) return;

        if (!shouldSelectAllAfterCancelRef.current) return;
        shouldSelectAllAfterCancelRef.current = false;

        const inputElement = assertExists(inputRef.current);
        inputElement.selectionStart = 0;
        inputElement.selectionEnd = inputElement.value.length;
    }, [name]);

    return (
        <>
            <Box display="flex" flexDirection="column" gap="5" width="full">
                <Box gap="5" display="flex" alignItems="center" justifyContent="space-between">
                    <label
                        htmlFor={nameTextInputId}
                        className={sprinkles({
                            display: "block",
                            fontSize: "100",
                            fontStyle: "semi-bold",
                            userSelect: "text",
                        })}
                    >
                        Name
                    </label>
                    <Box
                        position="relative"
                        width="full"
                        maxWidth="48"
                        ref={useConfirmSaveAfterLosingFocus({
                            shouldConfirmSave: name !== null,
                            isConfirmingSave: shouldShowConfirmSaveNameDialog,
                            onCancelSave: handleCancelNameEditing,
                            onConfirmSave: () => setShouldShowConfirmSaveNameDialog(true),
                        })}
                    >
                        <TextInputWithoutLabel
                            ref={inputRef}
                            fontSize="100"
                            id={nameTextInputId}
                            value={name ?? originalSpace.name}
                            onChange={setName}
                            placeholder={originalSpace.name}
                            onEnter={() => assertExists(nameInlineEditorToolbarRef.current).save()}
                            onEscape={handleCancelNameEditing}
                            isFocusRingVisible={name !== null}
                        />
                        {name !== null && (
                            <InlineEditorToolbar
                                ref={nameInlineEditorToolbarRef}
                                saveErrorTitle="Couldn’t save space name"
                                onSave={handleSaveName}
                                onCancel={handleCancelNameEditing}
                            />
                        )}
                    </Box>
                </Box>
                <Box display="flex" gap="5" alignItems="center" justifyContent="space-between">
                    <Box>
                        <Box fontSize="100" fontStyle="semi-bold" userSelect="text">
                            Logo
                        </Box>
                        <Box
                            fontSize="75"
                            color="grey-60"
                            userSelect="text"
                            style={{
                                // Allow contextual alternate glyphs in regular text content.
                                //
                                // Particularly the "x" in "256x256".
                                //
                                // eslint-disable-next-line string-quotes
                                fontFeatureSettings: '"calt" on',
                            }}
                        >
                            Recommended size is 256x256px
                        </Box>
                    </Box>
                    <SpaceAvatarUploader space={originalSpace} />
                </Box>
            </Box>
            {shouldShowConfirmSaveNameDialog && (
                <ModalDialog
                    title="Save name"
                    description="Would you like to save your new name?"
                    onClose={() => {
                        setShouldShowConfirmSaveNameDialog(false);
                        inputRef.current?.focus();
                    }}
                    primaryButtonLabel="Save"
                    primaryButtonPressErrorTitle="Couldn’t save space name"
                    onPrimaryButtonPress={handleSaveName}
                    cancelButtonLabel="Discard changes"
                    cancelButtonPressErrorTitle="Couldn’t discard changes"
                    onCancelButtonPress={handleCancelNameEditing}
                />
            )}
        </>
    );
}
