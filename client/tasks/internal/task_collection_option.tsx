import {differenceInMonths, differenceInYears} from "date-fns";
import {SpinnerGap} from "phosphor-react";
import {useEffect, useState} from "react";
import {Box} from "~/client/design/box.js";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants.js";
import {useCurrentTimeRoundedToHour} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {getTaskCollectionColor} from "~/client/tasks/internal/task_collection_chip_base.js";
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
                    {getTaskCollectionLastUpdateTimeSummary(
                        collectionResult,
                        useCurrentTimeRoundedToHour(),
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

function getTaskCollectionLastUpdateTimeSummary(
    collectionResult: TaskCollectionModelSearchResult,
    currentTime: Date,
) {
    if (!collectionResult.lastTaskAddedTime) {
        const createdTime = new Date(collectionResult.collection.getCreatedTime()[0]);
        const years = differenceInYears(currentTime, createdTime);

        if (years === 1) {
            return "created 1 year ago";
        } else if (years > 1) {
            return `created ${years} year ago`;
        }

        const months = differenceInMonths(currentTime, createdTime);

        if (months === 1) {
            return "created 1 month ago";
        } else if (months > 1) {
            return `created ${months} months ago`;
        } else {
            return "created recently";
        }
    } else {
        const lastTaskAddedTime = new Date(collectionResult.lastTaskAddedTime[0]);

        const years = differenceInYears(currentTime, lastTaskAddedTime);

        if (years === 1) {
            return "last updated 1 year ago";
        } else if (years > 1) {
            return `last updated ${years} year ago`;
        }

        const months = differenceInMonths(currentTime, lastTaskAddedTime);

        if (months === 1) {
            return "last updated 1 month ago";
        } else if (months > 1) {
            return `last updated ${months} months ago`;
        } else {
            return "updated recently";
        }
    }
}
