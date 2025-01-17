import {Globe, Lock} from "phosphor-react";
import {useId, useState} from "react";
import {usePress} from "react-aria";
import {useAccountClientStore} from "~/client/accounts/account_client_store_context.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {ModalDialog} from "~/client/design/modal_dialog.js";
import {OverlayTriggerButton} from "~/client/design/overlay_trigger_button.js";
import {useReporter} from "~/client/design/reporter.js";
import {BuildingsIcon} from "~/client/icons/buildings_icon.js";
import {accessLevelText} from "~/client/navigation/internal/access_level_text.js";
import {ShareOverlay} from "~/client/navigation/internal/share_overlay.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {useExpensivelyPreloadAllSpaceAccounts} from "~/client/spaces/use_expensively_load_all_space_accounts.js";
import {elevation, sprinkles} from "~/client/styles/styles.js";
import {
    AccessPolicy,
    compareAccessLevel,
    getAccountAccessLevelAssumingSpaceAccess,
    hasAccessLevel,
    validateAccessPolicyUpdate,
} from "~/shared/access/access_policy.js";
import {AccessPolicyAction, reduceAccessPolicy} from "~/shared/access/access_policy_action.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {joinPrettyConjunctionList} from "~/shared/design/join_pretty_conjunction_list.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export function ShareButton({
    entityNoun,
    accessPolicy,
    onAccessPolicyChange: onAccessPolicyChangeWithoutValidations,
    isReadOnly,
    onCopyLink,
}: {
    entityNoun: string;
    accessPolicy: AccessPolicy;
    onAccessPolicyChange: (accessPolicy: AccessPolicy) => void;
    isReadOnly: boolean;
    onCopyLink: () => MaybePromise<void>;
}) {
    const {space, currentAccount} = useSpaceContext();
    const accountStore = useAccountClientStore();

    const overlayId = useId();

    // We need all accounts when the `<ShareOverlay>` is open so preload
    // them now.
    useExpensivelyPreloadAllSpaceAccounts();

    const [warningDialogState, setWarningDialogState] = useState<{
        readonly title: string;
        readonly description: string;
        readonly isAllowed: boolean;
        readonly currentAccountId: AccountId;
        readonly action: AccessPolicyAction;
    } | null>(null);

    const onAccessPolicyChange = (action: AccessPolicyAction) => {
        // Defend against making changes while read only. Ultimately the backend should
        // prevent invalid changes like this but it's nice to catch errors like this
        // early.
        if (isReadOnly) {
            throw new InternalError("Can't update access policy when share button is read only");
        }

        if (!currentAccount) return;

        const oldAccessPolicy = accessPolicy;
        const newAccessPolicy = reduceAccessPolicy(currentAccount.id, oldAccessPolicy, action);

        let changedAccountName: string | undefined;
        let changeDescription: string;
        switch (action.type) {
            case "AddAccountGrants": {
                if (action.accountGrantById.size === 1) {
                    changedAccountName = getAccountShortNameWithoutFullNameTooltip(
                        (action.accountGrantById.size === 1
                            ? accountStore
                                  .weakGetAccountStoreByIdIfExists(
                                      iterableFirst(action.accountGrantById)![0],
                                  )
                                  ?.getSnapshot()
                            : null) ?? AccountModel.getUnknown().initialData,
                    );
                }

                changeDescription = `give ${
                    changedAccountName ?? "these people"
                } access to the ${entityNoun}`;
                break;
            }
            case "DeleteAccountGrant": {
                changedAccountName = getAccountShortNameWithoutFullNameTooltip(
                    accountStore.weakGetAccountStoreByIdIfExists(action.accountId)?.getSnapshot() ??
                        AccountModel.getUnknown().initialData,
                );

                changeDescription = `remove ${
                    currentAccount.id === action.accountId ? "your" : `${changedAccountName}’s`
                } access to the ${entityNoun}`;
                break;
            }
            case "SetAccountGrantLevel": {
                changedAccountName = getAccountShortNameWithoutFullNameTooltip(
                    accountStore.weakGetAccountStoreByIdIfExists(action.accountId)?.getSnapshot() ??
                        AccountModel.getUnknown().initialData,
                );

                changeDescription = `change ${
                    currentAccount.id === action.accountId ? "your" : `${changedAccountName}’s`
                } access to the ${entityNoun} to “${accessLevelText[action.level]}”`;
                break;
            }
            case "AddDefaultGrant": {
                changeDescription = `change everyone in ${
                    space.name
                }’s access to the ${entityNoun} to “${accessLevelText[action.defaultGrant.level]}”`;
                break;
            }
            // `DeleteDefaultGrantAndUrlGrant` uses the same language as
            // `DeleteDefaultGrant` since we'll generally only show this message for
            // warnings where changing the default grant matters.
            case "DeleteDefaultGrant":
            case "DeleteDefaultGrantAndUrlGrant": {
                changeDescription = `remove everyone in ${space.name}’s access to the ${entityNoun}`;
                break;
            }
            case "SetDefaultGrantLevel": {
                changeDescription = `change everyone in ${
                    space.name
                }’s access to the ${entityNoun} to “${accessLevelText[action.level]}”`;
                break;
            }
            case "AddUrlGrant": {
                changeDescription = `change anyone with the link’s access to the ${entityNoun} to “${
                    accessLevelText[action.urlGrant.level]
                }”`;
                break;
            }
            case "DeleteUrlGrant": {
                changeDescription = `remove anyone with the link’s access to the ${entityNoun}`;
                break;
            }
            case "SetUrlGrantLevel": {
                changeDescription = `change anyone with the link’s access to the ${entityNoun} to “${
                    accessLevelText[action.level]
                }”`;
                break;
            }
            default:
                throw exhaustive(action);
        }

        const validationResult = validateAccessPolicyUpdate(
            currentAccount.id,
            oldAccessPolicy,
            newAccessPolicy,
        );
        if (!validationResult.ok) {
            let title: string;
            let description: string;

            switch (validationResult.reason) {
                // Noop if we get here and the actor doesn't have manage access.
                case "Can't update access policy unless actor has manage access": {
                    return;
                }

                // It shouldn't be possible for the share overlay component to create one of
                // these changes. So throw an internal error if we see one of these reasons.
                case "Can't set new account grant manage generation to be less than or equal to our actor's manage generation":
                case "Can't change account grant manage generation":
                case "Can't set new default grant manage generation to be less than or equal to our actor's manage generation":
                case "Can't change default grant manage generation": {
                    throw new InternalError(
                        `Share overlay made an invalid change: ${validationResult.reason}`,
                    );
                }

                case "Can't revoke manage access from an account with a manage generation less than our actor": {
                    title = `Can’t change ${
                        changedAccountName ? `${changedAccountName}’s` : "their"
                    } permissions`;

                    // We use "they" to refer to the change description because we assume this error
                    // only happens when we either remove an account grant or change an account
                    // grant's level. In both cases we include the name of the account whose
                    // permissions we're changing in `changeDescription`.
                    description = `You can’t change the permissions of someone who was involved in adding you to the ${entityNoun}. So you can’t ${changeDescription}. Try asking whoever added ${
                        changedAccountName ?? "them"
                    } to the ${entityNoun} to change their permissions.`;
                    break;
                }

                case "Can't update access policy so that no one has manage access": {
                    title = "Can’t remove everyone who can change permissions";
                    description = `If you ${changeDescription} then there won’t be anyone who can change permissions of the ${entityNoun} anymore. Try adding more people with “can edit” access.`;
                    break;
                }

                default:
                    throw exhaustive(validationResult.reason);
            }

            setWarningDialogState({
                title,
                description,
                isAllowed: false,
                currentAccountId: currentAccount.id,
                action,
            });
            return;
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
                    isAllowed: true,
                    currentAccountId: currentAccount.id,
                    action,
                });
                return;
            }
        }

        onAccessPolicyChangeWithoutValidations(newAccessPolicy);
    };

    return (
        <Box display="flex" alignItems="center" gap="1.5">
            <OverlayTriggerButton
                aria-haspopup="dialog"
                placement="bottom"
                offset="3"
                overlay={({isVisible, onCloseWithoutAnimation}) => (
                    <Box paddingX="3">
                        <ShareOverlay
                            id={overlayId}
                            accessPolicy={accessPolicy}
                            onAccessPolicyChange={onAccessPolicyChange}
                            isVisible={isVisible}
                            isReadOnly={isReadOnly}
                            onCopyLink={onCopyLink}
                            onCloseWithoutAnimation={onCloseWithoutAnimation}
                        />
                    </Box>
                )}
                onOverlayEscapeGlobalKeyDown={event => {
                    // If the focused element is a combobox input, `<MenuButton>`, or menu item
                    // that's open and the user hits escape then we want the escape keydown to close
                    // the focused element's overlay.
                    if (
                        event.target instanceof HTMLElement &&
                        (event.target.getAttribute("aria-expanded") === "true" ||
                            event.target.role === "menuitem")
                    ) {
                        return {allowDefault: true};
                    }
                }}
                onOverlayTabGlobalKeyDown={() => {
                    // Don't close the overlay when tab is pressed. Tab is needed to navigate
                    // internally within the share overlay.
                    return {allowDefault: true};
                }}
            >
                <Button height="6" paddingX="2">
                    Share
                </Button>
            </OverlayTriggerButton>
            <ShareSwitch
                entityNoun={entityNoun}
                accessPolicy={accessPolicy}
                onAccessPolicyChange={onAccessPolicyChange}
                isReadOnly={isReadOnly}
            />
            {warningDialogState &&
                (warningDialogState.isAllowed ? (
                    <ModalDialog
                        data-ownedby={overlayId}
                        title={warningDialogState.title}
                        description={warningDialogState.description}
                        primaryButtonLabel="Cancel"
                        onPrimaryButtonPress={() => setWarningDialogState(null)}
                        cancelButtonLabel="I understand, make this change"
                        onCancelButtonPress={() => {
                            onAccessPolicyChangeWithoutValidations(
                                reduceAccessPolicy(
                                    warningDialogState.currentAccountId,
                                    accessPolicy,
                                    warningDialogState.action,
                                ),
                            );
                        }}
                        onClose={() => setWarningDialogState(null)}
                    />
                ) : (
                    <ModalDialog
                        data-ownedby={overlayId}
                        title={warningDialogState.title}
                        description={warningDialogState.description}
                        primaryButtonLabel="Ok"
                        onPrimaryButtonPress={() => setWarningDialogState(null)}
                        shouldHideCancelButton={true}
                        onClose={() => setWarningDialogState(null)}
                    />
                ))}
        </Box>
    );
}

function ShareSwitch({
    entityNoun,
    accessPolicy,
    onAccessPolicyChange,
    isReadOnly,
}: {
    entityNoun: string;
    accessPolicy: AccessPolicy;
    onAccessPolicyChange: (accessPolicy: AccessPolicyAction) => void;
    isReadOnly: boolean;
}) {
    const reporter = useReporter();
    const {space} = useSpaceContext();

    const {pressProps, isPressed} = usePress({
        isDisabled: isReadOnly,
        onPress: () => {
            if (!accessPolicy.defaultGrant && !accessPolicy.urlGrant) {
                onAccessPolicyChange({type: "AddDefaultGrant", defaultGrant: {level: "Manage"}});

                reporter.showInfoToast(
                    <>
                        Shared the {entityNoun} with everyone in{" "}
                        <span className={sprinkles({fontStyle: "semi-bold"})}>{space.name}</span>
                    </>,
                    {
                        // This message is short, appears a lot, and the user only really needs to read
                        // it once over the course of their lifetime with the product. Once the user
                        // learns what this switch does (ideally the first time they press the switch)
                        // they don't need to read this message again. So use a fast duration even
                        // though it's not accessible.
                        durationSeconds: 3,
                    },
                );
            } else if (accessPolicy.defaultGrant && !accessPolicy.urlGrant) {
                onAccessPolicyChange({type: "DeleteDefaultGrant"});
            } else if (!accessPolicy.defaultGrant && accessPolicy.urlGrant) {
                onAccessPolicyChange({type: "DeleteUrlGrant"});
            } else {
                assert(accessPolicy.defaultGrant && accessPolicy.urlGrant);
                onAccessPolicyChange({type: "DeleteDefaultGrantAndUrlGrant"});
            }
        },
    });

    const icon = accessPolicy.urlGrant
        ? ("Globe" as const)
        : accessPolicy.defaultGrant
        ? ("Buildings" as const)
        : ("Lock" as const);

    return (
        <FocusRing>
            <Box
                {...pressProps}
                tabIndex={0}
                role="button"
                aria-label={`Toggle sharing with everyone in ${space.name}`}
                aria-pressed={!!(accessPolicy.defaultGrant || accessPolicy.urlGrant)}
                width="12"
                backgroundColor={
                    {
                        // TODO: If `theme` is green we need a different color for the URL grant. Right
                        // now the theme color is always indigo so hard coding green is fine.
                        Globe: {light: "green-30-const", dark: "green-40-const"} as const,
                        Buildings: {light: "theme-40-const", dark: "theme-50-const"} as const,
                        Lock: {light: "grey-10-const", dark: "grey-50-const"} as const,
                    }[icon]
                }
                borderRadius="full"
                overflow="hidden"
                // We don't normally put cursor pointers on clickable things, but since this UI
                // pattern is a little novel we want to make it really clear to users that this
                // is a clickable switch.
                cursor={!isReadOnly ? "pointer" : undefined}
                style={{
                    // We want our switch knob to be spacing 6 size (to match the size of a `md`
                    // `<IconButton>` and fit a size 4 icon). But we also want 2px of color around
                    // the knob to make it feel like the knob is inset into the switch's well. So
                    // take 2px of size away from the knob and add 2px of size to the switch well
                    // so in total the knob is 4px smaller than the well giving us our border.
                    height: `calc(${spacing["6"]} + 2px)`,
                    margin: -1,
                    transition: "background-color 150ms linear",
                }}
            >
                <Box
                    borderRadius="full"
                    style={{
                        width: `calc(${spacing["6"]} + 2px)`,
                        height: `calc(${spacing["6"]} + 2px)`,
                        padding: 2,
                        transform:
                            accessPolicy.defaultGrant || accessPolicy.urlGrant
                                ? `translateX(calc(${spacing["6"]} - 2px))`
                                : undefined,
                        transition: "transform 150ms linear",
                    }}
                >
                    <Box
                        position="relative"
                        zIndex="0"
                        overflow="hidden"
                        backgroundColor="grey-0-const"
                        borderRadius="full"
                        color="grey-70-const"
                        style={{
                            height: `calc(${spacing["6"]} - 2px)`,
                            boxShadow: `${elevation["elevation-10"].light}`,
                            width: isPressed
                                ? `calc(${spacing["7"]} - 2px)`
                                : `calc(${spacing["6"]} - 2px)`,
                            transform:
                                isPressed && (accessPolicy.defaultGrant || accessPolicy.urlGrant)
                                    ? `translateX(-${spacing["1"]})`
                                    : undefined,
                            transition: "width 50ms linear, transform 50ms linear",
                        }}
                    >
                        <Box
                            position="absolute"
                            zIndex="0"
                            inset="0"
                            display="flex"
                            justifyContent="center"
                            alignItems="center"
                            backgroundColor="grey-0-const"
                        >
                            <Lock
                                size={spacing["4"]}
                                role="img"
                                aria-hidden={icon !== "Lock"}
                                aria-label={`Icon indicating the ${entityNoun} is private`}
                            />
                        </Box>
                        <Box
                            position="absolute"
                            zIndex="10"
                            inset="0"
                            display="flex"
                            justifyContent="center"
                            alignItems="center"
                            backgroundColor="grey-0-const"
                            opacity={icon !== "Lock" ? "100" : "0"}
                            style={{transition: "opacity 100ms linear"}}
                        >
                            <BuildingsIcon
                                size={spacing["4"]}
                                role="img"
                                aria-hidden={icon !== "Buildings"}
                                aria-label={`Icon indicating the ${entityNoun} is shared with everyone in ${space.name}`}
                            />
                        </Box>
                        <Box
                            position="absolute"
                            zIndex="20"
                            inset="0"
                            display="flex"
                            justifyContent="center"
                            alignItems="center"
                            backgroundColor="grey-0-const"
                            opacity={icon !== "Lock" && icon !== "Buildings" ? "100" : "0"}
                            style={{transition: "opacity 100ms linear"}}
                        >
                            <Globe
                                size={spacing["4"]}
                                role="img"
                                aria-hidden={icon !== "Globe"}
                                aria-label={`Icon indicating the ${entityNoun} is shared with anyone with the link`}
                            />
                        </Box>
                    </Box>
                </Box>
            </Box>
        </FocusRing>
    );
}
