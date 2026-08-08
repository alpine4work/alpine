import {JsonObjectValue} from "~/shared/helpers/types/json_value.open_source.js";

/**
 * Sort clause for an OpenSearch search request.
 *
 * https://opensearch.org/docs/latest/search-plugins/searching-data/sort/
 */
export type OpensearchSortClause<FlattenedKeys extends string> = Array<
    "_score" | "_doc" | OpensearchSortClauseItem<FlattenedKeys>
>;

export type OpensearchSortClauseItem<FlattenedKeys extends string> =
    | {
          [Key in FlattenedKeys]?: {
              order: "asc" | "desc";
              missing: "_last" | "_first";
          };
      }
    | {
          _id: {order: "asc" | "desc"};
      }
    | {
          _script: {
              type: "number" | "string";
              script: {
                  lang: "painless";
                  source: string;
                  params?: JsonObjectValue;
              };
              order: "asc" | "desc";
          };
      };
