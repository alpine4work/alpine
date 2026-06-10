/**
 * The maximum date value in JavaScript.
 *
 * From the [ECMAScript spec][1]:
 *
 * > Time is measured in ECMAScript in milliseconds since 01 January, 1970 UTC. In
 * > time values leap seconds are ignored. It is assumed that there are exactly
 * > 86,400,000 milliseconds per day. ECMAScript Number values can represent all
 * > integers from –9,007,199,254,740,992 to 9,007,199,254,740,992; this range
 * > suffices to measure times to millisecond precision for any instant that is
 * > within approximately 285,616 years, either forward or backward, from 01
 * > January, 1970 UTC.
 * >
 * > The actual range of times supported by ECMAScript Date objects is slightly
 * > smaller: exactly –100,000,000 days to 100,000,000 days measured relative to
 * > midnight at the beginning of 01 January, 1970 UTC. This gives a range of
 * > 8,640,000,000,000,000 milliseconds to either side of 01 January, 1970 UTC.
 *
 * [1]: https://262.ecma-international.org/5.1/#sec-15.9.1.1
 */
export const maxDate = new Date(8640000000000000);

/**
 * The minimum date which can be lexicographically sorted in ISO 8601 format.
 */
export const minIsoLexicographicallySortableDate = new Date("0000-01-01T00:00:00.000Z");

/**
 * The maximum date which can be lexicographically sorted in ISO 8601 format.
 *
 * At years larger than 9999 ISO 8601 uses the following format:
 * `+010000-01-01T00:00:00.000Z`. Unfortunately `+` is a smaller character than
 * numbers so it is not lexicographically sorted. `+` is an odd choice for the ISO
 * standard here given it's not lexicographically sortable?
 */
export const maxIsoLexicographicallySortableDate = new Date("9999-12-31T23:59:59.999Z");
