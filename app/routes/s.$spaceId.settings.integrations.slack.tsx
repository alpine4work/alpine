import {serialize} from "cookie";
import {ArrowSquareOut, DotsThree, User, UsersThree} from "phosphor-react";
import {useEffect, useState} from "react";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {useAccountModel} from "~/client/web/accounts/account_registry_context.js";
import {AppContext, useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {MenuActions} from "~/client/web/design/menu.js";
import {MenuButton} from "~/client/web/design/menu_button.js";
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {Switch} from "~/client/web/design/switch.js";
import {SlackLogo} from "~/client/web/icons/socials/slack_logo.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useRevalidator} from "~/client/web/remix/use_revalidator.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/web/spaces/space_context.js";
import {
    spaceBotSettingsHeadingGap,
    spaceBotSettingsHeadingHeight,
} from "~/client/web/styles/space_settings_shared_styles.js";
import {colorSchemeVars} from "~/client/web/styles/styles.js";
import {getConnectedSlackAccountIfExists} from "~/server/integrations/slack/get_connected_slack_account_if_exists.js";
import {getConnectedSlackWorkspaceIfExists} from "~/server/integrations/slack/get_connected_slack_workspace_if_exists.js";
import {areNotificationsToSlackEnabled} from "~/server/notifications/data/push/are_notifications_to_slack_enabled.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {
    SlackOAuthStatusMessageSchema,
    slackOAuthStatusMessageType,
    slackOAuthWindowName,
} from "~/shared/integrations/slack/slack_oauth_status_message_schema.js";
import {
    SlackAccount,
    SlackAccountSchema,
    SlackWorkspace,
    SlackWorkspaceSchema,
} from "~/shared/integrations/slack/slack_space_integration_schema.js";
import {
    disconnectSlackAccount,
    disconnectSlackWorkspace,
} from "~/shared/rpc/integrations_rpc_definitions.js";
import {
    disableNotificationsToSlack,
    enableNotificationsToSlack,
} from "~/shared/rpc/notifications_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";
import {hasSpaceRole} from "~/shared/spaces/space_model.js";

const LoaderSchema = Schema.object({
    slackWorkspace: SlackWorkspaceSchema.nullable(),
    slackAccount: SlackAccountSchema.nullable(),
    addToSlackUrl: Schema.string,
    initialAreNotificationsToSlackEnabled: Schema.boolean,
});

export async function loader({context, params}: LoaderArgs) {
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);

    const authenticatedContext = (await context.actor.authenticate()).actor.authorizeSession();

    const slackWorkspace = await getConnectedSlackWorkspaceIfExists(authenticatedContext, {
        spaceId,
    });

    let initialAreNotificationsToSlackEnabled: boolean = false;
    let slackAccount: {slackUserId: string} | null = null;
    if (slackWorkspace) {
        const [slackAccountResult, notificationsToSlackEnabledResult] = await runAllPromises([
            getConnectedSlackAccountIfExists(authenticatedContext, {
                spaceId,
                workspaceId: slackWorkspace.workspaceId,
                accountId: authenticatedContext.actor.getAccountId(),
            }),
            areNotificationsToSlackEnabled(authenticatedContext, {
                spaceId,
                workspaceId: slackWorkspace.workspaceId,
            }),
        ]);
        slackAccount = slackAccountResult;
        initialAreNotificationsToSlackEnabled = notificationsToSlackEnabledResult;
    }

    // Generate a state token to prevent CSRF attacks. This gets validated in the OAuth
    // callback at `/s/$spaceId/integrations/slack/oauth` to ensure the request is
    // coming from us. The cookie expires after 30 minutes, so if they don't complete
    // the OAuth flow within 30 minutes, they'll need to start over.
    const state = crypto.randomUUID();

    const addToSlackUrl = await context.slack.getOAuthUrl({
        spaceId,
        state,
        workspaceId: slackWorkspace?.workspaceId,
    });

    const response = jsonWithSchema(LoaderSchema, {
        slackWorkspace,
        slackAccount,
        addToSlackUrl,
        initialAreNotificationsToSlackEnabled,
    });
    response.headers.append(
        "set-cookie",
        serialize(`slackOAuthState${context.loader.cookieNameSuffix}`, state, {
            path: "/",
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            maxAge: 60 * 30, // 30 minutes
        }),
    );
    return response;
}

const slackHeaderLogoSize = "12";

const slackIntegrationSettingsSectionHeight = "16";
const slackIntegrationSettingsSectionConnectButtonHeight = "9";
const slackIntegrationSettingsAvatarGap = "6";
const slackIntegrationSettingsAvatarSize = "10";

// This is to set a left margin that horizontally aligns the avatars at the start
// of each section with the center of the Slack logo in the header.
// (slackHeaderLogoSize - slackIntegrationSettingsAvatarSize) / 2
const slackIntegrationSettingsSectionMarginLeft = "1";

const slackOAuthWindowFeatures = "popup,width=600,height=800";

export default function SpaceSlackIntegrationSettingsRoute() {
    const {slackWorkspace, slackAccount, addToSlackUrl, initialAreNotificationsToSlackEnabled} =
        useLoaderDataWithSchema(LoaderSchema);

    const context = useAppContext();
    const revalidator = useRevalidator();
    const reporter = useReporter();

    const {space, currentAccount} = useSpaceContextAndRequireSpaceAccess();

    const currentAccountData = useAccountModel(currentAccount);
    const hasAdminAccess = hasSpaceRole(currentAccountData.space.role, "Admin");

    useEffect(() => {
        // We send a message back from the popup window that is opened on connect to Slack
        // to perform the Slack OAuth flow and report back the authentication status. If it
        // succeeded, we revalidate the page to show the new Slack workspace and account.
        // If it failed, we display an error to the user. We use message events so we can
        // close the popup window and return to the settings page.
        const handleMessage = (event: MessageEvent) => {
            if (event.data.type === slackOAuthStatusMessageType) {
                const {ok, error} = SlackOAuthStatusMessageSchema.deserialize(event.data);
                if (ok) {
                    void revalidator.revalidate();
                } else if (error) {
                    reporter.displayError("Couldn\u2019t connect to Slack", error);
                }
            }
        };
        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [revalidator, reporter]);

    // Connecting a workspace and connecting an account follow the same OAuth flow, so
    // we can reuse the same function for both.
    const handleConnectToSlack = () => {
        window.open(addToSlackUrl, slackOAuthWindowName, slackOAuthWindowFeatures)?.focus();
    };

    return (
        <Box display="flex" flexDirection="column" gap="12">
            <Box
                display="flex"
                alignItems="center"
                height={spaceBotSettingsHeadingHeight}
                gap={spaceBotSettingsHeadingGap}
            >
                <Box
                    width={slackHeaderLogoSize}
                    height={slackHeaderLogoSize}
                    display="flex"
                    borderRadius="full"
                >
                    <SlackLogo />
                </Box>
                <Box display="flex" flexDirection="column" gap="1">
                    <Box fontSize="600" fontStyle="truncate-bold" userSelect="text">
                        Slack
                    </Box>
                    <Box fontSize="100" userSelect="text" color="grey-60">
                        Get Alpine notifications in Slack
                    </Box>
                </Box>
            </Box>
            <Box display="flex" flexDirection="column" gap="12">
                <SlackWorkspaceSection
                    context={context}
                    spaceId={space.id}
                    addToSlackUrl={addToSlackUrl}
                    slackWorkspace={slackWorkspace}
                    hasAdminAccess={hasAdminAccess}
                    onConnect={handleConnectToSlack}
                    onDisconnect={async () => revalidator.revalidate()}
                />
                <SlackAccountSection
                    context={context}
                    spaceId={space.id}
                    slackAccount={slackAccount}
                    slackWorkspace={slackWorkspace}
                    initialAreNotificationsToSlackEnabled={initialAreNotificationsToSlackEnabled}
                    onConnect={handleConnectToSlack}
                    onDisconnect={() => revalidator.revalidate()}
                />
            </Box>
        </Box>
    );
}

function SlackWorkspaceSection({
    context,
    spaceId,
    addToSlackUrl,
    slackWorkspace,
    hasAdminAccess,
    onConnect,
    onDisconnect,
}: {
    context: AppContext;
    spaceId: SpaceId;
    addToSlackUrl: string;
    slackWorkspace: SlackWorkspace | null;
    hasAdminAccess: boolean;
    onConnect: () => void;
    onDisconnect: () => Promise<void>;
}) {
    const [
        shouldShowDisconnectWorkspaceConfirmation,
        setShouldShowDisconnectWorkspaceConfirmation,
    ] = useState(false);

    const handleDisconnectSlackWorkspace = async () => {
        setShouldShowDisconnectWorkspaceConfirmation(false);
        await disconnectSlackWorkspace(context, {
            spaceId,
            workspaceId: assertExists(slackWorkspace).workspaceId,
        });
        await onDisconnect();
    };
    return (
        <>
            <Box marginLeft={slackIntegrationSettingsSectionMarginLeft}>
                {slackWorkspace !== null ? (
                    <Box
                        display="flex"
                        flexDirection="row"
                        alignItems="flex-start"
                        gap={slackIntegrationSettingsAvatarGap}
                    >
                        <Box
                            width={slackIntegrationSettingsAvatarSize}
                            height={slackIntegrationSettingsAvatarSize}
                            display="flex"
                            alignItems="center"
                            justifyContent="center"
                            backgroundColor="grey-5"
                            borderRadius="1.5"
                            overflow="hidden"
                        >
                            {slackWorkspace.workspaceImageUrl ? (
                                <img
                                    src={slackWorkspace.workspaceImageUrl}
                                    alt="Slack workspace icon"
                                />
                            ) : (
                                <UsersThree
                                    size={spacing["6"]}
                                    color={colorSchemeVars["grey-50"]}
                                />
                            )}
                        </Box>
                        <Box
                            display="flex"
                            flexDirection="column"
                            justifyContent="space-between"
                            height={slackIntegrationSettingsAvatarSize}
                        >
                            <Box display="flex" flexDirection="row" alignItems="center" gap="2">
                                <Box fontSize="200" fontStyle="semi-bold" userSelect="text">
                                    {slackWorkspace.workspaceName}
                                </Box>
                                <SlackMoreMenuButton
                                    menuActions={[
                                        [
                                            {
                                                label: "Open in Slack",
                                                icon: <ArrowSquareOut />,

                                                iconPlacement: "end",
                                                onPress: () => {
                                                    window.open(
                                                        slackWorkspace.workspaceUrl ??
                                                            "https://slack.com",
                                                        "_blank",
                                                    );
                                                },
                                                pressErrorTitle: "Couldn’t open Slack workspace",
                                            },
                                        ],
                                        hasAdminAccess
                                            ? [
                                                  {
                                                      label: "Disconnect",
                                                      pressErrorTitle:
                                                          "Couldn’t disconnect Slack workspace",
                                                      onPress: () =>
                                                          setShouldShowDisconnectWorkspaceConfirmation(
                                                              true,
                                                          ),
                                                  },
                                              ]
                                            : [],
                                    ]}
                                />
                            </Box>
                            <Box fontSize="75" color="grey-60" userSelect="text">
                                Your Slack workspace
                            </Box>
                        </Box>
                    </Box>
                ) : (
                    <Box
                        display="flex"
                        flexDirection="row"
                        alignItems="flex-start"
                        justifyContent="space-between"
                        gap="6"
                    >
                        <Box
                            height={slackIntegrationSettingsSectionHeight}
                            display="flex"
                            flexDirection="column"
                            gap="1"
                        >
                            <Box fontSize="100" fontStyle="semi-bold" userSelect="text">
                                Slack workspace
                            </Box>
                            <Box fontSize="75" color="grey-60" userSelect="text">
                                Only admins can connect, everyone will need to connect their
                                personal accounts separately
                            </Box>
                        </Box>
                        <Button
                            variant="accent"
                            fontSize="100"
                            height={slackIntegrationSettingsSectionConnectButtonHeight}
                            paddingX="3"
                            disabledReason={
                                !hasAdminAccess
                                    ? "Ask an admin to connect this integration"
                                    : !addToSlackUrl
                                      ? "Slack integration not available"
                                      : undefined
                            }
                            onPress={onConnect}
                        >
                            Connect
                        </Button>
                    </Box>
                )}
            </Box>
            {shouldShowDisconnectWorkspaceConfirmation && (
                <ModalDialog
                    title="Disconnect Slack"
                    description="Disconnecting your workspace will disconnect it for everyone in your space and uninstall the Alpine app from Slack."
                    onClose={() => setShouldShowDisconnectWorkspaceConfirmation(false)}
                    primaryButtonLabel="Disconnect"
                    primaryButtonPressErrorTitle="Couldn&#x2019;t disconnect Slack"
                    onPrimaryButtonPress={handleDisconnectSlackWorkspace}
                    cancelButtonLabel="Cancel"
                    onCancelButtonPress={() => setShouldShowDisconnectWorkspaceConfirmation(false)}
                />
            )}
        </>
    );
}
function SlackAccountSection({
    context,
    spaceId,
    slackAccount,
    slackWorkspace,
    initialAreNotificationsToSlackEnabled,
    onConnect,
    onDisconnect,
}: {
    context: AppContext;
    spaceId: SpaceId;
    slackAccount: SlackAccount | null;
    slackWorkspace: SlackWorkspace | null;
    initialAreNotificationsToSlackEnabled: boolean;
    onConnect: () => void;
    onDisconnect: () => Promise<void>;
}) {
    const [areNotificationsToSlackEnabled, setAreNotificationsToSlackEnabled] = useState(
        initialAreNotificationsToSlackEnabled && slackAccount !== null,
    );

    useEffect(() => {
        setAreNotificationsToSlackEnabled(
            initialAreNotificationsToSlackEnabled && slackAccount !== null,
        );
    }, [initialAreNotificationsToSlackEnabled, slackAccount]);

    const handleDisconnectSlackAccount = async () => {
        await disconnectSlackAccount(context, {
            spaceId,
            workspaceId: assertExists(slackWorkspace).workspaceId,
        });
        await onDisconnect();
    };

    const handleNotificationsToSlackToggle = async (shouldEnable: boolean) => {
        assert(slackWorkspace !== null, "Slack workspace not found");
        assert(slackAccount !== null, "Slack account not found");
        if (shouldEnable) {
            await enableNotificationsToSlack(context, {
                spaceId,
                workspaceId: slackWorkspace.workspaceId,
            });
            setAreNotificationsToSlackEnabled(true);
        } else {
            await disableNotificationsToSlack(context, {
                spaceId,
                workspaceId: slackWorkspace.workspaceId,
            });
            setAreNotificationsToSlackEnabled(false);
        }
    };
    return (
        <Box
            display="flex"
            flexDirection="column"
            gap="8"
            paddingLeft={slackIntegrationSettingsSectionMarginLeft}
        >
            {(slackAccount !== null || slackWorkspace) && (
                <Box
                    display="flex"
                    flexDirection="row"
                    alignItems="flex-start"
                    gap={slackIntegrationSettingsAvatarGap}
                >
                    <Box
                        width={slackIntegrationSettingsAvatarSize}
                        height={slackIntegrationSettingsAvatarSize}
                        display="flex"
                        alignItems="center"
                        justifyContent="center"
                        backgroundColor="grey-5"
                        borderRadius="1.5"
                        overflow="hidden"
                    >
                        {slackAccount && slackAccount.profileImageUrl ? (
                            <img src={slackAccount.profileImageUrl} alt="Slack account profile" />
                        ) : (
                            <User size={spacing["6"]} color={colorSchemeVars["grey-50"]} />
                        )}
                    </Box>
                    <Box
                        display="flex"
                        flexDirection="column"
                        justifyContent="space-between"
                        height={slackIntegrationSettingsAvatarSize}
                    >
                        <Box display="flex" flexDirection="row" alignItems="center" gap="2">
                            <Box fontSize="200" fontStyle="semi-bold" userSelect="text">
                                {!slackAccount
                                    ? "My account"
                                    : (slackAccount.displayName ?? slackAccount.realName)}
                            </Box>
                            {slackAccount && (
                                <SlackMoreMenuButton
                                    menuActions={[
                                        {
                                            label: "Disconnect",
                                            pressErrorTitle:
                                                "Couldn\u2019t disconnect Slack account",
                                            onPress: handleDisconnectSlackAccount,
                                        },
                                    ]}
                                />
                            )}
                        </Box>
                        <Box fontSize="75" color="grey-60" userSelect="text">
                            {!slackAccount
                                ? "Connect your personal account to get notifications"
                                : "Your personal Slack account"}
                        </Box>
                    </Box>
                    {!slackAccount && (
                        <Box flexGrow="1" display="flex" justifyContent="flex-end">
                            <Button
                                variant="accent"
                                fontSize="100"
                                height={slackIntegrationSettingsSectionConnectButtonHeight}
                                paddingX="3"
                                onPress={onConnect}
                            >
                                Connect
                            </Button>
                        </Box>
                    )}
                </Box>
            )}
            {slackAccount !== null && (
                <Box marginLeft="16">
                    <Switch
                        fontSize="100"
                        isDisabled={!slackAccount}
                        isSelected={areNotificationsToSlackEnabled && slackAccount !== null}
                        changeErrorTitle={`Couldn\u2019t ${
                            areNotificationsToSlackEnabled ? "disable" : "enable"
                        } notifications to Slack`}
                        onChange={handleNotificationsToSlackToggle}
                    >
                        Get Alpine notifications in Slack
                    </Switch>
                </Box>
            )}
        </Box>
    );
}

function SlackMoreMenuButton({menuActions}: {menuActions: MenuActions}) {
    return (
        <Box paddingTop="0.5" display="flex" alignItems="center" justifyContent="center">
            <MenuButton placement="bottom-start" actions={menuActions}>
                <IconButton size="md" description="More" withoutTooltip={true}>
                    <DotsThree />
                </IconButton>
            </MenuButton>
        </Box>
    );
}
