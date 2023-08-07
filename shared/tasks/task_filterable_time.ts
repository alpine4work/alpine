import {CalendarDate, parseAbsolute, toCalendarDate} from "@internationalized/date";
import {
    HybridLogicalTime,
    areHybridLogicalTimesEqual,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {TimeZone} from "~/shared/helpers/date/time_zone.js";
import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {TimeZoneSchema} from "~/shared/schema/helpers/time_zone_schema.js";
import {Schema} from "~/shared/schema/schema.js";

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
export class TaskFilterableTime {
    /**
     * The absolute time this date occurred in the UTC time zone.
     *
     * This is used for sorting but not filtering. `setterDate` is used for
     * filtering. See the documentation comment on this class for why.
     */
    public readonly absoluteTime: HybridLogicalTime;

    /**
     * The time zone of the user who set this time. For example, if a user creates
     * a task in Colorado then this will be set to `America/Denver` (GMT-6) and
     * `absoluteTime` will be in UTC.
     */
    public readonly setterTimeZone: TimeZone;

    /**
     * The date relative to the user who set this time. Computed from
     * `absoluteTime` and `setterTimeZone`.
     *
     * This is used for filtering but not sorting. `absoluteTime` is used for
     * sorting. See the documentation comment on this class for why.
     */
    public readonly setterDate: CalendarDate;

    constructor({
        absoluteTime,
        setterTimeZone,
    }: {
        absoluteTime: HybridLogicalTime;
        setterTimeZone: TimeZone;
    }) {
        this.absoluteTime = absoluteTime;
        this.setterTimeZone = setterTimeZone;
        this.setterDate = getTaskFilterableTimeSetterDate(absoluteTime, setterTimeZone);
    }

    public static readonly schema = Schema.object({
        absoluteTime: HybridLogicalTimeSchema,
        setterTimeZone: TimeZoneSchema,
    }).transform<TaskFilterableTime>({
        serialize: time => time,
        deserialize: time => new TaskFilterableTime(time),
    });

    public isEqual(other: TaskFilterableTime): boolean {
        return (
            areHybridLogicalTimesEqual(this.absoluteTime, other.absoluteTime) &&
            this.setterTimeZone === other.setterTimeZone
        );
    }
}

export function getTaskFilterableTimeSetterDate(
    absoluteTime: HybridLogicalTime,
    setterTimeZone: TimeZone,
): CalendarDate {
    return toCalendarDate(parseAbsolute(new Date(absoluteTime[0]).toISOString(), setterTimeZone));
}
