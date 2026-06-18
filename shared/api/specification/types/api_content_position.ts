import {ApiContentKey} from "~/shared/api/specification/types/api_content_key.js";

export type ApiContentPosition = {
    readonly key: ApiContentKey;
    readonly index: number;
};

export type ApiContentRange = {
    /** Inclusive */
    readonly start: ApiContentPosition;
    /** Exclusive */
    readonly end: ApiContentPosition;
};
