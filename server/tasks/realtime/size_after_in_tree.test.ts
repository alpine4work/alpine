import {RBTree} from "bintrees";
import {sizeAfterInTree} from "~/server/tasks/realtime/size_after_in_tree.js";

const testCases: Array<{tree: Array<number>; value: number; sizeAfter: number}> = [
    {
        tree: [5, 7, 9, 11, 12, 16],
        value: 8,
        sizeAfter: 4,
    },
    {
        tree: [5, 7, 9, 11, 12, 16],
        value: 9,
        sizeAfter: 3,
    },
    {
        tree: [5, 7, 9, 11, 12, 16],
        value: 10,
        sizeAfter: 3,
    },
];

for (const testCase of testCases) {
    test(`size after ${testCase.value} in [${testCase.tree.join(", ")}]`, () => {
        const tree = new RBTree<number>((a, b) => a - b);
        for (const value of testCase.tree) tree.insert(value);
        expect(sizeAfterInTree(tree, testCase.value)).toBe(testCase.sizeAfter);
    });
}
