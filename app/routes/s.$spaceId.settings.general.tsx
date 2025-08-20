import {useId, useRef, useState} from "react";
import {AvatarUploader} from "~/client/avatar/avatar_uploader.js";
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
import {SpaceAvatar} from "~/client/spaces/space_avatar.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/spaces/space_context.js";
import {spaceAvatarBorderRadius} from "~/client/styles/space_settings_shared_styles.js";
import {sprinkles} from "~/client/styles/styles.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {updateSpaceName} from "~/shared/rpc/spaces_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";
import {hasSpaceSettingsFeature} from "~/shared/spaces/has_space_settings_feature.js";

const LoaderSchema = Schema.object({});

export async function loader({params}: LoaderArgs) {
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? null);

    if (!hasSpaceSettingsFeature(spaceId)) {
        throw new UnimplementedError("Space settings is not available");
    }

    return jsonWithSchema(LoaderSchema, {});
}

export default function SpaceGeneralSettingsRoute() {
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
            <Box display="flex" flexDirection="column" gap="6" width="full">
                <Box gap="6" display="flex" alignItems="center" justifyContent="space-between">
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
                <Box display="flex" gap="6" alignItems="center" justifyContent="space-between">
                    <Box>
                        <Box fontSize="100" fontStyle="semi-bold" userSelect="text">
                            Logo
                        </Box>
                        <Box
                            paddingTop="1"
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
                    <AvatarUploader borderRadius={spaceAvatarBorderRadius}>
                        <SpaceAvatar space={originalSpace} size="12" />
                    </AvatarUploader>
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
