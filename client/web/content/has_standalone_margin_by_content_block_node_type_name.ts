import {ContentBlockNodeTypeName} from "~/shared/content/content_node_type_name.js";
import {cast} from "~/shared/helpers/control/cast.open_source.js";

/**
 * True for all the block nodes that get standalone block margin in
 * `content.css.ts` vs paragraph margin.
 *
 * Useful in places we need to programatically determine how much margin to add
 * between elements. Should be kept in sync with `content.css.ts`.
 *
 * List items (`unorderedListItem`, `orderedListItem`, and `checkListItem`) are a
 * special case where adjacent list items have paragraph margins but a list item
 * adjacent to anything else has standalone margin.
 */
export const hasStandaloneMarginByContentBlockNodeTypeName: {[key: string]: boolean} = cast<{
    [Key in ContentBlockNodeTypeName]: boolean;
}>({
    paragraph: false,
    unorderedListItem: true,
    orderedListItem: true,
    checkListItem: true,
    heading: true,
    divider: true,
    fileFloat: false,
    quoteBlock: true,
    codeBlock: true,
    fileRow: true,
    fileRowTable: true,
    table: true,
});
