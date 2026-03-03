type CubicBezier = `cubic-bezier(${number}, ${number}, ${number}, ${number})`;

/** n should be between 0 and 1 */
export type EasingFn = (n: number) => number;
/** n should be between 0 and 1 */
export type Easing = {
    (n: number): number;
    cubicBezier: CubicBezier;
};

// https://gist.github.com/rezoner/713615dabedb59a15470
// http://gsgd.co.uk/sandbox/jquery/easing/
export const reverseEasing =
    (easing: (n: number) => number) =>
    (n: number): number =>
        easing(1 - n);

// Many of these easing curves are taken from: https://easings.net/

export const easeLinear: Easing = n => n;
easeLinear.cubicBezier = "cubic-bezier(0.5, 0.5, 0.5, 0.5)";

export const easeInQuad: Easing = t => t * t;
easeInQuad.cubicBezier = "cubic-bezier(0.11, 0, 0.5, 0)";

export const easeOutQuad: Easing = t => t * (2 - t);
easeOutQuad.cubicBezier = "cubic-bezier(0.5, 1, 0.89, 1)";

export const easeInOutQuad: Easing = t => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);
easeInOutQuad.cubicBezier = "cubic-bezier(0.45, 0, 0.55, 1)";

export const easeInCubic: Easing = t => t * t * t;
easeInCubic.cubicBezier = "cubic-bezier(0.32, 0, 0.67, 0)";

export const easeOutCubic: Easing = t => --t * t * t + 1;
easeOutCubic.cubicBezier = "cubic-bezier(0.33, 1, 0.68, 1)";

export const easeInOutCubic: Easing = t =>
    t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;
easeInOutCubic.cubicBezier = "cubic-bezier(0.65, 0, 0.35, 1)";

export const easeInQuart: Easing = t => t * t * t * t;
easeInQuart.cubicBezier = "cubic-bezier(0.5, 0, 0.75, 0)";

export const easeOutQuart: Easing = t => 1 - --t * t * t * t;
easeOutQuart.cubicBezier = "cubic-bezier(0.25, 1, 0.5, 1)";

export const easeInOutQuart: Easing = t => (t < 0.5 ? 8 * t * t * t * t : 1 - 8 * --t * t * t * t);
easeInOutQuart.cubicBezier = "cubic-bezier(0.76, 0, 0.24, 1)";

export const easeInQuint: Easing = t => t * t * t * t * t;
easeInQuint.cubicBezier = "cubic-bezier(0.64, 0, 0.78, 0)";

export const easeOutQuint: Easing = t => 1 + --t * t * t * t * t;
easeOutQuint.cubicBezier = "cubic-bezier(0.22, 1, 0.36, 1)";

export const easeInOutQuint: Easing = t =>
    t < 0.5 ? 16 * t * t * t * t * t : 1 + 16 * --t * t * t * t * t;
easeInOutQuint.cubicBezier = "cubic-bezier(0.83, 0, 0.17, 1)";

export const easeInSin: Easing = t => -1 * Math.cos(t * Math.PI * 0.5) + 1;
easeInSin.cubicBezier = "cubic-bezier(0.12, 0, 0.39, 0)";

export const easeOutSin: Easing = t => Math.sin(t * Math.PI * 0.5);
easeOutSin.cubicBezier = "cubic-bezier(0.61, 1, 0.88, 1)";

export const easeInOutSin: Easing = t => (-1 / 2) * (Math.cos(Math.PI * t) - 1);
easeInOutSin.cubicBezier = "cubic-bezier(0.37, 0, 0.63, 1)";

export const easeInExpo: Easing = t => (t == 0 ? 0 : Math.pow(2, 10 * (t - 1)));
easeInExpo.cubicBezier = "cubic-bezier(0.7, 0, 0.84, 0)";

export const easeOutExpo: Easing = t => (t == 1 ? 1 : -Math.pow(2, -10 * t) + 1);
easeOutExpo.cubicBezier = "cubic-bezier(0.16, 1, 0.3, 1)";

export const easeInOutExpo: Easing = t => {
    if (t == 0) return 0;
    if (t == 1) return 1;
    if ((t /= 1 / 2) < 1) return (1 / 2) * Math.pow(2, 10 * (t - 1));
    return (1 / 2) * (-Math.pow(2, -10 * --t) + 2);
};
easeInOutExpo.cubicBezier = "cubic-bezier(0.87, 0, 0.13, 1)";

export const easeInCirc: Easing = t => -1 * (Math.sqrt(1 - t * t) - 1);
easeInCirc.cubicBezier = "cubic-bezier(0.55, 0, 1, 0.45)";

export const easeOutCirc: Easing = t => Math.sqrt(1 - (t = t - 1) * t);
easeOutCirc.cubicBezier = "cubic-bezier(0, 0.55, 0.45, 1)";

export const easeInOutCirc: Easing = t => {
    if ((t /= 1 / 2) < 1) return (-1 / 2) * (Math.sqrt(1 - t * t) - 1);
    return (1 / 2) * (Math.sqrt(1 - (t -= 2) * t) + 1);
};
easeInOutCirc.cubicBezier = "cubic-bezier(0.85, 0, 0.15, 1)";

export const easeInElastic = (t: number): number => {
    let s = 1.70158;
    let p = 0;
    let a = 1;
    if (t == 0) return 0;
    if (t == 1) return 1;
    if (!p) p = 0.3;
    if (a < 1) {
        a = 1;
        s = p / 4;
    } else {
        s = (p / (2 * Math.PI)) * Math.asin(1 / a);
    }
    return -(a * Math.pow(2, 10 * (t -= 1)) * Math.sin(((t - s) * (2 * Math.PI)) / p));
};

export const easeOutElastic = (t: number): number => {
    let s = 1.70158;
    let p = 0;
    let a = 1;
    if (t == 0) return 0;
    if (t == 1) return 1;
    if (!p) p = 0.3;
    if (a < 1) {
        a = 1;
        s = p / 4;
    } else {
        s = (p / (2 * Math.PI)) * Math.asin(1 / a);
    }
    return a * Math.pow(2, -10 * t) * Math.sin(((t - s) * (2 * Math.PI)) / p) + 1;
};

export const easeInOutElastic = (t: number): number => {
    let s = 1.70158;
    let p = 0;
    let a = 1;
    if (t == 0) return 0;
    if ((t /= 1 / 2) == 2) return 1;
    if (!p) p = 0.3 * 1.5;
    if (a < 1) {
        a = 1;
        s = p / 4;
    } else {
        s = (p / (2 * Math.PI)) * Math.asin(1 / a);
    }
    if (t < 1)
        return -0.5 * (a * Math.pow(2, 10 * (t -= 1)) * Math.sin(((t - s) * (2 * Math.PI)) / p));
    return a * Math.pow(2, -10 * (t -= 1)) * Math.sin(((t - s) * (2 * Math.PI)) / p) * 0.5 + 1;
};

export const easeInBack =
    (s = 1.70158) =>
    (t: number): number => {
        return 1 * t * t * ((s + 1) * t - s);
    };

export const easeOutBack =
    (s = 1.70158) =>
    (t: number): number => {
        t = t - 1;
        return 1 * (t * t * ((s + 1) * t + s) + 1);
    };

export const easeInOutBack =
    (s = 1.70158) =>
    (t: number): number => {
        if ((t /= 1 / 2) < 1) return (1 / 2) * (t * t * (((s *= 1.525) + 1) * t - s));
        return (1 / 2) * ((t -= 2) * t * (((s *= 1.525) + 1) * t + s) + 2);
    };

export const easeInBounce = (t: number): number => {
    return 1 - easeOutBounce(1 - t);
};

export const easeOutBounce = (t: number): number => {
    if ((t /= 1) < 1 / 2.75) {
        return 7.5625 * t * t;
    } else if (t < 2 / 2.75) {
        return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
    } else if (t < 2.5 / 2.75) {
        return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
    } else {
        return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
    }
};

export const easeInOutBounce = (t: number): number => {
    if (t < 1 / 2) return easeInBounce(t * 2) * 0.5;
    return easeOutBounce(t * 2 - 1) * 0.5 + 0.5;
};

/**
 * Parse `cubic-bezier()` string to its control points.
 */
export function parseCubicBezier(
    cubicBezier: `cubic-bezier(${number}, ${number}, ${number}, ${number})`,
): readonly [number, number, number, number] {
    return cubicBezier
        .slice(13, -1)
        .split(", ", 4)
        .map(string => parseFloat(string)) as any;
}
