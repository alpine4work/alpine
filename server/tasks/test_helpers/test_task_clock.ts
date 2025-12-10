import {HybridLogicalClock} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";

export const testTaskClock = new HybridLogicalClock(unsynchronizedSystemClock);
