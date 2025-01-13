import {CaretDown, Globe, Link as LinkIcon} from "phosphor-react";
import {useEffect, useMemo, useState} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {useAccountModel} from "~/client/accounts/account_client_store_context.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {MenuAction} from "~/client/design/menu.js";
import {MenuButton} from "~/client/design/menu_button.js";
import {Spacer} from "~/client/design/spacer.js";
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
    greyElevated1ClassName,
    pulseAnimationClassName,
    sprinkles,
} from "~/client/styles/styles.js";
import {
    AccessPolicy,
    AccessPolicyAccountGrant,
    AccessPolicyDefaultGrant,
    compareAccessLevel,
} from "~/shared/access/access_policy.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export function ShareOverlay({
    accessPolicy,
    onAccessPolicyChange,
    isReadOnly,
    onCopyLink,
    onCloseWithoutAnimation,
}: {
    accessPolicy: AccessPolicy;
    onAccessPolicyChange: (accessPolicy: AccessPolicy) => void;
    isReadOnly: boolean;
    onCopyLink: () => MaybePromise<void>;
    onCloseWithoutAnimation: () => void;
}) {
    const {currentAccount} = useSpaceContext();

    const [isAltKeyDown, setIsAltKeyDown] = useState(false);

    const allAccounts = useExpensivelyLoadAllSpaceAccounts() ?? emptyArray;

    const accountById = useMemo(() => {
        const accountById = new Map<AccountId, AccountModel>();
        for (const account of allAccounts) accountById.set(account.id, account);
        return accountById;
    }, [allAccounts]);

    // Sort account grants by:
    //
    // 1. Access level (higher access levels first).
    // 2. Order in which the account grant was added. We assume
    //    `accountGrantById` is in insertion order.
    //
    // The current account is not included in this array. The current account is
    // displayed first in the list of accounts with access.
    const sortedAccountGrants = useMemo(
        () =>
            Array.from(
                filterIterable(
                    accessPolicy.accountGrantById,
                    ([accountId]) => accountId !== currentAccount.id,
                ),
            ).sort(
                ([, accountGrant1], [, accountGrant2]) =>
                    -compareAccessLevel(accountGrant1.level, accountGrant2.level),
            ),
        [accessPolicy.accountGrantById, currentAccount.id],
    );

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
        <Box
            className={greyElevated1ClassName}
            backgroundColor="grey-0"
            borderRadius="2.5"
            boxShadow="elevation-20"
            width="96"
            padding="5"
        >
            {!isReadOnly && (
                <>
                    <ShareOverlayAccountGrantInput isAltKeyDown={isAltKeyDown} />
                    <Spacer space="5" />
                </>
            )}
            <Box display="flex" flexDirection="column" gap="4">
                <ShareOverlayAccountGrant
                    // We always want to show at least the current account in the share overlay and
                    // we want to show the current account first.
                    account={currentAccount}
                    // In order to open the share overlay the current account must have some access
                    // declared in the access policy in the first place.
                    accountGrant={assertExists(
                        accessPolicy.accountGrantById.get(currentAccount.id) ??
                            // If there's no grant for our current account then they may be covered by the
                            // default grant.
                            accessPolicy.defaultGrant,
                    )}
                    isReadOnly={isReadOnly}
                    isAltKeyDown={isAltKeyDown}
                />
                {sortedAccountGrants.map(([accountId, accountGrant]) => (
                    // NOCOMMIT: Scroll if this gets too long
                    <ShareOverlayAccountGrant
                        key={accountId}
                        account={accountById.get(accountId) ?? null}
                        accountGrant={accountGrant}
                        isReadOnly={isReadOnly}
                        isAltKeyDown={isAltKeyDown}
                    />
                ))}
            </Box>
            <Spacer space="5" />
            <Box height="border" backgroundColor="grey-5" />
            <Spacer space="5" />
            <ShareOverlayDefaultGrant
                defaultGrant={accessPolicy.defaultGrant}
                onDefaultGrantChange={defaultGrant => {
                    // NOCOMMIT: Warn if this will change the current account's access level.
                    onAccessPolicyChange({...accessPolicy, defaultGrant});
                }}
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
    );
}

function ShareOverlayAccountGrant({
    account,
    accountGrant,
    isReadOnly,
    isAltKeyDown,
}: {
    account: AccountModel | null;
    accountGrant: AccessPolicyAccountGrant;
    isReadOnly: boolean;
    isAltKeyDown: boolean;
}) {
    const accountData = useAccountModel(account);

    return (
        <Box display="flex" alignItems="center" gap="2.5">
            {!accountData ? (
                <>
                    <Box
                        className={pulseAnimationClassName}
                        backgroundColor="grey-10"
                        width="6"
                        height="6"
                        borderRadius="full"
                    />
                    <TextShimmer fontSize="100" width="32" ragRight="random" />
                </>
            ) : (
                <>
                    <AccountAvatar size="6" account={accountData} />
                    <Box fontSize="100" fontStyle="truncate-semi-bold">
                        {accountData.name}
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
                                    // NOCOMMIT
                                },
                            },
                            ...(isAltKeyDown
                                ? [
                                      cast<MenuAction>({
                                          isSelected: accountGrant.level === "Edit",
                                          label: accessLevelText.Edit,
                                          onPress: () => {
                                              // NOCOMMIT
                                          },
                                      }),
                                  ]
                                : emptyArray),
                            {
                                isSelected: accountGrant.level === "Comment",
                                label: accessLevelText.Comment,
                                onPress: () => {
                                    // NOCOMMIT
                                },
                            },
                            {
                                isSelected: accountGrant.level === "View",
                                label: accessLevelText.View,
                                onPress: () => {
                                    // NOCOMMIT
                                },
                            },
                        ],
                        [
                            {
                                label: removeAccessLevelText,
                                onPress: () => {
                                    // NOCOMMIT
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
    onDefaultGrantChange,
    isReadOnly,
    isAltKeyDown,
}: {
    defaultGrant: AccessPolicyDefaultGrant | null;
    onDefaultGrantChange: (defaultGrant: AccessPolicyDefaultGrant | null) => void;
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
                                    onDefaultGrantChange({type: "Space", level: "Manage"});
                                },
                            },
                            ...(isAltKeyDown || defaultGrant?.level === "Edit"
                                ? [
                                      cast<MenuAction>({
                                          isSelected: defaultGrant?.level === "Edit",
                                          label: accessLevelText.Edit,
                                          onPress: () => {
                                              onDefaultGrantChange({type: "Space", level: "Edit"});
                                          },
                                      }),
                                  ]
                                : emptyArray),
                            {
                                isSelected: defaultGrant?.level === "Comment",
                                label: accessLevelText.Comment,
                                onPress: () => {
                                    onDefaultGrantChange({type: "Space", level: "Comment"});
                                },
                            },
                            {
                                isSelected: defaultGrant?.level === "View",
                                label: accessLevelText.View,
                                onPress: () => {
                                    onDefaultGrantChange({type: "Space", level: "View"});
                                },
                            },
                        ],
                        [
                            {
                                isSelected: defaultGrant === null,
                                label: noAccessLevelText,
                                onPress: () => {
                                    onDefaultGrantChange(null);
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
