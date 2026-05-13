import {
    Memo,
    Ref,
    forwardRef,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {FocusScope} from "react-aria";
import {Box} from "~/client/web/design/box.js";
import {OverlayScopeContextProvider} from "~/client/web/design/overlay_scope_context_provider.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {getDefaultShareOverlyAccountInputAccessLevel} from "~/client/web/navigation/internal/get_default_share_overlay_account_input_access_level.js";
import {ShareOverlayAccountBody} from "~/client/web/navigation/internal/share_overlay_account_body.js";
import {
    ShareOverlayAccountInput,
    ShareOverlayAccountInputRef,
} from "~/client/web/navigation/internal/share_overlay_account_input.js";
import {useLazyLoadRpc} from "~/client/web/rpc/use_lazy_load_rpc.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {
    AccessLevel,
    ResolvedAccessPolicyWithGenerations,
    getAccountAccessLevelAssumingSpaceAccess,
    hasAccessLevel,
} from "~/shared/access/access_policy.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {addRemLengths, spacing} from "~/shared/design/core/spacing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {expensivelyGetAllSpaceAccounts} from "~/shared/rpc/spaces_rpc_definitions.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export type ShareNotificationOverlayRef = {
    isAccountInputComboBoxOpen(): boolean;
    closeAccountInputComboBox(): void;
};

const ShareNotificationOverlayForwardRef = forwardRef(ShareNotificationOverlay);
export {ShareNotificationOverlayForwardRef as ShareNotificationOverlay};

function ShareNotificationOverlay(
    {
        accessLevelText,
        accessPolicy,
        excludeAccountId,
        isVisible,
        onCloseWithoutAnimation,
        onShare,
    }: {
        accessLevelText: Record<AccessLevel, string>;
        accessPolicy: ResolvedAccessPolicyWithGenerations;
        excludeAccountId?: Memo<(accountId: AccountId) => boolean>;
        isVisible: boolean;
        onCloseWithoutAnimation: () => void;
        onShare: (notification: ShareNotification & {accessLevel: AccessLevel}) => Promise<void>;
    },
    ref: Ref<ShareNotificationOverlayRef>,
) {
    const {space, currentAccount} = useSpaceContext();

    const accountInputRef = useRef<ShareOverlayAccountInputRef>(null);

    const [selectedAccounts, setSelectedAccounts] =
        useState<ReadonlyArray<AccountModel>>(emptyArray);

    const currentAccountAccessLevel = useMemo(
        () => getAccountAccessLevelAssumingSpaceAccess(accessPolicy, currentAccount?.id),
        [accessPolicy, currentAccount?.id],
    );

    const defaultAccessLevel = useMemo(
        () => getDefaultShareOverlyAccountInputAccessLevel(accessPolicy, null),
        [accessPolicy],
    );

    const [accessLevel, setAccessLevel] = useState<AccessLevel>(defaultAccessLevel);
    if (!hasAccessLevel(currentAccountAccessLevel, "Manage") && accessLevel !== defaultAccessLevel)
        setAccessLevel(defaultAccessLevel);

    useImperativeHandle(
        ref,
        () => ({
            isAccountInputComboBoxOpen: () => {
                return assertExists(accountInputRef.current).isComboBoxOpen();
            },
            closeAccountInputComboBox: () => {
                assertExists(accountInputRef.current).closeComboBox();
            },
        }),
        [],
    );

    const allAccounts =
        useLazyLoadRpc(expensivelyGetAllSpaceAccounts, {spaceId: space.id}).output?.accounts ??
        emptyArray;

    const accountById = useMemo(() => {
        const accountById = new Map<AccountId, AccountModel>();
        for (const account of allAccounts) accountById.set(account.id, account);
        return accountById;
    }, [allAccounts]);

    const [isAltKeyDown, setIsAltKeyDown] = useState(false);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Alt") {
                setIsAltKeyDown(true);
            }
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.key === "Alt") {
                setIsAltKeyDown(false);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
        };
    }, []);

    return (
        <FocusScope
            // If we're animating closed then don't contain focus since we need to move focus
            // back to the overlay trigger button element.
            contain={isVisible}
        >
            <Box
                className={greyElevated2ClassName}
                position="relative"
                zIndex="0"
                backgroundColor="grey-0"
                borderRadius="2.5"
                boxShadow="elevation-20"
                paddingY="5"
                style={{
                    // Add just a little more width so it doesn't line up perfectly with other `96`
                    // spaced elements. For example, in channel views where `<ChannelViewAside>` has a
                    // width of `96` (see `postListViewAsideMaxWidth`).
                    width: addRemLengths(spacing["96"], spacing["4"]),
                }}
            >
                <OverlayScopeContextProvider
                // Make sure any overlays inside the share overlay are animated with the share
                // overlay.
                >
                    <Box position="relative" zIndex="10" paddingX="5">
                        <ShareOverlayAccountInput
                            ref={accountInputRef}
                            allAccounts={allAccounts}
                            accountById={accountById}
                            selectedAccounts={selectedAccounts}
                            onSelectedAccountsChange={setSelectedAccounts}
                            excludeAccountId={excludeAccountId}
                            accessLevel={
                                hasAccessLevel(currentAccountAccessLevel, "Manage")
                                    ? {
                                          accessLevelText,
                                          accessLevel,
                                          minAccessLevel: accessPolicy.defaultGrant?.level,
                                          onAccessLevelChange: setAccessLevel,
                                          isAltKeyDown,
                                      }
                                    : undefined
                            }
                        />
                    </Box>
                    <Spacer space="2" />
                    <Box paddingX="5">
                        <ShareOverlayAccountBody
                            willAlwaysNotifyPeople={true}
                            selectedAccounts={selectedAccounts}
                            onShare={async notification => {
                                await onShare({...assertExists(notification), accessLevel});
                                onCloseWithoutAnimation();
                            }}
                        />
                    </Box>
                </OverlayScopeContextProvider>
            </Box>
        </FocusScope>
    );
}
