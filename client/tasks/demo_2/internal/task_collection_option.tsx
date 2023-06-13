import {differenceInMonths, differenceInYears} from "date-fns";
import {SpinnerGap} from "phosphor-react";
import {useEffect, useState} from "react";
import {Box} from "~/client/design/box";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants";
import {useCurrentTimeRoundedToHour} from "~/client/remix/use_current_time_rounded_to_hour";
import {LocalTaskCollection} from "~/client/tasks/demo_2/local_tasks_state";
import {spacing} from "~/shared/design/spacing";
import {createTimeout} from "~/shared/helpers/async/timeout";
import {spinAnimationClassName} from "~/shared/styles/styles";

export function TaskCollectionOption({
    collection,
    isPending,
}: {
    collection: LocalTaskCollection;
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
                paddingX="0.5"
                display="flex"
                justifyContent="center"
                alignItems="center"
            >
                <Box
                    width="1.5"
                    height="1.5"
                    borderRadius="full"
                    backgroundColor={`${collection.color}-50-const`}
                />
            </Box>
            <Box flexGrow="1" overflow="hidden">
                <Box fontStyle="truncate">{collection.name}</Box>
                <Box fontSize="50" color="grey-40">
                    {getTaskCollectionTaskCountSummary(collection)},{" "}
                    {getTaskCollectionLastUpdateTimeSummary(
                        collection,
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

function getTaskCollectionTaskCountSummary(collection: LocalTaskCollection) {
    if (collection.taskCount === 0) {
        return "No tasks";
    } else if (collection.taskCount < 100) {
        return "Several tasks";
    } else if (collection.taskCount < 1000) {
        return "Hundreds of tasks";
    } else {
        return "Thousands of tasks";
    }
}

function getTaskCollectionLastUpdateTimeSummary(
    collection: LocalTaskCollection,
    currentTime: Date,
) {
    if (!collection.lastTaskAddedOrRemovedTimeRoundedToDay) {
        const years = differenceInYears(currentTime, collection.createdTime);

        if (years === 1) {
            return "created 1 year ago";
        } else if (years > 1) {
            return `created ${years} year ago`;
        }

        const months = differenceInMonths(currentTime, collection.createdTime);

        if (months === 1) {
            return "created 1 month ago";
        } else if (months > 1) {
            return `created ${months} months ago`;
        } else {
            return "created recently";
        }
    } else {
        const years = differenceInYears(
            currentTime,
            collection.lastTaskAddedOrRemovedTimeRoundedToDay,
        );

        if (years === 1) {
            return "last updated 1 year ago";
        } else if (years > 1) {
            return `last updated ${years} year ago`;
        }

        const months = differenceInMonths(
            currentTime,
            collection.lastTaskAddedOrRemovedTimeRoundedToDay,
        );

        if (months === 1) {
            return "last updated 1 month ago";
        } else if (months > 1) {
            return `last updated ${months} months ago`;
        } else {
            return "updated recently";
        }
    }
}
