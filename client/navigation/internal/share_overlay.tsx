import {CaretDown, Globe, Link as LinkIcon} from "phosphor-react";
import {useEffect, useMemo, useState} from "react";
import {FocusScope} from "react-aria";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {useAccountClientStore} from "~/client/accounts/account_client_store_context.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {MenuAction} from "~/client/design/menu.js";
import {MenuButton} from "~/client/design/menu_button.js";
import {OverlayScopeContextProvider} from "~/client/design/overlay_scope_context_provider.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {Spacer} from "~/client/design/spacer.js";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {useStore} from "~/client/helpers/use_store.js";
import {
    accessLevelText,
    noAccessLevelText,
    removeAccessLevelText,
} from "~/client/navigation/internal/access_level_text.js";
import {ShareOverlayAccountGrantInput} from "~/client/navigation/internal/share_overlay_account_grant_input.js";
import {TextShimmer} from "~/client/shimmer/text_shimmer.js";
import {SpaceAvatar} from "~/client/spaces/space_avatar.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {useExpensivelyLoadAllSpaceAccounts} from "~/client/spaces/use_expensively_load_all_space_accounts.js";
import {
    backgroundColorVar,
    greyElevated1ClassName,
    pulseAnimationClassName,
    sprinkles,
} from "~/client/styles/styles.js";
import {
    AccessLevel,
    AccessPolicy,
    AccessPolicyAccountGrant,
    AccessPolicyDefaultGrant,
    AccessPolicyUrlGrant,
    allAccessLevels,
} from "~/shared/access/access_policy.js";
import {AccessPolicyAction} from "~/shared/access/access_policy_action.js";
import {parseRemLength, spacing} from "~/shared/design/core/spacing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {flatIterable} from "~/shared/helpers/iterable/flat_iterable.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {partitionIterable} from "~/shared/helpers/iterable/partition_iterable.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {AccountModel, AccountModelData} from "~/shared/spaces/account_model.js";
import {computeStore} from "~/shared/store/compute_store.js";

export function ShareOverlay({
    id,
    accessPolicy,
    onAccessPolicyChange,
    isVisible,
    isReadOnly,
    onCopyLink,
    onCloseWithoutAnimation,
}: {
    id: string;
    accessPolicy: AccessPolicy;
    onAccessPolicyChange: (accessPolicy: AccessPolicyAction) => void;
    isVisible: boolean;
    isReadOnly: boolean;
    onCopyLink: () => MaybePromise<void>;
    onCloseWithoutAnimation: () => void;
}) {
    const hasAccountGrantInput = !isReadOnly;

    const allAccounts = useExpensivelyLoadAllSpaceAccounts() ?? emptyArray;

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
            // If we're animating closed then don't contain focus since we need to move
            // focus back to the overlay trigger button element.
            contain={isVisible}
        >
            <Box
                id={id}
                // Let initial focus from `<OverlayTriggerButton>` go somewhere other than the
                // add people text input.
                tabIndex={0}
                className={greyElevated1ClassName}
                position="relative"
                zIndex="0"
                backgroundColor="grey-0"
                borderRadius="2.5"
                boxShadow="elevation-20"
                width="96"
                paddingTop={hasAccountGrantInput ? "5" : undefined}
                paddingBottom="5"
            >
                <OverlayScopeContextProvider
                // Make sure any overlays inside the share overlay are animated with the share
                // overlay.
                >
                    {hasAccountGrantInput && (
                        <Box position="relative" zIndex="10" paddingX="5">
                            <ShareOverlayAccountGrantInput
                                accountGrantById={accessPolicy.accountGrantById}
                                onAccessPolicyChange={onAccessPolicyChange}
                                allAccounts={allAccounts}
                                accountById={accountById}
                                isAltKeyDown={isAltKeyDown}
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
                    )}
                    {accessPolicy.accountGrantById.size === 0 ? (
                        <Spacer space="5" />
                    ) : (
                        <ShareOverlayAccountGrants
                            accountGrantById={accessPolicy.accountGrantById}
                            onAccessPolicyChange={onAccessPolicyChange}
                            accountById={accountById}
                            isReadOnly={isReadOnly}
                            isAltKeyDown={isAltKeyDown}
                        />
                    )}
                    <Box paddingX="5">
                        <Box height="border" backgroundColor="grey-5" />
                        <Spacer space="5" />
                        <ShareOverlayDefaultGrant
                            defaultGrant={accessPolicy.defaultGrant}
                            onAccessPolicyChange={onAccessPolicyChange}
                            isReadOnly={isReadOnly}
                            isAltKeyDown={isAltKeyDown}
                        />
                        <Spacer space="3" />
                        <ShareOverlayUrlGrant
                            urlGrant={accessPolicy.urlGrant}
                            onAccessPolicyChange={onAccessPolicyChange}
                            isReadOnly={isReadOnly}
                        />
                        <Spacer space="5" />
                        <Box height="border" backgroundColor="grey-5" />
                        <Spacer space="5" />
                        <Button
                            variant="accent"
                            height="8"
                            fullWidth={true}
                            borderRadius="1.5"
                            icon={<LinkIcon size={spacing["4"]} />}
                            pressErrorTitle="Couldn’t copy link"
                            onPress={async () => {
                                await onCopyLink();

                                // Assume copy will work and close overlay without flicker.
                                onCloseWithoutAnimation();
                            }}
                        >
                            Copy link
                        </Button>
                    </Box>
                </OverlayScopeContextProvider>
            </Box>
        </FocusScope>
    );
}

function ShareOverlayAccountGrants({
    accountGrantById,
    onAccessPolicyChange,
    accountById,
    isReadOnly,
    isAltKeyDown,
}: {
    accountGrantById: AccessPolicy["accountGrantById"];
    onAccessPolicyChange: (action: AccessPolicyAction) => void;
    accountById: ReadonlyMap<AccountId, AccountModel>;
    isReadOnly: boolean;
    isAltKeyDown: boolean;
}) {
    const accountStore = useAccountClientStore();

    // Sort account grants by:
    //
    // 1. Access level (higher access levels first).
    // 2. Order in which the account grant was added. We assume
    //    `accountGrantById` is in insertion order.
    //
    // The current account is not included in this array. The current account is
    // displayed first in the list of accounts with access.
    //
    // We don't want accounts to move while the user is modifying their access
    // level. So we sort accounts by their initial access level, not their current
    // access level. Which is why we have this state here. This state creates a map
    // of account grants keyed by the initial access policy we saw for the grant.
    const [accountGrantByIdByInitialAccessLevel] = useStateWithDependencies<
        ReadonlyMap<AccessLevel, ReadonlyMap<AccountId, AccessPolicyAccountGrant>>,
        [AccessPolicy["accountGrantById"]]
    >(
        ([accountGrantById], previousAccountGrantByIdByInitialAccessLevel) => {
            const accountGrantByIdByInitialAccessLevel = new Map<
                AccessLevel,
                Map<AccountId, AccessPolicyAccountGrant>
            >();

            const initialAccessLevelByAccountId = new Map<AccountId, AccessLevel>();

            // Record the initial access level for each account in our previous state.
            for (const [
                initialAccessLevel,
                accountGrantById,
            ] of previousAccountGrantByIdByInitialAccessLevel ?? emptyArray) {
                for (const accountId of accountGrantById.keys()) {
                    assert(!initialAccessLevelByAccountId.has(accountId));
                    initialAccessLevelByAccountId.set(accountId, initialAccessLevel);
                }
            }

            // Add accounts to our map keyed by the initial access level we saw for the
            // account.
            for (const [accountId, accountGrant] of accountGrantById) {
                const initialAccessLevel = initialAccessLevelByAccountId.get(accountId);

                getOrSetDefaultMapValue(
                    accountGrantByIdByInitialAccessLevel,
                    initialAccessLevel ?? accountGrant.level,
                    () => new Map(),
                ).set(accountId, accountGrant);
            }

            return accountGrantByIdByInitialAccessLevel;
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
                            accountGrant: AccessPolicyAccountGrant;
                            account: AccountModel | null;
                            accountData: AccountModelData | null;
                        }>(
                            // This partition is used to sort removed accounts last. It splits the provided
                            // iterator into two iterators. The true iterator first (non-removed accounts)
                            // and the false iterator second (removed accounts). We then flatten that back
                            // into one iterable with the wrapping `flatIterable()`.
                            partitionIterable(
                                mapIterable(
                                    // Create an iterable that goes through each account grant in initial access
                                    // level order. Starting with the `Manage` access level and ending with the
                                    // `View` access level.
                                    flatIterable(
                                        Array.from(
                                            allAccessLevels,
                                            accessLevel =>
                                                accountGrantByIdByInitialAccessLevel.get(
                                                    accessLevel,
                                                ) ?? emptyArray,
                                        ).reverse(),
                                    ),
                                    ([accountId, accountGrant]) => {
                                        const account = accountById.get(accountId) ?? null;
                                        const accountData = account
                                            ? get(accountStore.getAccountStore(account))
                                            : null;
                                        return {accountId, accountGrant, account, accountData};
                                    },
                                ),
                                ({accountData}) => !accountData || !accountData.space.wasRemoved,
                            ),
                        ),
                    ),
                ),
            [accountById, accountGrantByIdByInitialAccessLevel, accountStore],
        ),
    );

    return (
        <Box
            ref={useScrollbar({insetTop: "5", insetBottom: "5"})}
            position="relative"
            zIndex="0"
            maxHeight="96"
            overflowX="hidden"
            overflowY="auto"
            style={{
                // At max, show seven account grants and two thirds of an eighth account.
                maxHeight: useMemo(
                    () =>
                        `${
                            parseRemLength(shareOverlayAccountGrantHeight) * 7.66667 +
                            parseRemLength("4") * 7 +
                            parseRemLength("5")
                        }rem`,
                    [],
                ),
            }}
        >
            <Box
                display="flex"
                flexDirection="column"
                gap="4"
                paddingX="5"
                paddingTop="5"
                paddingBottom="5"
            >
                {sortedAccountGrants.map(({accountId, accountGrant, accountData}) => (
                    <ShareOverlayAccountGrant
                        key={accountId}
                        accountId={accountId}
                        accountData={accountData}
                        accountGrant={accountGrant}
                        onAccessPolicyChange={onAccessPolicyChange}
                        isReadOnly={isReadOnly}
                        isAltKeyDown={isAltKeyDown}
                    />
                ))}
            </Box>
        </Box>
    );
}

const shareOverlayAccountGrantHeight = "6";

function ShareOverlayAccountGrant({
    accountId,
    accountData,
    accountGrant,
    onAccessPolicyChange,
    isReadOnly,
    isAltKeyDown,
}: {
    accountId: AccountId;
    accountData: AccountModelData | null;
    accountGrant: AccessPolicyAccountGrant;
    onAccessPolicyChange: (action: AccessPolicyAction) => void;
    isReadOnly: boolean;
    isAltKeyDown: boolean;
}) {
    const {currentAccount} = useSpaceContext();

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
                        color={accountData.space.wasRemoved ? "grey-60" : "grey-100"}
                    >
                        {accountData.name}
                        {currentAccount?.id === accountId ? " (you)" : ""}
                    </Box>
                </>
            )}
            <Box flexGrow="1" />
            {isReadOnly ? (
                <Box flexShrink="0">{accessLevelText[accountGrant.level]}</Box>
            ) : (
                <MenuButton
                    placement="bottom-end"
                    actions={[
                        [
                            {
                                isSelected: accountGrant.level === "Manage",
                                label: accessLevelText.Manage,
                                onPress: () => {
                                    onAccessPolicyChange({
                                        type: "SetAccountGrantLevel",
                                        accountId,
                                        level: "Manage",
                                    });
                                },
                            },
                            ...(isAltKeyDown
                                ? [
                                      cast<MenuAction>({
                                          isSelected: accountGrant.level === "Edit",
                                          label: accessLevelText.Edit,
                                          onPress: () => {
                                              onAccessPolicyChange({
                                                  type: "SetAccountGrantLevel",
                                                  accountId,
                                                  level: "Edit",
                                              });
                                          },
                                      }),
                                  ]
                                : emptyArray),
                            {
                                isSelected: accountGrant.level === "Comment",
                                label: accessLevelText.Comment,
                                onPress: () => {
                                    onAccessPolicyChange({
                                        type: "SetAccountGrantLevel",
                                        accountId,
                                        level: "Comment",
                                    });
                                },
                            },
                            {
                                isSelected: accountGrant.level === "View",
                                label: accessLevelText.View,
                                onPress: () => {
                                    onAccessPolicyChange({
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
                                onPress: () => {
                                    onAccessPolicyChange({
                                        type: "DeleteAccountGrant",
                                        accountId,
                                    });
                                },
                            },
                        ],
                    ]}
                >
                    <Button height="6" paddingX="2" icon={<CaretDown />} iconPlacement="end">
                        {accessLevelText[accountGrant.level]}
                    </Button>
                </MenuButton>
            )}
        </Box>
    );
}

function ShareOverlayDefaultGrant({
    defaultGrant,
    onAccessPolicyChange,
    isReadOnly,
    isAltKeyDown,
}: {
    defaultGrant: AccessPolicyDefaultGrant | null;
    onAccessPolicyChange: (action: AccessPolicyAction) => void;
    isReadOnly: boolean;
    isAltKeyDown: boolean;
}) {
    const {space} = useSpaceContext();

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
                <Box color={defaultGrant === null ? "grey-60" : "grey-100"}>
                    {defaultGrant === null
                        ? noAccessLevelText
                        : accessLevelText[defaultGrant.level]}
                </Box>
            ) : (
                <MenuButton
                    placement="bottom-end"
                    actions={[
                        [
                            {
                                isSelected: defaultGrant?.level === "Manage",
                                label: accessLevelText.Manage,
                                onPress: () => {
                                    if (defaultGrant) {
                                        onAccessPolicyChange({
                                            type: "SetDefaultGrantLevel",
                                            level: "Manage",
                                        });
                                    } else {
                                        onAccessPolicyChange({
                                            type: "AddDefaultGrant",
                                            defaultGrant: {level: "Manage"},
                                        });
                                    }
                                },
                            },
                            ...(isAltKeyDown || defaultGrant?.level === "Edit"
                                ? [
                                      cast<MenuAction>({
                                          isSelected: defaultGrant?.level === "Edit",
                                          label: accessLevelText.Edit,
                                          onPress: () => {
                                              if (defaultGrant) {
                                                  onAccessPolicyChange({
                                                      type: "SetDefaultGrantLevel",
                                                      level: "Edit",
                                                  });
                                              } else {
                                                  onAccessPolicyChange({
                                                      type: "AddDefaultGrant",
                                                      defaultGrant: {level: "Edit"},
                                                  });
                                              }
                                          },
                                      }),
                                  ]
                                : emptyArray),
                            {
                                isSelected: defaultGrant?.level === "Comment",
                                label: accessLevelText.Comment,
                                onPress: () => {
                                    if (defaultGrant) {
                                        onAccessPolicyChange({
                                            type: "SetDefaultGrantLevel",
                                            level: "Comment",
                                        });
                                    } else {
                                        onAccessPolicyChange({
                                            type: "AddDefaultGrant",
                                            defaultGrant: {level: "Comment"},
                                        });
                                    }
                                },
                            },
                            {
                                isSelected: defaultGrant?.level === "View",
                                label: accessLevelText.View,
                                onPress: () => {
                                    if (defaultGrant) {
                                        onAccessPolicyChange({
                                            type: "SetDefaultGrantLevel",
                                            level: "View",
                                        });
                                    } else {
                                        onAccessPolicyChange({
                                            type: "AddDefaultGrant",
                                            defaultGrant: {level: "View"},
                                        });
                                    }
                                },
                            },
                        ],
                        [
                            {
                                isSelected: defaultGrant === null,
                                label: noAccessLevelText,
                                onPress: () => {
                                    onAccessPolicyChange({
                                        type: "DeleteDefaultGrant",
                                    });
                                },
                            },
                        ],
                    ]}
                >
                    <Button
                        variant={defaultGrant === null ? "quieter" : "quiet"}
                        height="6"
                        paddingX="2"
                        icon={<CaretDown />}
                        iconPlacement="end"
                    >
                        {defaultGrant === null
                            ? noAccessLevelText
                            : accessLevelText[defaultGrant.level]}
                    </Button>
                </MenuButton>
            )}
        </Box>
    );
}

function ShareOverlayUrlGrant({
    urlGrant,
    onAccessPolicyChange,
    isReadOnly,
}: {
    urlGrant: AccessPolicyUrlGrant | null;
    onAccessPolicyChange: (action: AccessPolicyAction) => void;
    isReadOnly: boolean;
}) {
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
                <Box color={urlGrant === null ? "grey-60" : "grey-100"}>{noAccessLevelText}</Box>
            ) : (
                <MenuButton
                    placement="bottom-end"
                    actions={[
                        [
                            {
                                isSelected: urlGrant?.level === "View",
                                label: accessLevelText.View,
                                onPress: () => {
                                    if (urlGrant) {
                                        onAccessPolicyChange({
                                            type: "SetUrlGrantLevel",
                                            level: "View",
                                        });
                                    } else {
                                        onAccessPolicyChange({
                                            type: "AddUrlGrant",
                                            urlGrant: {level: "View"},
                                        });
                                    }
                                },
                            },
                        ],
                        [
                            {
                                isSelected: urlGrant === null,
                                label: noAccessLevelText,
                                onPress: () => {
                                    onAccessPolicyChange({
                                        type: "DeleteUrlGrant",
                                    });
                                },
                            },
                        ],
                    ]}
                >
                    <Button
                        variant={urlGrant === null ? "quieter" : "quiet"}
                        height="6"
                        paddingX="2"
                        icon={<CaretDown />}
                        iconPlacement="end"
                    >
                        {urlGrant === null ? noAccessLevelText : accessLevelText[urlGrant.level]}
                    </Button>
                </MenuButton>
            )}
        </Box>
    );
}
