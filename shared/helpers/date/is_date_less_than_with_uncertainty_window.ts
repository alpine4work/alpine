/**
 * We default to a 500ms uncertainty window, but in tests use a 0ms uncertainty
 * window since everything happens on the same machine.
 */
export const defaultUncertaintyWindowMs = process.env.NODE_ENV === "test" ? 0 : 500;

/**
 * Returns true if `date1 < date2` within some uncertainty window. This is a useful
 * function for building backend distributed systems since we can't guarantee
 * clocks between processes are perfectly synchronized.
 *
 * [AWS Time Sync][1] (which is configured for our EC2 instances) should get us
 * synchronized time within a couple milliseconds but never perfect
 * synchronization.
 *
 * Uncertainty windows turn our times into ranges. So `date` becomes the interval
 * `[date.getTime() - uncertaintyWindowMs / 2, date.getTime() + uncertaintyWindowMs / 2]`.
 * Supposing the true time is somewhere in that interval. ([Good talk on time in
 * distributed systems][2]. Wait for the part where it talks about Google Spanner's
 * True Time.)
 *
 * This function checks if uncertainty interval for `date1` is possibly lower than
 * the uncertainty interval for `date2`. If there's some overlap in date ranges
 * this function returns true.
 *
 * If you want to know that `date1` is definitely lower than `date2` you should use
 * `isDateDefinitelyLessThanWithUncertaintyWindow()`.
 *
 * Our uncertainty window defaults to 500ms which is the [default used by
 * CockroachDB][3]. It could be lower in AWS instances with AWS Time Sync. It's a
 * safe default. Generally you should only be calling this function in server
 * environments. Client clocks can't be trusted.
 *
 * If `date1` and `date2` are numbers then they should be in milliseconds.
 *
 * [1]:
 *     https://aws.amazon.com/blogs/aws/keeping-time-with-amazon-time-sync-service/
 * [2]: https://www.youtube.com/watch?v=BRvj8PykSc4
 * [3]:
 *     https://www.cockroachlabs.com/docs/v21.2/operational-faqs#what-happens-when-node-clocks-are-not-properly-synchronized
 */
export function isDatePossiblyLessThanWithUncertaintyWindow(
    date1: Date | number,
    date2: Date | number,
    uncertaintyWindowMs: number = defaultUncertaintyWindowMs,
): boolean {
    return (
        (typeof date1 !== "number" ? date1.getTime() : date1) - uncertaintyWindowMs / 2 <=
        (typeof date2 !== "number" ? date2.getTime() : date2) + uncertaintyWindowMs / 2
    );
}

/**
 * Returns true if `date1 < date2` is definitely true regardless of our uncertainty
 * window. This is a useful function for building backend distributed systems since
 * we can't guarantee clocks between processes are perfectly synchronized.
 *
 * This function checks if the uncertainty interval for `date1` is completely lower
 * than the uncertainty interval for `date2`. If there's some overlap this function
 * returns true because we don't definitely know that `date1` is less than `date2`.
 *
 * Generally when comparing times you don't want to be strict so you should use
 * `isDatePossiblyLessThanWithUncertaintyWindow()` which tells you if `date1` is
 * possibly less than `date2`. See that function's documentation for more
 * information on uncertainty windows in distributed systems.
 *
 * If `date1` and `date2` are numbers then they should be in milliseconds.
 */
export function isDateDefinitelyLessThanWithUncertaintyWindow(
    date1: Date | number,
    date2: Date | number,
    uncertaintyWindowMs: number = defaultUncertaintyWindowMs,
): boolean {
    return (
        (typeof date1 !== "number" ? date1.getTime() : date1) + uncertaintyWindowMs / 2 <
        (typeof date2 !== "number" ? date2.getTime() : date2) - uncertaintyWindowMs / 2
    );
}
