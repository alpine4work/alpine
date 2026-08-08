import {ApiSearchResultMatch} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

export type ZippedApiSearchResultMatches = Array<{
    text: string;
    isMatch: boolean;
}>;

export function zipApiSearchResultMatches(
    text: string,
    matches: ReadonlyArray<ApiSearchResultMatch>,
): ZippedApiSearchResultMatches {
    const segments: ZippedApiSearchResultMatches = [];
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
