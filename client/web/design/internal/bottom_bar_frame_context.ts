import {createContext} from "react";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.open_source.js";

export type BottomBarFrameContext = {
    currentBottomBarHeight: {
        readonly visibleMobileKeyboard: number;
        readonly hiddenMobileKeyboard: number;
    } | null;
    bottomBarFrameChangeEmitter: EventEmitter<{
        oldBottomBarHeight: {
            readonly visibleMobileKeyboard: number;
            readonly hiddenMobileKeyboard: number;
        };
        newBottomBarHeight: {
            readonly visibleMobileKeyboard: number;
            readonly hiddenMobileKeyboard: number;
        };
        wasBottomBarMounted: boolean;
        wasBottomBarUnmounted: boolean;
    }> | null;
    bottomBarFrames: Set<{
        readonly height: number;
        readonly withMobileKeyboardToolbar: boolean;
    }>;
};

export const BottomBarFrameContext = createContext<BottomBarFrameContext | null>(null);

export function getInitialBottomBarFrameContext(): BottomBarFrameContext {
    return {
        currentBottomBarHeight: null,
        bottomBarFrameChangeEmitter: null,
        bottomBarFrames: new Set(),
    };
}

export const bottomBarFrameContextForTest: BottomBarFrameContext | null = import.meta.jest
    ? getInitialBottomBarFrameContext()
    : null;
