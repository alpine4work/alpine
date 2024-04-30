import {SpinnerGap} from "phosphor-react";
import {Box} from "~/client/design/box.js";
import {useDelayLoadingIndicator} from "~/client/design/use_delay_loading_indicator.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useCurrentTimeRoundedToHour} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {spacing} from "~/shared/design/spacing.js";
import {getTaskCollectionColor} from "~/shared/styles/get_task_collection_color.js";
import {spinAnimationClassName} from "~/shared/styles/styles.js";
import {TaskCollectionModelSearchResult} from "~/shared/tasks/model/task_collection_model_search_result.js";
import {printTaskCollectionSearchResultBodyTextSnippet} from "~/shared/tasks/print_task_collection_search_result_body_text_snippet.js";

export const taskCollectionOptionSecondaryTextColor = "grey-40" as const;

export function TaskCollectionOption({
    collectionResult,
    isPending = false,
}: {
    collectionResult: TaskCollectionModelSearchResult;
    isPending?: boolean;
}) {
    const {timeZone} = useClientInfo();

    // We wait a bit before showing our pending spinner. Some actions are very fast so we
    // delay showing a spinner to avoid a loading spinner flicker which can be jarring.
    const shouldShowPendingSpinner = useDelayLoadingIndicator(isPending);

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
                <Box fontStyle="truncate">{collectionResult.collection.getName()}</Box>
                <Box fontSize="50" color={taskCollectionOptionSecondaryTextColor}>
                    {printTaskCollectionSearchResultBodyTextSnippet({
                        timeZone,
                        currentTime: useCurrentTimeRoundedToHour(),
                        createdTime: new Date(collectionResult.collection.getCreatedTime()[0]),
                        lastTaskAddedTime: collectionResult.lastTaskAddedTime
                            ? new Date(collectionResult.lastTaskAddedTime[0])
                            : null,
                        openTaskCount: collectionResult.openTaskCount,
                    })}
                </Box>
            </Box>
            {shouldShowPendingSpinner && (
                <Box alignSelf="center" flexShrink="0" marginLeft="0.5">
                    <SpinnerGap className={spinAnimationClassName} size={spacing["4"]} />
                </Box>
            )}
        </Box>
    );
}
