// Very important that this is a type import! This module needs to be executed
// before `native_mobile_bridge.js` to work.
import type {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {scheduleMacrotask} from "~/shared/helpers/async/schedule_macrotask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";

// Only importable from unit tests.
assert(import.meta.jest);

const navigationRequestEventualExternalPopEmitter = new EventEmitter();

export const NativeMobileBridgeForTest: typeof NativeMobileBridge & {
    navigation: {
        subscribeToRequestEventualExternalPopForTest: (listener: () => void) => void;
    };
} = {
    health: {
        ready: () => {},
        ping: () => {},
    },
    colors: {
        setThemeColors: () => {},
    },
    session: {
        signOut: () => {},
        switchSpace: () => {},
    },
    navigation: {
        preparePush: () => {},
        push: () => {},
        subscribeToExternalPop: () => {
            return () => {};
        },
        prepareExternalPop: () => {},
        externalPop: () => {},
        preparePop: () => {},
        pop: () => {},
        requestEventualExternalPop: () => {
            navigationRequestEventualExternalPopEmitter.emit();
        },
        subscribeToRequestEventualExternalPopForTest: listener => {
            return navigationRequestEventualExternalPopEmitter.subscribe(listener);
        },
        replace: () => {},
        prepareReplaceWithPushAnimation: () => {},
        replaceWithPushAnimation: () => {},
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
        initialTab: "Home",
        // Tab bar height on iOS is 49 points.
        height: 50,
        getDeferredScrollOffset: () => 0,
        isHidden: () => false,
        hide: () => {
            throw new UnimplementedError(
                "`NativeMobileBridge.tabBar.hide()` is unimplemented in tests",
            );
        },
        unhide: () => {
            throw new UnimplementedError(
                "`NativeMobileBridge.tabBar.unhide()` is unimplemented in tests",
            );
        },
        clearInboxNotificationBadge: () => {},
        setInboxLoudNotificationBadge: () => {},
        setInboxSubtleNotificationBadge: () => {},
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
    notifications: {
        takeAppleDeviceTokens: async () => [],
        subscribeToAppleDeviceTokensUpdate: () => {
            return () => {};
        },
    },
    haptic: {
        playLightImpact: () => {},
        playMediumImpact: () => {},
        playHeavyImpact: () => {},
        playSelectionChanged: () => {},
    },
};

(window as any).__NativeMobileBridge = NativeMobileBridgeForTest;
