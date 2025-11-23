/**
 * Can the user interact with the product with touch? This only tells us
 * whether a touch device is available. It does not tell us whether that's the
 * user's primary means of interacting with the product or if the user will use
 * touch to interact with the product at all.
 */
export const hasTouchPoints: boolean =
    typeof window !== "undefined" &&
    ("ontouchstart" in window ||
        navigator.maxTouchPoints > 0 ||
        (navigator as any).msMaxTouchPoints > 0);
