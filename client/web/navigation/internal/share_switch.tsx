import {useState} from "react";
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useStateWithOptimisticUpdates} from "~/client/web/helpers/use_state_with_optimistic_updates.js";
import {InheritedAccessPolicyExplanations} from "~/client/web/navigation/inherited_access_policy_explanations.js";
import {ShareSwitchBase} from "~/client/web/navigation/share_switch_base.js";
import {useAddGlobalLoadingIndicator} from "~/client/web/spaces/global_loading_indicator.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {AccessPolicy, AccessPolicyWithoutGenerations} from "~/shared/access/access_policy.js";
import {AccessPolicyAction, reduceAccessPolicy} from "~/shared/access/access_policy_action.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";

export function ShareSwitch({
    entityNoun,
    accessPolicy: accessPolicyFromProps,
    inherited,
    onAccessPolicyChange: onAccessPolicyChangeFromProps,
    isReadOnly,
}: {
    entityNoun: string;
    accessPolicy: AccessPolicy;
    inherited?: {
        accessPolicy: AccessPolicyWithoutGenerations;
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
    if (accessPolicyWithoutOptimisticUpdates !== accessPolicyFromProps)
        setAccessPolicy(() => accessPolicyFromProps);

    const [
        showDeleteDefaultGrantOrUrlGrantConfirmationDialog,
        setShowDeleteDefaultGrantOrUrlGrantConfirmationDialog,
    ] = useState(false);

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
    const onAccessPolicyChange = (action: AccessPolicyAction) => {
        if (!currentAccount) return;

        const promise = onAccessPolicyChangeFromProps(action);

        if (!promise) return;

        setAccessPolicyOptimistically(promise, accessPolicy =>
            reduceAccessPolicy(currentAccount.id, accessPolicy, action),
        );

        addGlobalLoadingIndicator(promise, {type: "Saving"});

        promise.catch(error => {
            reporter.displayError(`Couldn\u2019t share ${entityNoun}`, error);
        });
    };

    const icon = showDeleteDefaultGrantOrUrlGrantConfirmationDialog
        ? // Optimistically show the lock icon while the "make entity private" confirmation
          // dialog is open.
          ("Lock" as const)
        : accessPolicy.urlGrant || inherited?.accessPolicy.urlGrant
          ? ("Globe" as const)
          : accessPolicy.defaultGrant || inherited?.accessPolicy.defaultGrant
            ? ("Buildings" as const)
            : ("Lock" as const);

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
                        // parent task). Let the user know this.
                        setShowCanNotDeleteInheritedDefaultGrantOrUrlGrantDialog(true);
                        return;
                    }

                    if (accessPolicy.defaultGrant || accessPolicy.urlGrant) {
                        // Ask the user to confirm when pressing the switch to make the entity private. We
                        // want to make it very easy to share the entity but un-sharing the entity should
                        // have a little friction so the user doesn't do it accidentally.
                        setShowDeleteDefaultGrantOrUrlGrantConfirmationDialog(true);
                        return;
                    }

                    onAccessPolicyChange({
                        type: "AddDefaultGrant",
                        defaultGrant: {level: "Manage"},
                    });

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
            {showDeleteDefaultGrantOrUrlGrantConfirmationDialog && (
                <ModalDialog
                    title={`Make this ${entityNoun} private?`}
                    description={`${
                        accessPolicy.urlGrant ? `Anyone with the link` : `Everyone in ${space.name}`
                    } won\u2019t be able to access the ${entityNoun} anymore.`}
                    primaryButtonLabel="Confirm"
                    onPrimaryButtonPress={() => {
                        if (!accessPolicy.defaultGrant && !accessPolicy.urlGrant) {
                            // Noop
                        } else if (accessPolicy.defaultGrant && !accessPolicy.urlGrant) {
                            onAccessPolicyChange({type: "DeleteDefaultGrant"});
                        } else if (!accessPolicy.defaultGrant && accessPolicy.urlGrant) {
                            onAccessPolicyChange({type: "DeleteUrlGrant"});
                        } else {
                            assert(accessPolicy.defaultGrant && accessPolicy.urlGrant);
                            onAccessPolicyChange({type: "DeleteDefaultGrantAndUrlGrant"});
                        }
                    }}
                    onClose={() => setShowDeleteDefaultGrantOrUrlGrantConfirmationDialog(false)}
                />
            )}
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
