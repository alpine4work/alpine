import {createContext} from "react";

export type MobileFullScreenModalContext = {
    readonly presentedCount: number;
    onAfterPresent(): void;
    onBeforeDismiss(): void;
};

export const MobileFullScreenModalContext = createContext<MobileFullScreenModalContext | null>(
    null,
);
