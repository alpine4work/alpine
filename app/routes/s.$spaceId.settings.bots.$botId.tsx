import {ShouldRevalidateFunction} from "@remix-run/router";
import {Eye, EyeSlash} from "phosphor-react";
import {useId, useRef, useState} from "react";
import {
    deserializeBotIdForLoader,
    deserializeSpaceIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {AccountAvatar} from "~/client/web/accounts/account_avatar.js";
import {
    useAccountModel,
    useAccountRegistry,
} from "~/client/web/accounts/account_registry_context.js";
import {useBotSettingsAccount} from "~/client/web/bots/use_bot_settings_account.js";
import {ContentView} from "~/client/web/content/content_view.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {TextInputWithoutLabel} from "~/client/web/design/text_input.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/web/design/use_confirm_save_after_losing_focus.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useStateWithDependencies} from "~/client/web/helpers/lifecycle/use_state_with_dependencies.js";
import {
    InlineEditorToolbar,
    InlineEditorToolbarRef,
} from "~/client/web/messaging/inline_editor_toolbar.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/web/spaces/space_context.js";
import {
    spaceBotSettingsHeadingAvatarSize,
    spaceBotSettingsHeadingGap,
    spaceBotSettingsHeadingHeight,
    spaceBotSettingsHeadingHeightInstallButtonHeight,
    spaceBotSettingsHeadingHeightNameFontSize,
    spaceBotSettingsHeadingMarginBottom,
} from "~/client/web/styles/space_settings_shared_styles.js";
import {pointerEventsNoneNotInheritedClassName, sprinkles} from "~/client/web/styles/styles.js";
import {getBotSettingsAccount} from "~/server/bots/with_spaces/get_bot_settings_account.js";
import {getBotSpaceSettingsValues} from "~/server/bots/with_spaces/get_bot_space_settings_values.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {BotSettingsAccountSchema} from "~/shared/bots/bot_settings_account_schema.js";
import {
    BotSpaceSettingsSchemaSchema,
    BotSpaceSettingsStringPropertySchema,
} from "~/shared/bots/bot_space_settings_schema_schema.js";
import {SimpleContentWithReferencesSchema} from "~/shared/content/simple_content_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {updateBotSpaceSettingsPropertyValue} from "~/shared/rpc/bots_rpc_definitions.js";
import {
    addSpaceAccount,
    instantiateBotSpaceAccount,
    removeSpaceAccount,
} from "~/shared/rpc/spaces_rpc_definitions.js";
import {Schema, SchemaSerializedValue} from "~/shared/schema/schema.js";
import {hasSpaceRole} from "~/shared/spaces/space_model.js";

const LoaderSchema = Schema.object({
    botAccount: BotSettingsAccountSchema,
    botSettings: Schema.object({
        description: SimpleContentWithReferencesSchema,
        schema: BotSpaceSettingsSchemaSchema,
        valuesVersion: Schema.integer,
        values: Schema.map(Schema.string, Schema.unknown()),
        secretPropertyKeysWithValues: Schema.set(Schema.string),
    }),
});

// We don't need to reload if the URL doesn't change.
export const shouldRevalidate: ShouldRevalidateFunction = ({
    currentUrl: immutableCurrentUrl,
    nextUrl: immutableNextUrl,
}) => {
    const currentUrl = new URL(immutableCurrentUrl);
    const nextUrl = new URL(immutableNextUrl);

    return nextUrl.toString() !== currentUrl.toString();
};

export async function loader({context: unauthenticatedContext, params}: LoaderArgs) {
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);
    const botId = deserializeBotIdForLoader(params.botId);

    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const [botAccount, botSettings] = await runAllPromises([
        getBotSettingsAccount(context, spaceId, botId, {consistency: "StrongWithinCache"}),
        getBotSpaceSettingsValues(context, spaceId, botId, {consistency: "StrongWithinCache"}),
    ]);

    return jsonWithSchema(LoaderSchema, {botAccount, botSettings});
}

export default function SpaceBotSettingsRoute() {
    const {botAccount: botAccountFromLoader, botSettings: botSettingsFromLoader} =
        useLoaderDataWithSchema(LoaderSchema);

    const [botAccount, setBotAccount] = useStateWithDependencies(
        () => botAccountFromLoader,
        // If we get `loaderData` with a new `botAccount` then we want to use that
        // instead of whatever was set via `setBotAccount()`. This is why we use
        // `useStateWithDependencies()` here.
        [botAccountFromLoader],
    );

    const {description: botSettingsDescription, schema: botSettingsSchema} = botSettingsFromLoader;

    const [botSettingsValues, setBotSettingsValues] = useState<{
        valuesVersion: number;
        values: ReadonlyMap<string, SchemaSerializedValue>;
        secretPropertyKeysWithValues: ReadonlySet<string>;
    }>(botSettingsFromLoader);

    // If we got new values from loader data then update our state.
    if (botSettingsValues.valuesVersion < botSettingsFromLoader.valuesVersion) {
        setBotSettingsValues(botSettingsFromLoader);
    }

    const context = useAppContext();
    const navigate = useNavigate();
    const {space, currentAccount} = useSpaceContextAndRequireSpaceAccess();
    const accountRegistry = useAccountRegistry();

    const currentAccountData = useAccountModel(currentAccount);
    const botAccountData = useBotSettingsAccount(botAccount);

    const botId = assertExists(botAccountData.botId);

    // check "Admin" access for currently logged in account.
    const hasAdminAccess = hasSpaceRole(currentAccountData.space.role, "Admin");

    const isInstalled =
        botAccount.type === "Exists" && botAccountData.space.state.type === "Active";

    return (
        <Box>
            <Box
                display="flex"
                // Align bottom of avatar with the bottom of the buttons.
                alignItems="flex-end"
                gap={spaceBotSettingsHeadingGap}
            >
                <AccountAvatar
                    account={botAccountData}
                    size={spaceBotSettingsHeadingAvatarSize}
                    // Render just the avatar image. Don't render removed state transparency or the
                    // bot icon (bot icon should be implied).
                    withoutDecoration={true}
                />
                <Box
                    height={spaceBotSettingsHeadingHeight}
                    display="flex"
                    flexDirection="column"
                    justifyContent="space-between"
                >
                    <Box
                        fontSize={spaceBotSettingsHeadingHeightNameFontSize}
                        fontStyle="truncate-bold"
                        userSelect="text"
                    >
                        {botAccountData.name}
                    </Box>
                    <Box display="flex" gap="2">
                        {isInstalled ? (
                            <>
                                <Button
                                    variant="accent"
                                    fontSize="75"
                                    height={spaceBotSettingsHeadingHeightInstallButtonHeight}
                                    paddingX="2"
                                    pressErrorTitle="Couldn&#x2019;t open chat"
                                    onPress={async () => {
                                        await navigate(
                                            `/s/${space.id}/chat/with/${botAccount.account.id}?focus`,
                                        );
                                    }}
                                >
                                    Open chat
                                </Button>
                                <Button
                                    variant="quieter"
                                    fontSize="75"
                                    height={spaceBotSettingsHeadingHeightInstallButtonHeight}
                                    paddingX="2"
                                    disabledReason={
                                        !hasAdminAccess
                                            ? "Ask an admin to uninstall this bot."
                                            : undefined
                                    }
                                    pressErrorTitle="Couldn&#x2019;t uninstall bot"
                                    onPress={async () => {
                                        const {account: removedAccount} = await removeSpaceAccount(
                                            context,
                                            {
                                                spaceId: space.id,
                                                accountId: botAccount.account.id,
                                            },
                                        );
                                        accountRegistry.immediatelyUpdateAccountStoreIfExists(
                                            removedAccount,
                                        );
                                    }}
                                >
                                    Uninstall
                                </Button>
                            </>
                        ) : (
                            <>
                                <Button
                                    variant="accent"
                                    fontSize="75"
                                    height={spaceBotSettingsHeadingHeightInstallButtonHeight}
                                    paddingX="2"
                                    disabledReason={
                                        !hasAdminAccess
                                            ? "Ask an admin to install this bot."
                                            : undefined
                                    }
                                    pressErrorTitle="Couldn&#x2019;t install bot"
                                    onPress={async () => {
                                        switch (botAccount.type) {
                                            case "Exists": {
                                                const {account: addedAccount} =
                                                    await addSpaceAccount(context, {
                                                        spaceId: space.id,
                                                        accountId: botAccount.account.id,
                                                    });

                                                accountRegistry.immediatelyUpdateAccountStoreIfExists(
                                                    addedAccount,
                                                );
                                                break;
                                            }
                                            case "OnlyDefaultExists": {
                                                const {account: addedAccount} =
                                                    await instantiateBotSpaceAccount(context, {
                                                        spaceId: space.id,
                                                        botId: botAccount.defaultAccountData.botId,
                                                    });

                                                setBotAccount({
                                                    type: "Exists",
                                                    account: addedAccount,
                                                    defaultAccountData:
                                                        botAccount.defaultAccountData,
                                                });
                                                break;
                                            }
                                            default:
                                                throw exhaustive(botAccount);
                                        }
                                    }}
                                >
                                    Install
                                </Button>
                            </>
                        )}
                    </Box>
                </Box>
            </Box>
            <Spacer space={spaceBotSettingsHeadingMarginBottom} />
            <ContentView content={botSettingsDescription} />
            {!hasAdminAccess && (
                <>
                    <Spacer space="4" />
                    <Box userSelect="text" color="grey-50" fontSize="50">
                        Only admins can edit bot settings. Ask an admin to make changes.
                    </Box>
                </>
            )}
            {botSettingsSchema.properties.size > 0 && (
                <Box paddingTop="14" display="flex" flexDirection="column" gap="6">
                    {Array.from(botSettingsSchema.properties, ([propertyKey, propertySchema]) => (
                        <SpaceBotSettingsStringProperty
                            key={propertyKey}
                            isDisabled={!hasAdminAccess || !isInstalled}
                            propertySchema={propertySchema}
                            propertyValue={botSettingsValues.values.get(propertyKey)}
                            isSecretPropertyWithValue={botSettingsValues.secretPropertyKeysWithValues.has(
                                propertyKey,
                            )}
                            updatePropertyValue={async propertyValue => {
                                const newBotSettingsValues =
                                    await updateBotSpaceSettingsPropertyValue(context, {
                                        spaceId: space.id,
                                        botId,
                                        propertyKey,
                                        propertyValue,
                                    });

                                setBotSettingsValues(oldBotSettingsValues => {
                                    if (
                                        oldBotSettingsValues.valuesVersion <
                                        newBotSettingsValues.valuesVersion
                                    ) {
                                        return newBotSettingsValues;
                                    }
                                    return oldBotSettingsValues;
                                });
                            }}
                        />
                    ))}
                </Box>
            )}
        </Box>
    );
}

function SpaceBotSettingsStringProperty({
    isDisabled,
    propertySchema,
    propertyValue,
    isSecretPropertyWithValue,
    updatePropertyValue,
}: {
    isDisabled: boolean;
    propertySchema: BotSpaceSettingsStringPropertySchema;
    propertyValue: SchemaSerializedValue | undefined;
    isSecretPropertyWithValue: boolean;
    updatePropertyValue: (propertyValue: SchemaSerializedValue) => Promise<void>;
}) {
    const inputId = useId();

    const inputRef = useRef<HTMLInputElement>(null);
    const inlineEditorToolbarRef = useRef<InlineEditorToolbarRef>(null);

    const originalValue = typeof propertyValue === "string" ? propertyValue : "";
    const [value, setValue] = useState<string | null>(null);
    const [shouldShowConfirmSaveDialog, setShouldShowConfirmSaveDialog] = useState(false);

    const [isSecretRevealed, setIsSecretRevealed] = useState(false);
    if (isSecretRevealed && (isDisabled || !propertySchema.isSecret)) setIsSecretRevealed(false);

    const isSecretRevealButtonVisible =
        propertySchema.isSecret && (value ?? originalValue).length > 0 && !isDisabled;

    const handleCancelEditing = () => {
        // After we cancel editing, select all content in the text input. So the
        // selection doesn't move somewhere weird.
        shouldSelectAllAfterCancelRef.current = true;

        setValue(null);
    };

    const shouldSelectAllAfterCancelRef = useRef(false);
    useLayoutEffectWithoutServerSideWarning(() => {
        if (value !== null) return;

        if (!shouldSelectAllAfterCancelRef.current) return;
        shouldSelectAllAfterCancelRef.current = false;

        const inputElement = assertExists(inputRef.current);
        inputElement.selectionStart = 0;
        inputElement.selectionEnd = inputElement.value.length;
    }, [value]);

    const handleSave = async () => {
        await updatePropertyValue(value ?? "");
        setValue(null);
    };

    return (
        <>
            <Box
                height="10"
                gap="6"
                display="flex"
                alignItems="center"
                justifyContent="space-between"
            >
                <Box>
                    <label
                        htmlFor={inputId}
                        className={sprinkles({
                            display: "block",
                            fontSize: "100",
                            fontStyle: "truncate-semi-bold",
                            userSelect: "text",
                        })}
                    >
                        {propertySchema.label}
                    </label>
                    {propertySchema.hint !== null && (
                        <Box
                            paddingTop="1"
                            fontSize="75"
                            fontStyle="truncate"
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
                            {propertySchema.hint}
                        </Box>
                    )}
                </Box>
                <Box
                    position="relative"
                    width="full"
                    maxWidth="48"
                    ref={useConfirmSaveAfterLosingFocus({
                        shouldConfirmSave: value !== null,
                        isConfirmingSave: shouldShowConfirmSaveDialog,
                        onCancelSave: handleCancelEditing,
                        onConfirmSave: () => setShouldShowConfirmSaveDialog(true),
                    })}
                >
                    <TextInputWithoutLabel
                        ref={inputRef}
                        id={inputId}
                        isDisabled={isDisabled}
                        fontStyle={propertySchema.isCode ? "code" : "normal"}
                        fontSize="100"
                        // Make sure the secret content doesn't overlap with the reveal icon button.
                        paddingRight={isSecretRevealButtonVisible ? "9" : undefined}
                        value={
                            // If this is a secret property with a value but we're not an admin so we're
                            // not allowed to see the value then fill the input with `x`s which will render
                            // as dots.
                            isDisabled && propertySchema.isSecret && isSecretPropertyWithValue
                                ? "x".repeat(16)
                                : (value ?? originalValue)
                        }
                        onChange={setValue}
                        placeholder={propertySchema.placeholder}
                        inputMode={
                            propertySchema.isSecret && !isSecretRevealed ? "password" : "text"
                        }
                        // Disable autocomplete entirely for this input.
                        autoComplete="off"
                        onEnter={() => assertExists(inlineEditorToolbarRef.current).save()}
                        onEscape={handleCancelEditing}
                        isFocusRingVisible={value !== null}
                    />
                    {isSecretRevealButtonVisible && (
                        <Box
                            // The icon button `borderRadius` corners when clicked should fallthrough to
                            // the input.
                            className={pointerEventsNoneNotInheritedClassName}
                            position="absolute"
                            right="0"
                            top="0"
                            width="9"
                            height="9"
                            display="flex"
                            alignItems="center"
                            justifyContent="center"
                        >
                            <IconButton
                                description={isSecretRevealed ? "Hide" : "Reveal"}
                                // Avoid perfect alignment with bottom of the text input.
                                tooltipOffset="1"
                                size="md"
                                onPress={() => setIsSecretRevealed(!isSecretRevealed)}
                            >
                                {isSecretRevealed ? <EyeSlash /> : <Eye />}
                            </IconButton>
                        </Box>
                    )}
                    {value !== null && (
                        <InlineEditorToolbar
                            ref={inlineEditorToolbarRef}
                            saveErrorTitle={`Couldn\u2019t save \u201C${propertySchema.label}\u201D`}
                            onSave={handleSave}
                            onCancel={handleCancelEditing}
                        />
                    )}
                </Box>
            </Box>
            {shouldShowConfirmSaveDialog && (
                <ModalDialog
                    title={`Save \u201C${propertySchema.label}\u201D`}
                    description="Would you like to save your changes?"
                    onClose={() => {
                        setShouldShowConfirmSaveDialog(false);
                        inputRef.current?.focus();
                    }}
                    primaryButtonLabel="Save"
                    primaryButtonPressErrorTitle={`Couldn\u2019t save \u201C${propertySchema.label}\u201D`}
                    onPrimaryButtonPress={handleSave}
                    cancelButtonLabel="Discard changes"
                    cancelButtonPressErrorTitle="Couldn&#x2019;t discard changes"
                    onCancelButtonPress={handleCancelEditing}
                />
            )}
        </>
    );
}
