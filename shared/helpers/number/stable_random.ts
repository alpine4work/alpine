import {lerp} from "~/shared/helpers/number/lerp.js";

function cyrb53(baseString: string, keyString: string, seed = 0) {
    let h1 = 0xdeadbeef ^ seed,
        h2 = 0x41c6ce57 ^ seed;

    for (let i = 0, ch; i < baseString.length; i++) {
        ch = baseString.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    for (let i = 0, ch; i < keyString.length; i++) {
        ch = keyString.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }

    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Stable, hash-based random number generator.
 *
 * Pass each method a keyString to turn into a random number. Pass a second index
 * integer to generate several random numbers for a single key string.
 */
export class StableRandom {
    private readonly _baseString: string;

    constructor(baseString: string) {
        this._baseString = baseString;
    }

    /** Generate a random number between 0 and 1 based on */
    random(keyString: string, index: number) {
        return cyrb53(this._baseString, keyString, index) / Number.MAX_SAFE_INTEGER;
    }

    /**
     * Generates a stable random integer between `a` and `b` (exclusive).
     *
     * If `b` is not defined, generates a random integer between 0 and `a` (exclusive).
     */
    randomInteger(keyString: string, index: number, a: number, b?: number) {
        return Math.floor(this.randomFloat(keyString, index, a, b));
    }

    /**
     * Generates a stable random float between `a` and `b`.
     *
     * If `b` is not defined, generates a random float between 0 and `a`.
     */
    randomFloat(keyString: string, index: number, a: number, b?: number) {
        if (typeof b === "number") {
            return lerp(a, b, this.random(keyString, index));
        }
        return lerp(0, a, this.random(keyString, index));
    }

    /**
     * Generate a random number following a normal distribution. Approximate range is
     * -3 to 3.
     */
    randomNormalDistribution(keyString: string, index: number) {
        const u = 1 - this.random(keyString, index);
        const v = 1 - this.random(keyString + "_", index + 1);
        return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }
}
