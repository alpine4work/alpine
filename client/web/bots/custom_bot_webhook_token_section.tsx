import {Copy, Eye, EyeSlash, Key, Trash} from "phosphor-react";
import {useState} from "react";
import {BotCreateGhostRow} from "~/client/web/bots/bot_create_ghost_row.js";
import {CustomBotSettingsApiKey} from "~/client/web/bots/custom_bot_settings_view.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {PrettyAbsoluteDate} from "~/client/web/design/pretty_absolute_date.js";
import {writeTextToClipboard} from "~/client/web/helpers/write_text_to_clipboard.js";
import {colorSchemeVars} from "~/client/web/styles/styles.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {BotId} from "~/shared/id/types/id_types.open_source.js";
import {createUnscopedApiKeyForBot, deleteApiKeyForBot} from "~/shared/rpc/bots_rpc_definitions.js";

// TODO (#bot-docs): add link to docs explaining how unscoped api keys work and why
// you'd use one
/**
 * Lists the unscoped API keys that can be used to take actions on a webhook event
 */
export function CustomBotWebhookTokenSection({
    botId,
    initialApiKeys,
    canManage,
}: {
    botId: BotId;
    botName: string;
    isPersonalBot: boolean;
    initialApiKeys: ReadonlyArray<CustomBotSettingsApiKey>;
    canManage: boolean;
}) {
    const context = useAppContext();

    const [apiKeys, setApiKeys] = useState(initialApiKeys);

    const handleCreateApiKey = async () => {
        // A personal bot's keys only ever act as their owner. A shared bot's keys act as
        // the bot across the whole space.
        const {apiKey} = await createUnscopedApiKeyForBot(context, {
            botId,
            name: null,
        });

        setApiKeys(oldApiKeys => [
            ...oldApiKeys,
            {
                apiKey,
                name: null,
                createdTime: new Date(),
                scope: null,
            },
        ]);
    };

    return (
        <Box display="flex" flexDirection="column" gap="6">
            <Box display="flex" flexDirection="column" gap="1">
                <Box fontSize="100" fontStyle="bold" userSelect="text">
                    Event Tokens
                </Box>
                <Box fontSize="75" color="grey-60" userSelect="text">
                    Tokens grant bots access to respond to events when combined with the access
                    token included in the webhook payload.
                </Box>
            </Box>
            {apiKeys.length > 0 ? (
                <Box border="grey-5" borderRadius="2" overflow="hidden">
                    {apiKeys.map((apiKey, index) => (
                        <Box key={apiKey.apiKey} borderTop={index !== 0 ? "grey-5" : undefined}>
                            <CustomBotApiKeyRow
                                apiKey={apiKey}
                                canManage={canManage}
                                onRevoke={async () => {
                                    await deleteApiKeyForBot(context, {
                                        botId,
                                        apiKey: apiKey.apiKey,
                                    });
                                    setApiKeys(oldApiKeys =>
                                        oldApiKeys.filter(
                                            oldApiKey => oldApiKey.apiKey !== apiKey.apiKey,
                                        ),
                                    );
                                }}
                            />
                        </Box>
                    ))}
                    {canManage && (
                        <Box borderTop="grey-5">
                            <BotCreateGhostRow
                                label="Create new event token"
                                circleSize="9"
                                labelFontSize="100"
                                gap="3"
                                paddingX="3"
                                paddingY="3"
                                withoutBorder={true}
                                pressErrorTitle="Couldn&#x2019;t create token"
                                onPress={handleCreateApiKey}
                            />
                        </Box>
                    )}
                </Box>
            ) : (
                canManage && (
                    <BotCreateGhostRow
                        label="Create new webhook token"
                        circleSize="9"
                        labelFontSize="100"
                        pressErrorTitle="Couldn&#x2019;t create webhook token"
                        onPress={handleCreateApiKey}
                    />
                )
            )}
        </Box>
    );
}

function CustomBotApiKeyRow({
    apiKey,
    canManage,
    onRevoke,
}: {
    apiKey: CustomBotSettingsApiKey;
    canManage: boolean;
    onRevoke: () => Promise<void>;
}) {
    const [isRevokeDialogOpen, setIsRevokeDialogOpen] = useState(false);
    const [isRevealed, setIsRevealed] = useState(false);

    const maskedApiKey = `${"•".repeat(24)}`;

    return (
        <Box display="flex" alignItems="center" gap="3" paddingX="3" paddingY="3">
            {isRevokeDialogOpen && (
                <ModalDialog
                    title="Revoke this token?"
                    description="This permanently revokes the token. Any integration using it will immediately lose access. This action cannot be undone."
                    primaryButtonLabel="Revoke"
                    primaryButtonPressErrorTitle="Couldn&#x2019;t revoke token"
                    onPrimaryButtonPress={onRevoke}
                    onClose={() => setIsRevokeDialogOpen(false)}
                    initiallyFocus="Cancel"
                />
            )}
            <Box
                display="flex"
                alignItems="center"
                justifyContent="center"
                flexShrink="0"
                borderRadius="1.5"
                backgroundColor="grey-5"
                color="grey-60"
                style={{width: spacing["9"], height: spacing["9"]}}
            >
                <Key size={spacing["4"]} />
            </Box>
            <Box flexGrow="1" minWidth="flex-fit">
                <Box
                    fontSize="100"
                    fontStyle="code"
                    userSelect="text"
                    style={{whiteSpace: "nowrap"}}
                >
                    {isRevealed ? apiKey.apiKey : maskedApiKey}
                </Box>
                <Box
                    display="flex"
                    alignItems="center"
                    gap="2"
                    paddingTop="0.5"
                    fontSize="75"
                    color="grey-60"
                    userSelect="text"
                >
                    <Box>
                        Created <PrettyAbsoluteDate date={apiKey.createdTime} withoutTime={true} />
                    </Box>
                </Box>
            </Box>
            <IconButton
                description={isRevealed ? "Hide token" : "Show token"}
                variant="quiet"
                size="sm"
                onPress={() => setIsRevealed(oldIsRevealed => !oldIsRevealed)}
            >
                {isRevealed ? <EyeSlash /> : <Eye />}
            </IconButton>
            <IconButton
                description="Copy token"
                variant="quiet"
                size="sm"
                pressErrorTitle="Couldn&#x2019;t copy token"
                onPress={async () => {
                    await writeTextToClipboard(apiKey.apiKey);
                }}
            >
                <Copy />
            </IconButton>
            {canManage && (
                <Box
                    borderRadius="1.5"
                    flexShrink="0"
                    style={{border: `1px solid ${colorSchemeVars["grey-10"]}`}}
                >
                    <Button
                        type="button"
                        variant="quiet"
                        color="red-80"
                        fontSize="75"
                        height="7"
                        paddingX="2"
                        icon={<Trash />}
                        onPress={() => setIsRevokeDialogOpen(true)}
                    >
                        Revoke
                    </Button>
                </Box>
            )}
        </Box>
    );
}
