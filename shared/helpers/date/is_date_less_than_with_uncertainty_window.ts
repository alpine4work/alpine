export const defaultUncertaintyWindowMs = 500;

/**
 * Returns true if `date1 < date2` within some uncertainty window.
 * This is a useful function for building backend distributed systems since we
 * can't guarantee clocks between processes are perfectly synchronized.
 *
 * [AWS Time Sync][1] (which is configured for our EC2 instances) should get us
 * synchronized time within a couple milliseconds but never perfect
 * synchronization.
 *
 * Uncertainty windows turn our times into ranges. So `date` becomes the
 * interval `[date.getTime() - uncertaintyWindowMs / 2, date.getTime() + uncertaintyWindowMs / 2]`.
 * Supposing the true time is somewhere in that interval. ([Good talk on time
 * in distributed systems][2]. Wait for the part where it talks about Google
 * Spanner's True Time.)
 *
 * This function checks if uncertainty interval for `date1` is completely lower
 * than the uncertainty interval for `date2`. If there's some overlap this
 * function returns false since the true time of `date1` may or may not be
 * grater than the true time of `date2`.
 *
 * Our uncertainty window defaults to 500ms which is the [default used by
 * CockroachDB][3]. It could be lower in AWS instances with AWS Time Sync. It's
 * a safe default. Generally you should only be calling this function in server
 * environments. Client clocks can't be trusted.
 *
 * [1]: https://aws.amazon.com/blogs/aws/keeping-time-with-amazon-time-sync-service/
 * [2]: https://www.youtube.com/watch?v=BRvj8PykSc4
 * [3]: https://www.cockroachlabs.com/docs/v21.2/operational-faqs#what-happens-when-node-clocks-are-not-properly-synchronized
 */
export function isDateLessThanWithUncertaintyWindow(
    date1: Date,
    date2: Date,
    // We default to a 500ms uncertainty window, but in tests use a 0ms uncertainty
    // window since everything happens on the same machine.
    uncertaintyWindowMs: number = process.env.NODE_ENV === "test" ? 0 : defaultUncertaintyWindowMs,
): boolean {
    return date1.getTime() + uncertaintyWindowMs / 2 < date2.getTime() - uncertaintyWindowMs / 2;
}
