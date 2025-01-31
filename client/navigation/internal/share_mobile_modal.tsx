import {useMemo} from "react";
import {Box} from "~/client/design/box.js";
import {Spacer} from "~/client/design/spacer.js";
import {
    ShareOverlayAccountGrantsScrollView,
    ShareOverlayDefaultGrant,
    ShareOverlayUrlGrant,
} from "~/client/navigation/internal/share_overlay.js";
import {ShareOverlayAccountGrantInput} from "~/client/navigation/internal/share_overlay_account_grant_input.js";
import {ShareSwitch} from "~/client/navigation/internal/share_switch.js";
import {NavigationBarContent} from "~/client/navigation/navigation_bar_content.js";
import {useExpensivelyLoadAllSpaceAccounts} from "~/client/spaces/use_expensively_load_all_space_accounts.js";
import {backgroundColorVar} from "~/client/styles/styles.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {AccessPolicyAction} from "~/shared/access/access_policy_action.js";
import {screenPaddingX} from "~/shared/design/core/spacing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export function ShareMobileModal({
    entityNoun,
    accessPolicy,
    onAccessPolicyChange,
    isReadOnly,
    onCloseWithAnimation,
}: {
    entityNoun: string;
    accessPolicy: AccessPolicy;
    onAccessPolicyChange: (action: AccessPolicyAction) => void;
    isReadOnly: boolean;
    onCloseWithAnimation: () => void;
}) {
    const hasAccountGrantInput = !isReadOnly;

    const allAccounts = useExpensivelyLoadAllSpaceAccounts() ?? emptyArray;

    const accountById = useMemo(() => {
        const accountById = new Map<AccountId, AccountModel>();
        for (const account of allAccounts) accountById.set(account.id, account);
        return accountById;
    }, [allAccounts]);

    return (
        <Box
            flexGrow="1"
            width="full"
            height="full"
            position="relative"
            zIndex="0"
            overflow="hidden"
            display="flex"
            flexDirection="column"
        >
            <Box flexShrink="0" height="safe-area-inset-top" />
            <NavigationBarContent
                title="Share"
                onMobileClose={() => onCloseWithAnimation()}
                replaceActions={
                    <ShareSwitch
                        entityNoun={entityNoun}
                        accessPolicy={accessPolicy}
                        onAccessPolicyChange={onAccessPolicyChange}
                        isReadOnly={isReadOnly}
                    />
                }
            />
            <Box flexShrink="0" paddingX={screenPaddingX}>
                <Box height="border" backgroundColor="grey-5" />
                {hasAccountGrantInput && (
                    <>
                        <Spacer space="5" />
                        <Box position="relative" zIndex="10">
                            <ShareOverlayAccountGrantInput
                                accountGrantById={accessPolicy.accountGrantById}
                                onAccessPolicyChange={onAccessPolicyChange}
                                allAccounts={allAccounts}
                                accountById={accountById}
                                isAltKeyDown={false}
                            />
                            <Box
                                position="absolute"
                                bottom="-1"
                                left="0"
                                right="0"
                                height="1"
                                style={{backgroundColor: backgroundColorVar}}
                            />
                            <Box
                                position="absolute"
                                bottom="-4"
                                left="0"
                                right="0"
                                height="3"
                                style={{
                                    background: `linear-gradient(to bottom, ${backgroundColorVar}, transparent)`,
                                }}
                            />
                        </Box>
                    </>
                )}
            </Box>
            <Box
                flexGrow="1"
                style={{
                    // Don't allow item to grow beyond flexbox bounds. By default flexbox items
                    // have `min-width: auto` which extends with content.
                    // https://stackoverflow.com/a/66689926/1568890
                    minHeight: 0,
                }}
            >
                <ShareOverlayAccountGrantsScrollView
                    accountGrantById={accessPolicy.accountGrantById}
                    onAccessPolicyChange={onAccessPolicyChange}
                    accountById={accountById}
                    isReadOnly={isReadOnly}
                    isAltKeyDown={false}
                    height="full"
                    paddingX="3"
                />
            </Box>
            <Box flexShrink="0" paddingX={screenPaddingX}>
                <Box height="border" backgroundColor="grey-5" />
                <Spacer space="5" />
                <ShareOverlayDefaultGrant
                    defaultGrant={accessPolicy.defaultGrant}
                    onAccessPolicyChange={onAccessPolicyChange}
                    isReadOnly={isReadOnly}
                    isAltKeyDown={false}
                />
                <Spacer space="3" />
                <ShareOverlayUrlGrant
                    urlGrant={accessPolicy.urlGrant}
                    onAccessPolicyChange={onAccessPolicyChange}
                    isReadOnly={isReadOnly}
                />
                <Spacer space="5" />
            </Box>
            <Box flexShrink="0" height="safe-area-inset-bottom" />
        </Box>
    );
}
