export type FileNounCountState = {noun: string; number: number} | null;

/**
 * Format a file noun with an adjacent count suffix. Tracks adjacent files of the
 * same type and increments a count. The count resets when a different noun
 * appears.
 */
export function formatFileNounWithAdjacentCount(
    noun: string,
    state: FileNounCountState,
): {text: string; nextState: FileNounCountState} {
    const number = state?.noun === noun ? state.number + 1 : 1;
    const text = number > 1 ? `${noun} ${number}` : noun;
    return {text, nextState: {noun, number}};
}
