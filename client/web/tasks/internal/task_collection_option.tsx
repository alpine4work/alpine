import {SpinnerGap} from "phosphor-react";
import {useMemo} from "react";
import {Box} from "~/client/web/design/box.js";
import {useDelayLoadingIndicator} from "~/client/web/design/use_delay_loading_indicator.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {LockBoldFillIcon} from "~/client/web/icons/lock_bold_fill_icon.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {useCurrentTimeRoundedToHour} from "~/client/web/remix/use_current_time_rounded_to_hour.js";
import {useSiteRegistry} from "~/client/web/sites/site_registry_context.js";
import {getTaskCollectionColor} from "~/client/web/styles/get_task_collection_color.js";
import {spinAnimationClassName, sprinkles} from "~/client/web/styles/styles.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {ConstStore} from "~/shared/store/const_store.js";
import {TaskCollectionModelSearchResult} from "~/shared/tasks/model/task_collection_model_search_result.js";
import {printTaskCollectionSearchResultBodyTextSnippet} from "~/shared/tasks/print_task_collection_search_result_body_text_snippet.js";

export const taskCollectionOptionSecondaryTextColor = "grey-40";

export function TaskCollectionOption({
    collectionResult,
    isPending = false,
    withoutSnippet,
}: {
    collectionResult: TaskCollectionModelSearchResult;
    isPending?: boolean;
    withoutSnippet?: boolean;
}) {
    const {timeZone} = useClientInfo();
    const siteRegistry = useSiteRegistry();

    const currentTime = useCurrentTimeRoundedToHour();

    // We wait a bit before showing our pending spinner. Some actions are very fast so
    // we delay showing a spinner to avoid a loading spinner flicker which can be
    // jarring.
    const shouldShowPendingSpinner = useDelayLoadingIndicator(isPending);

    const isPrivate = useStore(
        useMemo(() => {
            const accessPolicy = collectionResult.collection.getAccessPolicy();

            switch (accessPolicy.type) {
                case "Local": {
                    assert(!collectionResult.referencedAccessPolicySite);
                    return new ConstStore(!accessPolicy.defaultGrant);
                }
                case "Site": {
                    assert(collectionResult.referencedAccessPolicySite?.id === accessPolicy.siteId);
                    const siteStore = siteRegistry.getSiteStore(
                        collectionResult.referencedAccessPolicySite,
                    );
                    return siteStore.map(site => !site.accessPolicy.defaultGrant);
                }
                default:
                    throw exhaustive(accessPolicy);
            }
        }, [
            collectionResult.collection,
            collectionResult.referencedAccessPolicySite,
            siteRegistry,
        ]),
    );

    return (
        <Box flexGrow="1" overflow="hidden" display="flex" alignItems="flex-start" gap="1.5">
            <Box
                flexShrink="0"
                height="4"
                paddingLeft="1"
                paddingRight="0.5"
                display="flex"
                justifyContent="center"
                alignItems="center"
            >
                <Box
                    width="1.5"
                    height="1.5"
                    borderRadius="full"
                    backgroundColor={getTaskCollectionColor(collectionResult.collection.getColor())}
                />
            </Box>
            <Box flexGrow="1" overflow="hidden">
                <Box display="flex" alignItems="center" gap="1">
                    {isPrivate && (
                        <LockBoldFillIcon
                            size={spacing["2.5"]}
                            aria-label="Private lock icon"
                            className={sprinkles({flexShrink: "0", fill: "grey-80"})}
                        />
                    )}
                    <Box fontStyle="truncate">{collectionResult.collection.getName()}</Box>
                </Box>
                {!withoutSnippet && (
                    <Box fontSize="50" color={taskCollectionOptionSecondaryTextColor}>
                        {printTaskCollectionSearchResultBodyTextSnippet({
                            timeZone,
                            currentTime,
                            createdTime: new Date(collectionResult.collection.getCreatedTime()[0]),
                            lastTaskAddedTime: collectionResult.lastTaskAddedTime
                                ? new Date(collectionResult.lastTaskAddedTime[0])
                                : null,
                            openTaskCount: collectionResult.openTaskCount,
                        })}
                    </Box>
                )}
            </Box>
            {shouldShowPendingSpinner && (
                <Box alignSelf="center" flexShrink="0" marginLeft="0.5">
                    <SpinnerGap className={spinAnimationClassName} size={spacing["4"]} />
                </Box>
            )}
        </Box>
    );
}
