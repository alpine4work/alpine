import {CalendarDate} from "@internationalized/date";
import murmurhash from "murmurhash";
import {stringifyForDeepEqualCheck} from "~/shared/helpers/control/stringify_for_deep_equal_check.open_source.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";

export const taskGridViewExpansionStateExpirationMonths = 4;

// After how many months should we renew expansion state expiration times?
//
// We renew expansion state items that are close to expiring if the user accesses
// them so we don't expire expansion states that are actively being used.
export const taskGridViewExpansionStateExpirationRenewalMonths = 2;

/**
 * Get the key we use for storing the expansion state of a grid view.
 *
 * Uniqueness is not guaranteed! We hash `filters` and `sorts` to avoid storing the
 * entire query definition. However as with any hash function collisions are very
 * unlikely but possible.
 *
 * For the purpose of grid view expansion state we find collisions acceptable given
 * expansion state is also partitioned by `SpaceId`, `AccountId`, and `BrowserId`.
 */
export function getTaskGridViewExpansionStateKey({
    filters,
    sorts,
}: {
    filters: TaskQueryNormalizedFilters;
    sorts: ReadonlyArray<TaskQueryNormalizedSort>;
}) {
    const queryKey = stringifyForDeepEqualCheck<CalendarDate>({filters, sorts}, date =>
        date.toString(),
    );

    const queryKeyMidpointIndex = Math.floor(queryKey.length / 2);

    const queryKey1 = queryKey.slice(0, queryKeyMidpointIndex);
    const queryKey2 = queryKey.slice(queryKeyMidpointIndex);

    // We use two hashes (one on the first half of the key, one on the second half) as
    // any easy way to reduce collision chance. However collisions are still not
    // impossible.
    //
    // Thread describing this issue:
    // https://contributors.scala-lang.org/t/murmur-hash-conflicts-when-hashing-many-items/1506
    const queryKeyHash1 = murmurhash.v3(queryKey1).toString(16).padStart(8, "0");
    const queryKeyHash2 = murmurhash.v3(queryKey2).toString(16).padStart(8, "0");

    return `${queryKeyHash1}${queryKeyHash2}`;
}
