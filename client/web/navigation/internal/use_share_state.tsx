import {useId, useMemo, useState} from "react";
import {useAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {InheritedAccessPolicyExplanations} from "~/client/web/navigation/inherited_access_policy_explanations.js";
import {useRevalidateOnAccessPolicySiteChange} from "~/client/web/sites/helpers/use_revalidate_on_access_policy_site_change.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {
    AccessLevel,
    EffectiveAccessPolicy,
    ResolvedAccessPolicyWithGenerations,
    compareAccessLevel,
    getAccountAccessLevelAssumingSpaceAccess,
    hasAccessLevel,
    isSiteRelatedAccessPolicyUpdate,
    maxAccessLevel,
    validateAccessPolicyUpdate,
} from "~/shared/access/access_policy.js";
import {AccessPolicyAction, reduceAccessPolicy} from "~/shared/access/access_policy_action.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {joinPrettyConjunctionList} from "~/shared/design/join_pretty_conjunction_list.js";
import {InternalError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

/**
 * Implements shared logic around changing the access policy. Mainly runs
 * validations on access policy changes and opens a confirmation modal dialog if a
 * warning is generated.
 */
export function useShareState(
    props: {
        entityNoun: string;
        accessLevelText: Record<AccessLevel, string>;
        accessPolicy: ResolvedAccessPolicyWithGenerations;
        inherited?: {
            accessPolicy: EffectiveAccessPolicy;
            explanations: InheritedAccessPolicyExplanations;
        };
        onAccessPolicyChangeWithoutValidations: (
            // The `notification` argument comes first to make it harder for the implementation
            // of this function to ignore the `notification` argument.
            notification: ShareNotification | null,
            accessPolicy: ResolvedAccessPolicyWithGenerations,
        ) => MaybePromise<void>;
        isReadOnly?: boolean;
    } | null,
) {
    const {space, currentAccount} = useSpaceContext();
    const accountRegistry = useAccountRegistry();
    useRevalidateOnAccessPolicySiteChange(props?.accessPolicy ?? null);

    const modalOwnerId = useId();

    // The share button must be read-only if we don't have the `Manage` access level.
    // Parent components may additionally make other considerations when deciding if
    // the share button is read-only.
    //
    // For example, in documents the `accessPolicy` prop is optimistic. If the
    // persisted `accessPolicy` doesn't have the `Manage` access level then we want the
    // share dialog to be read-only.
    const isReadOnly = useMemo(() => {
        if (props?.isReadOnly) return true;

        const accessPolicy = props?.accessPolicy;
        const inheritedAccessPolicy = props?.inherited?.accessPolicy;
        const currentAccountId = currentAccount?.id;
        if (!accessPolicy || !currentAccountId) return true;

        const accessLevel = maxAccessLevel(
            getAccountAccessLevelAssumingSpaceAccess(accessPolicy, currentAccountId),
            inheritedAccessPolicy
                ? getAccountAccessLevelAssumingSpaceAccess(inheritedAccessPolicy, currentAccountId)
                : null,
        );

        return !hasAccessLevel(accessLevel, "Manage");
    }, [
        currentAccount?.id,
        props?.accessPolicy,
        props?.inherited?.accessPolicy,
        props?.isReadOnly,
    ]);

    const [warningDialogState, setWarningDialogState] = useState<{
        readonly title: string;
        readonly description: string;
        readonly isAllowed: boolean;
        readonly currentAccountId: AccountId;
        readonly action: AccessPolicyAction;
    } | null>(null);
    if (warningDialogState && !props) setWarningDialogState(null);

    const changeAccessPolicy = (
        action: AccessPolicyAction,
        notification: ShareNotification | null = null,
    ): MaybePromise<void> => {
        // Defend against making changes while read only. Ultimately the backend should
        // prevent invalid changes like this but it's nice to catch errors like this early.
        if (isReadOnly || !props) {
            throw new InternalError(
                "Can\u2019t update access policy when share button is read only",
            );
        }

        if (!currentAccount) return;

        const {
            accessLevelText,
            entityNoun,
            accessPolicy: oldAccessPolicy,
            onAccessPolicyChangeWithoutValidations,
        } = props;

        const newAccessPolicy = reduceAccessPolicy(currentAccount.id, oldAccessPolicy, action);

        let changedAccountName: string | undefined;
        let changeDescription: string;
        switch (action.type) {
            case "AddAccountGrants": {
                if (action.accountGrantById.size === 1) {
                    changedAccountName = getAccountShortNameWithoutFullNameTooltip(
                        (action.accountGrantById.size === 1
                            ? accountRegistry
                                  .weakGetAccountStoreByIdIfExists(
                                      iterableFirst(action.accountGrantById)![0],
                                  )
                                  ?.getSnapshot()
                            : null) ?? AccountModel.getUnknownData(),
                    );
                }

                changeDescription = `give ${
                    changedAccountName ?? "these people"
                } access to the ${entityNoun}`;
                break;
            }
            case "DeleteAccountGrant": {
                changedAccountName = getAccountShortNameWithoutFullNameTooltip(
                    accountRegistry
                        .weakGetAccountStoreByIdIfExists(action.accountId)
                        ?.getSnapshot() ?? AccountModel.getUnknownData(),
                );

                changeDescription = `remove ${
                    currentAccount.id === action.accountId ? "your" : `${changedAccountName}\u2019s`
                } access to the ${entityNoun}`;
                break;
            }
            case "SetAccountGrantLevel": {
                changedAccountName = getAccountShortNameWithoutFullNameTooltip(
                    accountRegistry
                        .weakGetAccountStoreByIdIfExists(action.accountId)
                        ?.getSnapshot() ?? AccountModel.getUnknownData(),
                );

                changeDescription = `change ${
                    currentAccount.id === action.accountId ? "your" : `${changedAccountName}\u2019s`
                } access to the ${entityNoun} to \u201C${accessLevelText[action.level]}\u201D`;
                break;
            }
            case "AddDefaultGrant": {
                changeDescription = `change everyone in ${
                    space.name
                }\u2019s access to the ${entityNoun} to \u201C${accessLevelText[action.defaultGrant.level]}\u201D`;
                break;
            }
            // `DeleteDefaultGrantAndUrlGrant` uses the same language as `DeleteDefaultGrant`
            // since we'll generally only show this message for warnings where changing the
            // default grant matters.
            case "DeleteDefaultGrant":
            case "DeleteDefaultGrantAndUrlGrant": {
                changeDescription = `remove everyone in ${space.name}\u2019s access to the ${entityNoun}`;
                break;
            }
            case "SetDefaultGrantLevel": {
                changeDescription = `change everyone in ${
                    space.name
                }\u2019s access to the ${entityNoun} to \u201C${accessLevelText[action.level]}\u201D`;
                break;
            }
            case "AddUrlGrant": {
                changeDescription = `change anyone with the link\u2019s access to the ${entityNoun} to \u201C${
                    accessLevelText[action.urlGrant.level]
                }\u201D`;
                break;
            }
            case "DeleteUrlGrant": {
                changeDescription = `remove anyone with the link\u2019s access to the ${entityNoun}`;
                break;
            }
            case "SetUrlGrantLevel": {
                changeDescription = `change anyone with the link\u2019s access to the ${entityNoun} to \u201C${
                    accessLevelText[action.level]
                }\u201D`;
                break;
            }
            default:
                throw exhaustive(action);
        }

        const shouldCheckForRemovedAccounts =
            isSiteRelatedAccessPolicyUpdate(oldAccessPolicy, newAccessPolicy) &&
            newAccessPolicy.type === "Site";

        const validationResult = validateAccessPolicyUpdate(
            currentAccount.id,
            oldAccessPolicy,
            newAccessPolicy,
            {
                // On the server, we have to perform database roundtrips in order to determine if
                // an account is a member of a space, so we only check for removed accounts when
                // adding an entity to a site. The reasoning is that if an early generation manager
                // is removed from a space, it would make it really difficult for everyone else to
                // add content to the site. For Local access policy updates, this does mean that
                // accounts at lower generations can't remove the access of removed accounts, but
                // that seems reasonable.
                //
                // So given the following scenario:
                //
                // ```
                // old: [alice-1, bob-2 (removed), charlie-2] -> [{alice}, {bob, charlie}]
                // new: [alice-1, charlie-3] -> [{alice}, {charlie}]
                // ```
                //
                // Charlie can add the document (old access policy) to the site.
                isAccountRemovedFromSpace: shouldCheckForRemovedAccounts
                    ? accountId => {
                          const account = accountRegistry
                              .weakGetAccountStoreByIdIfExists(accountId)
                              ?.getSnapshot();

                          // NOTE(ifitzsimmons, 2026-06-05): We should have all of the space accounts in the
                          // account registry. If we don't find one, we should bias toward being overly
                          // permissive on the client and pretending the account is removed, which will omit
                          // that account from validation.
                          //
                          // So if an account is missing in the registry and it's not actually removed:
                          //
                          // 1. We'll allow the access policy change to proceed optimistically.
                          // 2. The server will handle the account properly. If it blocks the change, the
                          //    access policy change will fail and be reverted.
                          if (!account) return true;

                          return account.space.state.type === "Removed";
                      }
                    : undefined,
            },
        );
        if (!validationResult.ok) {
            let title: string;
            let description: string;

            switch (validationResult.reason) {
                // It shouldn't be possible for the share overlay component to create one of these
                // changes. So throw an internal error if we see one of these reasons.
                case "Can\u2019t set new account grant manage generation to be less than or equal to our actor\u2019s manage generation":
                case "Can\u2019t reorder manage grant generations":
                case "Can\u2019t set new default grant manage generation to be less than or equal to our actor\u2019s manage generation": {
                    throw new InternalError(
                        `Share overlay made an invalid change: ${validationResult.reason}`,
                    );
                }

                case "Can\u2019t revoke manage access from an account with a manage generation less than our actor": {
                    title = `Can\u2019t change ${
                        changedAccountName ? `${changedAccountName}\u2019s` : "their"
                    } permissions`;

                    // We use "they" to refer to the change description because we assume this error
                    // only happens when we either remove an account grant or change an account grant's
                    // level. In both cases we include the name of the account whose permissions we're
                    // changing in `changeDescription`.
                    description = `You can\u2019t change the permissions of someone who was involved in adding you to the ${entityNoun}. So you can\u2019t ${changeDescription}. Try asking whoever added ${
                        changedAccountName ?? "them"
                    } to the ${entityNoun} to change their permissions.`;
                    break;
                }

                case "Can\u2019t update access policy so that no one has manage access": {
                    title = "Can\u2019t remove everyone who can change permissions";
                    description = `If you ${changeDescription} then there won\u2019t be anyone who can change permissions of the ${entityNoun} anymore. Try adding more people with \u201C${props.accessLevelText.Manage}\u201D access.`;
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
                    description: `If you ${changeDescription} then you won\u2019t be able to ${joinedPermissionDescriptions} the ${entityNoun} anymore. You can\u2019t undo this change.`,
                    isAllowed: true,
                    currentAccountId: currentAccount.id,
                    action,
                });
                return;
            }
        }

        return onAccessPolicyChangeWithoutValidations(notification, newAccessPolicy);
    };

    return {
        changeAccessPolicy,
        isReadOnly,
        modalOwnerId,
        modals: warningDialogState ? (
            warningDialogState.isAllowed ? (
                <ModalDialog
                    data-ownedby={modalOwnerId}
                    title={warningDialogState.title}
                    description={warningDialogState.description}
                    primaryButtonLabel="Cancel"
                    onPrimaryButtonPress={() => setWarningDialogState(null)}
                    cancelButtonLabel="I understand, make this change"
                    cancelButtonPressErrorTitle="Couldn&#x2019;t make this change"
                    onCancelButtonPress={() => {
                        if (!props) return;

                        return props.onAccessPolicyChangeWithoutValidations(
                            null,
                            reduceAccessPolicy(
                                warningDialogState.currentAccountId,
                                props.accessPolicy,
                                warningDialogState.action,
                            ),
                        );
                    }}
                    onClose={() => setWarningDialogState(null)}
                />
            ) : (
                <ModalDialog
                    data-ownedby={modalOwnerId}
                    title={warningDialogState.title}
                    description={warningDialogState.description}
                    primaryButtonLabel="Ok"
                    onPrimaryButtonPress={() => setWarningDialogState(null)}
                    shouldHideCancelButton={true}
                    onClose={() => setWarningDialogState(null)}
                />
            )
        ) : null,
    };
}
