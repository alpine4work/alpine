export const searchWordTypingDebounceMs = {
    /**
     * The debounce timeout before we'll send a new search request. Picked so that
     * >50% of typists will be done typing by the time this debounce fires.
     *
     * We expect that in a work context we generally have above average typists.
     * Also for search the user generally knows what they want to type or it's a
     * word they usually type which may make them faster. We may have some weird
     * intermediate results but that's accepted.
     */
    desktop: (() => {
        // This is p50 typing speed according to the distribution here:
        // https://humanbenchmark.com/tests/typing
        //
        // Percentile calculator here:
        // https://docs.google.com/spreadsheets/d/1_FiahHiNpEqFG7KrtRYOcKWRG8LYIcuHZWBAX2X4nFQ/edit?usp=sharing
        const wordsPerMinute = 44;

        const charactersPerMinute = wordsPerMinute * 5;
        const charactersPerSecond = charactersPerMinute / 60;
        const charactersPerMillisecond = charactersPerSecond / 1000;
        const millisecondsPerCharacter = 1 / charactersPerMillisecond;

        return Math.floor(millisecondsPerCharacter);
    })(),

    /**
     * The debounce timeout before we'll send a new search request for mobile.
     * Picked so that >50% of typists will be done typing by the time this debounce
     * fires. Slower than `searchWordTypingDebounceMs.desktop` since the average
     * typing speed on mobile devices is slower than on desktop devices.
     */
    mobile: (() => {
        // This is average typing speed according to:
        // https://wordsrated.com/typing-speed-statistics/
        const wordsPerMinute = 38;

        const charactersPerMinute = wordsPerMinute * 5;
        const charactersPerSecond = charactersPerMinute / 60;
        const charactersPerMillisecond = charactersPerSecond / 1000;
        const millisecondsPerCharacter = 1 / charactersPerMillisecond;

        return Math.floor(millisecondsPerCharacter);
    })(),
};
