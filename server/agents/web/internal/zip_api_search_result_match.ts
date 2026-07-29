import {ApiSearchResultMatch} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {assert} from "~/shared/helpers/control/assert.js";

export type ApiSearchResultZippedMatch = {
    readonly text: string;
    readonly isMatch: boolean;
};

export function zipApiSearchResultMatch(
    text: string,
    matches: ReadonlyArray<ApiSearchResultMatch>,
): Array<ApiSearchResultZippedMatch> {
    const segments: Array<ApiSearchResultZippedMatch> = [];
    let startIndex = 0;

    for (const match of matches) {
        assert(match.index >= startIndex);
        const endIndex = match.index + match.length;
        assert(endIndex <= text.length);

        if (match.index > startIndex) {
            segments.push({
                text: text.slice(startIndex, match.index),
                isMatch: false,
            });
        }

        segments.push({
            text: text.slice(match.index, endIndex),
            isMatch: true,
        });
        startIndex = endIndex;
    }

    if (startIndex < text.length) {
        segments.push({
            text: text.slice(startIndex),
            isMatch: false,
        });
    }

    return segments;
}
