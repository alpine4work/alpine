import {useMemo, useState} from "react";
import {useAccountModel} from "~/client/web/accounts/account_registry_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {OverlayAnimated} from "~/client/web/design/overlay_animated.js";
import {TooltipContent, defaultTooltipOffset} from "~/client/web/design/tooltip.js";
import {writeTextToClipboard} from "~/client/web/helpers/write_text_to_clipboard.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {ChatModel} from "~/shared/chat/chat_model.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.open_source.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";
import {isEmailAddressValid} from "~/shared/helpers/string/email_address.js";
import {maxLabelStringLength} from "~/shared/schema/helpers/label_string_schema.js";
import {AccountModel, AccountModelData} from "~/shared/spaces/account_model.js";

export function ChatDirectOneOnOneInvitePendingOverlayController({chat}: {chat: ChatModel}) {
    const {currentAccount} = useSpaceContext();

    const otherAccountForDirectOneOnOne: AccountModel | null = useMemo(() => {
        if (chat.definition.type !== "Direct") return null;
        if (chat.definition.accounts.length !== 2) return null;

        return assertExists(
            iterableFirst(
                filterIterable(
                    chat.definition.accounts,
                    account => account.id !== currentAccount?.id,
                ),
            ),
        );
    }, [chat.definition, currentAccount?.id]);

    const otherAccountDataForDirectOneOnOne = useAccountModel(otherAccountForDirectOneOnOne);
    if (!otherAccountDataForDirectOneOnOne) return null;

    if (otherAccountDataForDirectOneOnOne.space.state.type !== "InvitePending") return null;

    return (
        <ChatDirectOneOnOneInvitePendingOverlay
            otherAccountData={otherAccountDataForDirectOneOnOne}
        />
    );
}

function ChatDirectOneOnOneInvitePendingOverlay({
    otherAccountData,
}: {
    otherAccountData: AccountModelData;
}) {
    const {space} = useSpaceContext();

    const [isCopied, setIsCopied] = useState(false);

    const handleCopyInviteLink = async () => {
        // HACK: We don't currently share an account's email address with other accounts in
        // the space for privacy reasons. However, for an invite pending account we, as of
        // 2026-03-13, always set the invited email address as the account name. So we use
        // the account's name to prefill the email input on the sign in page.
        //
        // If the name is `maxLabelStringLength` characters then the email may have been
        // truncated. Since account names have a max length of 50 characters whereas emails
        // can be much longer. Assume a 50 character account name is a truncated email. We
        // also check `isEmailAddressValid()` to defend against invited accounts who don't
        // have their name set to their email address.
        const inviteUrl =
            otherAccountData.name.length < maxLabelStringLength &&
            isEmailAddressValid(otherAccountData.name)
                ? `${window.location.origin}/auth/sign-in?email=${encodeURIComponent(otherAccountData.name)}&invite=${space.id}`
                : `${window.location.origin}/auth/sign-in?invite=${space.id}`;

        await writeTextToClipboard(inviteUrl);
        setIsCopied(true);
    };

    return (
        <Box
            zIndex="10"
            position="absolute"
            top="4"
            paddingX="4"
            width="full"
            maxWidth={contentStyles.contentMaxWidth}
            style={{left: "50%", transform: "translateX(-50%)"}}
        >
            <Box
                data-testid="ChatDirectOneOnOneInvitePendingOverlay"
                display="flex"
                justifyContent="space-between"
                alignItems="center"
                gap="2"
                color="grey-100"
                backgroundColor="grey-0"
                borderRadius="1.5"
                boxShadow="elevation-20"
                padding="2"
                paddingLeft="3"
                pointerEvents="auto"
                className={greyElevated2ClassName}
            >
                <Box display="flex" alignItems="center" gap="2" color="grey-80">
                    <Box userSelect="text" fontSize="75" fontStyle="truncate">
                        Ask {otherAccountData.name} to join you in Alpine
                    </Box>
                </Box>
                <OverlayAnimated
                    isVisible={isCopied}
                    disableAnimationIn={true}
                    placement="bottom"
                    offset={defaultTooltipOffset}
                    overlay={<TooltipContent>Copied</TooltipContent>}
                >
                    <Button
                        variant="accent"
                        height="7"
                        paddingX="2"
                        pressErrorTitle="Couldn&#x2019;t copy invite link"
                        onHoverEnd={() => setIsCopied(false)}
                        onPress={handleCopyInviteLink}
                    >
                        Copy invite link
                    </Button>
                </OverlayAnimated>
            </Box>
        </Box>
    );
}
