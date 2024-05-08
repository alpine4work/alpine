// Very important that this is a type import! This module needs to be executed
// before `native_mobile_bridge.js` to work.
import type {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {scheduleMacrotask} from "~/shared/helpers/async/schedule_macrotask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";

// Only importable from unit tests.
assert(import.meta.jest);

const navigationRequestExternalPopEmitter = new EventEmitter();

export const NativeMobileBridgeForTest: typeof NativeMobileBridge & {
    navigation: {
        subscribeToRequestExternalPopForTest: (listener: () => void) => void;
    };
} = {
    health: {
        ready: () => {},
        ping: () => {},
    },
    colors: {
        setThemeColors: () => {},
    },
    navigation: {
        preparePush: () => {},
        push: () => {},
        subscribeToExternalPop: () => {
            return () => {};
        },
        finishExternalPop: () => {},
        preparePop: () => {},
        pop: () => {},
        requestExternalPop: () => {
            navigationRequestExternalPopEmitter.emit();
        },
        subscribeToRequestExternalPopForTest: listener => {
            return navigationRequestExternalPopEmitter.subscribe(listener);
        },
        replace: () => {},
        preparePresentModal: () => {},
        presentModal: () => {},
        prepareDismissModal: () => {},
        dismissModal: () => {},
        prepareSwitchTab: () => {},
        switchTab: () => {},
        subscribeToExternalSwitchTab: () => {
            return () => {};
        },
        scheduleAfterAnimation: action => {
            scheduleMacrotask(action);
        },
    },
    navigationBar: {
        runScrollDebounceTimeout: () => {},
    },
    tabBar: {
        // Tab bar height on iOS is 49 points.
        height: 50,
        getDeferredScrollOffset: () => 0,
        isDisabled: () => false,
        disable: () => {
            throw new UnimplementedError(
                "`NativeMobileBridge.tabBar.disable()` is unimplemented in tests",
            );
        },
        enable: () => {
            throw new UnimplementedError(
                "`NativeMobileBridge.tabBar.enable()` is unimplemented in tests",
            );
        },
    },
    keyboard: {
        subscribeToFrameChange: () => {
            return () => {};
        },
        isSubstituteOpen: () => false,
        prepareForSubstitute: () => {
            throw new UnimplementedError(
                "`NativeMobileBridge.keyboard.prepareForSubstitute()` is unimplemented in tests",
            );
        },
        cleanupAfterSubstitute: () => {
            throw new UnimplementedError(
                "`NativeMobileBridge.keyboard.cleanupAfterSubstitute()` is unimplemented in tests",
            );
        },
        scheduleAfterAnimation: action => {
            scheduleMacrotask(action);
        },
    },
    scrollbar: {
        updateAllInsets: () => {},
    },
    modal: {
        presentDialog: () => {
            throw new UnimplementedError(
                "`NativeMobileBridge.modal.presentDialog()` is unimplemented in tests",
            );
        },
    },
    editMenu: {
        enableAddCommentAction: () => {},
        disableAddCommentAction: () => {},
        subscribeToAddCommentAction: () => {
            return () => {};
        },
    },
};

(window as any).__NativeMobileBridge = NativeMobileBridgeForTest;
