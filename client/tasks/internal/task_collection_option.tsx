import {SpinnerGap} from "phosphor-react";
import {useEffect, useState} from "react";
import {Box} from "~/client/design/box.js";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants.js";
import {useCurrentTimeRoundedToHour} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {getTaskCollectionColor} from "~/client/tasks/internal/task_collection_chip_base.js";
import {formatPrettyRelativeDateWithoutFullTimeTooltip} from "~/shared/design/format_pretty_relative_date_without_full_time_tooltip.js";
import {spacing} from "~/shared/design/spacing.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {spinAnimationClassName} from "~/shared/styles/styles.js";
import {TaskCollectionModelSearchResult} from "~/shared/tasks/model/task_collection_model_search_result.js";

export const taskCollectionOptionSecondaryTextColor = "grey-40" as const;

export function TaskCollectionOption({
    collectionResult,
    isPending,
}: {
    collectionResult: TaskCollectionModelSearchResult;
    isPending?: boolean;
}) {
    // We wait a bit before showing our pending spinner. Some actions are very fast so we
    // delay showing a spinner to avoid a loading spinner flicker which can be jarring.
    const [shouldShowPendingSpinner, setShouldShowPendingSpinner] = useState(false);
    useEffect(() => {
        if (!isPending) {
            setShouldShowPendingSpinner(false);
            return;
        }

        const timeout = createTimeout(() => {
            setShouldShowPendingSpinner(true);
        }, delayLoadingIndicatorLimitMs);
        return () => {
            timeout.clear();
        };
    }, [isPending]);

    // Only show the pending spinner if we are actually pending.
    if (!isPending && shouldShowPendingSpinner) setShouldShowPendingSpinner(false);

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
                    {getTaskCollectionTaskCountSummary(collectionResult)},{" "}
                    {!collectionResult.lastTaskAddedTime ? " created " : " updated "}
                    {formatPrettyRelativeDateWithoutFullTimeTooltip(
                        useCurrentTimeRoundedToHour(),
                        !collectionResult.lastTaskAddedTime
                            ? new Date(collectionResult.collection.getCreatedTime()[0])
                            : new Date(collectionResult.lastTaskAddedTime[0]),
                        "Weeks",
                    )}
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

function getTaskCollectionTaskCountSummary(collectionResult: TaskCollectionModelSearchResult) {
    if (collectionResult.openTaskCount === 0) {
        return "No tasks";
    } else if (collectionResult.openTaskCount < 100) {
        return "Several tasks";
    } else if (collectionResult.openTaskCount < 1000) {
        return "Hundreds of tasks";
    } else {
        return "Thousands of tasks";
    }
}
