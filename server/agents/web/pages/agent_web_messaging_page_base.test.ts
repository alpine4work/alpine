import {
    AgentWebMessagingPageBase,
    parseAgentWebMessagingPageBase,
    printAgentWebMessagingPageBase,
} from "~/server/agents/web/pages/agent_web_messaging_page_base.js";
import {runAgentWebPageTests} from "~/server/agents/web/pages/run_agent_web_page_tests.js";

runAgentWebPageTests<null, AgentWebMessagingPageBase>({
    print: printAgentWebMessagingPageBase,
    parse: parseAgentWebMessagingPageBase,
    tests: [],
});
