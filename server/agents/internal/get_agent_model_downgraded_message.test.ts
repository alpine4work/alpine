import {getAgentModelDowngradedMessage} from "~/server/agents/internal/get_agent_model_downgraded_message.js";
import {assertTimeZone} from "~/shared/helpers/intl/time_zone.js";

describe("getAgentModelDowngradedMessage", () => {
    test("returns message with ‘today at’ when reset is same day", () => {
        const currentTime = new Date("2025-01-15T15:00:00.000Z"); // 10am EST
        const resetTime = new Date("2025-01-15T23:00:00.000Z"); // 6pm EST

        const result = getAgentModelDowngradedMessage(
            resetTime,
            currentTime,
            assertTimeZone("America/New_York"),
        );

        expect(result).toBe(
            "*⚠️ To help extend your usage, I’m now using a less intelligent model. I’ll be back to using the best available model today at 6:00pm. If you’d like to continue using the most intelligent models, purchase [Alpine Lifetime access](https://www.alpine.inc#pricing).*",
        );
    });

    test("returns message with ‘tomorrow at’ when reset is next day", () => {
        const currentTime = new Date("2025-01-15T15:00:00.000Z"); // 10am EST
        const resetTime = new Date("2025-01-16T15:00:00.000Z"); // 10am EST next day

        const result = getAgentModelDowngradedMessage(
            resetTime,
            currentTime,
            assertTimeZone("America/New_York"),
        );

        expect(result).toBe(
            "*⚠️ To help extend your usage, I’m now using a less intelligent model. I’ll be back to using the best available model tomorrow at 10:00am. If you’d like to continue using the most intelligent models, purchase [Alpine Lifetime access](https://www.alpine.inc#pricing).*",
        );
    });

    test("returns message with formatted date when reset is in future", () => {
        const currentTime = new Date("2025-01-15T15:00:00.000Z");
        const resetTime = new Date("2025-01-22T15:00:00.000Z"); // 7 days later

        const result = getAgentModelDowngradedMessage(
            resetTime,
            currentTime,
            assertTimeZone("America/New_York"),
        );

        expect(result).toBe(
            "*⚠️ To help extend your usage, I’m now using a less intelligent model. I’ll be back to using the best available model on Jan 22nd at 10:00am. If you’d like to continue using the most intelligent models, purchase [Alpine Lifetime access](https://www.alpine.inc#pricing).*",
        );
    });
});
