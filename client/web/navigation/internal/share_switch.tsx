import {useState} from "react";
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {ShareSwitchBase} from "~/client/web/navigation/share_switch_base.js";
import {useAddGlobalLoadingIndicator} from "~/client/web/spaces/global_loading_indicator.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {AccessPolicyAction} from "~/shared/access/access_policy_action.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";

export function ShareSwitch({
    entityNoun,
    accessPolicy,
    onAccessPolicyChange: onAccessPolicyChangeFromProps,
    isReadOnly,
}: {
    entityNoun: string;
    accessPolicy: AccessPolicy;
    onAccessPolicyChange: (accessPolicy: AccessPolicyAction) => MaybePromise<void>;
    isReadOnly: boolean;
}) {
    const reporter = useReporter();
    const {space} = useSpaceContext();
    const addGlobalLoadingIndicator = useAddGlobalLoadingIndicator();

    const [
        showDeleteDefaultGrantOrUrlGrantConfirmationDialog,
        setShowDeleteDefaultGrantOrUrlGrantConfirmationDialog,
    ] = useState(false);

    // Our share switch doesn't have an inline loading indicator so use the
    // global loading indicator.
    //
    // TODO(calebmer): We should probably perform an optimistic update since
    // pressing the switch and then it doesn't move for a beat will feel weird.
    const onAccessPolicyChange = (accessPolicy: AccessPolicyAction) => {
        const promise = onAccessPolicyChangeFromProps(accessPolicy);

        if (!promise) return;

        addGlobalLoadingIndicator(promise, {type: "Saving"});

        promise.catch(error => {
            reporter.displayError(`Couldn\u2019t share ${entityNoun}`, error);
        });
    };

    const icon = showDeleteDefaultGrantOrUrlGrantConfirmationDialog
        ? // Optimistically show the lock icon while the "make entity private" confirmation dialog
          // is open.
          ("Lock" as const)
        : accessPolicy.urlGrant
          ? ("Globe" as const)
          : accessPolicy.defaultGrant
            ? ("Buildings" as const)
            : ("Lock" as const);

    return (
        <>
            <ShareSwitchBase
                entityNoun={entityNoun}
                icon={icon}
                isInert={isReadOnly}
                onPress={() => {
                    if (!accessPolicy.defaultGrant && !accessPolicy.urlGrant) {
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
                                // This message is short, appears a lot, and the user only really needs to read
                                // it once over the course of their lifetime with the product. Once the user
                                // learns what this switch does (ideally the first time they press the switch)
                                // they don't need to read this message again. So use a fast duration even
                                // though it's not accessible.
                                durationSeconds: 3,
                            },
                        );
                    } else {
                        // Ask the user to confirm when pressing the switch to make the entity private.
                        // We want to make it very easy to share the entity but un-sharing the entity
                        // should have a little friction so the user doesn't do it accidentally.
                        setShowDeleteDefaultGrantOrUrlGrantConfirmationDialog(true);
                    }
                }}
            />
            {showDeleteDefaultGrantOrUrlGrantConfirmationDialog && (
                <ModalDialog
                    title={`Make this ${entityNoun} private?`}
                    description={`${
                        accessPolicy.urlGrant ? `Anyone with the link` : `Everyone in ${space.name}`
                    } will no longer be able to access the ${entityNoun}.`}
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
        </>
    );
}
