/**
 * Evaluate the `If-Range` precondition against a Cloudflare R2 object (RFC 7233
 * §3.2).
 *
 * Returns `true` if the range should be applied. Returns `false` if the validator
 * does not match and the `Range` header should be ignored.
 */
export function isIfRangeConditionSatisfied(
    object: {httpEtag: string; uploaded: Date},
    ifRange: string,
): boolean {
    // An ETag validator starts with an ASCII double-quote. Weak ETags
    // (`W/"..."`) are never valid in `If-Range`, so they will never
    // equal a strong ETag and therefore always fail the comparison.
    // eslint-disable-next-line cyberworlds/string-quotes
    if (ifRange.startsWith('"')) {
        return ifRange === object.httpEtag;
    }

    // Treat everything else as an HTTP-date. If-Range uses strong (exact) date
    // comparison: the range applies only if the date matches the object's upload date
    // exactly to the second.
    const ifRangeDate = new Date(ifRange);
    if (isNaN(ifRangeDate.getTime())) {
        return false;
    }

    // HTTP-date has 1-second resolution, so truncate down to the second.
    return (
        Math.floor(ifRangeDate.getTime() / 1000) === Math.floor(object.uploaded.getTime() / 1000)
    );
}
