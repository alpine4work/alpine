import {ApiContentBlockElement} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {FileId} from "~/shared/id/types/id_types.js";

/**
 * NOTE(imjoshin, 2026-02-13): We are adding these as a placeholder before we
 * support files in our public facing api. These types should be represented by our
 * API's ApiContentBlockElement via our generated schema. Until we support files,
 * we'll use this to support them internally. (currently used for imports)
 * TODO(#public-api): Remove these once we support files in the public API.
 */

/**
 * A FileRow block element for internal use (not part of the public API). Used by
 * the importer to represent file attachments in content. Contains 1-3 files that
 * will be rendered in a horizontal row. TODO(#public-api): Remove this once we
 * support files in the public API.
 */
export interface ApiContentFileRowBlockElement {
    type: "FileRow";
    files: Array<{fileId: FileId}>;
}

/**
 * A FileRowTable block element for internal use (not part of the public API). Used
 * by the importer to represent file attachments in table cells. Unlike FileRow,
 * this is for table context and contains exactly one file. TODO(#public-api):
 * Remove this once we support files in the public API.
 */
export interface ApiContentFileRowTableBlockElement {
    type: "FileRowTable";
    fileId: FileId;
}

/**
 * Extended table cell type that can contain FileRowTable elements. This is used
 * internally by the importer to represent files in table cells. TODO(#public-api):
 * Remove this once we support files in the public API.
 */
export interface ApiContentTableBlockElementCellExtended {
    elements: Array<ApiContentBlockElementWithFileRow>;
}

/**
 * Extended table block element that uses extended cells. TODO(#public-api): Remove
 * this once we support files in the public API.
 */
export interface ApiContentTableBlockElementExtended {
    type: "Table";
    width: number;
    hasHeaderRow?: boolean;
    hasHeaderColumn?: boolean;
    columns: ReadonlyArray<{width: number}>;
    rows: ReadonlyArray<{cells: ReadonlyArray<ApiContentTableBlockElementCellExtended>}>;
}

/**
 * Extended block element type that includes FileRow and FileRowTable for internal
 * use. TODO(#public-api): Remove this once we support files in the public API.
 */
export type ApiContentBlockElementWithFileRow =
    | ApiContentBlockElement
    | ApiContentFileRowBlockElement
    | ApiContentFileRowTableBlockElement
    | ApiContentTableBlockElementExtended;
