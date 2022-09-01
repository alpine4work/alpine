/* eslint-disable @typescript-eslint/no-unused-vars */

// eslint-disable-next-line only-erasable-types
import {generateId} from "~/shared/id/id";

import type {Id} from "~/shared/id/id";

// Ok
type T1 = {a: number; b: number; c: number};

// Ok
interface T2 {
    a: number;
    b: number;
    c: number;
}

// eslint-disable-next-line only-erasable-types
const x = 42;

// eslint-disable-next-line only-erasable-types
class C {}

// eslint-disable-next-line only-erasable-types
test("ok", () => {
    // eslint-disable-next-line only-erasable-types
    expect(true).toEqual(true);
});
