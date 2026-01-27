import {Copy, Eye, EyeSlash} from "phosphor-react";
import {useState} from "react";
import {accountAvatarClassName} from "~/client/web/accounts/account_avatar_html.js";
import {AvatarDefault} from "~/client/web/avatar/avatar_default.js";
import {AvatarImage} from "~/client/web/avatar/avatar_image.js";
import {AvatarUploader} from "~/client/web/avatar/avatar_uploader.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
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
import {BotId} from "~/shared/id/types/id_types.js";
import {Reaction} from "~/shared/reactions/reaction.js";
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
    return jsonWithSchema(LoaderSchema, {
        knownBotIds: new Set(settingsDefaultKnownBotAccountModelDataById.get().keys()),
        bots: await expensivelyGetAllBotsForAdminSettingsPage(await context.actor.authenticate()),
    });
}

export default function BotsManagementPage() {
    const {knownBotIds, bots} = useLoaderDataWithSchema(LoaderSchema);
    const context = useAppContext();

    const handleUploadAvatar = async (bot: Bot, file: File): Promise<AvatarModel> => {
        return fetchWithTracer(
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
                    throw new InternalError(quote`Unexpected response type “${responseBody.type}”`);
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

function BotRow({
    bot,
    isKnownBot,
    onUploadAvatar,
}: {
    bot: BotForAdmin;
    isKnownBot: boolean;
    onUploadAvatar: (bot: Bot, file: File) => Promise<AvatarModel>;
}) {
    const [visibleApiKeys, setVisibleApiKeys] = useState<Set<number>>(new Set());

    // NOTE(ifitzsimmons, 2025-12-15): We manage the bot avatar's state locally in this React
    // component. Normally, we'd use something like a Registry to make sure that all data is
    // in-sync across the app. In this case, that's unnecessary because this is the only
    // surface in the application that renders the avatar content from `Bot#Avatar`. Keeping
    // track of the bot state here means that the bot's avatar will change as soon as the
    // upload is complete!
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
                <Box display="flex" flexDirection="column" gap="1">
                    <Box fontStyle="semi-bold" fontSize="200" userSelect="text">
                        {bot.name}
                    </Box>
                    <Box fontSize="75" color="grey-60">
                        Bot Id: {bot.id}
                    </Box>
                </Box>
            </Box>

            {isKnownBot && (
                <Box fontSize="200" userSelect="text">
                    ⚠️{" "}
                    <Box as="span" fontStyle="bold">
                        IMPORTANT:
                    </Box>{" "}
                    Make sure to also update this bot’s avatar in{" "}
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
                                        pressErrorTitle="Couldn’t copy webhook URL"
                                    >
                                        <Copy color={iconColor} />
                                    </Button>
                                </Box>
                            )}
                        </Box>
                    </Box>
                </Box>

                {/* API Keys */}
                {/* TODO(ifitzsimmons, 2025-12-15): Add ability to generate new API key for bot */}
                <Box display="flex" flexDirection="column" gap="3">
                    <Box fontSize="75" fontStyle="semi-bold">
                        API Keys
                    </Box>
                    {bot.apiKeys.length === 0 ? (
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
                    ) : (
                        <Box display="flex" flexDirection="column" gap="2">
                            {bot.apiKeys.map(({apiKey, name}, index) => (
                                <Box
                                    key={index}
                                    padding="3"
                                    border="grey-5"
                                    borderRadius="2"
                                    backgroundColor="grey-40"
                                    position="relative"
                                >
                                    <TextInput
                                        label={name || "Unnamed API Key"}
                                        inputMode={visibleApiKeys.has(index) ? "text" : "password"}
                                        fontSize="75"
                                        value={apiKey}
                                        // TODO(ifitzsimmons, 2025-12-15): Add endpoint for updating other
                                        // bot properties. Bots can have multiple API keys, so this should
                                        // ultimately be a list of API keys. But we'll probably want a key
                                        // description?
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
                                            onPress={() => toggleApiKeyVisibility(index)}
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
                                            pressErrorTitle="Couldn’t copy API key"
                                        >
                                            <Copy color={iconColor} />
                                        </Button>
                                        {/* TODO(ifitzsimmons, #bots): Implement delete API key? */}
                                    </Box>
                                </Box>
                            ))}
                        </Box>
                    )}
                </Box>
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
        // Position the SVG container just past the bounding box so that the ghost icon itself is
        // drawn almost exactly at the bottom right corner of the box. This looks correct at all
        // (tested) scales
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
                // The stroke width gets scaled according to the ghost icons size, so
                // this hardcoded value looks good at all (tested) scales.
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
