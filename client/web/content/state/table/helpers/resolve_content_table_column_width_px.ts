import * as kiwi from "@lume/kiwi";
import {createCachedFunction} from "~/client/web/content/state/internal/create_cached_function.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";
import {SpacingScale, remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";

export type ContentEditorTableLayout = {
    readonly totalColumnWidth: number;
    readonly columnWidths: ReadonlyArray<number>;
    readonly tableWidth: number;
};

assertAssignableTypes<ContentTableMap, ContentEditorTableLayout>();

/**
 * Computes the absolute pixel width of each column in a table. Implements the same
 * algorithm CSS grid will use to layout our table in the DOM.
 *
 * `totalColumnWidth` must be the sum of all `columnWidths`. Most of the time
 * you'll have precomputed this value so we required you to pass it in so we don't
 * have to compute it again.
 */
export const resolveContentTableColumnWidthPx = createCachedFunction(
    (spacingScale: SpacingScale, blockWidthPx: number, tableLayout: ContentEditorTableLayout) => {
        return resolveContentTableColumnWidthPxWithoutCache(
            tableLayout.totalColumnWidth,
            tableLayout.columnWidths,
            tableLayout.tableWidth,
            blockWidthPx,
            contentStyles.tableColumnMinWidthRem * remPxBySpacingScale[spacingScale],
            contentStyles.tableColumnMaxWidthRem * remPxBySpacingScale[spacingScale],
        );
    },
);

/**
 * Computes the absolute pixel width of each column in a table. Implements the same
 * algorithm CSS grid will use to layout our table in the DOM.
 *
 * `totalColumnWidth` must be the sum of all `columnWidths`. Most of the time
 * you'll have precomputed this value so we required you to pass it in so we don't
 * have to compute it again.
 *
 * This function is not cached. Only call this function if you're confident the
 * inputs will change frequently so caching would add more overhead than it's
 * worth.
 */
// NOTE(calebmer): Normally, since this has 6 arguments, I'd write this with a
// named argument object. But since this code will be called in a hot path (every
// frame) so I'm using positional arguments to avoid an extra object allocation.
function resolveContentTableColumnWidthPxWithoutCache(
    totalColumnWidth: number,
    columnWidths: ReadonlyArray<number>,
    tableWidth: number,
    blockWidthPx: number,
    columnMinWidthPx: number,
    columnMaxWidthPx: number,
): Array<number> {
    const solver = new kiwi.Solver();

    const totalColumnWidthPx = blockWidthPx * tableWidth;
    let totalColumnWidthPxVariable: kiwi.Variable | kiwi.Expression | null = null;

    const columnWidthPxVariableEntries = columnWidths.map(columnWidth => {
        const columnWidthPxVariable = new kiwi.Variable();

        // Make sure we maintain our column min width constraint.
        solver.addConstraint(
            new kiwi.Constraint(
                columnWidthPxVariable,
                kiwi.Operator.Ge,
                columnMinWidthPx,
                kiwi.Strength.required,
            ),
        );

        // Make sure we maintain our column max width constraint.
        solver.addConstraint(
            new kiwi.Constraint(
                columnWidthPxVariable,
                kiwi.Operator.Le,
                columnMaxWidthPx,
                kiwi.Strength.required,
            ),
        );

        // Our column pixel width should be as close as possible to the expected pixel
        // width before applying constraints.
        solver.addConstraint(
            new kiwi.Constraint(
                columnWidthPxVariable,
                kiwi.Operator.Eq,
                (columnWidth / totalColumnWidth) * totalColumnWidthPx,
                kiwi.Strength.medium,
            ),
        );

        if (totalColumnWidthPxVariable === null) {
            totalColumnWidthPxVariable = columnWidthPxVariable;
        } else {
            totalColumnWidthPxVariable = totalColumnWidthPxVariable.plus(columnWidthPxVariable);
        }

        return [columnWidth, columnWidthPxVariable] as const;
    });

    if (totalColumnWidthPxVariable === null) return [];

    // Column pixel width must not exceed total table width.
    solver.addConstraint(
        new kiwi.Constraint(
            totalColumnWidthPxVariable,
            kiwi.Operator.Le,
            totalColumnWidthPx,
            // If we have a bunch of columns and the `tableWidth` hasn't grown (e.g. right now
            // when you paste columns the `tableWidth` doesn't grow) then our total column
            // width is going to exceed the expected column width so lower the
            // less-than-or-equal-to constraint from required to "very strong"
            // (`kiwi.Strength.strong` is the same as `kiwi.Strength.create(1, 0, 0)`).
            //
            // NOTE(calebmer): In this case aren't all columns going to be `columnMinWidthPx`
            // anyway? Maybe we should early return an array that's just `columnMinWidthPx`s.
            columnWidths.length * columnMinWidthPx > totalColumnWidthPx
                ? kiwi.Strength.create(2, 0, 0)
                : kiwi.Strength.required,
        ),
    );

    // Our total column pixel width should be as close as possible to the expected
    // pixel width before applying constraints.
    solver.addConstraint(
        new kiwi.Constraint(
            totalColumnWidthPxVariable,
            kiwi.Operator.Eq,
            totalColumnWidthPx,
            kiwi.Strength.strong,
        ),
    );

    // Make sure the column widths maintain the same order. If two column widths are
    // equal, they should still be equal after solving. If one column width is less
    // than another it should continue to be less than the other after solving.
    //
    // We leverage the transitive property here. By establishing the first variable is
    // less than the second and the second variable is less than the third variable,
    // therefore the first variable must be less than the third variable.
    let previousColumnWidthPxVariableEntry: readonly [number, kiwi.Variable] | null = null;
    for (const columnWidthPxVariableEntry of columnWidthPxVariableEntries
        .slice()
        .sort(([columnIndex1], [columnIndex2]) => columnIndex1 - columnIndex2)) {
        if (previousColumnWidthPxVariableEntry !== null) {
            solver.addConstraint(
                new kiwi.Constraint(
                    previousColumnWidthPxVariableEntry[1],
                    previousColumnWidthPxVariableEntry[0] === columnWidthPxVariableEntry[0]
                        ? kiwi.Operator.Eq
                        : kiwi.Operator.Le,
                    columnWidthPxVariableEntry[1],
                    kiwi.Strength.required,
                ),
            );
        }

        previousColumnWidthPxVariableEntry = columnWidthPxVariableEntry;
    }

    solver.updateVariables();

    return columnWidthPxVariableEntries.map(([, columnWidthPxVariable]) =>
        columnWidthPxVariable.value(),
    );
}

export function resolveContentTableColumnWidthPxWithoutCacheForTest(
    totalColumnWidth: number,
    columnWidths: ReadonlyArray<number>,
    tableWidth: number,
    blockWidthPx: number,
    columnMinWidthPx: number,
    columnMaxWidthPx: number,
): Array<number> {
    assert(import.meta.jest);

    return resolveContentTableColumnWidthPxWithoutCache(
        totalColumnWidth,
        columnWidths,
        tableWidth,
        blockWidthPx,
        columnMinWidthPx,
        columnMaxWidthPx,
    );
}
