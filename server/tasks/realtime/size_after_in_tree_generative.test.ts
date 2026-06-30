import {RBTree} from "bintrees";
import fc from "fast-check";
import {sizeAfterInTree} from "~/server/tasks/realtime/size_after_in_tree.js";

import.meta.jest.setTimeout(25 * 1000);
fc.configureGlobal({interruptAfterTimeLimit: 15 * 1000});

test("gets the correct size after a value", () => {
    fc.assert(
        fc.property(
            fc.record({
                tree: fc.array(fc.integer({min: 1, max: 1_000_000})),
                value: fc.integer({min: 1, max: 1_000_000}),
            }),
            ({tree: treeValues, value}) => {
                const tree = new RBTree<number>((a, b) => a - b);
                for (const value of treeValues) tree.insert(value);

                const actualSizeAfter = sizeAfterInTree(tree, value);

                let expectedSizeAfter = 0;

                if (treeValues.length > 0) {
                    const iterator = tree.lowerBound(value);

                    if (iterator.data() !== value) expectedSizeAfter++;

                    while (iterator.next() !== null) {
                        expectedSizeAfter++;
                    }
                }

                expect(actualSizeAfter).toBe(expectedSizeAfter);
            },
        ),
        {
            // Run until we reach our 10s timeout.
            numRuns: Infinity,
        },
    );
});
