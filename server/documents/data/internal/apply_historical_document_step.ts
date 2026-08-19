import {Node} from "prosemirror-model";
import {Step} from "prosemirror-transform";
import {DataLossError} from "~/shared/error/error.open_source.js";

/**
 * Applies a stored historical step, converting invalid persisted data into a
 * data-loss error.
 */
export function applyHistoricalDocumentStep(content: Node, step: Step): Node {
    let result;
    try {
        result = step.apply(content);
    } catch (error) {
        if (error instanceof RangeError) {
            throw new DataLossError(`Couldn\u2019t apply saved document step: ${error.message}`, {
                cause: error,
            });
        }
        throw error;
    }
    if (!result.doc)
        throw new DataLossError(
            `Couldn\u2019t apply saved document step: ${result.failed ?? "Unknown failure"}`,
        );
    return result.doc;
}
