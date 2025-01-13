import {CaretDown, Globe, Link as LinkIcon} from "phosphor-react";
import {useEffect, useId, useMemo, useState} from "react";
import {FocusScope} from "react-aria";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {
    useAccountClientStore,
    useAccountModel,
} from "~/client/accounts/account_client_store_context.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {MenuAction} from "~/client/design/menu.js";
import {MenuButton} from "~/client/design/menu_button.js";
import {ModalDialog} from "~/client/design/modal_dialog.js";
import {OverlayScopeContextProvider} from "~/client/design/overlay_scope_context_provider.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {Spacer} from "~/client/design/spacer.js";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {
    accessLevelText,
    noAccessLevelText,
    removeAccessLevelText,
} from "~/client/navigation/internal/access_level_text.js";
import {
    AccessPolicyAction,
    reduceAccessPolicy,
} from "~/client/navigation/internal/access_policy_action.js";
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
    allAccessLevels,
    compareAccessLevel,
    getAccountAccessLevelAssumingSpaceAccess,
    hasAccessLevel,
} from "~/shared/access/access_policy.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {parseRemLength, spacing} from "~/shared/design/core/spacing.js";
import {joinPrettyConjunctionList} from "~/shared/design/join_pretty_conjunction_list.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {flatIterable} from "~/shared/helpers/iterable/flat_iterable.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";
import {iterableSome} from "~/shared/helpers/iterable/iterable_some.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export function ShareOverlay({
    entityNoun,
    accessPolicy,
    onAccessPolicyChange: onAccessPolicyChangeWithoutValidations,
    isVisible,
    isReadOnly,
    onCopyLink,
    onCloseWithoutAnimation,
}: {
    entityNoun: string;
    accessPolicy: AccessPolicy;
    onAccessPolicyChange: (accessPolicy: AccessPolicy) => void;
    isVisible: boolean;
    isReadOnly: boolean;
    onCopyLink: () => MaybePromise<void>;
    onCloseWithoutAnimation: () => void;
}) {
    const {space, currentAccount} = useSpaceContext();
    const accountStore = useAccountClientStore();
    const id = useId();

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

    const [warningDialogState, setWarningDialogState] = useState<{
        readonly title: string;
        readonly description: string;
        readonly action: AccessPolicyAction;
    } | null>(null);

    const onAccessPolicyChange = (action: AccessPolicyAction) => {
        const oldAccessPolicy = accessPolicy;
        const newAccessPolicy = reduceAccessPolicy(oldAccessPolicy, action);

        let changeDescription: string;
        switch (action.type) {
            case "AddAccountGrants": {
                changeDescription = `give ${
                    action.accountGrantById.size > 1
                        ? "these people"
                        : getAccountShortNameWithoutFullNameTooltip(
                              accountStore
                                  .getAccountStore(
                                      (action.accountGrantById.size === 1
                                          ? accountById.get(
                                                iterableFirst(action.accountGrantById)![0],
                                            )
                                          : null) ?? AccountModel.getUnknown(),
                                  )
                                  .getSnapshot(),
                          )
                } access to the ${entityNoun}`;
                break;
            }
            case "DeleteAccountGrant": {
                changeDescription = `remove ${
                    currentAccount.id === action.accountId
                        ? "your"
                        : `${getAccountShortNameWithoutFullNameTooltip(
                              accountStore
                                  .getAccountStore(
                                      accountById.get(action.accountId) ??
                                          AccountModel.getUnknown(),
                                  )
                                  .getSnapshot(),
                          )}’s`
                } access to the ${entityNoun}`;
                break;
            }
            case "SetAccountGrantLevel": {
                changeDescription = `change ${
                    currentAccount.id === action.accountId
                        ? "your"
                        : `${getAccountShortNameWithoutFullNameTooltip(
                              accountStore
                                  .getAccountStore(
                                      accountById.get(action.accountId) ??
                                          AccountModel.getUnknown(),
                                  )
                                  .getSnapshot(),
                          )}’s`
                } access to the ${entityNoun} to “${accessLevelText[action.level]}”`;
                break;
            }
            case "AddDefaultGrant": {
                changeDescription = `change everyone in ${
                    space.name
                }’s access to the ${entityNoun} to “${accessLevelText[action.defaultGrant.level]}”`;
                break;
            }
            case "DeleteDefaultGrant": {
                changeDescription = `remove everyone in ${space.name}’s access to the ${entityNoun}`;
                break;
            }
            case "SetDefaultGrantLevel": {
                changeDescription = `change everyone in ${
                    space.name
                }’s access to the ${entityNoun} to “${accessLevelText[action.level]}”`;
                break;
            }
            default:
                throw exhaustive(action);
        }

        {
            const doesAnyAccountHaveManageAccessLevel =
                hasAccessLevel(newAccessPolicy.defaultGrant?.level ?? null, "Manage") ||
                iterableSome(newAccessPolicy.accountGrantById.values(), accountGrant =>
                    hasAccessLevel(accountGrant.level, "Manage"),
                );

            // NOCOMMIT: Integration test
            if (!doesAnyAccountHaveManageAccessLevel) {
                setWarningDialogState({
                    title: "Remove everyone who can change permissions?",
                    description: `If you ${changeDescription} then there won’t be anyone who can share or change permissions on the ${entityNoun}. You can’t undo this change.`,
                    action,
                });
                return;
            }
        }

        {
            const oldAccessLevel = getAccountAccessLevelAssumingSpaceAccess(
                oldAccessPolicy,
                currentAccount.id,
            );
            const newAccessLevel = getAccountAccessLevelAssumingSpaceAccess(
                newAccessPolicy,
                currentAccount.id,
            );

            // NOCOMMIT: Integration test
            if (compareAccessLevel(oldAccessLevel, newAccessLevel) > 0) {
                const permissionDescriptions: Array<string> = [];

                if (
                    hasAccessLevel(oldAccessLevel, "View") &&
                    !hasAccessLevel(newAccessLevel, "View")
                ) {
                    permissionDescriptions.push("see");
                } else {
                    if (
                        hasAccessLevel(oldAccessLevel, "Edit") &&
                        !hasAccessLevel(newAccessLevel, "Edit")
                    ) {
                        permissionDescriptions.push("edit");
                    } else if (
                        hasAccessLevel(oldAccessLevel, "Comment") &&
                        !hasAccessLevel(newAccessLevel, "Comment")
                    ) {
                        permissionDescriptions.push("comment on");
                    }

                    if (
                        hasAccessLevel(oldAccessLevel, "Manage") &&
                        !hasAccessLevel(newAccessLevel, "Manage")
                    ) {
                        permissionDescriptions.push("share");
                    }
                }

                const joinedPermissionDescriptions = joinPrettyConjunctionList(
                    permissionDescriptions,
                    "or",
                );

                setWarningDialogState({
                    title: "Remove permissions from yourself?",
                    description: `If you ${changeDescription} then you won’t be able to ${joinedPermissionDescriptions} the ${entityNoun} anymore. You can’t undo this change.`,
                    action,
                });
                return;
            }
        }

        onAccessPolicyChangeWithoutValidations(newAccessPolicy);
    };

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
                        <ShareOverlayLinkGrant isReadOnly={isReadOnly} />
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
                {warningDialogState && (
                    <ModalDialog
                        data-ownedby={id}
                        title={warningDialogState.title}
                        description={warningDialogState.description}
                        primaryButtonLabel="Cancel"
                        onPrimaryButtonPress={() => setWarningDialogState(null)}
                        cancelButtonLabel="I understand, make this change"
                        onCancelButtonPress={() =>
                            onAccessPolicyChangeWithoutValidations(
                                reduceAccessPolicy(accessPolicy, warningDialogState.action),
                            )
                        }
                        onClose={() => setWarningDialogState(null)}
                    />
                )}
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

    // NOCOMMIT: Removed accounts should be sorted last and colored differently
    const sortedAccountGrants = useMemo(
        () =>
            flatIterable(
                Array.from(
                    allAccessLevels,
                    accessLevel =>
                        accountGrantByIdByInitialAccessLevel.get(accessLevel) ?? emptyArray,
                ).reverse(),
            ),
        [accountGrantByIdByInitialAccessLevel],
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
                {mapIterable(sortedAccountGrants, ([accountId, accountGrant]) => (
                    // NOCOMMIT: Protect against newly granted accounts lowering previously granted
                    // account access
                    <ShareOverlayAccountGrant
                        key={accountId}
                        accountId={accountId}
                        account={accountById.get(accountId) ?? null}
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
    account,
    accountGrant,
    onAccessPolicyChange,
    isReadOnly,
    isAltKeyDown,
}: {
    accountId: AccountId;
    account: AccountModel | null;
    accountGrant: AccessPolicyAccountGrant;
    onAccessPolicyChange: (action: AccessPolicyAction) => void;
    isReadOnly: boolean;
    isAltKeyDown: boolean;
}) {
    const {currentAccount} = useSpaceContext();

    const accountData = useAccountModel(account);

    return (
        <Box height={shareOverlayAccountGrantHeight} display="flex" alignItems="center" gap="2.5">
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
                    <Box fontSize="100" fontStyle="truncate-semi-bold">
                        {accountData.name}
                        {currentAccount.id === account?.id ? " (you)" : ""}
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
        <Box display="flex" alignItems="center">
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
                                            defaultGrant: {type: "Space", level: "Manage"},
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
                                                      defaultGrant: {
                                                          type: "Space",
                                                          level: "Edit",
                                                      },
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
                                            defaultGrant: {type: "Space", level: "Comment"},
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
                                            defaultGrant: {type: "Space", level: "View"},
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

function ShareOverlayLinkGrant({isReadOnly}: {isReadOnly: boolean}) {
    return (
        <Box display="flex" alignItems="center">
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
                <Box
                    // NOCOMMIT: Check if access level is actually null
                    color={true ? "grey-60" : "grey-100"}
                >
                    {noAccessLevelText}
                </Box>
            ) : (
                <MenuButton
                    placement="bottom-end"
                    actions={[
                        [
                            {
                                label: accessLevelText.View,
                                onPress: () => {
                                    // NOCOMMIT
                                },
                            },
                        ],
                        [
                            {
                                label: noAccessLevelText,
                                isSelected: true,
                                onPress: () => {
                                    // NOCOMMIT
                                },
                            },
                        ],
                    ]}
                >
                    <Button
                        // NOCOMMIT: Check if access level is actually null
                        variant={true ? "quieter" : "quiet"}
                        height="6"
                        paddingX="2"
                        icon={<CaretDown />}
                        iconPlacement="end"
                    >
                        {noAccessLevelText}
                    </Button>
                </MenuButton>
            )}
        </Box>
    );
}
