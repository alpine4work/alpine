import {expectTypeOf} from "expect-type";
import {UnionToTuple} from "~/shared/helpers/types/union-to-tuple";

test("converts a union to a tuple", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const tuple: UnionToTuple<"a" | "b" | "c"> = ["a", "b", "c"];

    expectTypeOf<UnionToTuple<"a" | "b" | "c">>().toEqualTypeOf<["a", "b", "c"]>();
});
