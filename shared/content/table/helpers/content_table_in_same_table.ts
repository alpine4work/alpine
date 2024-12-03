import {ResolvedPos} from "prosemirror-model";

/**
 * Checks if two cells are in the same table.
 *
 * Example usage:
 * const sameTable = inSameTable($cellA, $cellB);
 * console.log(`In same table: ${sameTable}`);
 *
 * This function is useful for validating operations that depend on cell relationships.
 */
export function contentTableInSameTable($cellA: ResolvedPos, $cellB: ResolvedPos): boolean {
    return (
        $cellA.depth == $cellB.depth &&
        $cellA.pos >= $cellB.start(-1) &&
        $cellA.pos <= $cellB.end(-1)
    );
}
