import {ShouldRevalidateFunction} from "@remix-run/router";
import {assignInlineVars} from "@vanilla-extract/dynamic";
import {CaretRight} from "phosphor-react";
import {useState} from "react";
import {usePress} from "react-aria";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {AccountAvatar} from "~/client/web/accounts/account_avatar.js";
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
import {getBotSettingsAccount} from "~/server/bots/with_spaces/get_bot_settings_account.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {BotSettingsAccountSchema} from "~/shared/bots/bot_settings_account_schema.js";
import {SettingsDefaultKnownBotAccountModelDataBase} from "~/shared/bots/settings_default_known_bot_account_model_data_types.js";
import {screenPaddingX, spacing} from "~/shared/design/core/spacing.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {Schema} from "~/shared/schema/schema.js";

const LoaderSchema = Schema.object({
    chatGptBotAccount: BotSettingsAccountSchema,
    claudeBotAccount: BotSettingsAccountSchema,
    cursorBotAccount: BotSettingsAccountSchema,
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

    const consistency: DynamoCacheReadConsistency = "StrongWithinCache";

    const [chatGptBotAccount, claudeBotAccount, cursorBotAccount] = await runAllPromises([
        getBotSettingsAccount(context, spaceId, chatGptKnownBotId, {consistency}),
        getBotSettingsAccount(context, spaceId, claudeKnownBotId, {consistency}),
        getBotSettingsAccount(context, spaceId, cursorKnownBotId, {consistency}),
    ]);

    return jsonWithSchema(LoaderSchema, {
        chatGptBotAccount,
        claudeBotAccount,
        cursorBotAccount,
    });
}

export default function SpaceBotListSettingsRoute() {
    const {chatGptBotAccount, claudeBotAccount, cursorBotAccount} =
        useLoaderDataWithSchema(LoaderSchema);

    const chatGptBot = {
        accountData: useBotSettingsAccount(chatGptBotAccount),
        tagline: "AI assistant powered by OpenAI\u2019s models",
    };

    const claudeBot = {
        accountData: useBotSettingsAccount(claudeBotAccount),
        tagline: "AI assistant powered by Anthropic\u2019s models",
    };

    const cursorBot = {
        accountData: useBotSettingsAccount(cursorBotAccount),
        tagline: "Coding agent that\u2019ll make changes for you",
    };

    const installedBots: Array<{
        accountData: SettingsDefaultKnownBotAccountModelDataBase;
        tagline: string;
    }> = [];

    const notInstalledBots: Array<{
        accountData: SettingsDefaultKnownBotAccountModelDataBase;
        tagline: string;
    }> = [];

    if (chatGptBot.accountData.space.state.type === "Active") {
        installedBots.push(chatGptBot);
    } else {
        notInstalledBots.push(chatGptBot);
    }

    if (claudeBot.accountData.space.state.type === "Active") {
        installedBots.push(claudeBot);
    } else {
        notInstalledBots.push(claudeBot);
    }

    if (cursorBot.accountData.space.state.type === "Active") {
        installedBots.push(cursorBot);
    } else {
        notInstalledBots.push(cursorBot);
    }

    const botFeedbackPrompt = (
        <Box fontSize="75" color="grey-60" userSelect="text">
            Want a bot you don&#x2019;t see here? Let us know:{" "}
            <Link color="inherit" url="mailto:feedback@alpine.inc">
                feedback@alpine.inc
            </Link>
        </Box>
    );

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
                    {installedBots.length === 0 ? (
                        <Box fontSize="75" color="grey-60" userSelect="text">
                            No bots installed.
                        </Box>
                    ) : notInstalledBots.length === 0 ? (
                        botFeedbackPrompt
                    ) : null}
                </Box>
                <Spacer space={spaceListSettingsHeadingMarginBottom} />
                {installedBots.map(installedBot => (
                    <SpaceBotSettingsRow
                        key={installedBot.accountData.botId}
                        accountData={installedBot.accountData}
                        tagline={installedBot.tagline}
                    />
                ))}
            </Box>
            {notInstalledBots.length > 0 && (
                <Box>
                    <Box display="flex" flexDirection="column" gap="1">
                        <Box
                            fontSize={spaceListSettingsHeadingFontSize}
                            fontStyle="bold"
                            userSelect="text"
                        >
                            Recommended
                        </Box>
                        {botFeedbackPrompt}
                    </Box>
                    <Spacer space={spaceListSettingsHeadingMarginBottom} />
                    {notInstalledBots.map(installedBot => (
                        <SpaceBotSettingsRow
                            key={installedBot.accountData.botId}
                            accountData={installedBot.accountData}
                            tagline={installedBot.tagline}
                        />
                    ))}
                </Box>
            )}
        </Box>
    );
}

function SpaceBotSettingsRow({
    accountData,
    tagline,
}: {
    accountData: SettingsDefaultKnownBotAccountModelDataBase;
    tagline: string;
}) {
    const platform = usePlatform();
    const routeLayout = useRouteLayout();
    const navigate = useNavigate();
    const {space} = useSpaceContextAndRequireSpaceAccess();

    const [isNavigating, setIsNavigating] = useState(false);

    const {isPressed, pressProps} = usePress({
        onPress: () => {
            if (isNavigating) return;

            setIsNavigating(true);

            navigate(`/settings/${space.id}/bots/${accountData.botId}`).finally(() => {
                setIsNavigating(false);
            });
        },
    });

    return (
        <FocusRing offset="border" insetX="-4">
            <Box
                {...pressProps}
                tabIndex={0}
                position="relative"
                zIndex="0"
                display="flex"
                alignItems="center"
                gap={spaceListSettingsHeadingSettingsRowGap}
                paddingY={spaceListSettingsHeadingSettingsRowPaddingY}
                cursor="pointer"
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
                <AccountAvatar
                    account={accountData}
                    size={spaceListSettingsHeadingSettingsRowAvatarSize}
                    // Render just the avatar image. Don't render removed state transparency or the bot
                    // icon (bot icon should be implied).
                    withoutDecoration={true}
                />
                <Box flexGrow="1">
                    <Box
                        fontSize={spaceListSettingsHeadingSettingsRowTitleFontSize}
                        fontStyle="semi-bold"
                    >
                        {accountData.name}
                    </Box>
                    <Spacer space={spaceListSettingsHeadingSettingsRowTitleMarginBottom} />
                    <Box
                        fontSize={spaceListSettingsHeadingSettingsRowTaglineFontSize}
                        color="grey-50"
                    >
                        {tagline}
                    </Box>
                </Box>
                <CaretRight size={spacing["4"]} color={colorSchemeVars["grey-60"]} />
            </Box>
        </FocusRing>
    );
}
