import {ApiContentKey} from "~/shared/api/specification/types/api_content_key.js";

export type ApiContentPosition =
    | {
          readonly type: "Inline";
          readonly key: ApiContentKey;
          readonly index: number;
      }
    | {
          readonly type: "Before";
          readonly key: ApiContentKey;
      }
    | {
          readonly type: "After";
          readonly key: ApiContentKey;
      };

export type ApiContentRange = {
    readonly start: ApiContentPosition;
    readonly end: ApiContentPosition;
};
