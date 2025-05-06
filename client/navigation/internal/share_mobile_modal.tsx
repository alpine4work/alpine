import {useMemo, useState} from "react";
import {Box} from "~/client/design/box.js";
import {Spacer} from "~/client/design/spacer.js";
import {
    ShareOverlayAccountGrantsScrollView,
    ShareOverlayDefaultGrant,
    ShareOverlayUrlGrant,
} from "~/client/navigation/internal/share_overlay.js";
import {ShareOverlayAccountBody} from "~/client/navigation/internal/share_overlay_account_body.js";
import {ShareOverlayAccountGrantInput} from "~/client/navigation/internal/share_overlay_account_grant_input.js";
import {ShareSwitch} from "~/client/navigation/internal/share_switch.js";
import {NavigationBarContent} from "~/client/navigation/navigation_bar_content.js";
import {useLazyLoadRpc} from "~/client/rpc/use_lazy_load_rpc.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {backgroundColorVar} from "~/client/styles/styles.js";
import {
    AccessLevel,
    AccessPolicy,
    AccessPolicyAccountGrant,
} from "~/shared/access/access_policy.js";
import {AccessPolicyAction} from "~/shared/access/access_policy_action.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {screenPaddingX} from "~/shared/design/core/spacing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {expensivelyGetAllSpaceAccounts} from "~/shared/rpc/spaces_rpc_definitions.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export function ShareMobileModal({
    entityNoun,
    withoutUrlGrantIfNull,
    accessLevelText,
    accessPolicy,
    onAccessPolicyChange,
    isReadOnly,
    onCloseWithAnimation,
}: {
    entityNoun: string;
    withoutUrlGrantIfNull?: boolean;
    accessLevelText: Record<AccessLevel, string>;
    accessPolicy: AccessPolicy;
    onAccessPolicyChange: (
        action: AccessPolicyAction,
        notification?: ShareNotification | null,
    ) => MaybePromise<void>;
    isReadOnly: boolean;
    onCloseWithAnimation: () => void;
}) {
    const {space} = useSpaceContext();

    const hasAccountGrantInput = !isReadOnly;

    const allAccounts =
        useLazyLoadRpc(expensivelyGetAllSpaceAccounts, {spaceId: space.id}).output?.accounts ??
        emptyArray;

    const accountById = useMemo(() => {
        const accountById = new Map<AccountId, AccountModel>();
        for (const account of allAccounts) accountById.set(account.id, account);
        return accountById;
    }, [allAccounts]);

    const [accountGrantInputAccessLevel, setAccountGrantInputAccessLevel] =
        useState<AccessLevel>("Manage");

    const [accountGrantInputSelectedAccounts, setAccountGrantInputSelectedAccounts] =
        useState<ReadonlyArray<AccountModel>>(emptyArray);
    if (!hasAccountGrantInput && accountGrantInputSelectedAccounts.length > 0)
        setAccountGrantInputSelectedAccounts(emptyArray);

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
                                accessLevelText={accessLevelText}
                                accountGrantById={accessPolicy.accountGrantById}
                                allAccounts={allAccounts}
                                accountById={accountById}
                                isAltKeyDown={false}
                                selectedAccounts={accountGrantInputSelectedAccounts}
                                onSelectedAccountsChange={setAccountGrantInputSelectedAccounts}
                                accessLevel={accountGrantInputAccessLevel}
                                onAccessLevelChange={setAccountGrantInputAccessLevel}
                            />
                            {accountGrantInputSelectedAccounts.length === 0 && (
                                <>
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
                                </>
                            )}
                        </Box>
                    </>
                )}
            </Box>
            {hasAccountGrantInput && accountGrantInputSelectedAccounts.length > 0 ? (
                <Box paddingX="3">
                    <ShareOverlayAccountBody
                        selectedAccounts={accountGrantInputSelectedAccounts}
                        onShare={async notification => {
                            const newAccountGrantById = new Map<
                                AccountId,
                                DistributiveOmit<AccessPolicyAccountGrant, "generation">
                            >();

                            for (const selectedAccount of accountGrantInputSelectedAccounts) {
                                if (!newAccountGrantById.has(selectedAccount.id)) {
                                    newAccountGrantById.set(selectedAccount.id, {
                                        level: accountGrantInputAccessLevel,
                                    });
                                }
                            }

                            await onAccessPolicyChange(
                                {
                                    type: "AddAccountGrants",
                                    accountGrantById: newAccountGrantById,
                                },
                                // NOCOMMIT: Integration test that notification actually gets sent
                                notification,
                            );

                            setAccountGrantInputSelectedAccounts(emptyArray);
                        }}
                    />
                </Box>
            ) : (
                <>
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
                            accessLevelText={accessLevelText}
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
                            accessLevelText={accessLevelText}
                            defaultGrant={accessPolicy.defaultGrant}
                            onAccessPolicyChange={onAccessPolicyChange}
                            isReadOnly={isReadOnly}
                            isAltKeyDown={false}
                        />
                        {(!withoutUrlGrantIfNull || accessPolicy.urlGrant) && (
                            <>
                                <Spacer space="3" />
                                <ShareOverlayUrlGrant
                                    accessLevelText={accessLevelText}
                                    urlGrant={accessPolicy.urlGrant}
                                    onAccessPolicyChange={onAccessPolicyChange}
                                    isReadOnly={isReadOnly}
                                />
                            </>
                        )}
                        <Spacer space="5" />
                    </Box>
                </>
            )}
            <Box flexShrink="0" style={{height: "var(--window-safe-area-inset-bottom, 0px)"}} />
        </Box>
    );
}
