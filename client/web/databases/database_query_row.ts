import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import type {DatabaseFieldId, DatabaseRowId} from "~/shared/id/types/id_types.js";

/**
 * A page of database view rows. Wraps the raw array-based row data from
 * `getViewRowsPage` with a per-page field index mapping. Row objects are created
 * lazily and cached.
 */
export class DatabaseQueryPage {
    readonly pageId: number;
    readonly afterCursor: DatabaseRowId | null;
    readonly endCursor: DatabaseRowId | null;

    private readonly fieldIndexes: ReadonlyMap<DatabaseFieldId, number>;
    private readonly rawRows: ReadonlyArray<ReadonlyArray<unknown>>;
    private readonly cachedRows: Array<DatabaseQueryRow | undefined>;

    constructor(options: {
        pageId: number;
        afterCursor: DatabaseRowId | null;
        endCursor: DatabaseRowId | null;
        fieldIndexes: ReadonlyMap<DatabaseFieldId, number>;
        rows: ReadonlyArray<ReadonlyArray<unknown>>;
    }) {
        this.pageId = options.pageId;
        this.afterCursor = options.afterCursor;
        this.endCursor = options.endCursor;
        this.fieldIndexes = options.fieldIndexes;
        this.rawRows = options.rows;
        this.cachedRows = new Array(options.rows.length);
    }

    get rowCount(): number {
        return this.rawRows.length;
    }

    getRow(index: number): DatabaseQueryRow {
        let row = this.cachedRows[index];
        if (row === undefined) {
            row = new DatabaseQueryRow(assertExists(this.rawRows[index]), this.fieldIndexes);
            this.cachedRows[index] = row;
        }
        return row;
    }
}

/**
 * A single row in a database view. Values are stored as an array; field values are
 * accessed by field ID through the page's field-index mapping. `_id` is always at
 * index 0.
 */
export class DatabaseQueryRow {
    private readonly values: ReadonlyArray<unknown>;
    private readonly fieldIndexes: ReadonlyMap<DatabaseFieldId, number>;

    constructor(
        values: ReadonlyArray<unknown>,
        fieldIndexes: ReadonlyMap<DatabaseFieldId, number>,
    ) {
        this.values = values;
        this.fieldIndexes = fieldIndexes;
    }

    getId(): DatabaseRowId {
        return this.values[0] as DatabaseRowId;
    }

    getCellValue(fieldId: DatabaseFieldId): unknown {
        const index = this.fieldIndexes.get(fieldId);
        if (index === undefined) return undefined;
        return this.values[index];
    }
}
