import {useId, useRef, useState} from "react";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {useAccountRegistry} from "~/client/accounts/account_registry_context.js";
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
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {sprinkles} from "~/client/styles/styles.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {UploadAvatarResponseSchema} from "~/shared/avatar/protocol/upload_avatar_response_schema.js";
import {InternalError, UnimplementedError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {updateOurAccountName} from "~/shared/rpc/accounts_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";
import {hasProfileSettingsFeature} from "~/shared/spaces/has_profile_settings_feature.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";

const LoaderSchema = Schema.object({});

export async function loader({params}: LoaderArgs) {
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);

    if (!hasProfileSettingsFeature(spaceId)) {
        throw new UnimplementedError("Profile settings is not available");
    }

    return jsonWithSchema(LoaderSchema, {});
}

export default function SpaceProfileSettingsRoute() {
    const context = useAppContext();
    const {currentAccount} = useSpaceContext();
    const account = assertExists(currentAccount);
    const accountRegistry = useAccountRegistry();

    const inputRef = useRef<HTMLInputElement>(null);
    const nameInlineEditorToolbarRef = useRef<InlineEditorToolbarRef>(null);

    const idBase = useId();
    const nameTextInputId = `${idBase}-name`;

    const [name, setName] = useState<string | null>(null);
    const [shouldShowConfirmSaveNameDialog, setShouldShowConfirmSaveNameDialog] = useState(false);

    const handleSaveName = async () => {
        if (name === null) return;

        const {account} = await updateOurAccountName(context, {
            name: name,
        });

        accountRegistry.immediatelyUpdateAccountStoreIfExists(account);
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

    const handleUploadAvatar = async (file: File) => {
        const response = await fetchWithTracer(
            context.tracer.getTracer(),
            new URL(`/api/avatar/account/${account.id}`, window.location.href),
            {
                serviceName: "EdgeService",
                route: "/api/avatar/account/:accountId",
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

                if (responseBody.type !== "UploadAccountAvatar") {
                    throw new InternalError(quote`Unexpected response type “${responseBody.type}”`);
                }
                return responseBody;
            },
        );

        accountRegistry.immediatelyUpdateAccountStoreIfExists(response.account);
    };

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
                            value={name ?? account.initialData.name}
                            onChange={setName}
                            placeholder={account.initialData.name}
                            onEnter={() => assertExists(nameInlineEditorToolbarRef.current).save()}
                            onEscape={handleCancelNameEditing}
                            isFocusRingVisible={name !== null}
                        />
                        {name !== null && (
                            <InlineEditorToolbar
                                ref={nameInlineEditorToolbarRef}
                                saveErrorTitle="Couldn’t save user name"
                                onSave={handleSaveName}
                                onCancel={handleCancelNameEditing}
                            />
                        )}
                    </Box>
                </Box>
                <Box display="flex" gap="6" alignItems="center" justifyContent="space-between">
                    <Box>
                        <Box fontSize="100" fontStyle="semi-bold" userSelect="text">
                            Avatar
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
                    <AvatarUploader onUploadAvatar={handleUploadAvatar} borderRadius="full">
                        <AccountAvatar account={account} size="12" />
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
                    primaryButtonPressErrorTitle="Couldn’t save user name"
                    onPrimaryButtonPress={handleSaveName}
                    cancelButtonLabel="Discard changes"
                    cancelButtonPressErrorTitle="Couldn’t discard changes"
                    onCancelButtonPress={handleCancelNameEditing}
                />
            )}
        </>
    );
}
