import {expectTypeOf} from "expect-type";
import {UnionToTuple} from "~/shared/helpers/types/union-to-tuple";

test("converts a union to a tuple", () => {
    // Hoping using `keyof` will make tuple order deterministic?
    type Union = keyof {a: true; b: true; c: true};

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const tuple: UnionToTuple<Union> = ["a", "b", "c"];

    expectTypeOf<UnionToTuple<Union>>().toEqualTypeOf<["a", "b", "c"]>();
});
