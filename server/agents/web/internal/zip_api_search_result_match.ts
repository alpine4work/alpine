import {ApiSearchResultMatch} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {assert} from "~/shared/helpers/control/assert.js";

export type ApiSearchResultMatchZippedItem = {
    readonly text: string;
    readonly isMatch?: true;
};

export function zipApiSearchResultMatch(
    text: string,
    match: ApiSearchResultMatch,
): Array<ApiSearchResultMatchZippedItem> {
    const segments: Array<ApiSearchResultMatchZippedItem> = [];
    let startIndex = 0;

    for (const segment of match) {
        const endIndex = startIndex + segment.length;
        assert(endIndex <= text.length);
        segments.push({
            text: text.slice(startIndex, endIndex),
            ...(segment.isMatch ? {isMatch: true} : {}),
        });
        startIndex = endIndex;
    }

    assert(startIndex === text.length);
    return segments;
}
