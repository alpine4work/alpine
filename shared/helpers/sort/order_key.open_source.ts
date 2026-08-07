// This code was derived from:
// https://observablehq.com/@dgreensp/implementing-fractional-indexing

import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

/**
 * Order keys provide a way to sort lists in a collaboratively edited environment.
 * They use a technique called [fractional indexing][1] which allows us to
 * efficiently generate a new `OrderKey` between two existing `OrderKey`s.
 *
 * They have a couple advantages over using a list to order your items:
 *
 * - You can put an order key on each individual item. You don't need separate
 *   storage for a list. Useful for ordering items in a database for this reason.
 * - When the order changes, you don't need to reassign integer indexes.
 * - They allow for collaborative updates. A user may insert an item at the same
 *   time another user moves an item. The items will end up in the right spot.
 *
 * When using order keys, make sure you guarantee the order key for each item is
 * unique.
 *
 * [1]: https://observablehq.com/@dgreensp/implementing-fractional-indexing
 */
export type OrderKey = string & {readonly _OrderKey: never};

export const orderKeyDigits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
let orderKeyDigitsSet: Set<string>;

/**
 * Is the provided string a valid `OrderKey`?
 */
export function isOrderKey(string: string): string is OrderKey {
    if (string.length < 2) return false;

    const head = string[0]!;
    if (!((head >= "a" && head <= "z") || (head >= "A" && head <= "Z"))) return false;

    const integerPartLength = getOrderKeyIntegerPartLength(head);
    if (integerPartLength > string.length) return false;

    if (!orderKeyDigitsSet) orderKeyDigitsSet = new Set(orderKeyDigits);

    for (let index = 0; index < string.length; index++) {
        if (!orderKeyDigitsSet.has(string[index]!)) return false;
    }

    return true;
}

/**
 * Asserts that the provided string is an `OrderKey`.
 */
export function assertOrderKey(string: string): OrderKey {
    assert(isOrderKey(string));
    return string;
}

const zeroOrderKey = "a0" as OrderKey;
export const minOrderKey = "A00000000000000000000000000" as OrderKey;
export const maxOrderKey = "zzzzzzzzzzzzzzzzzzzzzzzzzzz" as OrderKey;

function midpoint(a: string, b: string | null): string {
    assert(!b || a < b);
    assert(a.slice(-1) !== "0");
    assert(!b || b.slice(-1) !== "0");

    if (b) {
        // Remove longest common prefix. Pad `a` with 0s as we go. Note that we don't need
        // to pad `b`, because it can't end before `a` while traversing the common prefix.
        let n = 0;
        while ((a.charAt(n) || "0") === b.charAt(n)) {
            n++;
        }
        if (n > 0) {
            return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
        }
    }

    // First digits (or lack of digit) are different
    const digitA = a ? orderKeyDigits.indexOf(a.charAt(0)) : 0;
    const digitB = b !== null ? orderKeyDigits.indexOf(b.charAt(0)) : orderKeyDigits.length;
    if (digitB - digitA > 1) {
        const midDigit = Math.round(0.5 * (digitA + digitB));
        return orderKeyDigits.charAt(midDigit);
    } else {
        // First digits are consecutive
        if (b && b.length > 1) {
            return b.slice(0, 1);
        } else {
            // `b` is null or has length 1 (a single digit). The first digit of `a` is the
            // previous digit to `b`, or 9 if `b` is null.
            //
            // Given, for example, `midpoint('49', '5')`, return `'4' + midpoint('9', null)`,
            // which will become `'4' + '9' + midpoint('', null)`, which is `'495'`.
            return orderKeyDigits.charAt(digitA) + midpoint(a.slice(1), null);
        }
    }
}

function getOrderKeyIntegerPartLength(head: string) {
    if (head >= "a" && head <= "z") return head.charCodeAt(0) - "a".charCodeAt(0) + 2;
    if (head >= "A" && head <= "Z") return "Z".charCodeAt(0) - head.charCodeAt(0) + 2;

    throw new InvalidArgumentError("Unexpected head character");
}

function getOrderKeyIntegerPart(key: OrderKey): OrderKey {
    const integerPartLength = getOrderKeyIntegerPartLength(key.charAt(0));
    assert(integerPartLength <= key.length);
    return key.slice(0, integerPartLength) as OrderKey;
}

function incrementIntegerOrderKey(x: OrderKey): OrderKey | null {
    assert(x.length === getOrderKeyIntegerPartLength(x.charAt(0)));

    const [head, ...digits] = x.split("");
    let carry = true;
    for (let i = digits.length - 1; carry && i >= 0; i--) {
        const d = orderKeyDigits.indexOf(digits[i]!) + 1;
        if (d === orderKeyDigits.length) {
            digits[i] = "0";
        } else {
            digits[i] = orderKeyDigits.charAt(d);
            carry = false;
        }
    }
    if (carry) {
        if (head === "Z") return "a0" as OrderKey;
        if (head === "z") return null;
        const h = String.fromCharCode(head!.charCodeAt(0) + 1);
        if (h > "a") {
            digits.push("0");
        } else {
            digits.pop();
        }
        return (h + digits.join("")) as OrderKey;
    } else {
        return (head! + digits.join("")) as OrderKey;
    }
}

function decrementIntegerOrderKey(x: OrderKey): OrderKey | null {
    assert(x.length === getOrderKeyIntegerPartLength(x.charAt(0)));

    const [head, ...digits] = x.split("");
    let borrow = true;
    for (let i = digits.length - 1; borrow && i >= 0; i--) {
        const d = orderKeyDigits.indexOf(digits[i]!) - 1;
        if (d === -1) {
            digits[i] = orderKeyDigits.slice(-1);
        } else {
            digits[i] = orderKeyDigits.charAt(d);
            borrow = false;
        }
    }
    if (borrow) {
        if (head === "a") return ("Z" + orderKeyDigits.slice(-1)) as OrderKey;
        if (head === "A") return null;
        const h = String.fromCharCode(head!.charCodeAt(0) - 1);
        if (h < "Z") digits.push(orderKeyDigits.slice(-1));
        else digits.pop();
        return (h + digits.join("")) as OrderKey;
    } else {
        return (head! + digits.join("")) as OrderKey;
    }
}

function validateOrderKey(key: OrderKey) {
    assert(key !== minOrderKey);
    const i = getOrderKeyIntegerPart(key);
    const f = key.slice(i.length);
    assert(f.slice(-1) !== "0");
}

/**
 * The initial order key to use when starting a list.
 */
export const initialOrderKey = zeroOrderKey;

/**
 * Generate a new order key between two existing keys.
 *
 * If you pass in `null` for `a` that represents the start of the list. If you pass
 * in `null` for `b` that represents the end of the list.
 */
export function generateOrderKeyBetween(a: OrderKey | null, b: OrderKey | null): OrderKey {
    if (a !== null) validateOrderKey(a);
    if (b !== null) validateOrderKey(b);

    assert(a === null || b === null || a < b);

    if (a === null) {
        if (b === null) return zeroOrderKey;

        const ib = getOrderKeyIntegerPart(b);
        const fb = b.slice(ib.length);
        if (ib === minOrderKey) {
            return (ib + midpoint("", fb)) as OrderKey;
        }
        return ib < b ? ib : decrementIntegerOrderKey(ib)!;
    }

    if (b === null) {
        const ia = getOrderKeyIntegerPart(a);
        const fa = a.slice(ia.length);
        const i = incrementIntegerOrderKey(ia);
        return i === null ? ((ia + midpoint(fa, null)) as OrderKey) : i;
    }

    const ia = getOrderKeyIntegerPart(a);
    const fa = a.slice(ia.length);
    const ib = getOrderKeyIntegerPart(b);
    const fb = b.slice(ib.length);
    if (ia === ib) return (ia + midpoint(fa, fb)) as OrderKey;

    const i = incrementIntegerOrderKey(ia)!;
    return i < b ? i : ((ia + midpoint(fa, null)) as OrderKey);
}

/**
 * Generate multiple order keys between two existing keys. We generate the new keys
 * so that they're balanced.
 *
 * If you pass in `null` for `a` that represents the start of the list. If you pass
 * in `null` for `b` that represents the end of the list.
 */
export function generateOrderKeysBetween(
    a: OrderKey | null,
    b: OrderKey | null,
    n: number,
): Array<OrderKey> {
    if (n === 0) return [];
    if (n === 1) return [generateOrderKeyBetween(a, b)];

    if (b === null) {
        let c = generateOrderKeyBetween(a, b);
        const result = [c];
        for (let i = 0; i < n - 1; i++) {
            c = generateOrderKeyBetween(c, b);
            result.push(c);
        }
        return result;
    }

    if (a === null) {
        let c = generateOrderKeyBetween(a, b);
        const result = [c];
        for (let i = 0; i < n - 1; i++) {
            c = generateOrderKeyBetween(a, c);
            result.push(c);
        }
        result.reverse();
        return result;
    }

    const mid = Math.floor(n / 2);
    const c = generateOrderKeyBetween(a, b);
    return [
        ...generateOrderKeysBetween(a, c, mid),
        c,
        ...generateOrderKeysBetween(c, b, n - mid - 1),
    ];
}
