import prettyMs from "pretty-ms";

export function printAgentThoughtDuration(durationMs: number) {
    // Don't show "Thought for 540ms" - show "Thought for 1 second" instead.
    const finalDurationMs = Math.max(durationMs, 1000);
    return prettyMs(finalDurationMs, {
        secondsDecimalDigits: 0,
        millisecondsDecimalDigits: 0,
        keepDecimalsOnWholeSeconds: false,
        verbose: true,
    });
}
