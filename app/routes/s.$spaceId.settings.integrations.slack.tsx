import {ShouldRevalidateFunction, redirect} from "@remix-run/router";
import {SlackLogo} from "phosphor-react";
import {useAccountModel} from "~/client/web/accounts/account_registry_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/web/spaces/space_context.js";
import {
    spaceBotSettingsHeadingGap,
    spaceBotSettingsHeadingHeight,
    spaceBotSettingsHeadingHeightInstallButtonHeight,
    spaceBotSettingsHeadingHeightNameFontSize,
    spaceBotSettingsHeadingMarginBottom,
} from "~/client/web/styles/space_settings_shared_styles.js";
import {colorSchemeVars} from "~/client/web/styles/styles.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {hasSlackIntegrationSettingsFeature} from "~/shared/integrations/has_slack_integration_settings_feature.js";
import {SlackWorkspaceSchema} from "~/shared/integrations/slack/slack_space_integration_schema.js";
import {Schema} from "~/shared/schema/schema.js";
import {hasSpaceRole} from "~/shared/spaces/space_model.js";

const LoaderSchema = Schema.object({
    slackWorkspace: SlackWorkspaceSchema.nullable(),
    addToSlackUrl: Schema.string,
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

export async function loader({params}: LoaderArgs) {
    if (!hasSlackIntegrationSettingsFeature()) {
        return redirect(`/s/${params.spaceId}/settings/integrations`);
    }

    return jsonWithSchema(LoaderSchema, {
        slackWorkspace: null,
        addToSlackUrl: "",
    });
}

export default function SpaceSlackIntegrationSettingsRoute() {
    const {slackWorkspace, addToSlackUrl} = useLoaderDataWithSchema(LoaderSchema);

    const {currentAccount} = useSpaceContextAndRequireSpaceAccess();
    const currentAccountData = useAccountModel(currentAccount);

    const hasAdminAccess = hasSpaceRole(currentAccountData.space.role, "Admin");

    const isConnected = slackWorkspace !== null;

    return (
        <Box>
            <Box
                display="flex"
                // Align bottom of icon with the bottom of the buttons.
                alignItems="flex-end"
                gap={spaceBotSettingsHeadingGap}
            >
                <Box
                    width="14"
                    height="14"
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    backgroundColor="grey-5"
                    borderRadius="2"
                >
                    <SlackLogo size={spacing["8"]} color={colorSchemeVars["grey-70"]} />
                </Box>
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
                        Slack
                    </Box>
                    <Box display="flex" gap="2">
                        {isConnected ? (
                            <Button
                                variant="quieter"
                                fontSize="75"
                                height={spaceBotSettingsHeadingHeightInstallButtonHeight}
                                paddingX="2"
                                disabledReason={
                                    !hasAdminAccess
                                        ? "Ask an admin to disconnect this integration."
                                        : undefined
                                }
                                pressErrorTitle="Couldn’t disconnect Slack"
                                onPress={async () => {
                                    // TODO (#slack-integration): Implement disconnect logic.
                                }}
                            >
                                Disconnect
                            </Button>
                        ) : (
                            <Button
                                variant="accent"
                                fontSize="75"
                                height={spaceBotSettingsHeadingHeightInstallButtonHeight}
                                paddingX="2"
                                disabledReason={
                                    !hasAdminAccess
                                        ? "Ask an admin to connect this integration"
                                        : !addToSlackUrl
                                          ? "Slack integration not available"
                                          : undefined
                                }
                                onPress={() => {
                                    window.open(addToSlackUrl, "_blank")?.focus();
                                }}
                            >
                                Add to Slack
                            </Button>
                        )}
                    </Box>
                </Box>
            </Box>

            {isConnected ? (
                <>
                    <Spacer space="6" />
                    <Box display="flex" flexDirection="column" gap="2">
                        <Box fontSize="75" color="grey-50">
                            Connected workspace
                        </Box>
                        <Box display="flex" alignItems="center" gap="2">
                            <Box
                                width="14"
                                height="14"
                                display="flex"
                                alignItems="center"
                                justifyContent="center"
                                backgroundColor="grey-5"
                                borderRadius="2"
                                overflow="hidden"
                            >
                                {slackWorkspace.workspaceIcon ? (
                                    <img
                                        src={slackWorkspace.workspaceIcon}
                                        alt="Slack workspace icon"
                                    />
                                ) : (
                                    <SlackLogo
                                        size={spacing["8"]}
                                        color={colorSchemeVars["grey-70"]}
                                    />
                                )}
                            </Box>

                            <Box fontSize="75" fontStyle="semi-bold">
                                {slackWorkspace.workspaceName}
                            </Box>
                        </Box>
                    </Box>
                </>
            ) : (
                <>
                    <Spacer space={spaceBotSettingsHeadingMarginBottom} />
                    <Box fontSize="100" color="grey-70" userSelect="text">
                        Connect your Slack workspace to receive notifications and interact with
                        Alpine from Slack.
                    </Box>
                </>
            )}

            {!hasAdminAccess && (
                <>
                    <Spacer space="4" />
                    <Box userSelect="text" color="grey-50" fontSize="50">
                        Only admins can manage integrations. Ask an admin to make changes.
                    </Box>
                </>
            )}
        </Box>
    );
}
