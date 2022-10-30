import {expectTypeOf} from "expect-type";
import {UnionToTuple} from "~/shared/helpers/types/union-to-tuple";

test("converts a union to a tuple", () => {
    expectTypeOf<UnionToTuple<"a" | "b" | "c">>().toMatchTypeOf<
        | ["a", "b", "c"]
        | ["a", "c", "b"]
        | ["b", "a", "c"]
        | ["c", "a", "b"]
        | ["b", "c", "a"]
        | ["c", "b", "a"]
    >();
});
