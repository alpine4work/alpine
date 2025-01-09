import {
    AccessLevel,
    compareAccessLevel,
    hasAccessLevel,
    maxAccessLevel,
    minAccessLevel,
} from "~/shared/access/access_policy.js";

// Enumerate all possible cases. The first element is the smaller.
const testCases: Array<[AccessLevel | null, AccessLevel | null]> = [
    [null, null],
    [null, "View"],
    [null, "Comment"],
    [null, "Edit"],
    [null, "Manage"],
    ["View", "View"],
    ["View", "Comment"],
    ["View", "Edit"],
    ["View", "Manage"],
    ["Comment", "Comment"],
    ["Comment", "Edit"],
    ["Comment", "Manage"],
    ["Edit", "Edit"],
    ["Edit", "Manage"],
    ["Manage", "Manage"],
];

test("access level comparisons are correct", () => {
    // Base line hard coded tests before dynamic tests as a sanity check.
    {
        expect(hasAccessLevel(null, "View")).toEqual(false);
        expect(hasAccessLevel("View", null)).toEqual(true);

        expect(minAccessLevel(null, "View")).toEqual(null);
        expect(minAccessLevel("View", null)).toEqual(null);

        expect(maxAccessLevel(null, "View")).toEqual("View");
        expect(maxAccessLevel("View", null)).toEqual("View");

        expect(compareAccessLevel(null, "View")).toEqual(-1);
        expect(compareAccessLevel("View", null)).toEqual(1);

        expect(hasAccessLevel("Comment", "Manage")).toEqual(false);
        expect(hasAccessLevel("Manage", "Comment")).toEqual(true);

        expect(minAccessLevel("Comment", "Manage")).toEqual("Comment");
        expect(minAccessLevel("Manage", "Comment")).toEqual("Comment");

        expect(maxAccessLevel("Comment", "Manage")).toEqual("Manage");
        expect(maxAccessLevel("Manage", "Comment")).toEqual("Manage");

        expect(compareAccessLevel("Comment", "Manage")).toEqual(-1);
        expect(compareAccessLevel("Manage", "Comment")).toEqual(1);

        expect(hasAccessLevel("Edit", "Edit")).toEqual(true);

        expect(minAccessLevel("Edit", "Edit")).toEqual("Edit");

        expect(maxAccessLevel("Edit", "Edit")).toEqual("Edit");

        expect(compareAccessLevel("Edit", "Edit")).toEqual(0);
    }

    for (const [smallerAccessLevel, largerAccessLevel] of testCases) {
        expect(hasAccessLevel(smallerAccessLevel, largerAccessLevel)).toEqual(
            smallerAccessLevel === largerAccessLevel ? true : false,
        );
        expect(hasAccessLevel(largerAccessLevel, smallerAccessLevel)).toEqual(true);

        expect(minAccessLevel(smallerAccessLevel, largerAccessLevel)).toEqual(smallerAccessLevel);
        expect(minAccessLevel(largerAccessLevel, smallerAccessLevel)).toEqual(smallerAccessLevel);

        expect(maxAccessLevel(smallerAccessLevel, largerAccessLevel)).toEqual(largerAccessLevel);
        expect(maxAccessLevel(largerAccessLevel, smallerAccessLevel)).toEqual(largerAccessLevel);

        expect(compareAccessLevel(smallerAccessLevel, largerAccessLevel)).toEqual(
            smallerAccessLevel === largerAccessLevel ? 0 : -1,
        );
        expect(compareAccessLevel(largerAccessLevel, smallerAccessLevel)).toEqual(
            smallerAccessLevel === largerAccessLevel ? 0 : 1,
        );
    }
});
