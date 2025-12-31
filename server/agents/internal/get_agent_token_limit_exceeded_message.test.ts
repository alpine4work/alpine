import {getAgentTokenLimitExceededMessage} from "~/server/agents/internal/get_agent_token_limit_exceeded_message.js";
import {assertTimeZone} from "~/shared/helpers/intl/time_zone.js";

describe("getAgentTokenLimitExceededMessage", () => {
    test("returns message with ‘today at’ when reset is same day", () => {
        const currentTime = new Date("2025-01-15T15:00:00.000Z"); // 10am EST
        const resetTime = new Date("2025-01-15T23:00:00.000Z"); // 6pm EST

        const result = getAgentTokenLimitExceededMessage(
            resetTime,
            currentTime,
            assertTimeZone("America/New_York"),
        );

        expect(result).toBe(
            "You’ve reached your agent usage limit. Your limit will reset today at 6:00pm EST. You can get higher usage limits by [buying lifetime Alpine access](https://alpine.inc#pricing).",
        );
    });

    test("returns message with ‘tomorrow at’ when reset is next day", () => {
        const currentTime = new Date("2025-01-15T15:00:00.000Z"); // 10am EST
        const resetTime = new Date("2025-01-16T15:00:00.000Z"); // 10am EST next day

        const result = getAgentTokenLimitExceededMessage(
            resetTime,
            currentTime,
            assertTimeZone("America/New_York"),
        );

        expect(result).toBe(
            "You’ve reached your agent usage limit. Your limit will reset tomorrow at 10:00am EST. You can get higher usage limits by [buying lifetime Alpine access](https://alpine.inc#pricing).",
        );
    });

    test("returns message with formatted date when reset is in future", () => {
        const currentTime = new Date("2025-01-15T15:00:00.000Z");
        const resetTime = new Date("2025-01-22T15:00:00.000Z"); // 7 days later

        const result = getAgentTokenLimitExceededMessage(
            resetTime,
            currentTime,
            assertTimeZone("America/New_York"),
        );

        expect(result).toBe(
            "You’ve reached your agent usage limit. Your limit will reset on Jan 22nd at 10:00am EST. You can get higher usage limits by [buying lifetime Alpine access](https://alpine.inc#pricing).",
        );
    });
});
