import {useCallback, useState} from "react";
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useStateWithOptimisticUpdates} from "~/client/web/helpers/use_state_with_optimistic_updates.js";
import {InheritedAccessPolicyExplanations} from "~/client/web/navigation/inherited_access_policy_explanations.js";
import {ShareSwitchBase} from "~/client/web/navigation/share_switch_base.js";
import {useAddGlobalLoadingIndicator} from "~/client/web/spaces/global_loading_indicator.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {
    EffectiveAccessPolicy,
    ResolvedAccessPolicyWithGenerations,
} from "~/shared/access/access_policy.js";
import {AccessPolicyAction, reduceAccessPolicy} from "~/shared/access/access_policy_action.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

type ShareSwitchAccessPolicyAction = AccessPolicyAction & {
    type:
        | "AddDefaultGrant"
        | "DeleteDefaultGrant"
        | "DeleteUrlGrant"
        | "DeleteDefaultGrantAndUrlGrant";
};

type PendingAccessPolicyAction =
    | {
          accessPolicyType: "Local";
          // For local access policies, we don't show a modal when making them public, so
          // there is no pending action for that invariant
          action: Exclude<ShareSwitchAccessPolicyAction, {type: "AddDefaultGrant"}>;
      }
    | {
          accessPolicyType: "Site";
          action: ShareSwitchAccessPolicyAction;
      };

export function ShareSwitch({
    entityNoun,
    accessPolicy: accessPolicyFromProps,
    inherited,
    onAccessPolicyChange: onAccessPolicyChangeFromProps,
    isReadOnly,
}: {
    entityNoun: string;
    accessPolicy: ResolvedAccessPolicyWithGenerations;
    inherited?: {
        accessPolicy: EffectiveAccessPolicy;
        explanations: InheritedAccessPolicyExplanations;
    };
    onAccessPolicyChange: (accessPolicy: AccessPolicyAction) => MaybePromise<void>;
    isReadOnly: boolean;
}) {
    const reporter = useReporter();
    const {space, currentAccount} = useSpaceContext();
    const addGlobalLoadingIndicator = useAddGlobalLoadingIndicator();

    const [
        accessPolicy,
        setAccessPolicy,
        setAccessPolicyOptimistically,
        accessPolicyWithoutOptimisticUpdates,
    ] = useStateWithOptimisticUpdates(accessPolicyFromProps);

    // Make sure the base access policy in state is always the value from our props.
    if (accessPolicyWithoutOptimisticUpdates !== accessPolicyFromProps) {
        setAccessPolicy(() => accessPolicyFromProps);
    }

    // Action the user is being asked to confirm. We track the polic `type` alongside
    // the action so we know which confirmation dialog to render: a `Local` policy gets
    // the standard "make private" dialog, while a `Site` policy gets a dialog that
    // warns the user they're changing permissions for the entire site.
    const [pendingAccessPolicyAction, setPendingAccessPolicyAction] =
        useState<PendingAccessPolicyAction | null>(null);

    const [
        showCanNotDeleteInheritedDefaultGrantOrUrlGrantDialog,
        setShowCanNotDeleteInheritedDefaultGrantOrUrlGrantDialog,
    ] = useState(false);

    if (showCanNotDeleteInheritedDefaultGrantOrUrlGrantDialog && !inherited)
        setShowCanNotDeleteInheritedDefaultGrantOrUrlGrantDialog(false);

    // Our share switch doesn't have an inline loading indicator so use the global
    // loading indicator.
    //
    // TODO(calebmer): We should probably perform an optimistic update since pressing
    // the switch and then it doesn't move for a beat will feel weird.
    const onAccessPolicyChange = useCallback(
        (action: AccessPolicyAction) => {
            if (!currentAccount) return;

            const promise = onAccessPolicyChangeFromProps(action);

            if (!promise) return;

            setAccessPolicyOptimistically(promise, accessPolicy => {
                return reduceAccessPolicy(currentAccount.id, accessPolicy, action);
            });

            addGlobalLoadingIndicator(promise, {type: "Saving"});

            promise.catch(error => {
                reporter.displayError(`Couldn\u2019t share ${entityNoun}`, error);
            });
        },
        [
            currentAccount,
            onAccessPolicyChangeFromProps,
            setAccessPolicyOptimistically,
            addGlobalLoadingIndicator,
            reporter,
            entityNoun,
        ],
    );

    const icon = pendingAccessPolicyAction
        ? // Optimistically show the appropriate icon while the confirmation dialog is open.
          getIconForPendingAccessPolicyAction(pendingAccessPolicyAction)
        : accessPolicy.urlGrant || inherited?.accessPolicy.urlGrant
          ? ("Globe" as const)
          : accessPolicy.defaultGrant || inherited?.accessPolicy.defaultGrant
            ? ("Buildings" as const)
            : ("Lock" as const);

    const renderPendingAccessPolicyConfirmationModalIfNecessary = useCallback(() => {
        if (!pendingAccessPolicyAction) return null;

        const {title, description} = getPendingAccessPolicyConfirmationModalTitleAndDescription({
            pendingAccessPolicyAction,
            entityNoun,
            currentAccessPolicy: accessPolicy,
            space,
        });
        return (
            <ModalDialog
                title={title}
                description={description}
                primaryButtonLabel="Confirm"
                onPrimaryButtonPress={() => {
                    onAccessPolicyChange(pendingAccessPolicyAction.action);
                }}
                onClose={() => setPendingAccessPolicyAction(null)}
            />
        );
    }, [pendingAccessPolicyAction, entityNoun, accessPolicy, space, onAccessPolicyChange]);

    return (
        <>
            <ShareSwitchBase
                entityNoun={entityNoun}
                icon={icon}
                isInert={isReadOnly || !currentAccount}
                onPress={() => {
                    if (inherited?.accessPolicy.urlGrant || inherited?.accessPolicy.defaultGrant) {
                        // We can't delete inherited default grants or URL grants since they're not set on
                        // our current entity but rather some referenced entity (e.g. a task collection or
                        // parent task or a Site document). Let the user know this.
                        setShowCanNotDeleteInheritedDefaultGrantOrUrlGrantDialog(true);
                        return;
                    }

                    // The action the switch press implies: delete the existing grants to make the
                    // entity private, or add a default grant to make the entity shared.
                    const action = getNextAccessPolicyAction(accessPolicy);

                    if (accessPolicy.type === "Site") {
                        // The access policy lives on the site, so any toggle affects every entity in the
                        // site. Confirm with the user before making the change.
                        setPendingAccessPolicyAction({accessPolicyType: "Site", action});
                        return;
                    }

                    if (action.type !== "AddDefaultGrant") {
                        // Ask the user to confirm when pressing the switch to make the entity private. We
                        // want to make it very easy to share the entity but un-sharing the entity should
                        // have a little friction so the user doesn't do it accidentally.
                        setPendingAccessPolicyAction({accessPolicyType: "Local", action});
                        return;
                    }

                    // The entity does not belong to a site, and the action makes the entity public.
                    onAccessPolicyChange(action);

                    reporter.showInfoToast(
                        <>
                            Shared the {entityNoun} with everyone in{" "}
                            <span className={sprinkles({fontStyle: "semi-bold"})}>
                                {space.name}
                            </span>
                        </>,
                        {
                            // This message is short, appears a lot, and the user only really needs to read it
                            // once over the course of their lifetime with the product. Once the user learns
                            // what this switch does (ideally the first time they press the switch) they don't
                            // need to read this message again. So use a fast duration even though it's not
                            // accessible.
                            durationSeconds: 3,
                        },
                    );
                }}
            />
            {renderPendingAccessPolicyConfirmationModalIfNecessary()}
            {showCanNotDeleteInheritedDefaultGrantOrUrlGrantDialog && inherited && (
                <ModalDialog
                    title={`Can\u2019t make this ${entityNoun} private`}
                    description={
                        icon === "Globe"
                            ? inherited.explanations.DeleteUrlGrant()
                            : inherited.explanations.DeleteDefaultGrant()
                    }
                    shouldHideCancelButton={true}
                    primaryButtonLabel="Ok"
                    onPrimaryButtonPress={() =>
                        setShowCanNotDeleteInheritedDefaultGrantOrUrlGrantDialog(false)
                    }
                    onClose={() => setShowCanNotDeleteInheritedDefaultGrantOrUrlGrantDialog(false)}
                />
            )}
        </>
    );
}

function getPendingAccessPolicyConfirmationModalTitleAndDescription({
    pendingAccessPolicyAction,
    entityNoun,
    currentAccessPolicy,
    space,
}: {
    pendingAccessPolicyAction: PendingAccessPolicyAction;
    entityNoun: string;
    currentAccessPolicy: ResolvedAccessPolicyWithGenerations;
    space: SpaceModel;
}): {title: string; description: string} {
    const isPendingMakePrivate = pendingAccessPolicyAction.action.type !== "AddDefaultGrant";

    switch (pendingAccessPolicyAction.accessPolicyType) {
        case "Local": {
            assert(isPendingMakePrivate);
            return {
                title: `Make this ${entityNoun} private?`,
                description: `${
                    currentAccessPolicy.urlGrant
                        ? `Anyone with the link`
                        : `Everyone in ${space.name}`
                } won\u2019t be able to access the ${entityNoun} anymore.`,
            };
        }
        case "Site": {
            if (isPendingMakePrivate) {
                return {
                    title: "Make the entire site private?",
                    description: `Permissions for this ${entityNoun} are managed at the site level. If you make this change, ${
                        currentAccessPolicy.urlGrant
                            ? "anyone with the link"
                            : `everyone in ${space.name}`
                    } won\u2019t be able to access the site anymore.`,
                };
            }

            return {
                title: "Share the entire site?",
                description: `Permissions for this ${entityNoun} are managed at the site level. Sharing this will give everyone in ${space.name} access to the entire site, not just this ${entityNoun}.`,
            };
        }
        default:
            throw exhaustive(pendingAccessPolicyAction);
    }
}

/**
 * When the user presses the toggle, they are making the access policy public or
 * private depending on the current state. This function takes the current access
 * policy and returns the access policy action that will make the next access
 * policy the opposite of the current access policy.
 */
function getNextAccessPolicyAction(
    currentAccessPolicy: ResolvedAccessPolicyWithGenerations,
): ShareSwitchAccessPolicyAction {
    if (currentAccessPolicy.defaultGrant && currentAccessPolicy.urlGrant) {
        return {type: "DeleteDefaultGrantAndUrlGrant"};
    }

    if (currentAccessPolicy.defaultGrant) {
        return {type: "DeleteDefaultGrant"};
    }

    if (currentAccessPolicy.urlGrant) {
        return {type: "DeleteUrlGrant"};
    }

    return {type: "AddDefaultGrant", defaultGrant: {level: "Manage"}};
}

function getIconForPendingAccessPolicyAction(
    pendingAccessPolicyAction: PendingAccessPolicyAction,
): "Lock" | "Globe" | "Buildings" {
    switch (pendingAccessPolicyAction.action.type) {
        case "AddDefaultGrant":
            return "Buildings";
        case "DeleteDefaultGrant":
        case "DeleteUrlGrant":
        case "DeleteDefaultGrantAndUrlGrant":
            return "Lock";
        default:
            throw exhaustive(pendingAccessPolicyAction.action);
    }
}
