import type {Memo} from "react";

/**
 * An object that has been `Memo`d by React. If an object is memoized then we
 * can consider all of its entries as also memoized since they will update even
 * less frequently than the object itself. This type helps describe objects
 * like this where you want to pick off individual values that are treated
 * as `Memo`'d.
 */
export type MemoObject<Value> = Memo<{
    [Key in keyof Value]: Memo<Value[Key]>;
}>;
