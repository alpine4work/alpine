import {ShouldRevalidateFunction} from "@remix-run/router";
import {assignInlineVars} from "@vanilla-extract/dynamic";
import {CaretRight} from "phosphor-react";
import {ReactNode, useState} from "react";
import {usePress} from "react-aria";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {AccountAvatar} from "~/client/web/accounts/account_avatar.js";
import {useAccountModel} from "~/client/web/accounts/account_registry_context.js";
import {BotAvatar} from "~/client/web/bots/bot_avatar.js";
import {BotCreateGhostRow} from "~/client/web/bots/bot_create_ghost_row.js";
import {useBotSettingsAccount} from "~/client/web/bots/use_bot_settings_account.js";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {Link} from "~/client/web/design/link.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/web/spaces/context/space_context.js";
import {
    spaceListSettingsHeadingFontSize,
    spaceListSettingsHeadingMarginBottom,
    spaceListSettingsHeadingSettingsRowAvatarSize,
    spaceListSettingsHeadingSettingsRowGap,
    spaceListSettingsHeadingSettingsRowPaddingY,
    spaceListSettingsHeadingSettingsRowTaglineFontSize,
    spaceListSettingsHeadingSettingsRowTitleFontSize,
    spaceListSettingsHeadingSettingsRowTitleMarginBottom,
} from "~/client/web/styles/space_settings_shared_styles.js";
import {backgroundColorVar, colorSchemeVars} from "~/client/web/styles/styles.js";
import {
    chatGptKnownBotId,
    claudeKnownBotId,
    cursorKnownBotId,
} from "~/server/bots/settings_default_known_bot_account_model_data.js";
import {getBotsByOwnerForSettings} from "~/server/bots/with_spaces/get_bots_by_owner_for_settings.js";
import {getKnownBotSettingsAccount} from "~/server/bots/with_spaces/get_known_bot_settings_account.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {AvatarModelSchema} from "~/shared/avatar/avatar_schema.js";
import {BotSettingsAccountSchema} from "~/shared/bots/bot_settings_account_schema.js";
import {SettingsDefaultKnownBotAccountModelDataBase} from "~/shared/bots/settings_default_known_bot_account_model_data_types.js";
import {screenPaddingX, spacing} from "~/shared/design/core/spacing.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {BotId} from "~/shared/id/types/id_types.open_source.js";
import {Schema} from "~/shared/schema/schema.js";
import {hasCustomBotsFeature} from "~/shared/spaces/has_custom_bots_feature.js";
import {hasSpaceRole} from "~/shared/spaces/space_model.js";

/**
 * One of the known catalog bots (e.g. ChatGPT, Cursor) rendered in the bot list.
 */
type KnownBotSettingsRow = {
    botId: BotId;
    accountData: SettingsDefaultKnownBotAccountModelDataBase;
    tagline: string;
};

const OwnedBotSchema = Schema.object({
    id: Schema.id<BotId>(),
    name: Schema.string,
    description: Schema.string.nullable(),
    avatar: AvatarModelSchema.nullable(),
});

const LoaderSchema = Schema.object({
    chatGptBotAccount: BotSettingsAccountSchema,
    claudeBotAccount: BotSettingsAccountSchema,
    cursorBotAccount: BotSettingsAccountSchema,
    personalBots: Schema.array(OwnedBotSchema),
    spaceBots: Schema.array(OwnedBotSchema),
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

    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();
    const accountId = context.actor.getAccountId();

    const consistency: DynamoCacheReadConsistency = "StrongWithinCache";

    const [chatGptBotAccount, cursorBotAccount, claudeBotAccount, personalBots, spaceBots] =
        await runAllPromises([
            getKnownBotSettingsAccount(context, spaceId, chatGptKnownBotId, {consistency}),
            getKnownBotSettingsAccount(context, spaceId, cursorKnownBotId, {consistency}),
            getKnownBotSettingsAccount(context, spaceId, claudeKnownBotId, {consistency}),
            getBotsByOwnerForSettings(context, {type: "Account", accountId}, spaceId),
            getBotsByOwnerForSettings(context, {type: "Space", spaceId}),
        ]);

    return jsonWithSchema(LoaderSchema, {
        chatGptBotAccount,
        claudeBotAccount,
        cursorBotAccount,
        personalBots,
        spaceBots,
    });
}

export default function SpaceBotListSettingsRoute() {
    const {chatGptBotAccount, cursorBotAccount, claudeBotAccount, personalBots, spaceBots} =
        useLoaderDataWithSchema(LoaderSchema);

    const navigate = useNavigate();
    const {space, currentAccount} = useSpaceContextAndRequireSpaceAccess();
    const currentAccountData = useAccountModel(currentAccount);
    const hasAdminAccess = hasSpaceRole(currentAccountData.space.role, "Admin");

    // The new bot route opens in a peek on desktop
    const openBotCreator = () => {
        void navigate(`/bot/new/${space.id}`);
    };

    const chatGptBotAccountData = useBotSettingsAccount(chatGptBotAccount);
    const claudeBotAccountData = useBotSettingsAccount(claudeBotAccount);
    const cursorBotAccountData = useBotSettingsAccount(cursorBotAccount);

    // Known bots always have a `bot`, whether the data came from an installed bot
    // account or from the bot's default account data.
    const knownBots: ReadonlyArray<KnownBotSettingsRow> = [
        {
            botId: assertExists(chatGptBotAccountData.bot).id,
            accountData: chatGptBotAccountData,
            tagline: "AI assistant powered by OpenAI\u2019s models",
        },
        {
            botId: assertExists(claudeBotAccountData.bot).id,
            accountData: claudeBotAccountData,
            tagline: "AI assistant powered by Anthropic\u2019s models",
        },
        {
            botId: assertExists(cursorBotAccountData.bot).id,
            accountData: cursorBotAccountData,
            tagline: "Coding agent that\u2019ll make changes for you",
        },
    ];

    const installedBots = knownBots.filter(
        knownBot => knownBot.accountData.space.state.type === "Active",
    );

    const notInstalledBots = knownBots.filter(
        knownBot => knownBot.accountData.space.state.type !== "Active",
    );

    const customBots = [
        ...personalBots.map(bot => ({...bot, isPersonalBot: true})),
        ...spaceBots.map(bot => ({...bot, isPersonalBot: false})),
    ].sort((a, b) => a.name.localeCompare(b.name));

    const showCustomBots = hasCustomBotsFeature(space.id);

    return (
        <Box position="relative" zIndex="0" display="flex" flexDirection="column" gap="10">
            <Box>
                <Box display="flex" flexDirection="column" gap="1">
                    <Box
                        fontSize={spaceListSettingsHeadingFontSize}
                        fontStyle="bold"
                        userSelect="text"
                    >
                        Installed
                    </Box>

                    {installedBots.length + customBots.length === 0 ? (
                        <Box fontSize="75" color="grey-60" userSelect="text">
                            No bots installed in your space
                        </Box>
                    ) : (
                        <Box fontSize="75" color="grey-60" userSelect="text">
                            Bots currently installed in your space
                        </Box>
                    )}
                </Box>
                <Spacer space={spaceListSettingsHeadingMarginBottom} />
                {installedBots.map(installedBot => (
                    <BotSettingsRow
                        key={installedBot.botId}
                        avatar={
                            <AccountAvatar
                                account={installedBot.accountData}
                                size={spaceListSettingsHeadingSettingsRowAvatarSize}
                                withoutDecoration={true}
                            />
                        }
                        title={installedBot.accountData.name}
                        tagline={installedBot.tagline}
                        onNavigate={() =>
                            navigate(`/settings/${space.id}/bots/${installedBot.botId}`)
                        }
                    />
                ))}
                {customBots.map(bot => (
                    <BotSettingsRow
                        key={bot.id}
                        avatar={
                            <BotAvatar
                                bot={{id: bot.id, avatar: bot.avatar}}
                                size={spaceListSettingsHeadingSettingsRowAvatarSize}
                            />
                        }
                        title={bot.name}
                        titleTag={bot.isPersonalBot ? "Personal" : "Shared"}
                        tagline={bot.description ?? "Custom bot"}
                        // Space members may see the space's shared bots but only admins can open their
                        // management page.
                        onNavigate={
                            bot.isPersonalBot || hasAdminAccess
                                ? () => navigate(`/settings/${space.id}/bots/${bot.id}`)
                                : undefined
                        }
                    />
                ))}
            </Box>

            <Box>
                {(notInstalledBots.length > 0 || showCustomBots) && (
                    <>
                        <Box display="flex" flexDirection="column" gap="1">
                            <Box
                                fontSize={spaceListSettingsHeadingFontSize}
                                fontStyle="bold"
                                userSelect="text"
                            >
                                Recommended
                            </Box>
                            <BotFeedbackPrompt />
                        </Box>
                        <Spacer space={spaceListSettingsHeadingMarginBottom} />
                        {notInstalledBots.map(notInstalledBot => (
                            <BotSettingsRow
                                key={notInstalledBot.botId}
                                avatar={
                                    <AccountAvatar
                                        account={notInstalledBot.accountData}
                                        size={spaceListSettingsHeadingSettingsRowAvatarSize}
                                        withoutDecoration={true}
                                    />
                                }
                                title={notInstalledBot.accountData.name}
                                tagline={notInstalledBot.tagline}
                                onNavigate={() =>
                                    navigate(`/settings/${space.id}/bots/${notInstalledBot.botId}`)
                                }
                            />
                        ))}
                    </>
                )}
                {showCustomBots && (
                    <BotCreateGhostRow
                        label="Create a new custom bot"
                        circleSize={spaceListSettingsHeadingSettingsRowAvatarSize}
                        gap={spaceListSettingsHeadingSettingsRowGap}
                        withoutBorder
                        paddingX="0"
                        paddingY={spaceListSettingsHeadingSettingsRowPaddingY}
                        onPress={openBotCreator}
                    />
                )}
            </Box>
        </Box>
    );
}

function BotFeedbackPrompt() {
    return (
        <Box fontSize="75" color="grey-60" userSelect="text">
            Want a bot you don&#x2019;t see here? Let us know:{" "}
            <Link color="inherit" url="mailto:feedback@alpine.inc">
                feedback@alpine.inc
            </Link>
        </Box>
    );
}

function BotSettingsRow({
    avatar,
    title,
    titleTag,
    tagline,
    onNavigate,
}: {
    avatar: ReactNode;
    title: string;
    titleTag?: string;
    tagline: string;
    onNavigate?: () => Promise<void>;
}) {
    const platform = usePlatform();
    const routeLayout = useRouteLayout();

    const [isNavigating, setIsNavigating] = useState(false);

    const {isPressed, pressProps} = usePress({
        onPress: () => {
            if (!onNavigate || isNavigating) return;

            setIsNavigating(true);

            void onNavigate().finally(() => {
                setIsNavigating(false);
            });
        },
    });

    return (
        <FocusRing offset="border" insetX="-4">
            <Box
                {...(onNavigate ? pressProps : {})}
                tabIndex={onNavigate ? 0 : undefined}
                position="relative"
                zIndex="0"
                display="flex"
                alignItems="center"
                gap={spaceListSettingsHeadingSettingsRowGap}
                paddingY={spaceListSettingsHeadingSettingsRowPaddingY}
                cursor={onNavigate ? "pointer" : undefined}
                style={{
                    ...(isPressed
                        ? assignInlineVars({[backgroundColorVar]: colorSchemeVars["grey-5"]})
                        : {}),
                    boxShadow: `0 -1px 0 0 ${colorSchemeVars["grey-5"]}, inset 0 -1px 0 0 ${colorSchemeVars["grey-5"]}`,
                }}
            >
                {isPressed && (
                    <Box
                        position="absolute"
                        zIndex="-10"
                        top="0"
                        bottom="0"
                        left={routeLayout === "wide" ? "-4" : `-${screenPaddingX[platform]}`}
                        right={routeLayout === "wide" ? "-4" : `-${screenPaddingX[platform]}`}
                        borderRadius={routeLayout === "wide" ? "1.5" : undefined}
                        backgroundColor="grey-5"
                        style={{top: -1}}
                    />
                )}
                {avatar}
                <Box flexGrow="1" minWidth="flex-fit">
                    <Box display="flex" alignItems="center" gap="2">
                        <Box
                            fontSize={spaceListSettingsHeadingSettingsRowTitleFontSize}
                            fontStyle="semi-bold"
                        >
                            {title}
                        </Box>
                        {titleTag !== undefined && (
                            <Box
                                fontSize="50"
                                fontStyle="semi-bold"
                                color="grey-70"
                                backgroundColor="grey-10"
                                borderRadius="1.5"
                                paddingX="1.5"
                                paddingY="0.5"
                                userSelect="text"
                            >
                                {titleTag}
                            </Box>
                        )}
                    </Box>
                    <Spacer space={spaceListSettingsHeadingSettingsRowTitleMarginBottom} />
                    <Box
                        fontSize={spaceListSettingsHeadingSettingsRowTaglineFontSize}
                        fontStyle="truncate"
                        color="grey-50"
                    >
                        {tagline}
                    </Box>
                </Box>
                {onNavigate && (
                    <CaretRight size={spacing["4"]} color={colorSchemeVars["grey-60"]} />
                )}
            </Box>
        </FocusRing>
    );
}
