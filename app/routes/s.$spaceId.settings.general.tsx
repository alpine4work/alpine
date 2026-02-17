import {CaretDown} from "phosphor-react";
import {useId, useRef, useState} from "react";
import {AvatarUploader, avatarUploaderSize} from "~/client/web/avatar/avatar_uploader.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {MenuButton} from "~/client/web/design/menu_button.js";
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {TextInputWithoutLabel} from "~/client/web/design/text_input.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/web/design/use_confirm_save_after_losing_focus.js";
import {ColorScheme} from "~/client/web/helpers/color_scheme.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {
    InlineEditorToolbar,
    InlineEditorToolbarRef,
} from "~/client/web/messaging/inline_editor_toolbar.js";
import {SpaceAvatarWithThemeOverride} from "~/client/web/spaces/space_avatar_with_theme_avatar_override.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/web/spaces/space_context.js";
import {spaceAvatarBorderRadius} from "~/client/web/styles/space_settings_shared_styles.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {UploadAvatarResponseSchema} from "~/shared/avatar/protocol/upload_avatar_response_schema.js";
import {
    SelectableSpaceThemeColor,
    selectableSpaceThemeColors,
} from "~/shared/design/core/theme_colors.js";
import {InternalError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {updateSpaceName, updateSpaceThemeColor} from "~/shared/rpc/spaces_rpc_definitions.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";

const themeColorNames: {[key in SelectableSpaceThemeColor]: string} = {
    red: "Red",
    orange: "Orange",
    green: "Green",
    cyan: "Cyan",
    // We intentially choose indigo to be "blue" so it's more differentiated from Cyan
    indigo: "Blue",
    purple: "Purple",
    pink: "Pink",
} as const;

export default function SpaceGeneralSettingsRoute() {
    const context = useAppContext();
    const {space: originalSpace, updateSpace} = useSpaceContextAndRequireSpaceAccess();

    const inputRef = useRef<HTMLInputElement>(null);
    const nameInlineEditorToolbarRef = useRef<InlineEditorToolbarRef>(null);

    const idBase = useId();
    const nameTextInputId = `${idBase}-name`;

    const [name, setName] = useState<string | null>(null);
    const [shouldShowConfirmSaveNameDialog, setShouldShowConfirmSaveNameDialog] = useState(false);

    const handleUpdateThemeColor = async (themeColor: SelectableSpaceThemeColor) => {
        const {space: updatedSpace} = await updateSpaceThemeColor(context, {
            spaceId: originalSpace.id,
            themeColor,
        });

        updateSpace(updatedSpace);
    };

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

    const getHandleUploadAvatar = (colorScheme: ColorScheme) => async (file: File) => {
        const url = new URL(`/api/avatar/space/${originalSpace.id}`, window.location.href);
        // TODO(ifitzsimmons, #add-space-avatar-support)
        // This infers the type of space avatar from the user's current color scheme. Eventually
        // we should add a menu that lets them set this explicitly.
        url.searchParams.set("themeColor", colorScheme);

        const response = await fetchWithTracer(
            context.tracer.getTracer(),
            url,
            {
                serviceName: "EdgeService",
                route: "/api/avatar/space/:spaceId",
                method: "POST",
                headers: {
                    "content-type": file.type,
                    "content-length": file.size.toString(),
                },
                body: file,
            },
            async response => {
                const responseData = await response.json();
                const responseBody = UploadAvatarResponseSchema.deserialize(responseData);
                if (!responseBody.ok) throw responseBody.error;

                if (responseBody.type !== "UploadSpaceAvatar") {
                    throw new InternalError(quote`Unexpected response type “${responseBody.type}”`);
                }
                return responseBody;
            },
        );

        updateSpace(response.space);
    };

    return (
        <>
            <Box display="flex" flexDirection="column" gap="8" width="full">
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
                                saveErrorTitle="Couldn&#x2019;t save space name"
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
                                // eslint-disable-next-line cyberworlds/string-quotes
                                fontFeatureSettings: '"calt" on',
                            }}
                        >
                            May render over colorful backgrounds
                        </Box>
                    </Box>
                    <AvatarUploader
                        borderRadius={spaceAvatarBorderRadius}
                        onUploadAvatar={getHandleUploadAvatar("light")}
                    >
                        <SpaceAvatarWithThemeOverride
                            space={originalSpace}
                            size={avatarUploaderSize}
                            theme="light"
                        />
                    </AvatarUploader>
                </Box>
                <Box display="flex" gap="6" alignItems="center" justifyContent="space-between">
                    <Box>
                        <Box userSelect="text">
                            <Box display="inline" fontSize="100" fontStyle="semi-bold">
                                Logo{" "}
                            </Box>
                            <Box display="inline" fontSize="50" fontStyle="normal" color="grey-50">
                                (dark mode)
                            </Box>
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
                                // eslint-disable-next-line cyberworlds/string-quotes
                                fontFeatureSettings: '"calt" on',
                            }}
                        >
                            Optional. May render over colorful backgrounds
                        </Box>
                    </Box>
                    <AvatarUploader
                        borderRadius={spaceAvatarBorderRadius}
                        onUploadAvatar={getHandleUploadAvatar("dark")}
                    >
                        <SpaceAvatarWithThemeOverride
                            space={originalSpace}
                            size={avatarUploaderSize}
                            theme="dark"
                        />
                    </AvatarUploader>
                </Box>
                <Box display="flex" gap="6" alignItems="center" justifyContent="space-between">
                    <Box userSelect="text">
                        <Box display="inline" fontSize="100" fontStyle="semi-bold">
                            Theme
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
                                // eslint-disable-next-line cyberworlds/string-quotes
                                fontFeatureSettings: '"calt" on',
                            }}
                        >
                            An accent color used for links, buttons, and more
                        </Box>
                    </Box>
                    <MenuButton
                        placement="bottom-end"
                        actions={selectableSpaceThemeColors.map(color => ({
                            key: color,
                            label: themeColorNames[color],
                            icon: (
                                <Box
                                    height="4"
                                    width="4"
                                    display="flex"
                                    alignItems="center"
                                    justifyContent="center"
                                >
                                    <Box
                                        width="2"
                                        height="2"
                                        borderRadius="full"
                                        backgroundColor={{
                                            light: `${color}-40`,
                                            dark: `${color}-50`,
                                        }}
                                    />
                                </Box>
                            ),
                            isSelected: originalSpace.themeColor === color,
                            onPress: async () => {
                                if (originalSpace.themeColor !== color) {
                                    await handleUpdateThemeColor(color);
                                }
                            },
                            pressErrorTitle: "Couldn’t update theme color",
                        }))}
                    >
                        <Button
                            variant="text-input"
                            height="9"
                            paddingX="3"
                            fontSize="100"
                            icon={<CaretDown />}
                            iconPlacement="end"
                        >
                            <Box display="flex" alignItems="center" gap="2">
                                <Box
                                    width="2"
                                    height="2"
                                    borderRadius="full"
                                    backgroundColor={{
                                        light: `${originalSpace.themeColor}-40`,
                                        dark: `${originalSpace.themeColor}-50`,
                                    }}
                                />
                                {originalSpace.themeColor in themeColorNames
                                    ? themeColorNames[
                                          originalSpace.themeColor as keyof typeof themeColorNames
                                      ]
                                    : originalSpace.themeColor}
                            </Box>
                        </Button>
                    </MenuButton>
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
                    primaryButtonPressErrorTitle="Couldn&#x2019;t save space name"
                    onPrimaryButtonPress={handleSaveName}
                    cancelButtonLabel="Discard changes"
                    cancelButtonPressErrorTitle="Couldn&#x2019;t discard changes"
                    onCancelButtonPress={handleCancelNameEditing}
                />
            )}
        </>
    );
}
