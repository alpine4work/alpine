import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * Options that configure details of how a search is executed. If you have
 * internal access you may tweak search options to see how they impact search
 * results.
 *
 * Setting the right search options is more art than science. Small changes may
 * have a major impact on search results.
 */
export type SearchOptions = SchemaType<typeof SearchOptionsSchema>;

export const SearchOptionsSchema = Schema.object({
    /**
     * How much should we boost matches on a search entity's title vs matches on
     * a search entity's body? We multiply the search's title match score with this
     * value.
     *
     * We recommend a value between 1 and 2 (not inclusive).
     *
     * - Should be >1 so that title matches are ranked higher than body matches.
     *
     * - Should be <2 since a body match on two fields should rank higher than a
     *   title match on just one field.
     *
     *   We index attributes into multiple fields (e.g. we have an indexed 2gram
     *   field and 3gram field for phrase matching) and when searching we sum the
     *   scores from each matching field. So when matching two fields you get
     *   approximately double the score of matching just one field. It's not quite
     *   double since frequency statistics kick in but you can roughly think of the
     *   score as doubled.
     */
    titleBoost: Schema.float,
});

/**
 * The standard search options we use in production.
 *
 * You may change these options if you have internal access and enter search
 * debug mode for the purpose of tuning search. Regular usage of search uses
 * these options.
 *
 * Setting the right search options is more art than science. Small changes may
 * have a major impact on search results.
 */
export const standardSearchOptions: SearchOptions = {
    // A title match is much better than a body match. Set a boost close to 2 but
    // still less than 2 so a hit matching multiple body fields can beat a hit
    // matching one title field.
    titleBoost: 1.8,
};
