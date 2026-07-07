import {CaretDown, Globe, Link as LinkIcon} from "phosphor-react";
import {
    Ref,
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {FocusScope} from "react-aria";
import {AccountAvatar} from "~/client/web/accounts/account_avatar.js";
import {useAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {MenuAction} from "~/client/web/design/menu.js";
import {MenuButton} from "~/client/web/design/menu_button.js";
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {OverlayScopeContextProvider} from "~/client/web/design/overlay_scope_context_provider.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {useStateWithDependenciesWithoutDispatch} from "~/client/web/helpers/lifecycle/use_state_with_dependencies.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {BuildingsIcon} from "~/client/web/icons/buildings_icon.js";
import {
    noAccessLevelText,
    removeAccessLevelText,
} from "~/client/web/navigation/access_level_text.js";
import {InheritedAccessPolicyExplanations} from "~/client/web/navigation/inherited_access_policy_explanations.js";
import {getDefaultShareOverlyAccountInputAccessLevel} from "~/client/web/navigation/internal/get_default_share_overlay_account_input_access_level.js";
import {ShareOverlayAccountBody} from "~/client/web/navigation/internal/share_overlay_account_body.js";
import {
    ShareOverlayAccountInput,
    ShareOverlayAccountInputRef,
} from "~/client/web/navigation/internal/share_overlay_account_input.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useLazyLoadRpc} from "~/client/web/rpc/use_lazy_load_rpc.js";
import {TextShimmer} from "~/client/web/shimmer/text_shimmer.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {SpaceAvatar} from "~/client/web/spaces/space_avatar.js";
import {
    backgroundColorVar,
    pulseAnimationClassName,
    sprinkles,
} from "~/client/web/styles/styles.js";
import {
    AccessLevel,
    AccessPolicyAccountGrant,
    AccessPolicyAccountGrantWithoutGeneration,
    AccessPolicyDefaultGrant,
    AccessPolicyDefaultGrantWithoutGeneration,
    AccessPolicyUrlGrant,
    EffectiveAccessPolicy,
    ResolvedAccessPolicy,
    ResolvedAccessPolicyWithGenerations,
    allAccessLevels,
    hasAccessLevel,
    maxAccessLevel,
} from "~/shared/access/access_policy.js";
import {AccessPolicyAction} from "~/shared/access/access_policy_action.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {
    RemLength,
    Spacing,
    addRemLengths,
    parseRemLength,
    spacing,
} from "~/shared/design/core/spacing.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {flatIterable} from "~/shared/helpers/iterable/flat_iterable.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {partitionIterable} from "~/shared/helpers/iterable/partition_iterable.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {AccountId, PostDraftId} from "~/shared/id/types/id_types.js";
import {expensivelyGetAllSpaceAccounts} from "~/shared/rpc/spaces_rpc_definitions.js";
import {AccountModel, AccountModelData} from "~/shared/spaces/account_model.js";
import {computeStore} from "~/shared/store/compute_store.js";

export type ShareOverlayRef = {
    isAccountGrantInputComboBoxOpen(): boolean;
    closeAccountGrantInputComboBox(): void;
};

const ShareOverlayForwardRef = forwardRef(ShareOverlay);
export {ShareOverlayForwardRef as ShareOverlay};

function ShareOverlay(
    {
        id,
        entityNoun,
        entityId,
        accessLevelText,
        accessPolicy,
        inherited,
        onAccessPolicyChange,
        isVisible,
        isReadOnly,
        withoutEditAccessLevel,
        withHiddenCommentAccessLevel,
        onCopyLink,
        onCloseWithoutAnimation,
    }: {
        id: string;
        entityNoun: string;
        entityId?: FileEntityId;
        accessLevelText: Record<AccessLevel, string>;
        accessPolicy: ResolvedAccessPolicyWithGenerations;
        inherited?: {
            accessPolicy: EffectiveAccessPolicy;
            explanations: InheritedAccessPolicyExplanations;
        };
        onAccessPolicyChange: (
            accessPolicy: AccessPolicyAction,
            notification?: ShareNotification | null,
        ) => MaybePromise<void>;
        isVisible: boolean;
        isReadOnly: boolean;
        withoutEditAccessLevel?: boolean;
        withHiddenCommentAccessLevel?: boolean;
        onCopyLink: () => MaybePromise<void>;
        onCloseWithoutAnimation: () => void;
    },
    ref: Ref<ShareOverlayRef>,
) {
    const {space} = useSpaceContext();
    const navigate = useNavigate();

    const hasAccountGrantInput = !isReadOnly;
    const accountGrantInputRef = useRef<ShareOverlayAccountInputRef>(null);

    const [accountGrantInputAccessLevel, setAccountGrantInputAccessLevel] = useState<AccessLevel>(
        () =>
            getDefaultShareOverlyAccountInputAccessLevel(
                accessPolicy,
                inherited?.accessPolicy ?? null,
            ),
    );

    const [accountGrantInputSelectedAccounts, setAccountGrantInputSelectedAccounts] =
        useState<ReadonlyArray<AccountModel>>(emptyArray);
    if (!hasAccountGrantInput && accountGrantInputSelectedAccounts.length > 0)
        setAccountGrantInputSelectedAccounts(emptyArray);

    const excludeAccountGrantInputAccountId = useCallback(
        (accountId: AccountId): boolean =>
            accessPolicy.accountGrantById.has(accountId) ||
            !!inherited?.accessPolicy.accountGrantById.has(accountId),
        [accessPolicy.accountGrantById, inherited?.accessPolicy.accountGrantById],
    );

    useImperativeHandle(
        ref,
        () => ({
            isAccountGrantInputComboBoxOpen: () => {
                if (!hasAccountGrantInput) return false;
                return assertExists(accountGrantInputRef.current).isComboBoxOpen();
            },
            closeAccountGrantInputComboBox: () => {
                if (!hasAccountGrantInput) return;
                assertExists(accountGrantInputRef.current).closeComboBox();
            },
        }),
        [hasAccountGrantInput],
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

    const accountGrantsScrollViewMaxHeight = useMemo(
        (): RemLength =>
            `${
                parseRemLength(shareOverlayAccountGrantHeight) * 7.66667 +
                parseRemLength("4") * 7 +
                parseRemLength("5")
            }rem`,
        [],
    );

    return (
        <FocusScope
            // If we're animating closed then don't contain focus since we need to move focus
            // back to the overlay trigger button element.
            contain={isVisible}
        >
            <Box
                data-testid="ShareOverlay"
                id={id}
                // Let initial focus from `<OverlayTriggerButton>` go somewhere other than the add
                // people text input.
                tabIndex={0}
                className={greyElevated2ClassName}
                position="relative"
                zIndex="0"
                backgroundColor="grey-0"
                borderRadius="2.5"
                boxShadow="elevation-20"
                paddingTop={hasAccountGrantInput || accessPolicy.type === "Site" ? "5" : undefined}
                paddingBottom="5"
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
                    {accessPolicy.type === "Site" && (
                        <>
                            <Box paddingX="5">
                                <ShareOverlaySiteWarningBanner entityNoun={entityNoun} />
                            </Box>
                            {hasAccountGrantInput && <Spacer space="4" />}
                        </>
                    )}
                    {hasAccountGrantInput && (
                        <Box position="relative" zIndex="10" paddingX="5">
                            <ShareOverlayAccountInput
                                ref={accountGrantInputRef}
                                allAccounts={allAccounts}
                                accountById={accountById}
                                selectedAccounts={accountGrantInputSelectedAccounts}
                                onSelectedAccountsChange={setAccountGrantInputSelectedAccounts}
                                excludeAccountId={excludeAccountGrantInputAccountId}
                                accessLevel={{
                                    accessLevelText,
                                    accessLevel: accountGrantInputAccessLevel,
                                    onAccessLevelChange: setAccountGrantInputAccessLevel,
                                    isAltKeyDown,
                                    withoutEditAccessLevel,
                                    withHiddenCommentAccessLevel,
                                }}
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
                    )}
                    {hasAccountGrantInput && accountGrantInputSelectedAccounts.length > 0 ? (
                        <Box paddingX="5">
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
                                        notification,
                                    );

                                    setAccountGrantInputSelectedAccounts(emptyArray);
                                }}
                            />
                        </Box>
                    ) : (
                        <>
                            {accessPolicy.accountGrantById.size === 0 ? (
                                <Spacer space="5" />
                            ) : (
                                <ShareOverlayAccountGrantsScrollView
                                    accessLevelText={accessLevelText}
                                    accountGrantById={accessPolicy.accountGrantById}
                                    inherited={
                                        inherited
                                            ? {
                                                  accountGrantById:
                                                      inherited.accessPolicy.accountGrantById,
                                                  explanations: inherited.explanations,
                                              }
                                            : null
                                    }
                                    onAccessPolicyChange={onAccessPolicyChange}
                                    accountById={accountById}
                                    isReadOnly={isReadOnly}
                                    isAltKeyDown={isAltKeyDown}
                                    paddingX="5"
                                    // At max, show seven account grants and two thirds of an eighth account.
                                    maxHeight={accountGrantsScrollViewMaxHeight}
                                    withoutEditAccessLevel={withoutEditAccessLevel}
                                    withHiddenCommentAccessLevel={withHiddenCommentAccessLevel}
                                />
                            )}
                            <Box paddingX="5">
                                <Box height="border" backgroundColor="grey-5" />
                                <Spacer space="5" />
                                <ShareOverlayDefaultGrant
                                    entityNoun={entityNoun}
                                    accessLevelText={accessLevelText}
                                    defaultGrant={accessPolicy.defaultGrant}
                                    inherited={
                                        inherited
                                            ? {
                                                  defaultGrant: inherited.accessPolicy.defaultGrant,
                                                  explanations: inherited.explanations,
                                              }
                                            : null
                                    }
                                    onAccessPolicyChange={onAccessPolicyChange}
                                    isReadOnly={isReadOnly}
                                    isAltKeyDown={isAltKeyDown}
                                    withoutEditAccessLevel={withoutEditAccessLevel}
                                    withHiddenCommentAccessLevel={withHiddenCommentAccessLevel}
                                />
                                <Spacer space="3" />
                                <ShareOverlayUrlGrant
                                    entityNoun={entityNoun}
                                    accessLevelText={accessLevelText}
                                    urlGrant={accessPolicy.urlGrant}
                                    inherited={
                                        inherited
                                            ? {
                                                  urlGrant: inherited.accessPolicy.urlGrant,
                                                  explanations: inherited.explanations,
                                              }
                                            : null
                                    }
                                    onAccessPolicyChange={onAccessPolicyChange}
                                    isReadOnly={isReadOnly}
                                />
                                <Spacer space="5" />
                                <Box height="border" backgroundColor="grey-5" />
                                <Spacer space="5" />
                                <Box display="flex" gap="4">
                                    <Box flexGrow="1" style={{flexBasis: 0}}>
                                        <Button
                                            variant="outline"
                                            height="8"
                                            fullWidth={true}
                                            icon={<LinkIcon size={spacing["4"]} />}
                                            pressErrorTitle="Couldn&#x2019;t copy link"
                                            onPress={async () => {
                                                await onCopyLink();

                                                // Assume copy will work and close overlay without flicker.
                                                onCloseWithoutAnimation();
                                            }}
                                        >
                                            Copy link
                                        </Button>
                                    </Box>
                                    {entityId !== undefined && (
                                        <Box flexGrow="1" style={{flexBasis: 0}}>
                                            <Button
                                                variant="accent"
                                                height="8"
                                                fullWidth={true}
                                                iconGap="1.5"
                                                pressErrorTitle="Couldn&#x2019;t copy link"
                                                onPress={async () => {
                                                    const draftId =
                                                        generateChronologicalId<PostDraftId>();

                                                    await navigate(
                                                        `/post/new/${draftId}/${space.id}?focus=content&share=${entityId}`,
                                                    );

                                                    // Assume copy will work and close overlay without flicker.
                                                    onCloseWithoutAnimation();
                                                }}
                                            >
                                                Share in channel
                                            </Button>
                                        </Box>
                                    )}
                                </Box>
                            </Box>
                        </>
                    )}
                </OverlayScopeContextProvider>
            </Box>
        </FocusScope>
    );
}

export function ShareOverlayAccountGrantsScrollView({
    accessLevelText,
    accountGrantById,
    inherited,
    onAccessPolicyChange,
    accountById,
    isReadOnly,
    isAltKeyDown,
    withoutEditAccessLevel,
    withHiddenCommentAccessLevel,
    paddingX,
    height,
    maxHeight,
}: {
    accessLevelText: Record<AccessLevel, string>;
    accountGrantById: ResolvedAccessPolicyWithGenerations["accountGrantById"];
    inherited: {
        accountGrantById: ResolvedAccessPolicy["accountGrantById"];
        explanations: InheritedAccessPolicyExplanations;
    } | null;
    onAccessPolicyChange: (action: AccessPolicyAction) => MaybePromise<void>;
    accountById: ReadonlyMap<AccountId, AccountModel>;
    isReadOnly: boolean;
    isAltKeyDown: boolean;
    withoutEditAccessLevel?: boolean;
    withHiddenCommentAccessLevel?: boolean;
    paddingX?: Spacing;
    height?: Spacing | "full";
    maxHeight?: RemLength;
}) {
    return (
        <Box
            ref={useScrollbar({insetTop: "5", insetBottom: "5"})}
            position="relative"
            zIndex="0"
            height={height}
            overflowX="hidden"
            overflowY="auto"
            style={{maxHeight}}
        >
            <Box paddingX={paddingX} paddingTop="5" paddingBottom="5">
                <ShareOverlayAccountGrants
                    accessLevelText={accessLevelText}
                    accountGrantById={accountGrantById}
                    inherited={inherited}
                    onAccessPolicyChange={onAccessPolicyChange}
                    accountById={accountById}
                    isReadOnly={isReadOnly}
                    isAltKeyDown={isAltKeyDown}
                    withoutEditAccessLevel={withoutEditAccessLevel}
                    withHiddenCommentAccessLevel={withHiddenCommentAccessLevel}
                />
            </Box>
        </Box>
    );
}

export function ShareOverlayAccountGrants({
    accessLevelText,
    accountGrantById,
    inherited,
    onAccessPolicyChange,
    accountById,
    isReadOnly,
    isAltKeyDown,
    withoutEditAccessLevel = false,
    withHiddenCommentAccessLevel,
}: {
    accessLevelText: Record<AccessLevel, string>;
    accountGrantById: ResolvedAccessPolicyWithGenerations["accountGrantById"];
    inherited: {
        accountGrantById: ResolvedAccessPolicy["accountGrantById"];
        explanations: InheritedAccessPolicyExplanations;
    } | null;
    onAccessPolicyChange: (action: AccessPolicyAction) => MaybePromise<void>;
    accountById: ReadonlyMap<AccountId, AccountModel>;
    isReadOnly: boolean;
    isAltKeyDown: boolean;
    withoutEditAccessLevel?: boolean;
    withHiddenCommentAccessLevel?: boolean;
}) {
    const accountRegistry = useAccountRegistry();

    // Sort account grants by:
    //
    // 1. Access level (higher access levels first).
    // 2. Order in which the account grant was added. We assume `accountGrantById` is
    //    in insertion order.
    //
    // The current account is not included in this array. The current account is
    // displayed first in the list of accounts with access.
    //
    // We don't want accounts to move while the user is modifying their access level.
    // So we sort accounts by their initial access level, not their current access
    // level. Which is why we have this state here. This state creates a map of account
    // grants keyed by the initial access policy we saw for the grant.
    const accountGrantByIdByInitialEffectiveAccessLevel = useStateWithDependenciesWithoutDispatch<
        ReadonlyMap<AccessLevel, ReadonlyMap<AccountId, AccessPolicyAccountGrantWithoutGeneration>>,
        [ResolvedAccessPolicyWithGenerations["accountGrantById"]]
    >(
        ([accountGrantById], previousAccountGrantByIdByInitialEffectiveAccessLevel) => {
            const accountGrantByIdByInitialEffectiveAccessLevel = new Map<
                AccessLevel,
                Map<AccountId, AccessPolicyAccountGrantWithoutGeneration>
            >();

            const initialEffectiveAccessLevelByAccountId = new Map<AccountId, AccessLevel>();

            // Record the initial access level for each account in our previous state.
            for (const [
                initialEffectiveAccessLevel,
                accountGrantById,
            ] of previousAccountGrantByIdByInitialEffectiveAccessLevel ?? emptyArray) {
                for (const accountId of accountGrantById.keys()) {
                    assert(!initialEffectiveAccessLevelByAccountId.has(accountId));
                    initialEffectiveAccessLevelByAccountId.set(
                        accountId,
                        initialEffectiveAccessLevel,
                    );
                }
            }

            // Add accounts to our map keyed by the initial access level we saw for the
            // account.
            for (const accountId of concatIterables(
                accountGrantById.keys(),
                inherited?.accountGrantById.keys() ?? emptyArray,
            )) {
                const accessLevel = assertExists(
                    maxAccessLevel(
                        accountGrantById.get(accountId)?.level ?? null,
                        inherited?.accountGrantById.get(accountId)?.level ?? null,
                    ),
                );

                const initialEffectiveAccessLevel = getOrSetDefaultMapValue(
                    initialEffectiveAccessLevelByAccountId,
                    accountId,
                    () => accessLevel,
                );

                getOrSetDefaultMapValue(
                    accountGrantByIdByInitialEffectiveAccessLevel,
                    initialEffectiveAccessLevel,
                    () => new Map(),
                ).set(accountId, {level: accessLevel});
            }

            return accountGrantByIdByInitialEffectiveAccessLevel;
        },
        [accountGrantById],
    );

    const sortedAccountGrants = useStore(
        useMemo(
            () =>
                computeStore(get =>
                    Array.from(
                        flatIterable<{
                            accountId: AccountId;
                            account: AccountModel | null;
                            accountData: AccountModelData | null;
                        }>(
                            // This partition is used to sort removed accounts last. It splits the provided
                            // iterator into two iterators. The true iterator first (non-removed accounts) and
                            // the false iterator second (removed accounts). We then flatten that back into one
                            // iterable with the wrapping `flatIterable()`.
                            partitionIterable(
                                mapIterable(
                                    // Create an iterable that goes through each account grant in initial access level
                                    // order. Starting with the `Manage` access level and ending with the `View` access
                                    // level.
                                    flatIterable<AccountId>(
                                        Array.from(
                                            allAccessLevels,
                                            accessLevel =>
                                                accountGrantByIdByInitialEffectiveAccessLevel
                                                    .get(accessLevel)
                                                    ?.keys() ?? emptyArray,
                                        ).reverse(),
                                    ),
                                    accountId => {
                                        const account = accountById.get(accountId) ?? null;
                                        const accountData = account
                                            ? get(accountRegistry.getAccountStore(account))
                                            : null;
                                        return {accountId, account, accountData};
                                    },
                                ),
                                ({accountData}) =>
                                    !accountData || accountData.space.state.type !== "Removed",
                            ),
                        ),
                    ),
                ),
            [accountById, accountGrantByIdByInitialEffectiveAccessLevel, accountRegistry],
        ),
    );

    return (
        <Box display="flex" flexDirection="column" gap="4">
            {sortedAccountGrants.map(({accountId, accountData}) => {
                const accountGrant = accountGrantById.get(accountId);
                const inheritedAccountGrant = inherited?.accountGrantById.get(accountId);

                return (
                    <ShareOverlayAccountGrant
                        key={accountId}
                        accessLevelText={accessLevelText}
                        accountId={accountId}
                        accountData={accountData}
                        accountGrant={accountGrant ?? null}
                        inherited={
                            inheritedAccountGrant
                                ? {
                                      accountGrant: inheritedAccountGrant,
                                      explanations: inherited!.explanations,
                                  }
                                : null
                        }
                        onAccessPolicyChange={onAccessPolicyChange}
                        isReadOnly={isReadOnly}
                        isAltKeyDown={isAltKeyDown}
                        withoutEditAccessLevel={withoutEditAccessLevel}
                        withHiddenCommentAccessLevel={withHiddenCommentAccessLevel}
                    />
                );
            })}
        </Box>
    );
}

const shareOverlayAccountGrantHeight = "6";

function ShareOverlayAccountGrant({
    accessLevelText,
    accountId,
    accountData,
    accountGrant,
    inherited,
    onAccessPolicyChange,
    isReadOnly,
    isAltKeyDown,
    withoutEditAccessLevel,
    withHiddenCommentAccessLevel,
}: {
    accessLevelText: Record<AccessLevel, string>;
    accountId: AccountId;
    accountData: AccountModelData | null;
    accountGrant: AccessPolicyAccountGrantWithoutGeneration | null;
    inherited: {
        accountGrant: AccessPolicyAccountGrantWithoutGeneration;
        explanations: InheritedAccessPolicyExplanations;
    } | null;
    onAccessPolicyChange: (action: AccessPolicyAction) => MaybePromise<void>;
    isReadOnly: boolean;
    isAltKeyDown: boolean;
    withoutEditAccessLevel: boolean;
    withHiddenCommentAccessLevel?: boolean;
}) {
    const effectiveAccessLevel = assertExists(
        maxAccessLevel(accountGrant?.level ?? null, inherited?.accountGrant.level ?? null),
        "If an account doesn\u2019t have access then it shouldn\u2019t be rendered",
    );

    const [
        showCanNotDeleteInheritedAccountGrantDialog,
        setShowCanNotDeleteInheritedAccountGrantDialog,
    ] = useState(false);

    const [
        showCanNotSetInheritedAccountGrantLevelDialog,
        setShowCanNotSetInheritedAccountGrantLevelDialog,
    ] = useState<AccessLevel | null>(null);

    return (
        <Box
            data-testid={`ShareOverlayAccountGrant:${accountId}`}
            height={shareOverlayAccountGrantHeight}
            display="flex"
            alignItems="center"
            gap="2.5"
        >
            {!accountData ? (
                <>
                    <Box
                        className={pulseAnimationClassName}
                        backgroundColor="grey-10"
                        width={shareOverlayAccountGrantHeight}
                        height={shareOverlayAccountGrantHeight}
                        borderRadius="full"
                    />
                    <TextShimmer fontSize="100" width="32" ragRight="random" />
                </>
            ) : (
                <>
                    <AccountAvatar size={shareOverlayAccountGrantHeight} account={accountData} />
                    <Box
                        fontSize="100"
                        fontStyle="truncate-semi-bold"
                        color={accountData.space.state.type !== "Removed" ? "grey-100" : "grey-60"}
                    >
                        {accountData.name}
                    </Box>
                </>
            )}
            <Box flexGrow="1" />
            {isReadOnly ? (
                <Box flexShrink="0">{accessLevelText[effectiveAccessLevel]}</Box>
            ) : (
                <MenuButton
                    placement="bottom-end"
                    actions={[
                        [
                            {
                                isSelected: effectiveAccessLevel === "Manage",
                                label: accessLevelText.Manage,
                                pressErrorTitle: "Couldn\u2019t change access",
                                onPress: () => {
                                    if (effectiveAccessLevel === "Manage") return;

                                    // If there's an inherited access policy you can't change the access level to
                                    // something lower than the inherited access level.
                                    if (
                                        inherited?.accountGrant &&
                                        hasAccessLevel(inherited.accountGrant.level, "Manage")
                                    ) {
                                        setShowCanNotSetInheritedAccountGrantLevelDialog("Manage");
                                        return {withoutClose: true};
                                    }

                                    return onAccessPolicyChange({
                                        type: "SetAccountGrantLevel",
                                        accountId,
                                        level: "Manage",
                                    });
                                },
                            },
                            ...(!withoutEditAccessLevel && isAltKeyDown
                                ? [
                                      cast<MenuAction>({
                                          isSelected: effectiveAccessLevel === "Edit",
                                          label: accessLevelText.Edit,
                                          pressErrorTitle: "Couldn\u2019t change access",
                                          onPress: () => {
                                              if (effectiveAccessLevel === "Edit") return;

                                              // If there's an inherited access policy you can't change the access level to
                                              // something lower than the inherited access level.
                                              if (
                                                  inherited?.accountGrant &&
                                                  hasAccessLevel(
                                                      inherited.accountGrant.level,
                                                      "Edit",
                                                  )
                                              ) {
                                                  setShowCanNotSetInheritedAccountGrantLevelDialog(
                                                      "Edit",
                                                  );
                                                  return {withoutClose: true};
                                              }

                                              return onAccessPolicyChange({
                                                  type: "SetAccountGrantLevel",
                                                  accountId,
                                                  level: "Edit",
                                              });
                                          },
                                      }),
                                  ]
                                : emptyArray),
                            ...(!withHiddenCommentAccessLevel ||
                            isAltKeyDown ||
                            effectiveAccessLevel === "Comment"
                                ? [
                                      cast<MenuAction>({
                                          isSelected: effectiveAccessLevel === "Comment",
                                          label: accessLevelText.Comment,
                                          pressErrorTitle: "Couldn\u2019t change access",
                                          onPress: () => {
                                              if (effectiveAccessLevel === "Comment") return;

                                              // If there's an inherited access policy you can't change the access level to
                                              // something lower than the inherited access level.
                                              if (
                                                  inherited?.accountGrant &&
                                                  hasAccessLevel(
                                                      inherited.accountGrant.level,
                                                      "Comment",
                                                  )
                                              ) {
                                                  setShowCanNotSetInheritedAccountGrantLevelDialog(
                                                      "Comment",
                                                  );
                                                  return {withoutClose: true};
                                              }

                                              return onAccessPolicyChange({
                                                  type: "SetAccountGrantLevel",
                                                  accountId,
                                                  level: "Comment",
                                              });
                                          },
                                      }),
                                  ]
                                : emptyArray),
                            {
                                isSelected: effectiveAccessLevel === "View",
                                label: accessLevelText.View,
                                pressErrorTitle: "Couldn\u2019t change access",
                                onPress: () => {
                                    if (effectiveAccessLevel === "View") return;

                                    // If there's an inherited access policy you can't change the access level to
                                    // something lower than the inherited access level.
                                    if (
                                        inherited?.accountGrant &&
                                        hasAccessLevel(inherited.accountGrant.level, "View")
                                    ) {
                                        setShowCanNotSetInheritedAccountGrantLevelDialog("View");
                                        return {withoutClose: true};
                                    }

                                    return onAccessPolicyChange({
                                        type: "SetAccountGrantLevel",
                                        accountId,
                                        level: "View",
                                    });
                                },
                            },
                        ],
                        [
                            {
                                label: removeAccessLevelText,
                                pressErrorTitle: "Couldn\u2019t change access",
                                onPress: () => {
                                    // If there's an inherited access policy you can't change the access level to
                                    // something lower than the inherited access level.
                                    if (inherited?.accountGrant) {
                                        setShowCanNotDeleteInheritedAccountGrantDialog(true);
                                        return {withoutClose: true};
                                    }

                                    return onAccessPolicyChange({
                                        type: "DeleteAccountGrant",
                                        accountId,
                                    });
                                },
                            },
                        ],
                    ]}
                >
                    <Button height="6" paddingX="2" icon={<CaretDown />} iconPlacement="end">
                        {accessLevelText[effectiveAccessLevel]}
                    </Button>
                </MenuButton>
            )}
            {showCanNotDeleteInheritedAccountGrantDialog && inherited && (
                <ModalDialog
                    title="Can&#x2019;t remove this person"
                    description={inherited.explanations.DeleteAccountGrant(accountId)}
                    shouldHideCancelButton={true}
                    primaryButtonLabel="Ok"
                    onPrimaryButtonPress={() =>
                        setShowCanNotDeleteInheritedAccountGrantDialog(false)
                    }
                    onClose={() => setShowCanNotDeleteInheritedAccountGrantDialog(false)}
                />
            )}
            {showCanNotSetInheritedAccountGrantLevelDialog && inherited && (
                <ModalDialog
                    title={`Can\u2019t change this person to \u201C${accessLevelText[showCanNotSetInheritedAccountGrantLevelDialog]}\u201D`}
                    description={inherited.explanations.SetAccountGrantLevel(
                        accountId,
                        showCanNotSetInheritedAccountGrantLevelDialog,
                    )}
                    shouldHideCancelButton={true}
                    primaryButtonLabel="Ok"
                    onPrimaryButtonPress={() =>
                        setShowCanNotSetInheritedAccountGrantLevelDialog(null)
                    }
                    onClose={() => setShowCanNotSetInheritedAccountGrantLevelDialog(null)}
                />
            )}
        </Box>
    );
}

export function ShareOverlayDefaultGrant({
    entityNoun,
    accessLevelText,
    defaultGrant,
    inherited,
    onAccessPolicyChange,
    isReadOnly,
    isAltKeyDown,
    withoutEditAccessLevel,
    withHiddenCommentAccessLevel,
}: {
    entityNoun: string;
    accessLevelText: Record<AccessLevel, string>;
    defaultGrant: AccessPolicyDefaultGrant | null;
    inherited: {
        defaultGrant: AccessPolicyDefaultGrantWithoutGeneration | null;
        explanations: InheritedAccessPolicyExplanations;
    } | null;
    onAccessPolicyChange: (action: AccessPolicyAction) => MaybePromise<void>;
    isReadOnly: boolean;
    isAltKeyDown: boolean;
    withoutEditAccessLevel?: boolean;
    withHiddenCommentAccessLevel?: boolean;
}) {
    const {space} = useSpaceContext();

    const effectiveAccessLevel = maxAccessLevel(
        defaultGrant?.level ?? null,
        inherited?.defaultGrant?.level ?? null,
    );

    const [
        showCanNotDeleteInheritedDefaultGrantDialog,
        setShowCanNotDeleteInheritedDefaultGrantDialog,
    ] = useState(false);

    const [
        showCanNotSetInheritedDefaultGrantLevelDialog,
        setShowCanNotSetInheritedDefaultGrantLevelDialog,
    ] = useState<AccessLevel | null>(null);

    return (
        <Box data-testid="ShareOverlayDefaultGrant" display="flex" alignItems="center">
            <SpaceAvatar size="6" space={space} />
            <Spacer space="2.5" />
            <Box fontStyle="truncate" color="grey-80">
                Everyone in{" "}
                <span className={sprinkles({color: "grey-90", fontStyle: "semi-bold"})}>
                    {space.name}
                </span>
            </Box>
            <Box flexGrow="1" minWidth="2" />
            {isReadOnly ? (
                <Box color={effectiveAccessLevel === null ? "grey-60" : "grey-100"}>
                    {effectiveAccessLevel === null
                        ? noAccessLevelText
                        : accessLevelText[effectiveAccessLevel]}
                </Box>
            ) : (
                <MenuButton
                    placement="bottom-end"
                    actions={[
                        [
                            {
                                isSelected: effectiveAccessLevel === "Manage",
                                label: accessLevelText.Manage,
                                pressErrorTitle: "Couldn\u2019t change access",
                                onPress: () => {
                                    if (effectiveAccessLevel === "Manage") return;

                                    // If there's an inherited access policy you can't change the access level to
                                    // something lower than the inherited access level.
                                    if (
                                        inherited?.defaultGrant &&
                                        hasAccessLevel(inherited.defaultGrant.level, "Manage")
                                    ) {
                                        setShowCanNotSetInheritedDefaultGrantLevelDialog("Manage");
                                        return {withoutClose: true};
                                    }

                                    if (defaultGrant) {
                                        return onAccessPolicyChange({
                                            type: "SetDefaultGrantLevel",
                                            level: "Manage",
                                        });
                                    } else {
                                        return onAccessPolicyChange({
                                            type: "AddDefaultGrant",
                                            defaultGrant: {level: "Manage"},
                                        });
                                    }
                                },
                            },
                            ...((!withoutEditAccessLevel && isAltKeyDown) ||
                            effectiveAccessLevel === "Edit"
                                ? [
                                      cast<MenuAction>({
                                          isSelected: effectiveAccessLevel === "Edit",
                                          label: accessLevelText.Edit,
                                          pressErrorTitle: "Couldn\u2019t change access",
                                          onPress: () => {
                                              if (effectiveAccessLevel === "Edit") return;

                                              // If there's an inherited access policy you can't change the access level to
                                              // something lower than the inherited access level.
                                              if (
                                                  inherited?.defaultGrant &&
                                                  hasAccessLevel(
                                                      inherited.defaultGrant.level,
                                                      "Edit",
                                                  )
                                              ) {
                                                  setShowCanNotSetInheritedDefaultGrantLevelDialog(
                                                      "Edit",
                                                  );
                                                  return {withoutClose: true};
                                              }

                                              if (defaultGrant) {
                                                  return onAccessPolicyChange({
                                                      type: "SetDefaultGrantLevel",
                                                      level: "Edit",
                                                  });
                                              } else {
                                                  return onAccessPolicyChange({
                                                      type: "AddDefaultGrant",
                                                      defaultGrant: {level: "Edit"},
                                                  });
                                              }
                                          },
                                      }),
                                  ]
                                : emptyArray),
                            ...(!withHiddenCommentAccessLevel ||
                            isAltKeyDown ||
                            effectiveAccessLevel === "Comment"
                                ? [
                                      cast<MenuAction>({
                                          isSelected: effectiveAccessLevel === "Comment",
                                          label: accessLevelText.Comment,
                                          pressErrorTitle: "Couldn\u2019t change access",
                                          onPress: () => {
                                              if (effectiveAccessLevel === "Comment") return;

                                              // If there's an inherited access policy you can't change the access level to
                                              // something lower than the inherited access level.
                                              if (
                                                  inherited?.defaultGrant &&
                                                  hasAccessLevel(
                                                      inherited.defaultGrant.level,
                                                      "Comment",
                                                  )
                                              ) {
                                                  setShowCanNotSetInheritedDefaultGrantLevelDialog(
                                                      "Comment",
                                                  );
                                                  return {withoutClose: true};
                                              }

                                              if (defaultGrant) {
                                                  return onAccessPolicyChange({
                                                      type: "SetDefaultGrantLevel",
                                                      level: "Comment",
                                                  });
                                              } else {
                                                  return onAccessPolicyChange({
                                                      type: "AddDefaultGrant",
                                                      defaultGrant: {level: "Comment"},
                                                  });
                                              }
                                          },
                                      }),
                                  ]
                                : emptyArray),
                            {
                                isSelected: effectiveAccessLevel === "View",
                                label: accessLevelText.View,
                                pressErrorTitle: "Couldn\u2019t change access",
                                onPress: () => {
                                    if (effectiveAccessLevel === "View") return;

                                    // If there's an inherited access policy you can't change the access level to
                                    // something lower than the inherited access level.
                                    if (
                                        inherited?.defaultGrant &&
                                        hasAccessLevel(inherited.defaultGrant.level, "View")
                                    ) {
                                        setShowCanNotSetInheritedDefaultGrantLevelDialog("View");
                                        return {withoutClose: true};
                                    }

                                    if (defaultGrant) {
                                        return onAccessPolicyChange({
                                            type: "SetDefaultGrantLevel",
                                            level: "View",
                                        });
                                    } else {
                                        return onAccessPolicyChange({
                                            type: "AddDefaultGrant",
                                            defaultGrant: {level: "View"},
                                        });
                                    }
                                },
                            },
                        ],
                        [
                            {
                                isSelected: effectiveAccessLevel === null,
                                label: noAccessLevelText,
                                pressErrorTitle: "Couldn\u2019t change access",
                                onPress: () => {
                                    // If there's an inherited access policy you can't change the access level to
                                    // something lower than the inherited access level.
                                    if (inherited?.defaultGrant) {
                                        setShowCanNotDeleteInheritedDefaultGrantDialog(true);
                                        return {withoutClose: true};
                                    }

                                    return onAccessPolicyChange({
                                        type: "DeleteDefaultGrant",
                                    });
                                },
                            },
                        ],
                    ]}
                >
                    <Button
                        variant={effectiveAccessLevel === null ? "quietest" : "quiet"}
                        height="6"
                        paddingX="2"
                        icon={<CaretDown />}
                        iconPlacement="end"
                    >
                        {effectiveAccessLevel === null
                            ? noAccessLevelText
                            : accessLevelText[effectiveAccessLevel]}
                    </Button>
                </MenuButton>
            )}
            {showCanNotDeleteInheritedDefaultGrantDialog && inherited && (
                <ModalDialog
                    title={`Can\u2019t make this ${entityNoun} private`}
                    description={inherited.explanations.DeleteDefaultGrant()}
                    shouldHideCancelButton={true}
                    primaryButtonLabel="Ok"
                    onPrimaryButtonPress={() =>
                        setShowCanNotDeleteInheritedDefaultGrantDialog(false)
                    }
                    onClose={() => setShowCanNotDeleteInheritedDefaultGrantDialog(false)}
                />
            )}
            {showCanNotSetInheritedDefaultGrantLevelDialog && inherited && (
                <ModalDialog
                    title={`Can\u2019t change this ${entityNoun} to \u201C${accessLevelText[showCanNotSetInheritedDefaultGrantLevelDialog]}\u201D`}
                    description={inherited.explanations.SetDefaultGrantLevel(
                        showCanNotSetInheritedDefaultGrantLevelDialog,
                    )}
                    shouldHideCancelButton={true}
                    primaryButtonLabel="Ok"
                    onPrimaryButtonPress={() =>
                        setShowCanNotSetInheritedDefaultGrantLevelDialog(null)
                    }
                    onClose={() => setShowCanNotSetInheritedDefaultGrantLevelDialog(null)}
                />
            )}
        </Box>
    );
}

export function ShareOverlayUrlGrant({
    entityNoun,
    accessLevelText,
    urlGrant,
    inherited,
    onAccessPolicyChange,
    isReadOnly,
}: {
    entityNoun: string;
    accessLevelText: Record<AccessLevel, string>;
    urlGrant: AccessPolicyUrlGrant | null;
    inherited: {
        urlGrant: AccessPolicyUrlGrant | null;
        explanations: InheritedAccessPolicyExplanations;
    } | null;
    onAccessPolicyChange: (action: AccessPolicyAction) => MaybePromise<void>;
    isReadOnly: boolean;
}) {
    const [showCanNotDeleteInheritedUrlGrantDialog, setShowCanNotDeleteInheritedUrlGrantDialog] =
        useState(false);

    const effectiveAccessLevel = maxAccessLevel(
        urlGrant?.level ?? null,
        inherited?.urlGrant?.level ?? null,
    );

    return (
        <Box data-testid="ShareOverlayUrlGrant" display="flex" alignItems="center">
            <Box
                width="6"
                height="6"
                display="flex"
                justifyContent="center"
                alignItems="center"
                color="grey-70"
            >
                <Globe size={spacing["6"]} weight="light" />
            </Box>
            <Spacer space="2.5" />
            <Box fontStyle="truncate" color="grey-80">
                Anyone with the link
            </Box>
            <Box flexGrow="1" minWidth="2" />
            {isReadOnly ? (
                <Box color={effectiveAccessLevel === null ? "grey-60" : "grey-100"}>
                    {noAccessLevelText}
                </Box>
            ) : (
                <MenuButton
                    placement="bottom-end"
                    actions={[
                        [
                            {
                                isSelected: effectiveAccessLevel === "View",
                                label: accessLevelText.View,
                                pressErrorTitle: "Couldn\u2019t change access",
                                onPress: () => {
                                    if (effectiveAccessLevel === "View") return;

                                    if (urlGrant) {
                                        return onAccessPolicyChange({
                                            type: "SetUrlGrantLevel",
                                            level: "View",
                                        });
                                    } else {
                                        return onAccessPolicyChange({
                                            type: "AddUrlGrant",
                                            urlGrant: {level: "View"},
                                        });
                                    }
                                },
                            },
                        ],
                        [
                            {
                                isSelected: effectiveAccessLevel === null,
                                label: noAccessLevelText,
                                pressErrorTitle: "Couldn\u2019t change access",
                                onPress: () => {
                                    // If there's an inherited access policy you can't change the access level to
                                    // something lower than the inherited access level.
                                    if (inherited?.urlGrant) {
                                        setShowCanNotDeleteInheritedUrlGrantDialog(true);
                                        return {withoutClose: true};
                                    }

                                    return onAccessPolicyChange({
                                        type: "DeleteUrlGrant",
                                    });
                                },
                            },
                        ],
                    ]}
                >
                    <Button
                        variant={effectiveAccessLevel === null ? "quietest" : "quiet"}
                        height="6"
                        paddingX="2"
                        icon={<CaretDown />}
                        iconPlacement="end"
                    >
                        {effectiveAccessLevel === null
                            ? noAccessLevelText
                            : accessLevelText[effectiveAccessLevel]}
                    </Button>
                </MenuButton>
            )}
            {showCanNotDeleteInheritedUrlGrantDialog && inherited && (
                <ModalDialog
                    title={`Can\u2019t make this ${entityNoun} private`}
                    description={inherited.explanations.DeleteUrlGrant()}
                    shouldHideCancelButton={true}
                    primaryButtonLabel="Ok"
                    onPrimaryButtonPress={() => setShowCanNotDeleteInheritedUrlGrantDialog(false)}
                    onClose={() => setShowCanNotDeleteInheritedUrlGrantDialog(false)}
                />
            )}
        </Box>
    );
}

function ShareOverlaySiteWarningBanner({entityNoun}: {entityNoun: string}) {
    return (
        <Box
            display="flex"
            alignItems="center"
            gap="2"
            paddingX="3"
            paddingY="2"
            backgroundColor="grey-5"
            borderRadius="1"
        >
            <Box flexShrink="0" color="grey-70">
                <BuildingsIcon size={spacing["4"]} />
            </Box>
            <Box fontSize="50" color="grey-80">
                Permissions for this {entityNoun} are managed at the site level. Changing
                permissions here will affect the entire site.
            </Box>
        </Box>
    );
}
