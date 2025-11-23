import {Memo, createContext} from "react";
import {GlobalLoadingIndicator} from "~/client/web/spaces/global_loading_indicator_types.js";

export type GlobalLoadingIndicatorContext = {
    readonly add: Memo<(promise: Promise<unknown>, indicator: GlobalLoadingIndicator) => void>;
};

export const GlobalLoadingIndicatorContext = createContext<GlobalLoadingIndicatorContext | null>(
    null,
);
