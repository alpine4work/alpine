import {CalendarDate, parseAbsolute, toCalendarDate} from "@internationalized/date";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {TimeZone} from "~/shared/helpers/date/time_zone.js";
import {AccountId, TaskId} from "~/shared/id/types/id_types.js";
import {LabelStringSchema} from "~/shared/schema/label_string_schema.js";
import {Model} from "~/shared/schema/model/model.js";
import {Schema} from "~/shared/schema/schema.js";
import {TimeZoneSchema} from "~/shared/schema/time_zone_schema.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set_schema.js";
import {TaskTitleSchema} from "~/shared/tasks/task_title_schema.js";

/**
 * The representation of an account in a task model. Carries some information
 * in addition to the `AccountModel`.
 */
export class TaskAccountModel extends Model(
    Schema.object({
        /**
         * The standard account model. It is not kept up to date in realtime by the
         * task realtime system! We call it "stale" to reflect that it's not realtime
         * relative to the rest of our task data (unlike `workingAccountName`).
         */
        // NOTE(calebmer, 2023-07-12): We don't yet have a system for keeping
        // `AccountModel` up-to-date in realtime but I'd like us to have one
        // eventually. My rough idea is to not actually maintain a realtime connection
        // for account updates but rather if we get a new `AccountModel` from the
        // network, somehow make sure we render the same `AccountModel` everywhere.
        //
        // In that case `AccountModel` would be more like a reference to a centralized
        // map somewhere in the React component tree or HTTP response.
        staleAccount: AccountModel.schema(),

        /**
         * We denormalize the account's name into the task and keep it up to date in
         * realtime.
         *
         * Users expect when they sort by accounts to see accounts in alphabetical
         * order by name. That means account name needs to be integrated with our query
         * system. However in practice it lives in a separate DynamoDB table from our
         * task data and has less strict realtime requirements than our task query
         * system. So we store the account name directly in the task and index it in
         * OpenSearch.
         */
        accountName: LabelStringSchema,
    }),
) {
    // `AccountId` never changes. Give it a convenient alias that doesn't have
    // "stale" in the name.
    public get id(): AccountId {
        return this.staleAccount.id;
    }

    public isEqual(other: TaskAccountModel): boolean {
        return this.id === other.id && this.accountName === other.accountName;
    }
}

/**
 * Time zones are fun. We represent filterable times in our task system with
 * both the absolute UTC time and the time zone of the user who set the time.
 *
 * Why do we need both? Well, we filter _not_ by the absolute UTC time,
 * _not_ by the client's local time, but rather by the date of the user who
 * set the time.
 *
 * Why do we do this? Well our filters do not deal with time zones. You filter
 * by `date = X` or `date < Y` where X and Y are dates in the client's
 * time zone. I am in New York. Let's say I'm collaborating with someone in
 * Tokyo which has a +13 hour offset. If I filter their tasks with
 * `createdDate = 2023-07-12` what should I see? I think the most reasonable
 * interpretation here is I want to see tasks they created on their July 12th
 * workday. Not half of the tasks that fell on the right half of the time zone
 * offset cutoff. If I'm filtering for a team, then I think the most reasonable
 * interpretation is I want to see all tasks created across our July 12th
 * workdays.
 *
 * The claim we're making here is it's more important to capture the concept of
 * a "workday" for a business and abstract away time zones. Time zones matter
 * less in the past/future than the present.
 *
 * Sorting is a different story. Then I do care about seeing a correct
 * chronological record of tasks. Even if it may look weird when I make a date
 * field visible and see some date jumps around time zone borders.
 *
 * (We may add configuration options in the future for tuning our time zone
 * behavior. By including the setter time zone in our database we give ourselves
 * a lot of flexibility for presenting reasonable filtering/sorting options to
 * users.)
 */
export class TaskDateModel extends Model(
    Schema.object({
        /**
         * The absolute time this date occurred in the UTC time zone.
         *
         * This is used for sorting but not filtering. `setterDate` is used for
         * filtering. See the documentation comment on this class for why.
         */
        absoluteTime: Schema.date,

        /**
         * The time zone of the user who set this time. For example, if a user creates
         * a task in Colorado then this will be set to `America/Denver` (GMT-6) and
         * `absoluteTime` will be in UTC.
         */
        setterTimeZone: TimeZoneSchema,
    }),
) {
    /**
     * The date relative to the user who set this time. Computed from
     * `absoluteTime` and `setterTimeZone`.
     *
     * This is used for filtering but not sorting. `absoluteTime` is used for
     * sorting. See the documentation comment on this class for why.
     */
    public readonly setterDate: CalendarDate;

    constructor(data: {absoluteTime: Date; setterTimeZone: TimeZone}) {
        super(data);
        this.setterDate = toCalendarDate(
            parseAbsolute(data.absoluteTime.toISOString(), data.setterTimeZone),
        );
    }

    public isEqual(other: TaskDateModel): boolean {
        return (
            this.absoluteTime.getTime() === other.absoluteTime.getTime() &&
            this.setterTimeZone === other.setterTimeZone
        );
    }
}

/**
 * Representation of a task in our task system.
 */
export class TaskModel extends Model(
    Schema.object({
        id: Schema.id<TaskId>(),

        /** The account who created the task. */
        creator: TaskAccountModel.schema(),

        /** The time at which the task was created. */
        createdTime: TaskDateModel.schema(),

        /** The title of the task. */
        title: TaskTitleSchema,

        /** The collections our task is in. */
        collections: TaskCollectionSet.schema,
    }),
) {
    // Lets us use `TaskModel` as a member of a union.
    public readonly type = undefined;
}
