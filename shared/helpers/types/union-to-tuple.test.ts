import {expectTypeOf} from "expect-type";
import {UnionToTuple} from "~/shared/helpers/types/union-to-tuple";

test("converts a union to a tuple", () => {
    expectTypeOf<UnionToTuple<"a" | "b" | "c">>().toEqualTypeOf<["a", "b", "c"]>();
});
