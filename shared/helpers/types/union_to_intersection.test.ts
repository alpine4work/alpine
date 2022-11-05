import {expectTypeOf} from "expect-type";
import {UnionToIntersection} from "~/shared/helpers/types/union_to_intersection";

test("converts a union to an intersection", () => {
    expectTypeOf<UnionToIntersection<{a: number} | {b: number} | {c: number}>>().toEqualTypeOf<
        {a: number} & {b: number} & {c: number}
    >();
});
