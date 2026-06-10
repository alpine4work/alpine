import {useNavigate} from "@remix-run/react";
import {Copy, Eye, EyeSlash} from "phosphor-react";
import {useState} from "react";
import {accountAvatarClassName} from "~/client/web/accounts/account_avatar_html.js";
import {AvatarDefault} from "~/client/web/avatar/avatar_default.js";
import {AvatarImage} from "~/client/web/avatar/avatar_image.js";
import {AvatarUploader} from "~/client/web/avatar/avatar_uploader.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {TextInput} from "~/client/web/design/text_input.js";
import {writeTextToClipboard} from "~/client/web/helpers/write_text_to_clipboard.js";
import {BotIcon} from "~/client/web/icons/bot_icon.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix} from "~/client/web/remix/use_update_meta_title.js";
import {backgroundColorVar, colorSchemeVars} from "~/client/web/styles/styles.js";
import {expensivelyGetAllBotsForAdminSettingsPage} from "~/server/bots/expensively_get_all_bots_for_admin_settings_page.js";
import {settingsDefaultKnownBotAccountModelDataById} from "~/server/bots/settings_default_known_bot_account_model_data.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {AvatarModel} from "~/shared/avatar/avatar_schema.js";
import {UploadAvatarResponseSchema} from "~/shared/avatar/protocol/upload_avatar_response_schema.js";
import {Bot, BotForAdmin, BotForAdminSchema} from "~/shared/bots/bot_schema.js";
import {borderRadius} from "~/shared/design/core/border_radius.js";
import {colors} from "~/shared/design/core/colors.js";
import {Spacing, convertRemLengthToPx, spacing} from "~/shared/design/core/spacing.js";
import {ThemeColor} from "~/shared/design/core/theme_colors.js";
import {InternalError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {assertId} from "~/shared/id/id.js";
import {
    AccountId,
    BotId,
    ChatId,
    DocumentId,
    PostId,
    SpaceId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {Reaction} from "~/shared/reactions/reaction.js";
import {
    createBot,
    createScopedApiKeyForBot,
    createUnscopedApiKeyForBot,
    deleteBot,
    getBotAccountIdForSpaceIfExists,
} from "~/shared/rpc/bots_rpc_definitions.js";
import {instantiateBotSpaceAccount} from "~/shared/rpc/spaces_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";
import {getAvatarDefaultDesign} from "~/shared/spaces/get_avatar_default_design.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";

export function meta() {
    return [{title: `Bot Account Management${metaTitlePostfix}`}];
}

const LoaderSchema = Schema.object({
    knownBotIds: Schema.set(Schema.id<BotId>()),
    bots: Schema.array(BotForAdminSchema),
});

export async function loader({context}: LoaderArgs) {
    const bots = await expensivelyGetAllBotsForAdminSettingsPage(
        await context.actor.authenticate(),
    );
    bots.sort((a, b) => b.createdTime.getTime() - a.createdTime.getTime());
    return jsonWithSchema(LoaderSchema, {
        knownBotIds: new Set(settingsDefaultKnownBotAccountModelDataById.get().keys()),
        bots,
    });
}

export default function BotsManagementPage() {
    const {knownBotIds, bots} = useLoaderDataWithSchema(LoaderSchema);
    const context = useAppContext();
    const navigate = useNavigate();

    const handleUploadAvatar = async (bot: Bot, file: File): Promise<AvatarModel> => {
        return await fetchWithTracer(
            context.tracer.getTracer(),
            new URL(`/api/avatar/bot/${bot.id}`, window.location.href),
            {
                serviceName: "EdgeService",
                route: "/api/avatar/bot/:botId",
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

                if (responseBody.type !== "UploadBotAvatar") {
                    throw new InternalError(
                        quote`Unexpected response type \u201C${responseBody.type}\u201D`,
                    );
                }

                return assertExists(responseBody.bot.avatar);
            },
        );
    };

    return (
        <Box display="flex" width="full" height="full" maxWidth="128" marginX="6">
            <Box width="full">
                <Box fontSize="300" fontStyle="bold">
                    Bots that you own
                </Box>
                <Box fontSize="75" color="grey-60" paddingTop="1">
                    Manage bots that you own.
                </Box>
                <Spacer space="6" />
                <Box border="grey-5" borderRadius="3" padding="6" backgroundColor="grey-20">
                    <CreateBotForm onCreated={() => navigate(0)} />
                </Box>
                <Spacer space="6" />
                {bots.length === 0 && <Box color="grey-80">No bots found</Box>}
                <Box display="flex" flexDirection="column" gap="6">
                    {bots.map(bot => (
                        <Box
                            key={bot.id}
                            border="grey-5"
                            borderRadius="3"
                            padding="6"
                            backgroundColor="grey-20"
                        >
                            <BotRow
                                bot={bot}
                                isKnownBot={knownBotIds.has(bot.id)}
                                onUploadAvatar={handleUploadAvatar}
                            />
                        </Box>
                    ))}
                </Box>
            </Box>
        </Box>
    );
}

function CreateBotForm({onCreated}: {onCreated: () => void}) {
    const context = useAppContext();
    const [name, setName] = useState("");
    const [keyName, setKeyName] = useState("");
    const [webhookUrl, setWebhookUrl] = useState("");
    const [scopeState, setScopeState] = useState<ScopeState>({type: "Unscoped"});

    return (
        <Box display="flex" flexDirection="column" gap="3">
            <Box fontStyle="semi-bold" fontSize="200">
                Create a new bot
            </Box>
            <TextInput label="Name" value={name} onChange={setName} placeholder="My Bot" />
            <TextInput
                label="Webhook URL (optional)"
                value={webhookUrl}
                onChange={setWebhookUrl}
                placeholder="https://..."
            />
            <TextInput
                label="Key Name (optional)"
                value={keyName}
                onChange={setKeyName}
                placeholder="My Key"
            />
            <ScopeForm scopeState={scopeState} onChange={setScopeState} />
            <Box>
                <Button
                    variant="accent"
                    isDisabled={name.trim().length === 0}
                    pressErrorTitle="Couldn&#x2019;t create bot"
                    onPress={async () => {
                        const {botId} = await createBot(context, {
                            name,
                            webhookUrl: webhookUrl.trim() || null,
                        });

                        switch (scopeState.type) {
                            case "Unscoped":
                                await createUnscopedApiKeyForBot(context, {
                                    botId,
                                    name: keyName.trim() || null,
                                });
                                break;
                            case "Space":
                            case "Account":
                            case "Chat":
                            case "Document":
                            case "Post":
                            case "Task":
                                const spaceId = assertId<SpaceId>(scopeState.spaceId);
                                const accountId = await getOrInstantiateBotAccountId(
                                    context,
                                    botId,
                                    spaceId,
                                );
                                await createScopedApiKeyForBot(context, {
                                    botId,
                                    spaceId,
                                    accountId,
                                    name: keyName.trim() || null,
                                    scope: buildScope(scopeState),
                                });
                                break;
                            default:
                                throw exhaustive(scopeState);
                        }

                        setName("");
                        setWebhookUrl("");
                        setScopeState({type: "Unscoped"});
                        onCreated();
                    }}
                >
                    Create Bot
                </Button>
            </Box>
        </Box>
    );
}

type ScopeState =
    | {type: "Unscoped"}
    | {type: "Space"; spaceId: string}
    | {type: "Account"; spaceId: string; resourceId: string}
    | {type: "Chat"; spaceId: string; resourceId: string}
    | {type: "Document"; spaceId: string; resourceId: string}
    | {type: "Post"; spaceId: string; resourceId: string}
    | {type: "Task"; spaceId: string; resourceId: string};

type ScopedScopeType = Exclude<ScopeState["type"], "Unscoped">;

async function getOrInstantiateBotAccountId(
    context: ReturnType<typeof useAppContext>,
    botId: BotId,
    spaceId: SpaceId,
): Promise<AccountId> {
    const {accountId: existingAccountId} = await getBotAccountIdForSpaceIfExists(context, {
        botId,
        spaceId,
    });
    if (existingAccountId !== null) return existingAccountId;
    const {account} = await instantiateBotSpaceAccount(context, {botId, spaceId});
    return account.id;
}

function buildScope(scopeState: Exclude<ScopeState, {type: "Unscoped"}>) {
    switch (scopeState.type) {
        case "Space":
            return {type: "Space"};
        case "Account":
            return {type: "Account", accountId: assertId<AccountId>(scopeState.resourceId)};
        case "Chat":
            return {type: "Chat", chatId: assertId<ChatId>(scopeState.resourceId)};
        case "Document":
            return {type: "Document", documentId: assertId<DocumentId>(scopeState.resourceId)};
        case "Post":
            return {type: "Post", postId: assertId<PostId>(scopeState.resourceId)};
        case "Task":
            return {type: "Task", taskId: assertId<TaskId>(scopeState.resourceId)};
        default:
            throw exhaustive(scopeState);
    }
}

const scopeTypes: ReadonlyArray<ScopeState["type"]> = [
    "Unscoped",
    "Space",
    "Account",
    "Chat",
    "Document",
    "Post",
    "Task",
];

const resourceIdLabel: Record<ScopedScopeType, string | null> = {
    Space: null,
    Account: "Account ID",
    Chat: "Chat ID",
    Document: "Document ID",
    Post: "Post ID",
    Task: "Task ID",
};

function ScopeForm({
    scopeState,
    onChange,
}: {
    scopeState: ScopeState;
    onChange: (state: ScopeState) => void;
}) {
    const spaceId = scopeState.type !== "Unscoped" ? scopeState.spaceId : "";
    const resourceId =
        scopeState.type !== "Unscoped" && scopeState.type !== "Space" ? scopeState.resourceId : "";

    const handleTypeChange = (newType: ScopeState["type"]) => {
        if (newType === "Unscoped") {
            onChange({type: "Unscoped"});
        } else if (newType === "Space") {
            onChange({type: "Space", spaceId});
        } else {
            onChange({type: newType, spaceId, resourceId});
        }
    };

    const handleSpaceIdChange = (value: string) => {
        if (scopeState.type === "Unscoped") return;
        if (scopeState.type === "Space") {
            onChange({type: "Space", spaceId: value});
        } else {
            onChange({...scopeState, spaceId: value});
        }
    };

    const handleResourceIdChange = (value: string) => {
        if (scopeState.type === "Unscoped" || scopeState.type === "Space") return;
        onChange({...scopeState, resourceId: value});
    };

    const idLabel = scopeState.type !== "Unscoped" ? resourceIdLabel[scopeState.type] : null;

    return (
        <Box display="flex" flexDirection="column" gap="2">
            <Box fontSize="75" fontStyle="semi-bold">
                Scope
            </Box>
            <select
                value={scopeState.type}
                onChange={e => handleTypeChange(e.currentTarget.value as ScopeState["type"])}
            >
                {scopeTypes.map(t => (
                    <option key={t} value={t}>
                        {t}
                    </option>
                ))}
            </select>
            {scopeState.type !== "Unscoped" && (
                <TextInput
                    label="Space ID"
                    value={spaceId}
                    onChange={handleSpaceIdChange}
                    placeholder="Space ID"
                />
            )}
            {idLabel !== null && (
                <TextInput
                    label={idLabel}
                    value={resourceId}
                    onChange={handleResourceIdChange}
                    placeholder={idLabel}
                />
            )}
        </Box>
    );
}

function BotRow({
    bot,
    isKnownBot,
    onUploadAvatar,
}: {
    bot: BotForAdmin;
    isKnownBot: boolean;
    onUploadAvatar: (bot: Bot, file: File) => Promise<AvatarModel>;
}) {
    const context = useAppContext();
    const navigate = useNavigate();
    const [visibleApiKeys, setVisibleApiKeys] = useState<Set<number>>(new Set());
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

    // NOTE(ifitzsimmons, 2025-12-15): We manage the bot avatar's state locally in this
    // React component. Normally, we'd use something like a Registry to make sure that
    // all data is in-sync across the app. In this case, that's unnecessary because
    // this is the only surface in the application that renders the avatar content from
    // `Bot#Avatar`. Keeping track of the bot state here means that the bot's avatar
    // will change as soon as the upload is complete!
    const [botAvatar, setBotAvatar] = useState(bot.avatar);

    const toggleApiKeyVisibility = (index: number) => {
        const newSet = new Set(visibleApiKeys);
        if (newSet.has(index)) {
            newSet.delete(index);
        } else {
            newSet.add(index);
        }
        setVisibleApiKeys(newSet);
    };

    const iconColor = colorSchemeVars["grey-100"];

    return (
        <Box display="flex" gap="6" flexDirection="column">
            {isDeleteDialogOpen && (
                <ModalDialog
                    title={`Delete ${bot.name}?`}
                    description="This will permanently delete the bot and all of its API keys. This action cannot be undone."
                    primaryButtonLabel="Delete"
                    primaryButtonPressErrorTitle="Couldn&#x2019;t delete bot"
                    onPrimaryButtonPress={async () => {
                        await deleteBot(context, {botId: bot.id});
                        navigate(0);
                    }}
                    onClose={() => setIsDeleteDialogOpen(false)}
                    initiallyFocus="Cancel"
                />
            )}
            {/* Identity Section */}
            <Box display="flex" alignItems="center" gap="4">
                <AvatarUploader
                    onUploadAvatar={async file => {
                        const avatarModel = await onUploadAvatar(bot, file);
                        setBotAvatar(avatarModel);
                    }}
                >
                    <BotAvatar
                        bot={{
                            ...bot,
                            avatar: botAvatar,
                        }}
                        size="12"
                    />
                </AvatarUploader>
                <Box display="flex" flexDirection="column" gap="1" flexGrow="1">
                    <Box fontStyle="semi-bold" fontSize="200" userSelect="text">
                        {bot.name}
                    </Box>
                    <Box fontSize="75" color="grey-60" userSelect="text">
                        Bot Id: {bot.id}
                    </Box>
                </Box>
                <Button type="button" variant="quiet" onPress={() => setIsDeleteDialogOpen(true)}>
                    Delete
                </Button>
            </Box>

            {isKnownBot && (
                <Box fontSize="200" userSelect="text">
                    ⚠️{" "}
                    <Box as="span" fontStyle="bold">
                        IMPORTANT:
                    </Box>{" "}
                    Make sure to also update this bot&#x2019;s avatar in{" "}
                    <Box as="span" fontStyle="code">
                        settings_default_known_bot_account_model_data.ts
                    </Box>
                </Box>
            )}

            {/* Integration Settings */}
            <Box display="flex" flexDirection="column" gap="4">
                {/* Webhook URL */}
                <Box display="flex" flexDirection="column" gap="2">
                    <Box display="flex" gap="2" alignItems="center">
                        <Box flexGrow="1" position="relative">
                            <TextInput
                                label="Webhook URL"
                                value={bot.webhookUrl ?? ""}
                                fontSize="75"
                                onChange={() => {}}
                                isReadOnly={true}
                                placeholder="No webhook URL configured"
                            />
                            {bot.webhookUrl && (
                                <Box
                                    position="absolute"
                                    display="flex"
                                    style={{
                                        right: "0rem",
                                        bottom: "0rem",
                                    }}
                                >
                                    <Button
                                        type="button"
                                        height="8"
                                        paddingX="3"
                                        onPress={() => writeTextToClipboard(bot.webhookUrl!)}
                                        pressErrorTitle="Couldn&#x2019;t copy webhook URL"
                                    >
                                        <Copy color={iconColor} />
                                    </Button>
                                </Box>
                            )}
                        </Box>
                    </Box>
                </Box>

                {/* API Keys */}
                <Box display="flex" flexDirection="column" gap="3">
                    <Box fontSize="75" fontStyle="semi-bold">
                        API Keys
                    </Box>
                    {bot.apiKeys.length === 0 && (
                        <Box
                            padding="4"
                            border="grey-5"
                            borderRadius="2"
                            display="flex"
                            flexDirection="column"
                            alignItems="center"
                            gap="2"
                        >
                            <Box fontSize="75" color="grey-60">
                                No API keys yet
                            </Box>
                        </Box>
                    )}
                    {bot.apiKeys.length > 0 && (
                        <Box display="flex" flexDirection="column" gap="2">
                            {bot.apiKeys.map(({apiKey, name, spaceId, scope}, index) => (
                                <ApiKeyRow
                                    key={index}
                                    apiKey={apiKey}
                                    name={name}
                                    spaceId={spaceId}
                                    scope={scope}
                                    index={index}
                                    visibleApiKeys={visibleApiKeys}
                                    onToggleVisibility={toggleApiKeyVisibility}
                                    iconColor={iconColor}
                                />
                            ))}
                        </Box>
                    )}
                    <GenerateApiKeyForm botId={bot.id} onGenerated={() => navigate(0)} />
                </Box>
            </Box>
        </Box>
    );
}

function ApiKeyRow({
    apiKey,
    name,
    spaceId,
    scope,
    index,
    visibleApiKeys,
    onToggleVisibility,
    iconColor,
}: {
    apiKey: string;
    name: string | null;
    spaceId: string | null;
    scope: unknown;
    index: number;
    visibleApiKeys: Set<number>;
    onToggleVisibility: (index: number) => void;
    iconColor: string;
}) {
    const scopeLabel =
        spaceId === null
            ? "Unscoped"
            : `Scoped · ${(scope as {type: string} | null)?.type ?? "Unknown"}`;

    return (
        <Box
            padding="3"
            border="grey-5"
            borderRadius="2"
            backgroundColor="grey-40"
            position="relative"
        >
            <Box display="flex" alignItems="center" gap="2" paddingBottom="2">
                <Box fontSize="75" fontStyle="semi-bold">
                    {name || "Unnamed API Key"}
                </Box>
                <Box
                    fontSize="75"
                    color={spaceId === null ? "grey-60" : "blue-80"}
                    fontStyle="semi-bold"
                >
                    {scopeLabel}
                </Box>
                {spaceId !== null && (
                    <Box fontSize="75" color="grey-60" userSelect="text">
                        {spaceId}
                    </Box>
                )}
            </Box>
            <TextInput
                label=""
                inputMode={visibleApiKeys.has(index) ? "text" : "password"}
                fontSize="75"
                value={apiKey}
                isReadOnly={true}
                onChange={() => {}}
            />
            <Box
                position="absolute"
                display="flex"
                alignItems="center"
                style={{
                    right: "1rem",
                    bottom: "0.85rem",
                }}
            >
                <Button
                    type="button"
                    height="6"
                    paddingX="1.5"
                    onPress={() => onToggleVisibility(index)}
                >
                    {visibleApiKeys.has(index) ? (
                        <EyeSlash color={iconColor} />
                    ) : (
                        <Eye color={iconColor} />
                    )}
                </Button>
                <Button
                    type="button"
                    height="6"
                    paddingX="1.5"
                    onPress={() => writeTextToClipboard(apiKey)}
                    pressErrorTitle="Couldn&#x2019;t copy API key"
                >
                    <Copy color={iconColor} />
                </Button>
            </Box>
        </Box>
    );
}

function GenerateApiKeyForm({botId, onGenerated}: {botId: BotId; onGenerated: () => void}) {
    const context = useAppContext();
    const [keyName, setKeyName] = useState("");
    const [scopeState, setScopeState] = useState<ScopeState>({type: "Unscoped"});
    const [isExpanded, setIsExpanded] = useState(false);

    if (!isExpanded) {
        return (
            <Button type="button" variant="quiet" onPress={() => setIsExpanded(true)}>
                Generate new API key
            </Button>
        );
    }

    const handleCancel = () => {
        setKeyName("");
        setScopeState({type: "Unscoped"});
        setIsExpanded(false);
    };

    return (
        <Box
            display="flex"
            flexDirection="column"
            gap="3"
            padding="3"
            border="grey-5"
            borderRadius="2"
            backgroundColor="grey-40"
        >
            <Box fontStyle="semi-bold" fontSize="75">
                Generate new API key
            </Box>
            <TextInput
                label="Key name (optional)"
                value={keyName}
                onChange={setKeyName}
                placeholder="e.g. Production key"
            />
            <ScopeForm scopeState={scopeState} onChange={setScopeState} />
            <Box display="flex" gap="2" justifyContent="flex-end">
                <Button type="button" variant="quiet" onPress={handleCancel}>
                    Cancel
                </Button>
                <Button
                    variant="accent"
                    pressErrorTitle="Couldn&#x2019;t generate API key"
                    onPress={async () => {
                        const name = keyName.trim() || null;
                        if (scopeState.type === "Unscoped") {
                            await createUnscopedApiKeyForBot(context, {botId, name});
                        } else {
                            const spaceId = assertId<SpaceId>(scopeState.spaceId);
                            const accountId = await getOrInstantiateBotAccountId(
                                context,
                                botId,
                                spaceId,
                            );
                            await createScopedApiKeyForBot(context, {
                                botId,
                                spaceId,
                                accountId,
                                name,
                                scope: buildScope(scopeState),
                            });
                        }
                        setKeyName("");
                        setScopeState({type: "Unscoped"});
                        setIsExpanded(false);
                        onGenerated();
                    }}
                >
                    Generate
                </Button>
            </Box>
        </Box>
    );
}

function BotAvatar({
    bot,
    size,
    backgroundBorderWidth,
}: {
    bot: Bot;
    size: Spacing;
    backgroundBorderWidth?: 1 | 1.5 | 2 | 3;
}) {
    const spacingScale = useSpacingScale();

    const avatarPx = convertRemLengthToPx(size, spacingScale);
    const avatarDesign = getBotAvatarDesign(bot);

    return (
        <span
            className={accountAvatarClassName}
            style={{
                width: spacing[size],
                height: spacing[size],
                borderRadius: borderRadius["full"],
                backgroundColor:
                    avatarDesign.type === "Default"
                        ? colors[`${avatarDesign.backgroundColor}-20`]
                        : undefined,
                boxShadow:
                    backgroundBorderWidth !== undefined
                        ? `0px 0px 0px ${backgroundBorderWidth}px ${backgroundColorVar}`
                        : undefined,
            }}
        >
            <BotAvatarDesignView size={size} avatarDesign={avatarDesign} />
            <BotIconOverlay avatarPx={avatarPx} />
        </span>
    );
}

function BotAvatarDesignView({size, avatarDesign}: {size: Spacing; avatarDesign: BotAvatarDesign}) {
    switch (avatarDesign.type) {
        case "Image": {
            return <BotImageAvatarDesignView avatarDesign={avatarDesign} />;
        }
        case "Default": {
            return <AvatarDefault size={size} reaction={avatarDesign.reaction} />;
        }
        default:
            throw exhaustive(avatarDesign);
    }
}

function BotImageAvatarDesignView({avatarDesign}: {avatarDesign: BotImageAvatarDesign}) {
    return <AvatarImage content={avatarDesign.content} borderRadius="full" />;
}

type BotImageAvatarDesign = {
    type: "Image";
    content: Uint8Array;
};
type BotDefaultAvatarDesign = {
    type: "Default";
    reaction: Reaction;
    backgroundColor: ThemeColor;
};
type BotAvatarDesign = BotImageAvatarDesign | BotDefaultAvatarDesign;

function getBotAvatarDesign(bot: Bot): BotAvatarDesign {
    return bot.avatar?.content
        ? {type: "Image", content: bot.avatar.content}
        : {
              type: "Default",
              ...getAvatarDefaultDesign(bot.id, null),
          };
}

export function BotIconOverlay({avatarPx}: {avatarPx: number}) {
    const iconSize = avatarPx / 1.618033988749; // golden ratio
    const iconStyleBase = {
        position: "absolute",
        width: iconSize,
        height: iconSize,
        // Position the SVG container just past the bounding box so that the ghost icon
        // itself is drawn almost exactly at the bottom right corner of the box. This looks
        // correct at all (tested) scales
        bottom: "-1px",
        right: "-1px",
    } as const;

    return (
        <>
            <BotIcon
                color={backgroundColorVar}
                style={{
                    ...iconStyleBase,
                    overflow: "hidden",
                }}
                // The stroke width gets scaled according to the ghost icons size, so this
                // hardcoded value looks good at all (tested) scales.
                strokeWidth={96}
            />
            <BotIcon
                color={colorSchemeVars["grey-60"]}
                style={{
                    ...iconStyleBase,
                    overflow: "visible",
                }}
            />
        </>
    );
}
