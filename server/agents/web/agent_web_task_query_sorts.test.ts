import {
    parseAgentWebTaskQuerySorts,
    printAgentWebTaskQuerySorts,
} from "~/server/agents/web/agent_web_task_query_sorts.open_source.js";
import {ApiTaskQuerySort} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {ErrorBase, InternalError} from "~/shared/error/error.open_source.js";

/**
 * Asserts that `sorts` print to exactly `searchParamsString` and that parsing
 * `searchParamsString` returns exactly `sorts` back. The printed string is inline
 * in each test so the aesthetics of the format are easy to review.
 */
function expectTaskQuerySortFormat(
    sorts: ReadonlyArray<ApiTaskQuerySort>,
    searchParamsString: string,
): void {
    expect({
        printed: printAgentWebTaskQuerySorts(sorts),
        parsed: parseAgentWebTaskQuerySorts(new URLSearchParams(searchParamsString)),
    }).toEqual({
        printed: searchParamsString,
        parsed: sorts,
    });
}

/**
 * Asserts that parsing `searchParamsString` throws an error with exactly the
 * `expected` display message. The full message is inline in each test so the
 * errors an agent would see are easy to review.
 */
function expectParseTaskQuerySortsDisplayMessage(
    searchParamsString: string,
    expected: string,
): void {
    let error: unknown;

    try {
        parseAgentWebTaskQuerySorts(new URLSearchParams(searchParamsString));
    } catch (actualError) {
        error = actualError;
    }

    if (error === undefined) throw new InternalError("Expected task sort parsing to throw");
    if (!(error instanceof ErrorBase) || !error.displayMessage) throw error;

    expect(error.displayMessage.map(segment => segment.text).join("")).toEqual(expected);
}

test("prints no search params for no sorts", () => {
    expectTaskQuerySortFormat([], "");
});

test("prints a status sort", () => {
    expectTaskQuerySortFormat([{type: "Status", direction: "Ascending"}], "sort=status");
});

test("prints a descending status sort", () => {
    expectTaskQuerySortFormat([{type: "Status", direction: "Descending"}], "sort=-status");
});

test("prints a priority sort", () => {
    expectTaskQuerySortFormat([{type: "Priority", direction: "Ascending"}], "sort=priority");
});

test("prints a descending priority sort", () => {
    expectTaskQuerySortFormat([{type: "Priority", direction: "Descending"}], "sort=-priority");
});

test("prints a layout sort with tasks missing a layout last", () => {
    expectTaskQuerySortFormat([{type: "Layout", missing: "Last"}], "sort=layout");
});

test("prints a layout sort with tasks missing a layout first", () => {
    expectTaskQuerySortFormat([{type: "Layout", missing: "First"}], "sort=-layout");
});

test("prints an assignee sort with unassigned tasks last", () => {
    expectTaskQuerySortFormat([{type: "Assignee", missing: "Last"}], "sort=assignee");
});

test("prints an assignee sort with unassigned tasks first", () => {
    expectTaskQuerySortFormat([{type: "Assignee", missing: "First"}], "sort=-assignee");
});

test("prints a creator sort", () => {
    expectTaskQuerySortFormat([{type: "Creator"}], "sort=creator");
});

test("prints an assigner sort with tasks missing an assigner last", () => {
    expectTaskQuerySortFormat([{type: "Assigner", missing: "Last"}], "sort=assigner");
});

test("prints an assigner sort with tasks missing an assigner first", () => {
    expectTaskQuerySortFormat([{type: "Assigner", missing: "First"}], "sort=-assigner");
});

test("prints a due date sort", () => {
    expectTaskQuerySortFormat([{type: "Due", direction: "Ascending"}], "sort=due");
});

test("prints a descending due date sort", () => {
    expectTaskQuerySortFormat([{type: "Due", direction: "Descending"}], "sort=-due");
});

test("prints a created time sort", () => {
    expectTaskQuerySortFormat([{type: "CreatedTime", direction: "Ascending"}], "sort=created");
});

test("prints a descending created time sort", () => {
    expectTaskQuerySortFormat([{type: "CreatedTime", direction: "Descending"}], "sort=-created");
});

test("prints an assigned time sort", () => {
    expectTaskQuerySortFormat([{type: "AssignedTime", direction: "Ascending"}], "sort=assigned");
});

test("prints a descending assigned time sort", () => {
    expectTaskQuerySortFormat([{type: "AssignedTime", direction: "Descending"}], "sort=-assigned");
});

test("prints a closed time sort", () => {
    expectTaskQuerySortFormat([{type: "ClosedTime", direction: "Ascending"}], "sort=closed");
});

test("prints a descending closed time sort", () => {
    expectTaskQuerySortFormat([{type: "ClosedTime", direction: "Descending"}], "sort=-closed");
});

test("prints an activated time sort", () => {
    expectTaskQuerySortFormat([{type: "ActivatedTime", direction: "Ascending"}], "sort=activated");
});

test("prints a descending activated time sort", () => {
    expectTaskQuerySortFormat(
        [{type: "ActivatedTime", direction: "Descending"}],
        "sort=-activated",
    );
});

test("prints multiple sorts with earlier sorts taking priority", () => {
    expectTaskQuerySortFormat(
        [
            {type: "Priority", direction: "Descending"},
            {type: "Assignee", missing: "Last"},
            {type: "Due", direction: "Ascending"},
        ],
        "sort=-priority,assignee,due",
    );
});

test("prints repeated sort types", () => {
    expectTaskQuerySortFormat(
        [
            {type: "CreatedTime", direction: "Ascending"},
            {type: "CreatedTime", direction: "Descending"},
        ],
        "sort=created,-created",
    );
});

test("prints identical repeated sorts", () => {
    expectTaskQuerySortFormat(
        [
            {type: "Due", direction: "Ascending"},
            {type: "Due", direction: "Ascending"},
        ],
        "sort=due,due",
    );
});

test("parses an explicitly ascending sort", () => {
    expect(parseAgentWebTaskQuerySorts(new URLSearchParams("sort=+created"))).toEqual([
        {type: "CreatedTime", direction: "Ascending"},
    ]);
});

test("parses a percent encoded plus as an explicitly ascending sort", () => {
    expect(parseAgentWebTaskQuerySorts(new URLSearchParams("sort=%2Bcreated"))).toEqual([
        {type: "CreatedTime", direction: "Ascending"},
    ]);
});

test("parses an explicitly ascending creator sort", () => {
    expect(parseAgentWebTaskQuerySorts(new URLSearchParams("sort=+creator"))).toEqual([
        {type: "Creator"},
    ]);
});

test("parses repeated sort params in order", () => {
    expect(parseAgentWebTaskQuerySorts(new URLSearchParams("sort=-priority&sort=due"))).toEqual([
        {type: "Priority", direction: "Descending"},
        {type: "Due", direction: "Ascending"},
    ]);
});

test("parses no sorts from search params without a sort param", () => {
    expect(parseAgentWebTaskQuerySorts(new URLSearchParams("status=open&after=a1b2c3"))).toEqual(
        [],
    );
});

test("parses an empty sort param as no sorts", () => {
    expect(parseAgentWebTaskQuerySorts(new URLSearchParams("sort="))).toEqual([]);
});

test("parses a sort list with empty segments", () => {
    expect(parseAgentWebTaskQuerySorts(new URLSearchParams("sort=,due,"))).toEqual([
        {type: "Due", direction: "Ascending"},
    ]);
});

test("parses repeated sort keys across repeated sort params", () => {
    expect(parseAgentWebTaskQuerySorts(new URLSearchParams("sort=created&sort=-created"))).toEqual([
        {type: "CreatedTime", direction: "Ascending"},
        {type: "CreatedTime", direction: "Descending"},
    ]);
});

test("rejects an unknown sort key", () => {
    expectParseTaskQuerySortsDisplayMessage(
        "sort=name",
        "Unexpected task sort `name` in the `sort` URL search param. Try again with one of the " +
            "sort keys `status`, `priority`, `layout`, `assignee`, `creator`, `assigner`, " +
            "`due`, `created`, `assigned`, `closed`, or `activated`, where a `-` in front of a " +
            "key sorts descending (e.g. `sort=-created`).",
    );
});

test("rejects an unknown descending sort key", () => {
    expectParseTaskQuerySortsDisplayMessage(
        "sort=-name",
        "Unexpected task sort `-name` in the `sort` URL search param. Try again with one of " +
            "the sort keys `status`, `priority`, `layout`, `assignee`, `creator`, `assigner`, " +
            "`due`, `created`, `assigned`, `closed`, or `activated`, where a `-` in front of a " +
            "key sorts descending (e.g. `sort=-created`).",
    );
});

test("rejects an unknown ascending sort key quoting the plus the agent wrote", () => {
    expectParseTaskQuerySortsDisplayMessage(
        "sort=+name",
        "Unexpected task sort `+name` in the `sort` URL search param. Try again with one of " +
            "the sort keys `status`, `priority`, `layout`, `assignee`, `creator`, `assigner`, " +
            "`due`, `created`, `assigned`, `closed`, or `activated`, where a `-` in front of a " +
            "key sorts descending (e.g. `sort=-created`).",
    );
});

test("rejects a descending creator sort", () => {
    expectParseTaskQuerySortsDisplayMessage(
        "sort=-creator",
        "The `creator` task sort can\u2019t be reversed with `-` since sorting by creator " +
            "doesn\u2019t have a direction. Try again with `sort=creator`.",
    );
});

test("rejects a sort param with a bracket operator", () => {
    expectParseTaskQuerySortsDisplayMessage(
        "sort[desc]=created",
        "Unknown task sort `sort[desc]=...`. Try again with a plain `sort` search param " +
            "(e.g. `sort=created`) where a `-` in front of a sort key sorts descending " +
            "(e.g. `sort=-created`).",
    );
});
