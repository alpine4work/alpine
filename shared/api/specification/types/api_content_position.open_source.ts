import {ApiContentKey} from "~/shared/api/specification/types/api_content_key.open_source.js";

export type ApiContentPosition =
    | ApiContentInlinePosition
    | ApiContentBeforePosition
    | ApiContentAfterPosition;

export type ApiContentInlinePosition = {
    readonly type: "Inline";
    readonly key: ApiContentKey;
    readonly index: number;
};

export type ApiContentBeforePosition = {
    readonly type: "Before";
    readonly key: ApiContentKey;
};

export type ApiContentAfterPosition = {
    readonly type: "After";
    readonly key: ApiContentKey;
};

export type ApiContentRange = {
    readonly start: ApiContentPosition;
    readonly end: ApiContentPosition;
};
