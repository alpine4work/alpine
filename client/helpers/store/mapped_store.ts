import {Store} from "~/client/helpers/store/internal/store.js";

/**
 * A combinator for `Store` where we can transform the underlying value.
 */
export class MappedStore<OldValue, NewValue> extends Store<NewValue> {
    private _store: Store<OldValue>;
    private _map: (value: OldValue) => NewValue;
    private _state: {
        readonly oldValue: OldValue;
        readonly newValue: NewValue;
    } | null = null;

    constructor(store: Store<OldValue>, map: (value: OldValue) => NewValue) {
        super();
        this._store = store;
        this._map = map;
    }

    public override getSnapshot = () => {
        const oldValue = this._store.getSnapshot();

        if (this._state === null || !Object.is(this._state.oldValue, oldValue)) {
            this._state = {
                oldValue,
                newValue: this._map(oldValue),
            };
        }

        return this._state.newValue;
    };

    public override subscribe = (listener: () => void) => {
        // We wrap our listener to:
        //
        // 1. Garbage collect mapped state values.
        // 2. Treat `mappedStore.subscribe(listener)` and
        //    `mappedStore._store.subscribe(listener)` with the same `listener` as
        //    distinct calls. Unsubscribe one shouldn't unsubscribe the other.
        const wrappedListener = () => {
            this._state = null;
            listener();
        };

        return this._store.subscribe(wrappedListener);
    };
}
