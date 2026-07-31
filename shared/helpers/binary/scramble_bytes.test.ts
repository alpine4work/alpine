import fc from "fast-check";
import {scrambleBytes, unscrambleBytes} from "~/shared/helpers/binary/scramble_bytes.js";

import.meta.jest.setTimeout(20 * 1000);
fc.configureGlobal({interruptAfterTimeLimit: 10 * 1000});

test("can unscramble scrambled bytes", () => {
    fc.assert(
        fc.property(fc.uint8Array(), fc.integer({min: 0, max: 0xffff_ffff}), (bytes, seed) => {
            expect(unscrambleBytes(scrambleBytes(bytes, seed), seed)).toEqual(bytes);
        }),
        {
            // Run until we reach our 10s timeout.
            numRuns: Infinity,
        },
    );
});
