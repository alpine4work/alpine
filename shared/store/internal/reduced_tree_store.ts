import {Tree} from "functional-red-black-tree";
import {TreeChange, symmetricDiffTree} from "~/shared/helpers/immutable/symmetric_diff_tree.js";
import {Store} from "~/shared/store/internal/store.js";

/**
 * A combinator for `Store<Tree<TreeKey, TreeValue>>` that lets you reduce into a
 * single, new, `Value` efficiently. Since instead of reducing the entire tree when
 * the underlying store updates, we diff the tree and use the diff to update
 * `Value`.
 *
 * We use this to build simpler combinators on tree stores. Like
 * `mapTreeStoreValues()` which maps tree values but only when those values change.
 */
export class ReducedTreeStore<TreeKey, TreeValue, Value> extends Store<Value> {
    private readonly _store: Store<Tree<TreeKey, TreeValue>>;
    private readonly _reduce: (value: Value, change: TreeChange<TreeKey, TreeValue>) => Value;
    private _previousTree: Tree<TreeKey, TreeValue> | null = null;
    private _value: Value;

    constructor(
        store: Store<Tree<TreeKey, TreeValue>>,
        reduce: (value: Value, change: TreeChange<TreeKey, TreeValue>) => Value,
        initialValue: Value,
    ) {
        super();
        this._store = store;
        this._reduce = reduce;
        this._value = initialValue;
    }

    public override isFinal(): boolean {
        return this._store.isFinal();
    }

    public readonly getSnapshot = () => {
        const tree = this._store.getSnapshot();

        // It's ok if `reduce()` throws an error since our store won't be left in a broken
        // state. We will end up re-evaluating changes to the tree next time `getSnapshot`
        // is called unlike other utilities which memorize the error and rethrow it until
        // the underlying store changes.
        if (this._previousTree === null) {
            const reduce = this._reduce;
            let value = this._value;

            const iterator = tree.begin;
            while (iterator.valid) {
                value = reduce(value, {
                    type: "CreateEntry",
                    key: iterator.key!,
                    newValue: iterator.value!,
                });
                iterator.next();
            }

            this._previousTree = tree;
            this._value = value;
        } else if (this._previousTree !== tree) {
            const reduce = this._reduce;
            let value = this._value;

            const changes = symmetricDiffTree(this._previousTree, tree);
            for (const change of changes) {
                value = reduce(value, change);
            }

            this._previousTree = tree;
            this._value = value;
        }

        return this._value;
    };

    public addListener(listener: () => void) {
        this._store.addListener(listener);
    }

    public removeListener(listener: () => void) {
        this._store.removeListener(listener);
    }

    public _addWeakImmediateListener(listener: () => void): void {
        this._store._addWeakImmediateListener(listener);
    }

    public _removeWeakImmediateListener(listener: () => void): void {
        this._store._removeWeakImmediateListener(listener);
    }
}
