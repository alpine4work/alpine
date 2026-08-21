import classNames from "classnames";
import {SpinnerGap, Trash} from "phosphor-react";
import {KeyboardEvent as ReactKeyboardEvent, useId, useRef, useState} from "react";
import {usePress} from "react-aria";
import {useAccountModel} from "~/client/web/accounts/account_registry_context.js";
import {AvatarUploader} from "~/client/web/avatar/avatar_uploader.js";
import {BotAvatar} from "~/client/web/bots/bot_avatar.js";
import {CustomBotApiKeysSection} from "~/client/web/bots/custom_bot_api_keys_section.js";
import {CustomBotWebhookTokenSection} from "~/client/web/bots/custom_bot_webhook_token_section.js";
import {uploadBotAvatar} from "~/client/web/bots/upload_bot_avatar.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {InputWithAutoGrowingWidth} from "~/client/web/design/input_with_auto_growing_width.js";
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {scheduleAfterNavigationAnimation} from "~/client/web/design/schedule_after_navigation_animation.js";
import {SecretTextInputWithoutLabel} from "~/client/web/design/secret_text_input.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {TextInputWithoutLabel} from "~/client/web/design/text_input.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/web/design/use_confirm_save_after_losing_focus.js";
import {useDelayLoadingIndicator} from "~/client/web/design/use_delay_loading_indicator.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {
    InlineEditorToolbar,
    InlineEditorToolbarRef,
} from "~/client/web/messaging/inline_editor_toolbar.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/web/spaces/context/space_context.js";
import {
    spaceBotSettingsHeadingAvatarSize,
    spaceBotSettingsHeadingGap,
    spaceBotSettingsHeadingHeightNameFontSize,
    spaceBotSettingsHeadingMarginBottom,
} from "~/client/web/styles/space_settings_shared_styles.js";
import {colorSchemeVars, spinAnimationClassName, sprinkles} from "~/client/web/styles/styles.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {BotOperationType} from "~/shared/bots/bot_operation.js";
import {Bot} from "~/shared/bots/bot_schema.js";
import {BotTokenScope} from "~/shared/bots/bot_token_scope.js";
import {BotOwnerEntity} from "~/shared/bots/owners/bot_owner_entity.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {deleteBot, updateBot} from "~/shared/rpc/bots_rpc_definitions.js";

export type CustomBotSettingsApiKey = {
    readonly apiKey: string;
    readonly name: string | null;
    readonly scope?: BotTokenScope | null;
    readonly createdTime: Date;
};

// TODO (rmtobin, #bot-documentation): This page needs links to our documentation
// explaining personal/shared bots, our scopes, how webhooks work (auth, payload,
// and signing secret)
/**
 * Settings page for a custom bot. Lets the owner edit the bot's identity inline,
 * point it at a webhook, manage its API keys, and delete it.
 */
export function CustomBotSettingsView({
    bot,
    webhook,
    scopedApiKeys,
    unscopedApiKeys,
    ownerEntity,
    allowedOperations,
}: {
    bot: Pick<Bot, "id" | "name" | "avatar">;
    webhook: {
        url: string | null;
        secret: string | null;
    };
    ownerEntity: BotOwnerEntity;
    scopedApiKeys: ReadonlyArray<CustomBotSettingsApiKey>;
    unscopedApiKeys: ReadonlyArray<CustomBotSettingsApiKey>;
    allowedOperations: ReadonlySet<BotOperationType>;
}) {
    const context = useAppContext();
    const navigate = useNavigate();

    const {space, currentAccount} = useSpaceContextAndRequireSpaceAccess();
    const currentAccountData = useAccountModel(currentAccount);

    const isPersonalBot = ownerEntity.type === "Account";

    // Every mutation on this page is a `Manage` operation, so without it the page is
    // read-only. The server authorizes each mutation too, this only keeps us from
    // offering controls that would fail.
    const canManage = allowedOperations.has("Manage");

    const ownerName =
        ownerEntity.type === "Account"
            ? getAccountShortNameWithoutFullNameTooltip(currentAccountData)
            : space.name;

    const [botName, setBotName] = useState(bot.name);
    const [webhookUrl, setWebhookUrl] = useState(webhook.url ?? null);
    const [webhookSecret, setWebhookSecret] = useState(webhook.secret);
    const [botAvatar, setBotAvatar] = useState(bot.avatar ?? null);
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

    // Whether the user is currently editing the bot's name inline.
    const [isEditingName, setIsEditingName] = useState(false);

    const {pressProps: nameEditPressProps} = usePress({
        onPress: () => setIsEditingName(true),
    });

    const handleUpdateBot = async (update: {
        name?: string;
        webhookUrl?: string | null;
        // `undefined` leaves the secret untouched, `null` clears it, a string sets it.
        webhookSecret?: string | null;
    }) => {
        const newName = update.name ?? bot.name;
        const newWebhookUrl = update.webhookUrl === undefined ? webhookUrl : update.webhookUrl;

        await updateBot(context, {
            botId: bot.id,
            name: newName,
            webhook:
                newWebhookUrl === null
                    ? null
                    : {
                          url: newWebhookUrl,
                          // Only forward the secret when this update actually changes it. Omitting it leaves
                          // the existing secret untouched (vs. `null`, which clears it), so an unrelated
                          // edit (name, URL, ...) never disturbs the stored secret.
                          ...(update.webhookSecret !== undefined
                              ? {secret: update.webhookSecret}
                              : {}),
                      },
        });

        setBotName(newName);
        setWebhookUrl(newWebhookUrl);

        if (newWebhookUrl === null) {
            setWebhookSecret(null);
        } else if (update.webhookSecret !== undefined) {
            setWebhookSecret(update.webhookSecret);
        }
    };

    return (
        <Box>
            {isDeleteDialogOpen && (
                <ModalDialog
                    title={`Delete ${bot.name}?`}
                    description="This will permanently delete the bot and all of its API keys. This action cannot be undone."
                    primaryButtonLabel="Delete"
                    primaryButtonPressErrorTitle="Couldn&#x2019;t delete bot"
                    onPrimaryButtonPress={async () => {
                        await deleteBot(context, {botId: bot.id});
                        await navigate(`/settings/${space.id}/bots`);
                    }}
                    onClose={() => setIsDeleteDialogOpen(false)}
                    initiallyFocus="Cancel"
                />
            )}
            <Box display="flex" gap={spaceBotSettingsHeadingGap}>
                {canManage ? (
                    <AvatarUploader
                        borderRadius="full"
                        size={spaceBotSettingsHeadingAvatarSize}
                        onUploadAvatar={async file => {
                            const avatarModel = await uploadBotAvatar(context, bot.id, file);
                            setBotAvatar(avatarModel);
                        }}
                    >
                        <BotAvatar
                            bot={{id: bot.id, avatar: botAvatar}}
                            size={spaceBotSettingsHeadingAvatarSize}
                        />
                    </AvatarUploader>
                ) : (
                    <BotAvatar
                        bot={{id: bot.id, avatar: botAvatar}}
                        size={spaceBotSettingsHeadingAvatarSize}
                    />
                )}
                <Box display="flex" flexDirection="column" flexGrow="1" minWidth="flex-fit">
                    <Box display="flex" alignItems="center" gap="3">
                        {isEditingName ? (
                            <CustomBotHeaderInlineEditor
                                initialValue={botName}
                                placeholder="Name"
                                textClassName={sprinkles({
                                    paddingX: "1",
                                    fontSize: spaceBotSettingsHeadingHeightNameFontSize,
                                    fontStyle: "bold",
                                })}
                                confirmSaveTitle="Save name"
                                saveErrorTitle="Couldn&#x2019;t save name"
                                onCancel={() => setIsEditingName(false)}
                                onSave={async value => {
                                    await handleUpdateBot({name: value});
                                    setIsEditingName(false);
                                }}
                            />
                        ) : canManage ? (
                            <FocusRing offset="border">
                                <Box
                                    {...nameEditPressProps}
                                    role="button"
                                    tabIndex={0}
                                    fontSize={spaceBotSettingsHeadingHeightNameFontSize}
                                    fontStyle="truncate-bold"
                                    userSelect="text"
                                    cursor="pointer"
                                    borderRadius="1"
                                    marginX="-1"
                                    paddingX="1"
                                    minWidth="flex-fit"
                                >
                                    {bot.name}
                                </Box>
                            </FocusRing>
                        ) : (
                            <Box
                                fontSize={spaceBotSettingsHeadingHeightNameFontSize}
                                fontStyle="truncate-bold"
                                userSelect="text"
                                minWidth="flex-fit"
                            >
                                {bot.name}
                            </Box>
                        )}
                        <Box
                            flexShrink="0"
                            fontSize="50"
                            color="grey-60"
                            border="grey-10"
                            borderRadius="full"
                            paddingX="2.5"
                            paddingY="1"
                            userSelect="text"
                        >
                            {isPersonalBot ? "Personal" : "Shared"}
                        </Box>
                    </Box>
                    {isPersonalBot ? (
                        <Box fontSize="75" color="grey-60">
                            Custom bot owned by {ownerName}
                        </Box>
                    ) : (
                        <Box fontSize="75" color="grey-60">
                            Custom bot shared with {ownerName}
                        </Box>
                    )}
                </Box>
            </Box>
            <Spacer space={spaceBotSettingsHeadingMarginBottom} />
            <Box display="flex" flexDirection="column" gap="16">
                <Box display="flex" flexDirection="column" gap="8">
                    <Box
                        display="flex"
                        alignItems="baseline"
                        justifyContent="space-between"
                        paddingBottom="1.5"
                        borderBottom="grey-5"
                    >
                        <Box fontSize="300" fontStyle="bold" userSelect="text">
                            Events
                        </Box>
                        <Box color="grey-50" fontSize="50" userSelect="text">
                            {!isPersonalBot && "Only admins can edit these"}
                        </Box>
                    </Box>
                    <CustomBotSettingsField
                        label="Webhook URL"
                        hint="URL where Alpine will send events"
                        value={webhookUrl ?? ""}
                        placeholder="https://..."
                        isCode={true}
                        isReadOnly={!canManage}
                        onSave={async value => {
                            await handleUpdateBot({webhookUrl: value.trim() || null});
                        }}
                    />
                    <CustomBotSettingsField
                        label="Signing secret"
                        hint="Secret for verifying events are from Alpine"
                        value={webhookSecret ?? ""}
                        placeholder="..."
                        isCode={true}
                        isSecret={true}
                        isReadOnly={!canManage}
                        onSave={async value => {
                            await handleUpdateBot({webhookSecret: value.trim() || null});
                        }}
                    />
                    <CustomBotWebhookTokenSection
                        botId={bot.id}
                        botName={bot.name}
                        isPersonalBot={isPersonalBot}
                        initialApiKeys={unscopedApiKeys}
                        canManage={canManage}
                    />
                </Box>
                <CustomBotApiKeysSection
                    botId={bot.id}
                    botName={bot.name}
                    isPersonalBot={isPersonalBot}
                    initialApiKeys={scopedApiKeys}
                    canManage={canManage}
                />
                {canManage && (
                    <Box display="flex" flexDirection="column" gap="8">
                        <Box paddingBottom="1.5" borderBottom="grey-5">
                            <Box fontSize="300" fontStyle="bold" color="red-80" userSelect="text">
                                Danger zone
                            </Box>
                        </Box>
                        <Box
                            display="flex"
                            alignItems="center"
                            justifyContent="space-between"
                            gap="6"
                        >
                            <Box>
                                <Box fontSize="100" fontStyle="semi-bold" userSelect="text">
                                    Delete this bot
                                </Box>
                                <Box fontSize="75" color="grey-60" paddingTop="1" userSelect="text">
                                    Permanently remove this bot and revoke all of its API keys. This
                                    cannot be undone.
                                </Box>
                            </Box>
                            <Box
                                borderRadius="1.5"
                                flexShrink="0"
                                style={{border: `1px solid ${colorSchemeVars["red-80"]}`}}
                            >
                                <Button
                                    type="button"
                                    variant="quiet"
                                    color="red-80"
                                    icon={<Trash />}
                                    onPress={() => setIsDeleteDialogOpen(true)}
                                >
                                    Delete bot
                                </Button>
                            </Box>
                        </Box>
                    </Box>
                )}
            </Box>
        </Box>
    );
}

/**
 * Inline, click-to-edit text editor for the custom bot header's name. Uses an
 * auto-growing-width single-line input so it hugs the title. Focuses on mount,
 * saves on `Enter` or blur (asking for confirmation when there are unsaved
 * changes), and cancels on `Escape`. Modeled after `RoomChatViewNameEditor`.
 */
function CustomBotHeaderInlineEditor({
    initialValue,
    placeholder,
    textClassName,
    confirmSaveTitle,
    saveErrorTitle,
    onCancel,
    onSave,
}: {
    initialValue: string;
    placeholder: string;
    textClassName: string;
    confirmSaveTitle: string;
    saveErrorTitle: string;
    onCancel: () => void;
    onSave: (value: string) => Promise<void>;
}) {
    const reporter = useReporter();

    const inputRef = useRef<HTMLInputElement>(null);
    const [value, setValue] = useState(initialValue);
    const [isSaving, setIsSaving] = useState(false);
    const [shouldShowConfirmSaveDialog, setShouldShowConfirmSaveDialog] = useState(false);

    const shouldShowSavingIndicator = useDelayLoadingIndicator(isSaving);

    const shouldFocusNextRenderRef = useRef(true);
    useLayoutEffectWithoutServerSideWarning(() => {
        // If the close confirmation dialog is open, we can't focus our editor.
        if (shouldShowConfirmSaveDialog) return;

        if (!shouldFocusNextRenderRef.current) return;
        shouldFocusNextRenderRef.current = false;

        return scheduleAfterNavigationAnimation(() => {
            const inputElement = assertExists(inputRef.current);
            inputElement.select();
            inputElement.focus({preventScroll: true});
        });
    }, [shouldShowConfirmSaveDialog]);

    const trimmedValue = value.trim();
    const canSave = trimmedValue.length > 0;
    const hasUnsavedChanges = trimmedValue !== initialValue.trim();

    const save = () => {
        if (isSaving) return;

        // An empty value reverts to what we had before. Discard instead of saving.
        if (!canSave) {
            onCancel();
            return;
        }

        runPromiseWithoutAwaiting(async () => {
            setIsSaving(true);
            try {
                await onSave(trimmedValue);
            } catch (error) {
                reporter.displayError(saveErrorTitle, error);
            } finally {
                setIsSaving(false);
            }
        });
    };

    const editorRef = useMergedRefs(
        inputRef,
        useConfirmSaveAfterLosingFocus<HTMLInputElement>({
            isDisabled: isSaving,
            shouldConfirmSave: canSave && hasUnsavedChanges,
            isConfirmingSave: shouldShowConfirmSaveDialog,
            onCancelSave: onCancel,
            onConfirmSave: () => setShouldShowConfirmSaveDialog(true),
        }),
    );

    // `Enter` saves; `Escape` cancels.
    const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
        switch (event.key) {
            case "Enter": {
                event.preventDefault();
                event.stopPropagation();
                save();
                break;
            }
            case "Escape": {
                event.preventDefault();
                event.stopPropagation();
                if (isSaving) break;
                onCancel();
                break;
            }
        }
    };

    return (
        <>
            <Box display="flex" alignItems="center" gap="2" minWidth="flex-fit" margin="-1">
                <FocusRing offset="border" isVisibleFromAnyFocus={true}>
                    <InputWithAutoGrowingWidth
                        ref={editorRef}
                        placeholder={placeholder}
                        autoComplete="off"
                        value={value}
                        onChange={event => {
                            if (isSaving) return;
                            setValue(event.currentTarget.value);
                        }}
                        className={sprinkles({
                            paddingY: "1",
                            borderRadius: "1",
                            backgroundColor: "transparent",
                        })}
                        style={{boxShadow: `inset 0 0 0 1px ${colorSchemeVars["grey-10"]}`}}
                        textClassName={textClassName}
                        textStyle={{
                            // Render contextual alternate glyphs for user-entered text.
                            // eslint-disable-next-line cyberworlds/string-quotes
                            fontFeatureSettings: '"calt" on',
                        }}
                        onKeyDown={handleKeyDown}
                    />
                </FocusRing>
                {shouldShowSavingIndicator && (
                    <SpinnerGap
                        className={classNames(spinAnimationClassName, sprinkles({flexShrink: "0"}))}
                        color={colorSchemeVars["grey-70"]}
                        size={spacing["4"]}
                    />
                )}
            </Box>
            {shouldShowConfirmSaveDialog && (
                <ModalDialog
                    title={confirmSaveTitle}
                    description="Would you like to save your changes?"
                    onClose={() => {
                        // Return focus to the editor if the dialog is closed. This acts as a "cancel" and
                        // lets the user continue writing.
                        shouldFocusNextRenderRef.current = true;
                        setShouldShowConfirmSaveDialog(false);
                    }}
                    primaryButtonLabel="Save"
                    primaryButtonPressErrorTitle={saveErrorTitle}
                    onPrimaryButtonPress={() => onSave(trimmedValue)}
                    cancelButtonLabel="Discard changes"
                    cancelButtonPressErrorTitle="Couldn&#x2019;t discard changes"
                    onCancelButtonPress={onCancel}
                />
            )}
        </>
    );
}

/**
 * A labeled text field with save/cancel editing controls, like
 * `SpaceBotSettingsStringProperty` but for the bot's own attributes instead of a
 * dynamic settings schema property.
 */
function CustomBotSettingsField({
    label,
    hint,
    value: originalValue,
    placeholder,
    isCode,
    isSecret,
    isReadOnly,
    onSave,
}: {
    label: string;
    hint: string;
    value: string;
    placeholder?: string;
    isCode?: boolean;
    isSecret?: boolean;
    isReadOnly?: boolean;
    onSave: (value: string) => Promise<void>;
}) {
    const inputId = useId();

    const inputRef = useRef<HTMLInputElement>(null);
    const inlineEditorToolbarRef = useRef<InlineEditorToolbarRef>(null);

    const [value, setValue] = useState<string | null>(null);
    const [shouldShowConfirmSaveDialog, setShouldShowConfirmSaveDialog] = useState(false);

    const handleCancelEditing = () => {
        setValue(null);
    };

    const handleSave = async () => {
        await onSave(value ?? originalValue);
        setValue(null);
    };

    return (
        <>
            <Box
                minHeight="10"
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
                        {label}
                    </label>
                    <Box paddingTop="1" fontSize="75" color="grey-60" userSelect="text">
                        {hint}
                    </Box>
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
                    {isSecret ? (
                        <SecretTextInputWithoutLabel
                            ref={inputRef}
                            id={inputId}
                            fontStyle={isCode ? "code" : "normal"}
                            fontSize="100"
                            value={value ?? originalValue}
                            onChange={setValue}
                            placeholder={placeholder}
                            onEnter={() => assertExists(inlineEditorToolbarRef.current).save()}
                            onEscape={handleCancelEditing}
                            isFocusRingVisible={value !== null}
                            // Disabled rather than read-only so the reveal control goes away too, keeping the
                            // secret hidden from anyone who can't manage it.
                            isDisabled={isReadOnly}
                            isValueHiddenWhenDisabled={true}
                        />
                    ) : (
                        <TextInputWithoutLabel
                            ref={inputRef}
                            id={inputId}
                            fontStyle={isCode ? "code" : "normal"}
                            fontSize="100"
                            value={value ?? originalValue}
                            onChange={setValue}
                            placeholder={placeholder}
                            inputMode="url"
                            onEnter={() => assertExists(inlineEditorToolbarRef.current).save()}
                            onEscape={handleCancelEditing}
                            isFocusRingVisible={value !== null}
                            isReadOnly={isReadOnly}
                        />
                    )}
                    {!isReadOnly && value !== null && (
                        <InlineEditorToolbar
                            ref={inlineEditorToolbarRef}
                            saveErrorTitle={`Couldn\u2019t save \u201C${label}\u201D`}
                            onSave={handleSave}
                            onCancel={handleCancelEditing}
                        />
                    )}
                </Box>
            </Box>
            {shouldShowConfirmSaveDialog && (
                <ModalDialog
                    title={`Save \u201C${label}\u201D`}
                    description="Would you like to save your changes?"
                    onClose={() => {
                        setShouldShowConfirmSaveDialog(false);
                        inputRef.current?.focus();
                    }}
                    primaryButtonLabel="Save"
                    primaryButtonPressErrorTitle={`Couldn\u2019t save \u201C${label}\u201D`}
                    onPrimaryButtonPress={handleSave}
                    cancelButtonLabel="Discard changes"
                    cancelButtonPressErrorTitle="Couldn&#x2019;t discard changes"
                    onCancelButtonPress={handleCancelEditing}
                />
            )}
        </>
    );
}
