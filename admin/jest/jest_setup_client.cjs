"use strict";

/* globals jest */

// `jest-dom` adds custom jest matchers for asserting on DOM nodes. Allows you to
// do things like:
//
// ```
// expect(element).toHaveTextContent(/react/i)
// ```
require("@testing-library/jest-dom");

const crypto = require("crypto");
const {ResizeObserver: ResizeObserverPolyfill} = require("@juggle/resize-observer");
const {TextEncoder, TextDecoder} = require("util");

// Set the Node.js `webcrypto` implementation to the `crypto` global so that client
// code which runs in a browser has access to the web Crypto API.
globalThis.crypto = crypto.webcrypto;

// NOTE(calebmer): It would appear that when upgrading to Node.js v20 there is now
// a read-only global `performance` property. Reassign the property but make it
// writable so `jest.useFakeTimers()` can override it.
const performance = globalThis.performance;
Object.defineProperty(globalThis, "performance", {value: performance, writable: true});

// Polyfill text encoder/decoders.
globalThis.TextEncoder = TextEncoder;
globalThis.TextDecoder = TextDecoder;

// Pretend we are on a Mac for tests. Most of our programmers use Mac for
// development so it's more natural to use those platform conventions.
//
// Learn more:
// https://developer.mozilla.org/en-US/docs/Web/API/NavigatorID/platform
Object.defineProperty(navigator, "platform", {
    get: () => "MacIntel",
});

// Polyfill: https://developer.mozilla.org/en-US/docs/Web/API/Range/getClientRects
if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = function () {
        const clientRects = Array.from(this.cloneContents().children).flatMap(childNode =>
            Array.from(childNode.getClientRects()),
        );
        return clientRects;
    };
} else {
    throw new Error("Yay! jsdom supports this now, we can remove our polyfill");
}

// Polyfill:
// https://developer.mozilla.org/en-US/docs/Web/API/Range/getBoundingClientRect
if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = function () {
        const clientRects = this.getClientRects();
        if (clientRects.length === 0) {
            return {x: 0, y: 0, width: 0, height: 0};
        }

        let ax1 = clientRects[0].x;
        let ax2 = clientRects[0].x + clientRects[0].width;
        let ay1 = clientRects[0].y;
        let ay2 = clientRects[0].y + clientRects[0].height;

        for (let i = 1; i < clientRects.length; i++) {
            const bx1 = clientRects[i].x;
            const bx2 = clientRects[i].x + clientRects[i].width;
            const by1 = clientRects[i].y;
            const by2 = clientRects[i].y + clientRects[i].height;

            if (bx1 < ax1) ax1 = bx1;
            if (bx2 > ax2) ax2 = bx2;
            if (by1 < ay1) ay1 = by1;
            if (by2 > ay2) ay2 = by2;
        }

        return {
            x: ax1,
            y: ay1,
            width: ax2 - ax1,
            height: ay2 - ay1,
        };
    };
} else {
    throw new Error("Yay! jsdom supports this now, we can remove our polyfill");
}

// Polyfill: https://developer.mozilla.org/en-US/docs/Web/API/Window/matchMedia
if (!window.matchMedia) {
    window.matchMedia = jest.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
    }));
} else {
    throw new Error("Yay! jsdom supports this now, we can remove our polyfill");
}

// Polyfill: https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver
if (!window.ResizeObserver) {
    window.ResizeObserver = ResizeObserverPolyfill;
} else {
    throw new Error("Yay! jsdom supports this now, we can remove our polyfill");
}

// Polyfill:
// https://developer.mozilla.org/en-US/docs/Web/API/Document/elementFromPoint
if (!Document.prototype.elementFromPoint) {
    Document.prototype.elementFromPoint = () => null;
} else {
    throw new Error("Yay! jsdom supports this now, we can remove our polyfill");
}

// Polyfill: https://developer.mozilla.org/en-US/docs/Web/API/Element/getAnimations
if (!Element.prototype.getAnimations) {
    Element.prototype.getAnimations = () => [];
} else {
    throw new Error("Yay! jsdom supports this now, we can remove our polyfill");
}
