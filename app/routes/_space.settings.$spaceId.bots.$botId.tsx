import {ShouldRevalidateFunction} from "@remix-run/router";
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
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {SecretTextInputWithoutLabel} from "~/client/web/design/secret_text_input.js";
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
import {useSpaceContextAndRequireSpaceAccess} from "~/client/web/spaces/context/space_context.js";
import {
    spaceBotSettingsHeadingAvatarSize,
    spaceBotSettingsHeadingGap,
    spaceBotSettingsHeadingHeight,
    spaceBotSettingsHeadingHeightInstallButtonHeight,
    spaceBotSettingsHeadingHeightNameFontSize,
    spaceBotSettingsHeadingMarginBottom,
} from "~/client/web/styles/space_settings_shared_styles.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {getBotSettingsAccount} from "~/server/bots/with_spaces/get_bot_settings_account.js";
import {getBotSpaceAndSpaceAccountSettingsValues} from "~/server/bots/with_spaces/get_bot_space_and_space_account_settings_values.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {BotSettingsAccountSchema} from "~/shared/bots/bot_settings_account_schema.js";
import {
    BotSettingsSchemaSchema,
    BotSettingsSchemaStringProperty,
} from "~/shared/bots/bot_settings_schema.js";
import {SimpleContentWithReferencesSchema} from "~/shared/content/simple_content_schema.js";
import {addRemLengths} from "~/shared/design/core/spacing.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.open_source.js";
import {
    updateBotSpaceAccountSettingsPropertyValue,
    updateBotSpaceSettingsPropertyValue,
} from "~/shared/rpc/bots_rpc_definitions.js";
import {
    addSpaceAccount,
    instantiateBotSpaceAccount,
    removeSpaceAccount,
} from "~/shared/rpc/spaces_rpc_definitions.js";
import {Schema, SchemaSerializedValue} from "~/shared/schema/schema.open_source.js";
import {hasSpaceRole} from "~/shared/spaces/space_model.js";

const LoaderSchema = Schema.object({
    botAccount: BotSettingsAccountSchema,
    botSettings: Schema.object({
        description: SimpleContentWithReferencesSchema,
        schema: BotSettingsSchemaSchema,
    }),
    botSpaceSettings: Schema.object({
        valuesVersion: Schema.integer,
        values: Schema.map(Schema.string, Schema.unknown()),
        secretPropertyKeysWithValues: Schema.set(Schema.string),
    }),
    botSpaceAccountSettings: Schema.object({
        valuesVersion: Schema.integer,
        values: Schema.map(Schema.string, Schema.unknown()),
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
    const accountId = context.actor.getAccountId();

    const [botAccount, botSettings] = await runAllPromises([
        getBotSettingsAccount(context, spaceId, botId, {consistency: "StrongWithinCache"}),
        getBotSpaceAndSpaceAccountSettingsValues(context, spaceId, accountId, botId, {
            consistency: "StrongWithinCache",
        }),
    ]);

    return jsonWithSchema(LoaderSchema, {
        botAccount,
        botSettings: {
            description: botSettings.description,
            schema: botSettings.schema,
        },
        botSpaceSettings: {
            valuesVersion: botSettings.spaceValuesVersion,
            values: botSettings.spaceValues,
            secretPropertyKeysWithValues: botSettings.spaceSecretPropertyKeysWithValues,
        },
        botSpaceAccountSettings: {
            valuesVersion: botSettings.accountValuesVersion,
            values: botSettings.accountValues,
        },
    });
}

export default function SpaceBotSettingsRoute() {
    const {
        botAccount: botAccountFromLoader,
        botSettings,
        botSpaceSettings: botSpaceSettingsFromLoader,
        botSpaceAccountSettings: botSpaceAccountSettingsFromLoader,
    } = useLoaderDataWithSchema(LoaderSchema);

    const [botAccount, setBotAccount] = useStateWithDependencies(
        () => botAccountFromLoader,
        // If we get `loaderData` with a new `botAccount` then we want to use that instead
        // of whatever was set via `setBotAccount()`. This is why we use
        // `useStateWithDependencies()` here.
        [botAccountFromLoader],
    );

    const [botSpaceSettingsValues, setBotSpaceSettingsValues] = useState<{
        valuesVersion: number;
        values: ReadonlyMap<string, SchemaSerializedValue>;
        secretPropertyKeysWithValues: ReadonlySet<string>;
    }>(botSpaceSettingsFromLoader);

    const [botSpaceAccountSettingsValues, setBotSpaceAccountSettingsValues] = useState<{
        valuesVersion: number;
        values: ReadonlyMap<string, SchemaSerializedValue>;
    }>(botSpaceAccountSettingsFromLoader);

    // If we got new values from loader data then update our state.
    if (botSpaceSettingsValues.valuesVersion < botSpaceSettingsFromLoader.valuesVersion) {
        setBotSpaceSettingsValues(botSpaceSettingsFromLoader);
    }

    // If we got new values from loader data then update our state.
    if (
        botSpaceAccountSettingsValues.valuesVersion <
        botSpaceAccountSettingsFromLoader.valuesVersion
    ) {
        setBotSpaceAccountSettingsValues(botSpaceAccountSettingsFromLoader);
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

    const botSpaceSettingsSchemaPropertyEntries = Array.from(
        filterIterable(
            botSettings.schema.properties,
            ([, propertySchema]) => propertySchema.level === "Space",
        ),
    );

    const botSpaceAccountSettingsSchemaPropertyEntries = Array.from(
        filterIterable(
            botSettings.schema.properties,
            ([, propertySchema]) => propertySchema.level === "SpaceAccount",
        ),
    );

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
                    // Render just the avatar image. Don't render removed state transparency or the bot
                    // icon (bot icon should be implied).
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
                                            `/chat/with/${botAccount.account.id}/${space.id}?focus`,
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
            <ContentView content={botSettings.description} />
            <Box
                display="flex"
                flexDirection="column"
                gap="24"
                style={{paddingTop: addRemLengths("16", "2")}}
            >
                {botSpaceSettingsSchemaPropertyEntries.length > 0 && (
                    <Box display="flex" flexDirection="column" gap="8">
                        <Box
                            display="flex"
                            alignItems="baseline"
                            justifyContent="space-between"
                            paddingBottom="1.5"
                            borderBottom="grey-5"
                        >
                            <Box fontSize="300" fontStyle="bold" userSelect="text">
                                Space settings
                            </Box>
                            <Box color="grey-50" fontSize="50" userSelect="text">
                                Only admins can edit these
                            </Box>
                        </Box>
                        <Box display="flex" flexDirection="column" gap="7">
                            {botSpaceSettingsSchemaPropertyEntries.map(
                                ([propertyKey, propertySchema]) => (
                                    <SpaceBotSettingsStringProperty
                                        key={propertyKey}
                                        isDisabled={!hasAdminAccess || !isInstalled}
                                        propertySchema={propertySchema}
                                        propertyValue={botSpaceSettingsValues.values.get(
                                            propertyKey,
                                        )}
                                        isSecretPropertyWithValue={botSpaceSettingsValues.secretPropertyKeysWithValues.has(
                                            propertyKey,
                                        )}
                                        updatePropertyValue={async propertyValue => {
                                            const newBotSpaceSettingsValues =
                                                await updateBotSpaceSettingsPropertyValue(context, {
                                                    spaceId: space.id,
                                                    botId,
                                                    propertyKey,
                                                    propertyValue,
                                                });

                                            setBotSpaceSettingsValues(oldBotSpaceSettingsValues => {
                                                if (
                                                    oldBotSpaceSettingsValues.valuesVersion <
                                                    newBotSpaceSettingsValues.valuesVersion
                                                ) {
                                                    return newBotSpaceSettingsValues;
                                                }
                                                return oldBotSpaceSettingsValues;
                                            });
                                        }}
                                    />
                                ),
                            )}
                        </Box>
                    </Box>
                )}
                {botSpaceAccountSettingsSchemaPropertyEntries.length > 0 && (
                    <Box display="flex" flexDirection="column" gap="7">
                        <Box
                            display="flex"
                            alignItems="baseline"
                            justifyContent="space-between"
                            paddingBottom="1.5"
                            borderBottom="grey-5"
                        >
                            <Box fontSize="300" fontStyle="bold" userSelect="text">
                                Your settings
                            </Box>
                            <Box color="grey-50" fontSize="50" userSelect="text">
                                Only you can see and edit these
                            </Box>
                        </Box>
                        <Box display="flex" flexDirection="column" gap="8">
                            {botSpaceAccountSettingsSchemaPropertyEntries.map(
                                ([propertyKey, propertySchema]) => (
                                    <SpaceBotSettingsStringProperty
                                        key={propertyKey}
                                        isDisabled={!isInstalled}
                                        propertySchema={propertySchema}
                                        propertyValue={botSpaceAccountSettingsValues.values.get(
                                            propertyKey,
                                        )}
                                        isSecretPropertyWithValue={false}
                                        updatePropertyValue={async propertyValue => {
                                            const newBotSpaceAccountSettingsValues =
                                                await updateBotSpaceAccountSettingsPropertyValue(
                                                    context,
                                                    {
                                                        spaceId: space.id,
                                                        botId,
                                                        accountId: currentAccount.id,
                                                        propertyKey,
                                                        propertyValue,
                                                    },
                                                );

                                            setBotSpaceAccountSettingsValues(
                                                oldBotSpaceAccountSettingsValues => {
                                                    if (
                                                        oldBotSpaceAccountSettingsValues.valuesVersion <
                                                        newBotSpaceAccountSettingsValues.valuesVersion
                                                    ) {
                                                        return newBotSpaceAccountSettingsValues;
                                                    }
                                                    return oldBotSpaceAccountSettingsValues;
                                                },
                                            );
                                        }}
                                    />
                                ),
                            )}
                        </Box>
                    </Box>
                )}
            </Box>
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
    propertySchema: BotSettingsSchemaStringProperty;
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

    const handleCancelEditing = () => {
        // After we cancel editing, select all content in the text input. So the selection
        // doesn't move somewhere weird.
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
                alignItems="flex-start"
                justifyContent="space-between"
            >
                <Box minWidth="flex-fit">
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
                                // eslint-disable-next-line cyberworlds/string-quotes
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
                    flexShrink="0"
                    ref={useConfirmSaveAfterLosingFocus({
                        shouldConfirmSave: value !== null,
                        isConfirmingSave: shouldShowConfirmSaveDialog,
                        onCancelSave: handleCancelEditing,
                        onConfirmSave: () => setShouldShowConfirmSaveDialog(true),
                    })}
                >
                    {propertySchema.isSecret ? (
                        <SecretTextInputWithoutLabel
                            ref={inputRef}
                            id={inputId}
                            isDisabled={isDisabled}
                            fontStyle={propertySchema.isCode ? "code" : "normal"}
                            fontSize="100"
                            value={value ?? originalValue}
                            isValueHiddenWhenDisabled={isSecretPropertyWithValue}
                            onChange={setValue}
                            placeholder={propertySchema.placeholder}
                            onEnter={() => assertExists(inlineEditorToolbarRef.current).save()}
                            onEscape={handleCancelEditing}
                            isFocusRingVisible={value !== null}
                        />
                    ) : (
                        <TextInputWithoutLabel
                            ref={inputRef}
                            id={inputId}
                            isDisabled={isDisabled}
                            fontStyle={propertySchema.isCode ? "code" : "normal"}
                            fontSize="100"
                            value={value ?? originalValue}
                            onChange={setValue}
                            placeholder={propertySchema.placeholder}
                            onEnter={() => assertExists(inlineEditorToolbarRef.current).save()}
                            onEscape={handleCancelEditing}
                            isFocusRingVisible={value !== null}
                        />
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
