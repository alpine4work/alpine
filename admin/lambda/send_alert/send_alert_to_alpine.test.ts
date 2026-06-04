import {
    GitHubActionsEventPayload,
    GitHubPushEventPayload,
} from "~/admin/lambda/send_alert/send_alert_github_actions.js";
import {HoneycombEventPayload} from "~/admin/lambda/send_alert/send_alert_honeycomb.js";
import {PagerDutyEventPayload} from "~/admin/lambda/send_alert/send_alert_pagerduty.js";
import {
    sendGitHubActionsAlertToAlpine,
    sendGitHubAlertToAlpine,
    sendHoneycombAlertToAlpine,
    sendPagerDutyAlertToAlpine,
} from "~/admin/lambda/send_alert/send_alert_to_alpine.js";
import {printApiContentToMarkdown} from "~/shared/api/markdown/print_api_content_to_markdown.js";
import {ApiContent} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

// Mock environment variables
const mockEnv = {
    ALPINE_API_KEY: "test-api-key",
    EDGE_SERVICE_URL: "https://test.cyberworlds.com",
};

// Store original environment
const originalEnv = process.env;

// Track which Honeycomb API URLs were called (to verify no API calls are made)
let mockHoneycombApiCalls: Array<string> = [];

// Mock fetch function
let mockFetchCalls: Array<{url: string; body: unknown}> = [];
const mockFetch = import.meta.jest.fn().mockImplementation((url: string, options?: any) => {
    // Track any Honeycomb API calls (to verify none are made)
    if (url.startsWith("https://api.honeycomb.io/")) {
        mockHoneycombApiCalls.push(url);
    }

    // Handle Alpine API calls
    if (options?.body) {
        mockFetchCalls.push({
            url,
            body: JSON.parse(options.body),
        });
    }
    return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(""),
    });
});

const testSpaceId = "test_space_id_for_snapshots" as SpaceId;

function formatFetchCallForSnapshot(fetchCall: {url: string; body: unknown}): string {
    const body = fetchCall.body as {channelId: string; content: ApiContent};
    const markdown = printApiContentToMarkdown(body.content, {spaceId: testSpaceId});
    return `URL: ${fetchCall.url}
Channel: ${body.channelId}

${markdown}`;
}

describe("sendAlertToAlpine", () => {
    beforeEach(() => {
        // Reset environment
        process.env = {...originalEnv, ...mockEnv};

        // Reset mock data
        mockFetchCalls = [];
        mockHoneycombApiCalls = [];

        // Mock global fetch
        global.fetch = mockFetch;
        mockFetch.mockClear();
    });

    afterEach(() => {
        // Restore original environment
        process.env = originalEnv;
    });

    describe("Honeycomb", () => {
        const createHoneycombFixture = (
            overrides: Partial<HoneycombEventPayload> = {},
        ): HoneycombEventPayload => ({
            name: "Database Connection Error",
            channel: "honeycomb",
            isEvent: "false",
            emoji: "",
            id: "hc-alert-123",
            description: "High error rate detected in database connections",
            environment: "production",
            links: {
                trigger: "https://ui.honeycomb.io/cyberworlds/triggers/db-error-trigger",
                result: "https://ui.honeycomb.io/cyberworlds/environments/production/result/znqGGwhdYP6/a/pwzJA4FzA1C",
            },
            threshold: {
                op: ">",
                value: "5",
            },
            result: {
                groupsTriggered: [],
            },
            alert: {
                instanceId: "alert-instance-456",
                description: "Database connection errors exceeded threshold",
                status: "triggered",
                summary: "Database errors are spiking",
                isTest: false,
            },
            ...overrides,
        });

        test("triggered alert", async () => {
            const payload = createHoneycombFixture({
                alert: {
                    instanceId: "alert-instance-456",
                    description: "Database connection errors exceeded threshold",
                    status: "triggered",
                    summary: "Database errors are spiking",
                    isTest: false,
                },
            });

            await sendHoneycombAlertToAlpine(payload);

            expect(mockFetchCalls).toHaveLength(1);
            expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
        });

        test("resolved alert", async () => {
            const payload = createHoneycombFixture({
                alert: {
                    instanceId: "alert-instance-456",
                    description: "Database connection errors returned to normal",
                    status: "ok",
                    summary: "Database errors have resolved",
                    isTest: false,
                },
            });

            await sendHoneycombAlertToAlpine(payload);

            expect(mockFetchCalls).toHaveLength(1);
            expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
        });

        test("event alert", async () => {
            const payload = createHoneycombFixture({
                name: "User Signups",
                isEvent: "true",
                description: "New user registration detected",
                alert: {
                    instanceId: "event-instance-789",
                    description: "User signup event triggered",
                    status: "triggered",
                    summary: "New user registered",
                    isTest: false,
                },
            });

            await sendHoneycombAlertToAlpine(payload);

            expect(mockFetchCalls).toHaveLength(1);
            expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
        });

        test("event alert with custom emoji", async () => {
            const payload = createHoneycombFixture({
                name: "User Signups",
                isEvent: "true",
                emoji: "🎉",
                description: "New user registration detected",
                alert: {
                    instanceId: "event-instance-789",
                    description: "User signup event triggered",
                    status: "triggered",
                    summary: "New user registered",
                    isTest: false,
                },
            });

            await sendHoneycombAlertToAlpine(payload);

            expect(mockFetchCalls).toHaveLength(1);
            expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
        });

        test("staging environment alert", async () => {
            const payload = createHoneycombFixture({
                environment: "staging",
                alert: {
                    instanceId: "alert-instance-staging",
                    description: "Staging environment issue",
                    status: "triggered",
                    summary: "Error in staging",
                    isTest: false,
                },
            });

            await sendHoneycombAlertToAlpine(payload);

            expect(mockFetchCalls).toHaveLength(1);
            expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
        });

        describe("webhook payload data", () => {
            test("displays groupsTriggered data in a table with keys as headers", async () => {
                const payload = createHoneycombFixture({
                    groupsTriggered: [
                        {
                            group: [
                                {key: "error.type", value: "ConnectionError"},
                                {key: "service.name", value: "api-gateway"},
                            ],
                            result: 5,
                        },
                        {
                            group: [
                                {key: "error.type", value: "TimeoutError"},
                                {key: "service.name", value: "database"},
                            ],
                            result: 3,
                        },
                    ],
                });

                await sendHoneycombAlertToAlpine(payload);

                // Should NOT make any Honeycomb API calls
                const honeycombCalls = mockHoneycombApiCalls.filter(url =>
                    url.includes("/query_results/"),
                );
                expect(honeycombCalls).toHaveLength(0);

                expect(mockFetchCalls).toHaveLength(1);
                expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
            });

            test("aggregates by non-user columns and shows user mentions at bottom", async () => {
                const payload = createHoneycombFixture({
                    groupsTriggered: [
                        {
                            group: [
                                {key: "error.type", value: "ConnectionError"},
                                {key: "context.known_account.name", value: "Josh Johnson"},
                            ],
                            result: 5,
                        },
                        {
                            group: [
                                {key: "error.type", value: "ConnectionError"},
                                {key: "context.known_account.name", value: "Rachel Date"},
                            ],
                            result: 3,
                        },
                        {
                            group: [
                                {key: "error.type", value: "TimeoutError"},
                                {key: "context.known_account.name", value: "Josh Johnson"},
                            ],
                            result: 2,
                        },
                    ],
                });

                await sendHoneycombAlertToAlpine(payload);

                expect(mockFetchCalls).toHaveLength(1);
                // Should aggregate: ConnectionError=8, TimeoutError=2 Should show user mentions:
                // Josh Johnson, Rachel Date
                expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
            });

            test("shows only user mentions when context.known_account.name is the only key", async () => {
                const payload = createHoneycombFixture({
                    groupsTriggered: [
                        {
                            group: [{key: "context.known_account.name", value: "Josh Johnson"}],
                            result: 5,
                        },
                        {
                            group: [{key: "context.known_account.name", value: "Rachel Date"}],
                            result: 3,
                        },
                    ],
                });

                await sendHoneycombAlertToAlpine(payload);

                expect(mockFetchCalls).toHaveLength(1);
                // Should show only user mentions, no table
                expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
            });

            test("shows no table when groupsTriggered is empty", async () => {
                const payload = createHoneycombFixture({
                    groupsTriggered: [],
                });

                await sendHoneycombAlertToAlpine(payload);

                // Should NOT make any Honeycomb API calls
                const honeycombCalls = mockHoneycombApiCalls.filter(url =>
                    url.includes("/query_results/"),
                );
                expect(honeycombCalls).toHaveLength(0);

                expect(mockFetchCalls).toHaveLength(1);
                expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
            });

            test("truncates results to 5 and shows remaining count", async () => {
                const payload = createHoneycombFixture({
                    groupsTriggered: [
                        {group: [{key: "error", value: "Error 1"}], result: 1},
                        {group: [{key: "error", value: "Error 2"}], result: 2},
                        {group: [{key: "error", value: "Error 3"}], result: 3},
                        {group: [{key: "error", value: "Error 4"}], result: 4},
                        {group: [{key: "error", value: "Error 5"}], result: 5},
                        {group: [{key: "error", value: "Error 6"}], result: 6},
                        {group: [{key: "error", value: "Error 7"}], result: 7},
                    ],
                });

                await sendHoneycombAlertToAlpine(payload);

                expect(mockFetchCalls).toHaveLength(1);
                expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
            });

            test("formats exception columns with inline code", async () => {
                const payload = createHoneycombFixture({
                    groupsTriggered: [
                        {
                            group: [
                                {key: "exception.message", value: "Connection refused"},
                                {key: "exception.type", value: "NetworkError"},
                                {key: "service.name", value: "api-gateway"},
                            ],
                            result: 5,
                        },
                        {
                            group: [
                                {key: "exception.message", value: "Timeout exceeded"},
                                {key: "exception.type", value: "TimeoutError"},
                                {key: "service.name", value: "database"},
                            ],
                            result: 3,
                        },
                    ],
                });

                await sendHoneycombAlertToAlpine(payload);

                expect(mockFetchCalls).toHaveLength(1);
                expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
            });

            test("renders single group as a table", async () => {
                const payload = createHoneycombFixture({
                    groupsTriggered: [
                        {
                            group: [
                                {key: "exception.message", value: "Connection refused"},
                                {key: "exception.type", value: "NetworkError"},
                                {key: "service.name", value: "api-gateway"},
                            ],
                            result: 5,
                        },
                    ],
                });

                await sendHoneycombAlertToAlpine(payload);

                expect(mockFetchCalls).toHaveLength(1);
                expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
            });
        });
    });

    describe("GitHub", () => {
        const createGitHubFixture = (
            overrides: Partial<GitHubActionsEventPayload> = {},
        ): GitHubActionsEventPayload => ({
            type: "workflow_run",
            action: "completed",
            workflow_run: {
                id: 123456789,
                name: "CI",
                node_id: "WFR_kwDOExample123",
                check_suite_id: 987654321,
                head_branch: "main",
                head_sha: "abc123def456",
                path: ".github/workflows/ci.yml",
                run_number: 42,
                event: "push",
                display_title: "Fix bug in user authentication",
                status: "completed",
                conclusion: "failure",
                workflow_id: 789,
                url: "https://api.github.com/repos/cyberworlds/cyberworlds/actions/runs/123456789",
                html_url: "https://github.com/cyberworlds/cyberworlds/actions/runs/123456789",
                pull_requests: [],
                created_at: "2023-11-10T10:00:00Z",
                updated_at: "2023-11-10T10:05:00Z",
                actor: {
                    login: "developer123",
                    id: 12345,
                    node_id: "MDQ6VXNlcjEyMzQ1",
                    avatar_url: "https://avatars.githubusercontent.com/u/12345?v=4",
                    gravatar_id: "",
                    url: "https://api.github.com/users/developer123",
                    html_url: "https://github.com/developer123",
                    followers_url: "https://api.github.com/users/developer123/followers",
                    following_url:
                        "https://api.github.com/users/developer123/following{/other_user}",
                    gists_url: "https://api.github.com/users/developer123/gists{/gist_id}",
                    starred_url: "https://api.github.com/users/developer123/starred{/owner}{/repo}",
                    subscriptions_url: "https://api.github.com/users/developer123/subscriptions",
                    organizations_url: "https://api.github.com/users/developer123/orgs",
                    repos_url: "https://api.github.com/users/developer123/repos",
                    events_url: "https://api.github.com/users/developer123/events{/privacy}",
                    received_events_url:
                        "https://api.github.com/users/developer123/received_events",
                    type: "User",
                    site_admin: false,
                },
                run_attempt: 1,
                run_started_at: "2023-11-10T10:00:00Z",
                triggering_actor: {
                    login: "developer123",
                    id: 12345,
                    node_id: "MDQ6VXNlcjEyMzQ1",
                    avatar_url: "https://avatars.githubusercontent.com/u/12345?v=4",
                    gravatar_id: "",
                    url: "https://api.github.com/users/developer123",
                    html_url: "https://github.com/developer123",
                    followers_url: "https://api.github.com/users/developer123/followers",
                    following_url:
                        "https://api.github.com/users/developer123/following{/other_user}",
                    gists_url: "https://api.github.com/users/developer123/gists{/gist_id}",
                    starred_url: "https://api.github.com/users/developer123/starred{/owner}{/repo}",
                    subscriptions_url: "https://api.github.com/users/developer123/subscriptions",
                    organizations_url: "https://api.github.com/users/developer123/orgs",
                    repos_url: "https://api.github.com/users/developer123/repos",
                    events_url: "https://api.github.com/users/developer123/events{/privacy}",
                    received_events_url:
                        "https://api.github.com/users/developer123/received_events",
                    type: "User",
                    site_admin: false,
                },
                jobs_url:
                    "https://api.github.com/repos/cyberworlds/cyberworlds/actions/runs/123456789/jobs",
                logs_url:
                    "https://api.github.com/repos/cyberworlds/cyberworlds/actions/runs/123456789/logs",
                artifacts_url:
                    "https://api.github.com/repos/cyberworlds/cyberworlds/actions/runs/123456789/artifacts",
                cancel_url:
                    "https://api.github.com/repos/cyberworlds/cyberworlds/actions/runs/123456789/cancel",
                rerun_url:
                    "https://api.github.com/repos/cyberworlds/cyberworlds/actions/runs/123456789/rerun",
                workflow_url:
                    "https://api.github.com/repos/cyberworlds/cyberworlds/actions/workflows/789",
                head_commit: {
                    id: "abc123def456",
                    tree_id: "tree123456",
                    message: "Fix bug in user authentication",
                    timestamp: "2023-11-10T09:55:00Z",
                    author: {
                        name: "developer123",
                        email: "developer123@example.com",
                    },
                    committer: {
                        name: "developer123",
                        email: "developer123@example.com",
                    },
                },
                repository: {
                    id: 456789,
                    node_id: "MDEwOlJlcG9zaXRvcnk0NTY3ODk=",
                    name: "cyberworlds",
                    full_name: "cyberworlds/cyberworlds",
                    private: true,
                    owner: {
                        login: "cyberworlds",
                        id: 12345,
                        node_id: "MDEyOk9yZ2FuaXphdGlvbjEyMzQ1",
                        avatar_url: "https://avatars.githubusercontent.com/u/12345?v=4",
                        gravatar_id: "",
                        url: "https://api.github.com/users/cyberworlds",
                        html_url: "https://github.com/cyberworlds",
                        followers_url: "https://api.github.com/users/cyberworlds/followers",
                        following_url:
                            "https://api.github.com/users/cyberworlds/following{/other_user}",
                        gists_url: "https://api.github.com/users/cyberworlds/gists{/gist_id}",
                        starred_url:
                            "https://api.github.com/users/cyberworlds/starred{/owner}{/repo}",
                        subscriptions_url: "https://api.github.com/users/cyberworlds/subscriptions",
                        organizations_url: "https://api.github.com/users/cyberworlds/orgs",
                        repos_url: "https://api.github.com/users/cyberworlds/repos",
                        events_url: "https://api.github.com/users/cyberworlds/events{/privacy}",
                        received_events_url:
                            "https://api.github.com/users/cyberworlds/received_events",
                        type: "Organization",
                        site_admin: false,
                    },
                    html_url: "https://github.com/cyberworlds/cyberworlds",
                    description: "Cyberworlds Application",
                    fork: false,
                    url: "https://api.github.com/repos/cyberworlds/cyberworlds",
                    archive_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/{archive_format}{/ref}",
                    assignees_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/assignees{/user}",
                    blobs_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/git/blobs{/sha}",
                    branches_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/branches{/branch}",
                    collaborators_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/collaborators{/collaborator}",
                    comments_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/comments{/number}",
                    commits_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/commits{/sha}",
                    compare_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/compare/{base}...{head}",
                    contents_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/contents/{+path}",
                    contributors_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/contributors",
                    deployments_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/deployments",
                    downloads_url: "https://api.github.com/repos/cyberworlds/cyberworlds/downloads",
                    events_url: "https://api.github.com/repos/cyberworlds/cyberworlds/events",
                    forks_url: "https://api.github.com/repos/cyberworlds/cyberworlds/forks",
                    git_commits_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/git/commits{/sha}",
                    git_refs_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/git/refs{/sha}",
                    git_tags_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/git/tags{/sha}",
                    git_url: "git://github.com/cyberworlds/cyberworlds.git",
                    issue_comment_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/issues/comments{/number}",
                    issue_events_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/issues/events{/number}",
                    issues_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/issues{/number}",
                    keys_url: "https://api.github.com/repos/cyberworlds/cyberworlds/keys{/key_id}",
                    labels_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/labels{/name}",
                    languages_url: "https://api.github.com/repos/cyberworlds/cyberworlds/languages",
                    merges_url: "https://api.github.com/repos/cyberworlds/cyberworlds/merges",
                    milestones_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/milestones{/number}",
                    notifications_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/notifications{?since,all,participating}",
                    pulls_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/pulls{/number}",
                    releases_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/releases{/id}",
                    ssh_url: "git@github.com:cyberworlds/cyberworlds.git",
                    stargazers_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/stargazers",
                    statuses_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/statuses/{sha}",
                    subscribers_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/subscribers",
                    subscription_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/subscription",
                    tags_url: "https://api.github.com/repos/cyberworlds/cyberworlds/tags",
                    teams_url: "https://api.github.com/repos/cyberworlds/cyberworlds/teams",
                    trees_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/git/trees{/sha}",
                    clone_url: "https://github.com/cyberworlds/cyberworlds.git",
                    mirror_url: null,
                    hooks_url: "https://api.github.com/repos/cyberworlds/cyberworlds/hooks",
                    svn_url: "https://github.com/cyberworlds/cyberworlds",
                    homepage: "https://cyberworlds.com",
                    language: "TypeScript",
                    forks_count: 5,
                    stargazers_count: 42,
                    watchers_count: 42,
                    size: 1024,
                    default_branch: "main",
                    open_issues_count: 3,
                    is_template: false,
                    topics: ["react", "typescript", "collaboration"],
                    has_issues: true,
                    has_projects: true,
                    has_wiki: false,
                    has_pages: false,
                    has_downloads: true,
                    archived: false,
                    disabled: false,
                    visibility: "private",
                    pushed_at: "2023-11-10T09:55:00Z",
                    created_at: "2023-01-01T00:00:00Z",
                    updated_at: "2023-11-10T09:55:00Z",
                    permissions: {
                        admin: true,
                        maintain: true,
                        push: true,
                        triage: true,
                        pull: true,
                    },
                    allow_rebase_merge: true,
                    template_repository: null,
                    temp_clone_token: "",
                    allow_squash_merge: true,
                    allow_auto_merge: false,
                    delete_branch_on_merge: false,
                    allow_merge_commit: true,
                    subscribers_count: 10,
                    network_count: 5,
                    license: {
                        key: "mit",
                        name: "MIT License",
                        url: "https://api.github.com/licenses/mit",
                        spdx_id: "MIT",
                        node_id: "MDc6TGljZW5zZW1pdA==",
                        html_url: "https://github.com/git/git-scm.com/blob/main/MIT-LICENSE.txt",
                    },
                    forks: 5,
                    open_issues: 3,
                    watchers: 42,
                },
                head_repository: {
                    id: 456789,
                    node_id: "MDEwOlJlcG9zaXRvcnk0NTY3ODk=",
                    name: "app",
                    full_name: "cyberworlds/cyberworlds",
                    private: true,
                    owner: {
                        login: "cyberworlds",
                        id: 12345,
                        node_id: "MDEyOk9yZ2FuaXphdGlvbjEyMzQ1",
                        avatar_url: "https://avatars.githubusercontent.com/u/12345?v=4",
                        gravatar_id: "",
                        url: "https://api.github.com/users/cyberworlds",
                        html_url: "https://github.com/cyberworlds",
                        followers_url: "https://api.github.com/users/cyberworlds/followers",
                        following_url:
                            "https://api.github.com/users/cyberworlds/following{/other_user}",
                        gists_url: "https://api.github.com/users/cyberworlds/gists{/gist_id}",
                        starred_url:
                            "https://api.github.com/users/cyberworlds/starred{/owner}{/repo}",
                        subscriptions_url: "https://api.github.com/users/cyberworlds/subscriptions",
                        organizations_url: "https://api.github.com/users/cyberworlds/orgs",
                        repos_url: "https://api.github.com/users/cyberworlds/repos",
                        events_url: "https://api.github.com/users/cyberworlds/events{/privacy}",
                        received_events_url:
                            "https://api.github.com/users/cyberworlds/received_events",
                        type: "Organization",
                        site_admin: false,
                    },
                    html_url: "https://github.com/cyberworlds/cyberworlds",
                    description: "Cyberworlds Application",
                    fork: false,
                    url: "https://api.github.com/repos/cyberworlds/cyberworlds",
                    archive_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/{archive_format}{/ref}",
                    assignees_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/assignees{/user}",
                    blobs_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/git/blobs{/sha}",
                    branches_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/branches{/branch}",
                    collaborators_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/collaborators{/collaborator}",
                    comments_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/comments{/number}",
                    commits_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/commits{/sha}",
                    compare_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/compare/{base}...{head}",
                    contents_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/contents/{+path}",
                    contributors_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/contributors",
                    deployments_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/deployments",
                    downloads_url: "https://api.github.com/repos/cyberworlds/cyberworlds/downloads",
                    events_url: "https://api.github.com/repos/cyberworlds/cyberworlds/events",
                    forks_url: "https://api.github.com/repos/cyberworlds/cyberworlds/forks",
                    git_commits_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/git/commits{/sha}",
                    git_refs_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/git/refs{/sha}",
                    git_tags_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/git/tags{/sha}",
                    git_url: "git://github.com/cyberworlds/cyberworlds.git",
                    issue_comment_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/issues/comments{/number}",
                    issue_events_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/issues/events{/number}",
                    issues_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/issues{/number}",
                    keys_url: "https://api.github.com/repos/cyberworlds/cyberworlds/keys{/key_id}",
                    labels_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/labels{/name}",
                    languages_url: "https://api.github.com/repos/cyberworlds/cyberworlds/languages",
                    merges_url: "https://api.github.com/repos/cyberworlds/cyberworlds/merges",
                    milestones_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/milestones{/number}",
                    notifications_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/notifications{?since,all,participating}",
                    pulls_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/pulls{/number}",
                    releases_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/releases{/id}",
                    ssh_url: "git@github.com:cyberworlds/cyberworlds.git",
                    stargazers_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/stargazers",
                    statuses_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/statuses/{sha}",
                    subscribers_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/subscribers",
                    subscription_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/subscription",
                    tags_url: "https://api.github.com/repos/cyberworlds/cyberworlds/tags",
                    teams_url: "https://api.github.com/repos/cyberworlds/cyberworlds/teams",
                    trees_url:
                        "https://api.github.com/repos/cyberworlds/cyberworlds/git/trees{/sha}",
                    clone_url: "https://github.com/cyberworlds/cyberworlds.git",
                    mirror_url: null,
                    hooks_url: "https://api.github.com/repos/cyberworlds/cyberworlds/hooks",
                    svn_url: "https://github.com/cyberworlds/cyberworlds",
                    homepage: "https://cyberworlds.com",
                    language: "TypeScript",
                    forks_count: 5,
                    stargazers_count: 42,
                    watchers_count: 42,
                    size: 1024,
                    default_branch: "main",
                    open_issues_count: 3,
                    is_template: false,
                    topics: ["react", "typescript", "collaboration"],
                    has_issues: true,
                    has_projects: true,
                    has_wiki: false,
                    has_pages: false,
                    has_downloads: true,
                    archived: false,
                    disabled: false,
                    visibility: "private",
                    pushed_at: "2023-11-10T09:55:00Z",
                    created_at: "2023-01-01T00:00:00Z",
                    updated_at: "2023-11-10T09:55:00Z",
                    permissions: {
                        admin: true,
                        maintain: true,
                        push: true,
                        triage: true,
                        pull: true,
                    },
                    allow_rebase_merge: true,
                    template_repository: null,
                    temp_clone_token: "",
                    allow_squash_merge: true,
                    allow_auto_merge: false,
                    delete_branch_on_merge: false,
                    allow_merge_commit: true,
                    subscribers_count: 10,
                    network_count: 5,
                    license: {
                        key: "mit",
                        name: "MIT License",
                        url: "https://api.github.com/licenses/mit",
                        spdx_id: "MIT",
                        node_id: "MDc6TGljZW5zZW1pdA==",
                        html_url: "https://github.com/git/git-scm.com/blob/main/MIT-LICENSE.txt",
                    },
                    forks: 5,
                    open_issues: 3,
                    watchers: 42,
                },
                referenced_workflows: [],
            },
            workflow: {
                id: 789,
                node_id: "W_kwDOExample789",
                name: "CI",
                path: ".github/workflows/ci.yml",
                state: "active",
                created_at: "2023-01-01T00:00:00Z",
                updated_at: "2023-11-10T09:55:00Z",
                url: "https://api.github.com/repos/cyberworlds/cyberworlds/actions/workflows/789",
                html_url: "https://github.com/cyberworlds/cyberworlds/actions/workflows/ci.yml",
                badge_url: "https://github.com/cyberworlds/cyberworlds/workflows/CI/badge.svg",
            },
            repository: {
                id: 456789,
                node_id: "MDEwOlJlcG9zaXRvcnk0NTY3ODk=",
                name: "app",
                full_name: "cyberworlds/cyberworlds",
                private: true,
                owner: {
                    login: "cyberworlds",
                    id: 12345,
                    node_id: "MDEyOk9yZ2FuaXphdGlvbjEyMzQ1",
                    avatar_url: "https://avatars.githubusercontent.com/u/12345?v=4",
                    gravatar_id: "",
                    url: "https://api.github.com/users/cyberworlds",
                    html_url: "https://github.com/cyberworlds",
                    followers_url: "https://api.github.com/users/cyberworlds/followers",
                    following_url:
                        "https://api.github.com/users/cyberworlds/following{/other_user}",
                    gists_url: "https://api.github.com/users/cyberworlds/gists{/gist_id}",
                    starred_url: "https://api.github.com/users/cyberworlds/starred{/owner}{/repo}",
                    subscriptions_url: "https://api.github.com/users/cyberworlds/subscriptions",
                    organizations_url: "https://api.github.com/users/cyberworlds/orgs",
                    repos_url: "https://api.github.com/users/cyberworlds/repos",
                    events_url: "https://api.github.com/users/cyberworlds/events{/privacy}",
                    received_events_url: "https://api.github.com/users/cyberworlds/received_events",
                    type: "Organization",
                    site_admin: false,
                },
                html_url: "https://github.com/cyberworlds/cyberworlds",
                description: "Cyberworlds Application",
                fork: false,
                url: "https://api.github.com/repos/cyberworlds/cyberworlds",
                archive_url:
                    "https://api.github.com/repos/cyberworlds/cyberworlds/{archive_format}{/ref}",
                assignees_url:
                    "https://api.github.com/repos/cyberworlds/cyberworlds/assignees{/user}",
                blobs_url: "https://api.github.com/repos/cyberworlds/cyberworlds/git/blobs{/sha}",
                branches_url:
                    "https://api.github.com/repos/cyberworlds/cyberworlds/branches{/branch}",
                collaborators_url:
                    "https://api.github.com/repos/cyberworlds/cyberworlds/collaborators{/collaborator}",
                comments_url:
                    "https://api.github.com/repos/cyberworlds/cyberworlds/comments{/number}",
                commits_url: "https://api.github.com/repos/cyberworlds/cyberworlds/commits{/sha}",
                compare_url:
                    "https://api.github.com/repos/cyberworlds/cyberworlds/compare/{base}...{head}",
                contents_url:
                    "https://api.github.com/repos/cyberworlds/cyberworlds/contents/{+path}",
                contributors_url:
                    "https://api.github.com/repos/cyberworlds/cyberworlds/contributors",
                deployments_url: "https://api.github.com/repos/cyberworlds/cyberworlds/deployments",
                downloads_url: "https://api.github.com/repos/cyberworlds/cyberworlds/downloads",
                events_url: "https://api.github.com/repos/cyberworlds/cyberworlds/events",
                forks_url: "https://api.github.com/repos/cyberworlds/cyberworlds/forks",
                git_commits_url:
                    "https://api.github.com/repos/cyberworlds/cyberworlds/git/commits{/sha}",
                git_refs_url: "https://api.github.com/repos/cyberworlds/cyberworlds/git/refs{/sha}",
                git_tags_url: "https://api.github.com/repos/cyberworlds/cyberworlds/git/tags{/sha}",
                git_url: "git://github.com/cyberworlds/cyberworlds.git",
                issue_comment_url:
                    "https://api.github.com/repos/cyberworlds/cyberworlds/issues/comments{/number}",
                issue_events_url:
                    "https://api.github.com/repos/cyberworlds/cyberworlds/issues/events{/number}",
                issues_url: "https://api.github.com/repos/cyberworlds/cyberworlds/issues{/number}",
                keys_url: "https://api.github.com/repos/cyberworlds/cyberworlds/keys{/key_id}",
                labels_url: "https://api.github.com/repos/cyberworlds/cyberworlds/labels{/name}",
                languages_url: "https://api.github.com/repos/cyberworlds/cyberworlds/languages",
                merges_url: "https://api.github.com/repos/cyberworlds/cyberworlds/merges",
                milestones_url:
                    "https://api.github.com/repos/cyberworlds/cyberworlds/milestones{/number}",
                notifications_url:
                    "https://api.github.com/repos/cyberworlds/cyberworlds/notifications{?since,all,participating}",
                pulls_url: "https://api.github.com/repos/cyberworlds/cyberworlds/pulls{/number}",
                releases_url: "https://api.github.com/repos/cyberworlds/cyberworlds/releases{/id}",
                ssh_url: "git@github.com:cyberworlds/cyberworlds.git",
                stargazers_url: "https://api.github.com/repos/cyberworlds/cyberworlds/stargazers",
                statuses_url: "https://api.github.com/repos/cyberworlds/cyberworlds/statuses/{sha}",
                subscribers_url: "https://api.github.com/repos/cyberworlds/cyberworlds/subscribers",
                subscription_url:
                    "https://api.github.com/repos/cyberworlds/cyberworlds/subscription",
                tags_url: "https://api.github.com/repos/cyberworlds/cyberworlds/tags",
                teams_url: "https://api.github.com/repos/cyberworlds/cyberworlds/teams",
                trees_url: "https://api.github.com/repos/cyberworlds/cyberworlds/git/trees{/sha}",
                clone_url: "https://github.com/cyberworlds/cyberworlds.git",
                mirror_url: null,
                hooks_url: "https://api.github.com/repos/cyberworlds/cyberworlds/hooks",
                svn_url: "https://github.com/cyberworlds/cyberworlds",
                homepage: "https://cyberworlds.com",
                language: "TypeScript",
                forks_count: 5,
                stargazers_count: 42,
                watchers_count: 42,
                size: 1024,
                default_branch: "main",
                open_issues_count: 3,
                is_template: false,
                topics: ["react", "typescript", "collaboration"],
                has_issues: true,
                has_projects: true,
                has_wiki: false,
                has_pages: false,
                has_downloads: true,
                archived: false,
                disabled: false,
                visibility: "private",
                pushed_at: "2023-11-10T09:55:00Z",
                created_at: "2023-01-01T00:00:00Z",
                updated_at: "2023-11-10T09:55:00Z",
                permissions: {
                    admin: true,
                    maintain: true,
                    push: true,
                    triage: true,
                    pull: true,
                },
                allow_rebase_merge: true,
                template_repository: null,
                temp_clone_token: "",
                allow_squash_merge: true,
                allow_auto_merge: false,
                delete_branch_on_merge: false,
                allow_merge_commit: true,
                subscribers_count: 10,
                network_count: 5,
                license: {
                    key: "mit",
                    name: "MIT License",
                    url: "https://api.github.com/licenses/mit",
                    spdx_id: "MIT",
                    node_id: "MDc6TGljZW5zZW1pdA==",
                    html_url: "https://github.com/git/git-scm.com/blob/main/MIT-LICENSE.txt",
                },
                forks: 5,
                open_issues: 3,
                watchers: 42,
            },
            sender: {
                login: "developer123",
                id: 12345,
                node_id: "MDQ6VXNlcjEyMzQ1",
                avatar_url: "https://avatars.githubusercontent.com/u/12345?v=4",
                gravatar_id: "",
                url: "https://api.github.com/users/developer123",
                html_url: "https://github.com/developer123",
                followers_url: "https://api.github.com/users/developer123/followers",
                following_url: "https://api.github.com/users/developer123/following{/other_user}",
                gists_url: "https://api.github.com/users/developer123/gists{/gist_id}",
                starred_url: "https://api.github.com/users/developer123/starred{/owner}{/repo}",
                subscriptions_url: "https://api.github.com/users/developer123/subscriptions",
                organizations_url: "https://api.github.com/users/developer123/orgs",
                repos_url: "https://api.github.com/users/developer123/repos",
                events_url: "https://api.github.com/users/developer123/events{/privacy}",
                received_events_url: "https://api.github.com/users/developer123/received_events",
                type: "User",
                site_admin: false,
            },
            ...overrides,
        });

        const createGitHubPushCommitFixture = (
            overrides: Partial<GitHubPushEventPayload["commits"][number]> = {},
        ): GitHubPushEventPayload["commits"][number] => ({
            id: "def456abc789",
            tree_id: "tree987654",
            distinct: true,
            message: "Ship GitHub commit alert (#812)",
            timestamp: "2023-11-10T09:55:00Z",
            url: "https://github.com/cyberworlds/cyberworlds/commit/def456abc789",
            author: {
                name: "Josh Johnson",
                email: "josh@example.com",
                username: "imjoshin",
            },
            committer: {
                name: "GitHub",
                email: "noreply@github.com",
                username: "web-flow",
            },
            added: [],
            removed: [],
            modified: ["admin/lambda/send_alert/send_alert_to_alpine.ts"],
            ...overrides,
        });

        const createGitHubPushFixture = (
            overrides: Partial<GitHubPushEventPayload> = {},
        ): GitHubPushEventPayload => {
            const workflowRunFixture = createGitHubFixture();
            const commit = createGitHubPushCommitFixture();

            return {
                type: "push",
                after: commit.id,
                base_ref: null,
                before: "abc123def456",
                commits: [commit],
                compare:
                    "https://github.com/cyberworlds/cyberworlds/compare/abc123def456...def456abc789",
                created: false,
                deleted: false,
                forced: false,
                head_commit: commit,
                pusher: {
                    name: "imjoshin",
                    email: "josh@example.com",
                },
                ref: "refs/heads/main",
                repository: workflowRunFixture.repository,
                sender: {
                    ...workflowRunFixture.sender,
                    login: "imjoshin",
                    html_url: "https://github.com/imjoshin",
                },
                ...overrides,
            };
        };

        test("build failure", async () => {
            const payload = createGitHubFixture({
                workflow_run: {
                    ...createGitHubFixture().workflow_run,
                    conclusion: "failure",
                    head_commit: {
                        id: "abc123def456",
                        tree_id: "tree123456",
                        message: "Fix bug in user authentication",
                        timestamp: "2023-11-10T09:55:00Z",
                        author: {
                            name: "developer123",
                            email: "developer123@example.com",
                        },
                        committer: {
                            name: "developer123",
                            email: "developer123@example.com",
                        },
                    },
                },
            });

            await sendGitHubActionsAlertToAlpine(payload);

            expect(mockFetchCalls).toHaveLength(1);
            expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
        });

        test("build failure with PR reference", async () => {
            const payload = createGitHubFixture({
                workflow_run: {
                    ...createGitHubFixture().workflow_run,
                    conclusion: "failure",
                    head_commit: {
                        id: "abc123def456",
                        tree_id: "tree123456",
                        message: "Small alert formatting (#746)",
                        timestamp: "2023-11-10T09:55:00Z",
                        author: {
                            name: "developer123",
                            email: "developer123@example.com",
                        },
                        committer: {
                            name: "developer123",
                            email: "developer123@example.com",
                        },
                    },
                },
            });

            await sendGitHubActionsAlertToAlpine(payload);

            expect(mockFetchCalls).toHaveLength(1);
            expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
        });

        test("build failure with multiple PR references", async () => {
            const payload = createGitHubFixture({
                workflow_run: {
                    ...createGitHubFixture().workflow_run,
                    conclusion: "failure",
                    head_commit: {
                        id: "abc123def456",
                        tree_id: "tree123456",
                        message: "Merge multiple PRs: feature A (#123) and bug fix (#456)",
                        timestamp: "2023-11-10T09:55:00Z",
                        author: {
                            name: "developer123",
                            email: "developer123@example.com",
                        },
                        committer: {
                            name: "developer123",
                            email: "developer123@example.com",
                        },
                    },
                },
            });

            await sendGitHubActionsAlertToAlpine(payload);

            expect(mockFetchCalls).toHaveLength(1);
            expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
        });

        test("push to main with multiple commits", async () => {
            const firstCommit = createGitHubPushCommitFixture();
            const secondCommit = createGitHubPushCommitFixture({
                id: "fed321cba987",
                tree_id: "tree654321",
                message: "Follow-up alert polish",
                timestamp: "2023-11-10T09:57:00Z",
                url: "https://github.com/cyberworlds/cyberworlds/commit/fed321cba987",
                author: {
                    name: "Mona Lisa",
                    email: "mona@example.com",
                    username: null,
                },
                modified: ["admin/lambda/send_alert/send_alert_github_actions.ts"],
            });
            const payload = createGitHubPushFixture({
                after: secondCommit.id,
                commits: [firstCommit, secondCommit],
                head_commit: secondCommit,
                compare:
                    "https://github.com/cyberworlds/cyberworlds/compare/abc123def456...fed321cba987",
            });

            await sendGitHubAlertToAlpine(payload);

            expect(mockFetchCalls).toHaveLength(1);
            expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
        });

        test("push to main with one commit", async () => {
            const payload = createGitHubPushFixture();

            await sendGitHubAlertToAlpine(payload);

            expect(mockFetchCalls).toHaveLength(1);
            expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
        });

        test("push maps real GitHub usernames to first names", async () => {
            const firstCommit = createGitHubPushCommitFixture({
                id: "1111111aaaaaa",
                message: "Add support for GitHub push alerts",
                url: "https://github.com/cyberworlds/cyberworlds/commit/1111111aaaaaa",
                author: {
                    name: "i-fitz",
                    email: "ian@example.com",
                    username: "ifitzsimmons",
                },
            });
            const secondCommit = createGitHubPushCommitFixture({
                id: "2222222bbbbbb",
                message: "Polish push alert copy",
                url: "https://github.com/cyberworlds/cyberworlds/commit/2222222bbbbbb",
                author: {
                    name: "rmt",
                    email: "rachel@example.com",
                    username: "rmtobin",
                },
            });
            const thirdCommit = createGitHubPushCommitFixture({
                id: "3333333cccccc",
                message: "Wire push alert channel",
                url: "https://github.com/cyberworlds/cyberworlds/commit/3333333cccccc",
                author: {
                    name: "jj",
                    email: "josh@example.com",
                    username: "imjoshin",
                },
            });
            const payload = createGitHubPushFixture({
                after: thirdCommit.id,
                commits: [firstCommit, secondCommit, thirdCommit],
                head_commit: thirdCommit,
                compare:
                    "https://github.com/cyberworlds/cyberworlds/compare/abc123def456...3333333cccccc",
                sender: {
                    ...createGitHubFixture().sender,
                    login: "calebmer",
                    html_url: "https://github.com/calebmer",
                },
            });

            await sendGitHubAlertToAlpine(payload);

            expect(mockFetchCalls).toHaveLength(1);
            expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
        });

        test("ignores push to another branch", async () => {
            const payload = createGitHubPushFixture({
                ref: "refs/heads/some-feature-branch",
            });

            await sendGitHubAlertToAlpine(payload);

            expect(mockFetchCalls).toHaveLength(0);
        });

        test("ignores push with no commits", async () => {
            const payload = createGitHubPushFixture({
                commits: [],
                head_commit: null,
            });

            await sendGitHubAlertToAlpine(payload);

            expect(mockFetchCalls).toHaveLength(0);
        });
    });

    describe("PagerDuty", () => {
        const createPagerDutyFixture = (
            overrides: Partial<PagerDutyEventPayload> = {},
        ): PagerDutyEventPayload => ({
            event: {
                id: "pd-event-123",
                occurred_at: "2023-11-10T10:00:00Z",
                agent: {
                    html_url: "https://api.pagerduty.com/agents/pagerduty",
                    id: "pagerduty",
                    self: "https://api.pagerduty.com/agents/pagerduty",
                    summary: "PagerDuty",
                    type: "user_reference",
                },
                client: {
                    name: "PagerDuty Web",
                },
                event_type: "incident.triggered",
                resource_type: "incident",
                data: {
                    id: "incident-123",
                    type: "incident",
                    self: "https://api.pagerduty.com/incidents/incident-123",
                    html_url: "https://cyberworlds.pagerduty.com/incidents/incident-123",
                    number: 42,
                    status: "triggered",
                    incident_key: "database-connection-error",
                    created_at: "2023-11-10T10:00:00Z",
                    reopened_at: null,
                    title: "Database Connection Pool Exhausted",
                    incident_type: {
                        name: "Database Error",
                    },
                    service: {
                        html_url: "https://cyberworlds.pagerduty.com/services/database-service",
                        id: "service-db-123",
                        self: "https://api.pagerduty.com/services/service-db-123",
                        summary: "Database Service",
                        type: "service_reference",
                    },
                    assignees: [
                        {
                            html_url: "https://cyberworlds.pagerduty.com/users/oncall-eng",
                            id: "user-oncall-eng",
                            self: "https://api.pagerduty.com/users/user-oncall-eng",
                            summary: "On-Call Engineer",
                            type: "user_reference",
                        },
                    ],
                    escalation_policy: {
                        html_url:
                            "https://cyberworlds.pagerduty.com/escalation_policies/eng-escalation",
                        id: "escalation-eng",
                        self: "https://api.pagerduty.com/escalation_policies/escalation-eng",
                        summary: "Engineering Escalation",
                        type: "escalation_policy_reference",
                    },
                    teams: [],
                    priority: {
                        html_url: "https://cyberworlds.pagerduty.com/priorities/p1",
                        id: "priority-p1",
                        self: "https://api.pagerduty.com/priorities/priority-p1",
                        summary: "P1 - Critical",
                        type: "priority_reference",
                    },
                    urgency: "high",
                    conference_bridge: {
                        conference_number: "+1-555-123-4567",
                        conference_url: "https://zoom.us/j/123456789",
                    },
                    resolve_reason: null,
                },
            },
            ...overrides,
        });

        test("triggered incident", async () => {
            const payload = createPagerDutyFixture();

            await sendPagerDutyAlertToAlpine(payload);

            expect(mockFetchCalls).toHaveLength(1);
            expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
        });

        test("acknowledged incident", async () => {
            const payload = createPagerDutyFixture({
                event: {
                    ...createPagerDutyFixture().event,
                    event_type: "incident.acknowledged",
                    data: {
                        ...createPagerDutyFixture().event.data,
                    },
                },
            });

            await sendPagerDutyAlertToAlpine(payload);

            expect(mockFetchCalls).toHaveLength(1);
            expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
        });

        test("resolved incident", async () => {
            const payload = createPagerDutyFixture({
                event: {
                    ...createPagerDutyFixture().event,
                    event_type: "incident.resolved",
                    data: {
                        ...createPagerDutyFixture().event.data,
                        // @ts-expect-error: Status does not exist on some types, just
                        // force it for this test
                        status: "resolved",
                        resolve_reason: "Database connection pool was restarted and issue resolved",
                    },
                },
            });

            await sendPagerDutyAlertToAlpine(payload);

            expect(mockFetchCalls).toHaveLength(1);
            expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
        });
    });
});
