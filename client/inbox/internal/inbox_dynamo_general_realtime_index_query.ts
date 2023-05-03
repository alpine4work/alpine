import {
    DynamoGeneralRealtimeIndexQueryBase,
    DynamoGeneralRealtimeIndexQueryData,
} from "~/client/dynamo/dynamo_general_realtime_index_query";
import {
    DynamoGeneralRealtimeIndexQueryResult,
    DynamoGeneralRealtimeItem,
} from "~/shared/dynamo/dynamo_general_realtime_types";
import {DynamoIndexCursor} from "~/shared/dynamo/dynamo_opaque_strings";
import {ImmutableSet} from "~/shared/helpers/immutable/immutable_set";
import {InboxEntryModel} from "~/shared/models/inbox_model";

type InboxDynamoGeneralRealtimeIndexQueryExtraItem = {
    readonly type: "AnimatingDeletion";
    readonly oldCursor: DynamoIndexCursor;
    readonly oldItem: DynamoGeneralRealtimeItem<InboxEntryModel>;
};

export class InboxDynamoGeneralRealtimeIndexQuery extends DynamoGeneralRealtimeIndexQueryBase<
    InboxEntryModel,
    InboxDynamoGeneralRealtimeIndexQueryExtraItem
> {
    private readonly _animatingDeletedCursors: ImmutableSet<DynamoIndexCursor>;

    // Private constructor means you can't subclass.
    private constructor(
        data: DynamoGeneralRealtimeIndexQueryData<
            InboxEntryModel,
            InboxDynamoGeneralRealtimeIndexQueryExtraItem
        >,
        {
            animatingDeletedCursors,
        }: {
            animatingDeletedCursors: ImmutableSet<DynamoIndexCursor>;
        },
    ) {
        super(data);
        this._animatingDeletedCursors = animatingDeletedCursors;
    }

    protected override _construct(
        data: DynamoGeneralRealtimeIndexQueryData<
            InboxEntryModel,
            InboxDynamoGeneralRealtimeIndexQueryExtraItem
        >,
    ): this {
        // Ok to case `as this` because our class has a private constructor and can't
        // be subclassed.
        return new InboxDynamoGeneralRealtimeIndexQuery(data, {
            animatingDeletedCursors: this._animatingDeletedCursors,
        }) as this;
    }

    /**
     * Initialize our immutable query data type with a query result.
     *
     * Does not currently support initializing data in the middle of the query.
     */
    public static new(result: DynamoGeneralRealtimeIndexQueryResult<InboxEntryModel>) {
        return new InboxDynamoGeneralRealtimeIndexQuery(
            DynamoGeneralRealtimeIndexQueryBase._getInitialData(result),
            {animatingDeletedCursors: ImmutableSet.empty()},
        );
    }

    // Leave an extra item around in the query when a normal item is deleted so we
    // can animate the item out of the list.
    protected _afterItemDeleted(
        oldCursor: DynamoIndexCursor,
        oldItem: DynamoGeneralRealtimeItem<InboxEntryModel>,
    ) {
        const self = this._setExtraItem(oldCursor, {
            type: "AnimatingDeletion",
            oldCursor,
            oldItem,
        });

        return new InboxDynamoGeneralRealtimeIndexQuery(self._getData(), {
            animatingDeletedCursors: self._animatingDeletedCursors.add(oldCursor),
        }) as this;
    }

    public getAnimatingDeletedItemCountBefore(cursor: DynamoIndexCursor) {
        let count = 0;

        for (const animatingDeletedCursor of this._animatingDeletedCursors) {
            if (animatingDeletedCursor < cursor) {
                count++;
            }
        }

        return count;
    }
}
