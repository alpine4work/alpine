import {CaretDown, Star} from "phosphor-react";
import {useId, useRef, useState} from "react";
import {AccountAvatar} from "~/client/web/accounts/account_avatar.js";
import {useAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {AvatarUploader, avatarUploaderSize} from "~/client/web/avatar/avatar_uploader.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {MenuButton} from "~/client/web/design/menu_button.js";
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {TextInputWithoutLabel} from "~/client/web/design/text_input.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/web/design/use_confirm_save_after_losing_focus.js";
import {setColorScheme, useColorScheme} from "~/client/web/helpers/color_scheme.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {
    InlineEditorToolbar,
    InlineEditorToolbarRef,
} from "~/client/web/messaging/inline_editor_toolbar.js";
import {ReactionCharacterCarouselSelector} from "~/client/web/reactions/reaction_character_carousel_selector.js";
import {useRootNavigate} from "~/client/web/remix/use_navigate.js";
import {searchFavoriteEntityIconColor} from "~/client/web/search/core/use_search_favorite_affinity_entity_menu_action.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {UploadAvatarResponseSchema} from "~/shared/avatar/protocol/upload_avatar_response_schema.js";
import {InternalError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {
    createLifetimeAccessCheckoutSessionUrl,
    updateOurAccountName,
} from "~/shared/rpc/accounts_rpc_definitions.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";

export default function SpaceProfileSettingsRoute() {
    const context = useAppContext();
    const {currentAccount} = useSpaceContext();
    const account = assertExists(currentAccount);
    const accountRegistry = useAccountRegistry();
    const rootNavigate = useRootNavigate();

    const inputRef = useRef<HTMLInputElement>(null);
    const nameInlineEditorToolbarRef = useRef<InlineEditorToolbarRef>(null);

    const idBase = useId();
    const nameTextInputId = `${idBase}-name`;

    const [name, setName] = useState<string | null>(null);
    const [shouldShowConfirmSaveNameDialog, setShouldShowConfirmSaveNameDialog] = useState(false);

    const hasLifetimeAccess = account.initialData.plan === "LifetimeAccess";

    const {colorScheme, isSystemPreference} = useColorScheme();

    const themeSettingLabel = isSystemPreference
        ? "System"
        : colorScheme === "light"
          ? "Light"
          : "Dark";

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
                    throw new InternalError(
                        quote`Unexpected response type \u201C${responseBody.type}\u201D`,
                    );
                }
                return responseBody;
            },
        );

        accountRegistry.immediatelyUpdateAccountStoreIfExists(response.account);
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
                                saveErrorTitle="Couldn&#x2019;t save user name"
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
                                // eslint-disable-next-line cyberworlds/string-quotes
                                fontFeatureSettings: '"calt" on',
                            }}
                        >
                            Recommended size is 256x256px
                        </Box>
                    </Box>
                    <AvatarUploader onUploadAvatar={handleUploadAvatar} borderRadius="full">
                        <AccountAvatar account={account} size={avatarUploaderSize} />
                    </AvatarUploader>
                </Box>
                <Box display="flex" gap="6" alignItems="flex-start" justifyContent="space-between">
                    <Box>
                        <Box fontSize="100" fontStyle="semi-bold" userSelect="text">
                            Character
                        </Box>
                        <Box paddingTop="1" fontSize="75" color="grey-60" userSelect="text">
                            Your personal character, used for reactions
                        </Box>
                    </Box>
                    <Box marginY="-2">
                        <ReactionCharacterCarouselSelector />
                    </Box>
                </Box>
                <Box display="flex" gap="6" alignItems="center" justifyContent="space-between">
                    <Box>
                        <Box fontSize="100" fontStyle="semi-bold" userSelect="text">
                            Theme
                        </Box>
                        <Box paddingTop="1" fontSize="75" color="grey-60" userSelect="text">
                            Choose your preferred color scheme
                        </Box>
                    </Box>
                    {colorScheme !== null && (
                        <Box>
                            <MenuButton
                                placement="bottom-end"
                                actions={[
                                    {
                                        label: "System",
                                        isSelected: !!isSystemPreference,
                                        onPress: () => setColorScheme("system"),
                                    },
                                    {
                                        label: "Light",
                                        isSelected: !isSystemPreference && colorScheme === "light",
                                        onPress: () => setColorScheme("light"),
                                    },
                                    {
                                        label: "Dark",
                                        isSelected: !isSystemPreference && colorScheme === "dark",
                                        onPress: () => setColorScheme("dark"),
                                    },
                                ]}
                            >
                                <Button
                                    variant="text-input"
                                    height="9"
                                    paddingX="3"
                                    fontSize="100"
                                    icon={<CaretDown />}
                                    iconPlacement="end"
                                >
                                    {themeSettingLabel}
                                </Button>
                            </MenuButton>
                        </Box>
                    )}
                </Box>
                <Box
                    paddingY="5"
                    display="flex"
                    gap="4"
                    alignItems="flex-start"
                    justifyContent="space-between"
                >
                    <Box display="flex" flexDirection="column" gap="1">
                        <Box userSelect="text" display="flex" alignItems="center" gap="2">
                            <Box display="inline" fontSize="100" fontStyle="semi-bold">
                                Lifetime access
                            </Box>
                            <Star
                                weight="fill"
                                className={sprinkles({
                                    // Re-use the search favorite icon colors for the
                                    // lifetime access purchase icon since they fit well.
                                    fill: searchFavoriteEntityIconColor,
                                })}
                                size={20}
                            />
                        </Box>
                        <Box display="flex" flexDirection="row" gap="4">
                            <Box fontSize="75" color="grey-60" userSelect="text">
                                Support Alpine&#x2019;s four person team by buying lifetime access
                                for $250 (limited availability, eventually we&#x2019;ll switch to
                                subscription pricing)
                            </Box>
                        </Box>
                    </Box>
                    <Box
                        // Optically align "Purchase" text baseline with "Lifetime access" text baseline.
                        marginTop="-1"
                        paddingLeft="24"
                    >
                        <Button
                            variant="accent"
                            fontSize="100"
                            height="9"
                            paddingX="3"
                            isDisabled={hasLifetimeAccess}
                            pressErrorTitle="Couldn&#x2019;t purchase lifetime access"
                            onPress={async () => {
                                const {result} = await createLifetimeAccessCheckoutSessionUrl(
                                    context,
                                    {
                                        currentPathname: window.location.pathname,
                                    },
                                );

                                if (result.ok) {
                                    window.location.href = result.url;
                                } else {
                                    switch (result.reason) {
                                        case "AlreadyPurchased":
                                            await rootNavigate(`/?purchased=lifetime-access`);
                                            break;
                                        default:
                                            throw exhaustive(result.reason);
                                    }
                                }
                            }}
                        >
                            <Box display="flex" alignItems="center" gap="1">
                                {hasLifetimeAccess ? "Purchased" : "Purchase"}
                            </Box>
                        </Button>
                    </Box>
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
                    primaryButtonPressErrorTitle="Couldn&#x2019;t save user name"
                    onPrimaryButtonPress={handleSaveName}
                    cancelButtonLabel="Discard changes"
                    cancelButtonPressErrorTitle="Couldn&#x2019;t discard changes"
                    onCancelButtonPress={handleCancelNameEditing}
                />
            )}
        </>
    );
}
