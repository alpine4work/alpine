import {createHmac} from "crypto";
import {GitHubAlertSource} from "~/admin/lambda/send_alert/internal/github_alert_source.js";
import {
    GitHubEventPayload,
    GitHubPushEventPayload,
    GitHubWorkflowRunEventPayload,
} from "~/admin/lambda/send_alert/internal/github_alert_source_types.js";
import {sendAlertAvailableChannels} from "~/admin/lambda/send_alert/internal/send_alert_available_channels.js";
import {printApiContentToMarkdown} from "~/shared/api/content/print_api_content_to_markdown.open_source.js";
import {ApiContent} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {ApiSpecification} from "~/shared/api/specification/types/api_specification_types.open_source.js";
import {assertDateString} from "~/shared/helpers/date/date_string.open_source.js";
import {assertId} from "~/shared/id/id.open_source.js";
import {AccountId, BotId, PostId} from "~/shared/id/types/id_types.open_source.js";

type ApiCreatePostRequestBody =
    ApiSpecification.paths["/posts"]["post"]["requestBody"]["content"]["application/json"];
type ApiSearchResponse =
    ApiSpecification.paths["/spaces/{id}/search"]["get"]["responses"]["200"]["content"]["application/json"];

const mockEnv = {
    ALPINE_API_KEY: "test-api-key",
    EDGE_SERVICE_URL: "https://test.cyberworlds.com",
    GITHUB_ACTIONS_WEBHOOK_SECRET: "test-github-secret",
};

const originalEnv = process.env;

const deployGithubWorkflowId = 111000643;
const nonDeployGithubWorkflowId = 789;

let mockFetchCalls: Array<{url: string; body: unknown}> = [];

const mockFetch = import.meta.jest.fn().mockImplementation((_url: string, options?: any) => {
    if (_url.endsWith("/posts") && mockFetchCalls.at(-1)?.url.includes("/channels/")) {
        mockFetchCalls.pop();
    }
    mockFetchCalls.push({
        url: _url,
        body: options?.body ? JSON.parse(options.body) : null,
    });

    return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () =>
            Promise.resolve(
                _url.includes("/channels/")
                    ? JSON.stringify({
                          spaceId: "test-space-id",
                          channel: {
                              id: _url.split("/").at(-1),
                              name: "Alert Channel",
                              description: {elements: []},
                          },
                      })
                    : JSON.stringify({post: {id: "generated-post-id"}}),
            ),
    });
});

function resetAlertSourceTestEnvironment(): void {
    process.env = {...originalEnv, ...mockEnv};
    mockFetchCalls = [];
    global.fetch = mockFetch;
    mockFetch.mockClear();
}

function restoreAlertSourceTestEnvironment(): void {
    process.env = originalEnv;
}

function formatFetchCallForSnapshot(fetchCall: {url: string; body: unknown}): string {
    if (!fetchCall.body) {
        return `URL: ${fetchCall.url}`;
    }
    const body = fetchCall.body as Partial<ApiCreatePostRequestBody> & {
        channelId?: string;
        content?: ApiContent;
    };
    if (body.post?.content) {
        const markdown = printApiContentToMarkdown(body.post.content);
        return `URL: ${fetchCall.url}
Channel: ${body.post.channel.id}

${markdown}`;
    }
    if (body.content) {
        const markdown = printApiContentToMarkdown(body.content);
        return `URL: ${fetchCall.url}
Channel: ${body.channelId}

${markdown}`;
    }
    return `URL: ${fetchCall.url}
Body: ${JSON.stringify(body)}`;
}

function createGitHubSignature(body: string, webhookSecret = "test-github-secret"): string {
    const hmac = createHmac("sha256", webhookSecret);
    hmac.update(body);
    return `sha256=${hmac.digest("hex")}`;
}

async function handleGitHubPayload(data: GitHubEventPayload): Promise<void> {
    await new GitHubAlertSource({
        body: "",
        headers: {"x-github-event": data.type},
    }).handlePayload(data);
}

async function handleGitHubWorkflowRunPayload(data: GitHubWorkflowRunEventPayload): Promise<void> {
    await handleGitHubPayload(data);
}

describe("GitHubAlertSource", () => {
    beforeEach(() => {
        resetAlertSourceTestEnvironment();
    });

    afterEach(() => {
        restoreAlertSourceTestEnvironment();
    });

    const createGitHubFixture = (
        overrides: Partial<GitHubWorkflowRunEventPayload> = {},
    ): GitHubWorkflowRunEventPayload => ({
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
                following_url: "https://api.github.com/users/cyberworlds/following{/other_user}",
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
            assignees_url: "https://api.github.com/repos/cyberworlds/cyberworlds/assignees{/user}",
            blobs_url: "https://api.github.com/repos/cyberworlds/cyberworlds/git/blobs{/sha}",
            branches_url: "https://api.github.com/repos/cyberworlds/cyberworlds/branches{/branch}",
            collaborators_url:
                "https://api.github.com/repos/cyberworlds/cyberworlds/collaborators{/collaborator}",
            comments_url: "https://api.github.com/repos/cyberworlds/cyberworlds/comments{/number}",
            commits_url: "https://api.github.com/repos/cyberworlds/cyberworlds/commits{/sha}",
            compare_url:
                "https://api.github.com/repos/cyberworlds/cyberworlds/compare/{base}...{head}",
            contents_url: "https://api.github.com/repos/cyberworlds/cyberworlds/contents/{+path}",
            contributors_url: "https://api.github.com/repos/cyberworlds/cyberworlds/contributors",
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
            subscription_url: "https://api.github.com/repos/cyberworlds/cyberworlds/subscription",
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

    describe("authorization", () => {
        test("returns an error when the webhook secret is not configured", () => {
            delete process.env.GITHUB_ACTIONS_WEBHOOK_SECRET;

            const authorization = new GitHubAlertSource({
                body: "{}",
                headers: {"x-hub-signature-256": createGitHubSignature("{}")},
            }).validateAuthorization();

            expect(authorization).toEqual({
                ok: false,
                statusCode: 500,
                error: "GITHUB_ACTIONS_WEBHOOK_SECRET environment variable is not set",
            });
        });

        test("returns an error when the signature is missing", () => {
            const authorization = new GitHubAlertSource({
                body: "{}",
                headers: {},
            }).validateAuthorization();

            expect(authorization).toEqual({
                ok: false,
                statusCode: 401,
                error: "Invalid signature",
            });
        });

        test("returns an error when the body is missing", () => {
            const authorization = new GitHubAlertSource({
                headers: {"x-hub-signature-256": createGitHubSignature("{}")},
            }).validateAuthorization();

            expect(authorization).toEqual({
                ok: false,
                statusCode: 401,
                error: "Invalid signature",
            });
        });

        test("returns an error when the signature length does not match", () => {
            const authorization = new GitHubAlertSource({
                body: "{}",
                headers: {"x-hub-signature-256": "sha256=short"},
            }).validateAuthorization();

            expect(authorization).toEqual({
                ok: false,
                statusCode: 401,
                error: "Invalid signature",
            });
        });

        test("returns an error when the signature value does not match", () => {
            const authorization = new GitHubAlertSource({
                body: "{}",
                headers: {"x-hub-signature-256": `sha256=${"0".repeat(64)}`},
            }).validateAuthorization();

            expect(authorization).toEqual({
                ok: false,
                statusCode: 401,
                error: "Invalid signature",
            });
        });

        test("validates a matching signature", () => {
            const body = "{}";
            const authorization = new GitHubAlertSource({
                body,
                headers: {"x-hub-signature-256": createGitHubSignature(body)},
            }).validateAuthorization();

            expect(authorization).toEqual({ok: true});
        });
    });

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

        await handleGitHubWorkflowRunPayload(payload);

        const postCalls = mockFetchCalls.filter(call => call.body !== null);
        expect(postCalls).toHaveLength(1);
        expect(postCalls[0]!.body).toMatchObject({
            post: {
                content: {
                    elements: expect.arrayContaining([
                        {
                            type: "Quote",
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [
                                        {type: "Text", text: "Fix bug in user authentication"},
                                    ],
                                },
                            ],
                        },
                    ]),
                },
            },
        });
        expect(formatFetchCallForSnapshot(postCalls[0]!)).toMatchSnapshot();
    });

    test("build failure preserves multiline commit messages in a quote", async () => {
        const payload = createGitHubFixture({
            workflow_run: {
                ...createGitHubFixture().workflow_run,
                conclusion: "failure",
                head_commit: {
                    id: "abc123def456",
                    tree_id: "tree123456",
                    message: "Fix bug in user authentication\n\nDetails (#123)",
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

        await handleGitHubWorkflowRunPayload(payload);

        const postCalls = mockFetchCalls.filter(call => call.body !== null);
        expect(postCalls).toHaveLength(1);
        expect(postCalls[0]!.body).toMatchObject({
            post: {
                content: {
                    elements: expect.arrayContaining([
                        {
                            type: "Quote",
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [
                                        {type: "Text", text: "Fix bug in user authentication"},
                                        {type: "Break"},
                                        {type: "Break"},
                                        {type: "Text", text: "Details "},
                                        {
                                            type: "Text",
                                            text: "(#123)",
                                            marks: [
                                                {
                                                    type: "Link",
                                                    url: "https://app.graphite.com/github/pr/cyberworlds/cyberworlds/123",
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ]),
                },
            },
        });
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

        await handleGitHubWorkflowRunPayload(payload);

        const postCalls = mockFetchCalls.filter(call => call.body !== null);
        expect(postCalls).toHaveLength(1);
        expect(formatFetchCallForSnapshot(postCalls[0]!)).toMatchSnapshot();
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

        await handleGitHubWorkflowRunPayload(payload);

        const postCalls = mockFetchCalls.filter(call => call.body !== null);
        expect(postCalls).toHaveLength(1);
        expect(formatFetchCallForSnapshot(postCalls[0]!)).toMatchSnapshot();
    });

    test("ignores workflow run from another branch", async () => {
        const payload = createGitHubFixture({
            workflow_run: {
                ...createGitHubFixture().workflow_run,
                head_branch: "some-feature-branch",
            },
        });

        await handleGitHubWorkflowRunPayload(payload);

        expect(mockFetchCalls).toHaveLength(0);
    });

    test("ignores workflow run action that is not completed", async () => {
        const payload = createGitHubFixture({
            action: "requested",
        });

        await handleGitHubWorkflowRunPayload(payload);

        expect(mockFetchCalls).toHaveLength(0);
    });

    test("ignores workflow run conclusion that is not failure", async () => {
        const payload = createGitHubFixture({
            workflow_run: {
                ...createGitHubFixture().workflow_run,
                conclusion: "success",
            },
        });

        await handleGitHubWorkflowRunPayload(payload);

        const postCalls = mockFetchCalls.filter(call => call.body !== null);
        expect(postCalls).toHaveLength(0);
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
            modified: ["admin/lambda/send_alert/internal/github_alert_source_types.ts"],
        });
        const payload = createGitHubPushFixture({
            after: secondCommit.id,
            commits: [firstCommit, secondCommit],
            head_commit: secondCommit,
            compare:
                "https://github.com/cyberworlds/cyberworlds/compare/abc123def456...fed321cba987",
        });

        await handleGitHubPayload(payload);

        expect(mockFetchCalls).toHaveLength(1);
        expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
    });

    test("push to main with one commit", async () => {
        const payload = createGitHubPushFixture();

        await handleGitHubPayload(payload);

        expect(mockFetchCalls).toHaveLength(1);
        expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
    });

    test("push to main by Graphite with one commit uses the commit author", async () => {
        const payload = createGitHubPushFixture({
            commits: [
                createGitHubPushCommitFixture({
                    author: {
                        name: "Mona Lisa",
                        email: "mona@example.com",
                        username: null,
                    },
                }),
            ],
            sender: {
                ...createGitHubFixture().sender,
                login: "graphite-app[bot]",
                html_url: "https://github.com/apps/graphite-app",
            },
        });

        await handleGitHubPayload(payload);

        expect(mockFetchCalls).toHaveLength(1);
        expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
    });

    test("push to main by Graphite with same-author commits uses the commit author", async () => {
        const firstCommit = createGitHubPushCommitFixture({
            id: "1111111aaaaaa",
            message: "Add Graphite attribution",
            url: "https://github.com/cyberworlds/cyberworlds/commit/1111111aaaaaa",
            author: {
                name: "Mona Lisa",
                email: "mona@example.com",
                username: null,
            },
        });
        const secondCommit = createGitHubPushCommitFixture({
            id: "2222222bbbbbb",
            message: "Polish Graphite attribution",
            url: "https://github.com/cyberworlds/cyberworlds/commit/2222222bbbbbb",
            author: {
                name: "Mona Lisa",
                email: "mona@example.com",
                username: null,
            },
        });
        const payload = createGitHubPushFixture({
            after: secondCommit.id,
            commits: [firstCommit, secondCommit],
            head_commit: secondCommit,
            compare:
                "https://github.com/cyberworlds/cyberworlds/compare/abc123def456...2222222bbbbbb",
            sender: {
                ...createGitHubFixture().sender,
                login: "graphite-app[bot]",
                html_url: "https://github.com/apps/graphite-app",
            },
        });

        await handleGitHubPayload(payload);

        expect(mockFetchCalls).toHaveLength(1);
        expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
    });

    test("push to main by Graphite with mixed-author commits uses Graphite", async () => {
        const firstCommit = createGitHubPushCommitFixture({
            id: "1111111aaaaaa",
            message: "Add Graphite attribution",
            url: "https://github.com/cyberworlds/cyberworlds/commit/1111111aaaaaa",
            author: {
                name: "Mona Lisa",
                email: "mona@example.com",
                username: null,
            },
        });
        const secondCommit = createGitHubPushCommitFixture({
            id: "2222222bbbbbb",
            message: "Polish Graphite attribution",
            url: "https://github.com/cyberworlds/cyberworlds/commit/2222222bbbbbb",
            author: {
                name: "Josh Johnson",
                email: "josh@example.com",
                username: "imjoshin",
            },
        });
        const payload = createGitHubPushFixture({
            after: secondCommit.id,
            commits: [firstCommit, secondCommit],
            head_commit: secondCommit,
            compare:
                "https://github.com/cyberworlds/cyberworlds/compare/abc123def456...2222222bbbbbb",
            sender: {
                ...createGitHubFixture().sender,
                login: "graphite-app[bot]",
                html_url: "https://github.com/apps/graphite-app",
            },
        });

        await handleGitHubPayload(payload);

        expect(mockFetchCalls).toHaveLength(1);
        expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
    });

    test("push pulls only the final PR reference out of the commit message", async () => {
        const payload = createGitHubPushFixture({
            commits: [
                createGitHubPushCommitFixture({
                    message: "Backfill alert 404 handling (#811) (#812)",
                }),
            ],
        });

        await handleGitHubPayload(payload);

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

        await handleGitHubPayload(payload);

        expect(mockFetchCalls).toHaveLength(1);
        expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
    });

    test("push uses the first line of a multiline commit message", async () => {
        const payload = createGitHubPushFixture({
            commits: [
                createGitHubPushCommitFixture({
                    message: "Add source edge tests\n\nKeep the body out of the alert.",
                }),
            ],
        });

        await handleGitHubPayload(payload);

        expect(mockFetchCalls).toHaveLength(1);
        expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
    });

    test("ignores push to another branch", async () => {
        const payload = createGitHubPushFixture({
            ref: "refs/heads/some-feature-branch",
        });

        await handleGitHubPayload(payload);

        expect(mockFetchCalls).toHaveLength(0);
    });

    test("ignores deleted push to main", async () => {
        const payload = createGitHubPushFixture({
            deleted: true,
        });

        await handleGitHubPayload(payload);

        expect(mockFetchCalls).toHaveLength(0);
    });

    test("ignores push with no commits", async () => {
        const payload = createGitHubPushFixture({
            commits: [],
            head_commit: null,
        });

        await handleGitHubPayload(payload);

        expect(mockFetchCalls).toHaveLength(0);
    });

    test("ignores unsupported GitHub event type", async () => {
        const result = await new GitHubAlertSource({
            body: "{}",
            headers: {"x-github-event": "issues"},
        }).handlePayload({});

        expect({result, fetchCalls: mockFetchCalls.length}).toEqual({
            result: {ok: true},
            fetchCalls: 0,
        });
    });

    describe("deploy notifications", () => {
        test("comments on posts with commit hash when deploy succeeds", async () => {
            const commitHash = "abc123def456";
            const shortHash = commitHash.substring(0, 7);
            const spaceId = "test-space-id";
            const postId1 = "test-post-id-1";
            const postId2 = "test-post-id-2";
            const humanPostId = "non-bot-post-id";

            mockFetch.mockClear();
            mockFetchCalls = [];

            mockFetch
                .mockImplementationOnce((_url: string, options?: any) => {
                    mockFetchCalls.push({
                        url: _url,
                        body: options?.body ? JSON.parse(options.body) : null,
                    });
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: "OK",
                        text: () =>
                            Promise.resolve(
                                JSON.stringify({
                                    spaceId,
                                    channel: {},
                                }),
                            ),
                    });
                })
                .mockImplementationOnce((_url: string, options?: any) => {
                    mockFetchCalls.push({
                        url: _url,
                        body: options?.body ? JSON.parse(options.body) : null,
                    });
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: "OK",
                        text: () =>
                            Promise.resolve(
                                JSON.stringify({
                                    results: [
                                        {
                                            type: "Post",
                                            id: postId1,
                                            title: `in GitHub: cursor pushed a commit (${shortHash})`,
                                            bodySnippet: {
                                                text: `in GitHub: cursor pushed a commit (${shortHash})`,
                                                matches: [],
                                            },
                                            author: {botId: "paul-bot-id"},
                                        },
                                        {
                                            type: "Post",
                                            id: postId2,
                                            title: `in GitHub: another post with ${shortHash}`,
                                            bodySnippet: {
                                                text: `in GitHub: another post with ${shortHash}`,
                                                matches: [],
                                            },
                                            author: {botId: "paul-bot-id"},
                                        },
                                        {
                                            type: "Post",
                                            id: "post-without-commit-hash",
                                            title: "in GitHub: unrelated post",
                                            bodySnippet: {
                                                text: "in GitHub: unrelated post",
                                                matches: [],
                                            },
                                            author: {botId: "paul-bot-id"},
                                        },
                                        {
                                            type: "Post",
                                            id: humanPostId,
                                            title: `in GitHub: manual mention of ${shortHash}`,
                                            bodySnippet: {
                                                text: `manual mention of ${shortHash}`,
                                                matches: [],
                                            },
                                            author: {},
                                        },
                                    ],
                                }),
                            ),
                    });
                })
                .mockImplementationOnce((_url: string, options?: any) => {
                    mockFetchCalls.push({
                        url: _url,
                        body: options?.body ? JSON.parse(options.body) : null,
                    });
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: "OK",
                        text: () => Promise.resolve(JSON.stringify({id: "post-id"})),
                    });
                })
                .mockImplementationOnce((_url: string, options?: any) => {
                    mockFetchCalls.push({
                        url: _url,
                        body: options?.body ? JSON.parse(options.body) : null,
                    });
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: "OK",
                        text: () => Promise.resolve(JSON.stringify({id: "post-id"})),
                    });
                })
                .mockImplementationOnce((_url: string, options?: any) => {
                    mockFetchCalls.push({
                        url: _url,
                        body: options?.body ? JSON.parse(options.body) : null,
                    });
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: "OK",
                        text: () => Promise.resolve(JSON.stringify({id: "post-id"})),
                    });
                });

            const payload = createGitHubFixture({
                workflow_run: {
                    ...createGitHubFixture().workflow_run,
                    head_sha: commitHash,
                    conclusion: "success",
                    workflow_id: deployGithubWorkflowId,
                },
            });

            await handleGitHubWorkflowRunPayload(payload);

            expect(mockFetchCalls.length).toBe(5);

            expect(mockFetchCalls[0]?.url).toBe(
                `https://api.test.cyberworlds.com/channels/${sendAlertAvailableChannels.github}`,
            );

            const searchQuery = encodeURIComponent(shortHash);
            expect(mockFetchCalls[1]?.url).toBe(
                `https://api.test.cyberworlds.com/spaces/${spaceId}/search?query=${searchQuery}`,
            );

            expect(mockFetchCalls[2]?.url).toBe(
                `https://api.test.cyberworlds.com/posts/${postId1}/messages`,
            );
            expect(formatFetchCallForSnapshot(mockFetchCalls[2]!)).toMatchSnapshot();

            expect(mockFetchCalls[3]?.url).toBe(
                `https://api.test.cyberworlds.com/posts/${postId2}/messages`,
            );
            expect(mockFetchCalls[4]?.url).toBe(
                `https://api.test.cyberworlds.com/posts/${humanPostId}/messages`,
            );
        });

        test("comments when the commit hash is only in the post title", async () => {
            const commitHash = "abc123def456";
            const shortHash = commitHash.substring(0, 7);
            const spaceId = "test-space-id";
            const postId = assertId<PostId>("11111111111111111111111111");
            const searchResponse = {
                results: [
                    {
                        type: "Post",
                        id: postId,
                        title: `in GitHub: cursor pushed a commit (${shortHash})`,
                        titleMatches: [],
                        bodySnippet: null,
                        author: {
                            id: assertId<AccountId>("22222222222222222222222222"),
                            name: "Paul",
                            shortName: "Paul",
                            bot: {id: assertId<BotId>("33333333333333333333333333")},
                            space: {
                                role: "Member",
                                addedTime: assertDateString("2025-10-29T22:36:02.933Z"),
                            },
                        },
                    },
                ],
            } satisfies ApiSearchResponse;

            mockFetch.mockClear();
            mockFetchCalls = [];

            mockFetch
                .mockImplementationOnce((_url: string) => {
                    mockFetchCalls.push({url: _url, body: null});
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: "OK",
                        text: () => Promise.resolve(JSON.stringify({spaceId, channel: {}})),
                    });
                })
                .mockImplementationOnce((_url: string) => {
                    mockFetchCalls.push({url: _url, body: null});
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: "OK",
                        text: () => Promise.resolve(JSON.stringify(searchResponse)),
                    });
                });

            const payload = createGitHubFixture({
                workflow_run: {
                    ...createGitHubFixture().workflow_run,
                    head_sha: commitHash,
                    conclusion: "success",
                    workflow_id: deployGithubWorkflowId,
                },
            });

            await handleGitHubWorkflowRunPayload(payload);

            expect(mockFetchCalls).toHaveLength(3);
            expect(mockFetchCalls[2]?.url).toBe(
                `https://api.test.cyberworlds.com/posts/${postId}/messages`,
            );
        });

        test("comments on posts with commit hash when deploy fails", async () => {
            const commitHash = "abc123def456";
            const spaceId = "test-space-id";
            const postId = "test-post-id";

            mockFetch.mockClear();
            mockFetchCalls = [];

            mockFetch
                .mockImplementationOnce((_url: string, options?: any) => {
                    mockFetchCalls.push({
                        url: _url,
                        body: options?.body ? JSON.parse(options.body) : null,
                    });
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: "OK",
                        text: () =>
                            Promise.resolve(
                                JSON.stringify({
                                    spaceId,
                                    channel: {id: sendAlertAvailableChannels.builds},
                                }),
                            ),
                    });
                })
                .mockImplementationOnce((_url: string, options?: any) => {
                    mockFetchCalls.push({
                        url: _url,
                        body: options?.body ? JSON.parse(options.body) : null,
                    });
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: "OK",
                        text: () =>
                            Promise.resolve(
                                JSON.stringify({
                                    post: {id: "builds-post-id"},
                                    spaceId,
                                }),
                            ),
                    });
                })
                .mockImplementationOnce((_url: string, options?: any) => {
                    mockFetchCalls.push({
                        url: _url,
                        body: options?.body ? JSON.parse(options.body) : null,
                    });
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: "OK",
                        text: () =>
                            Promise.resolve(
                                JSON.stringify({
                                    spaceId,
                                    channel: {},
                                }),
                            ),
                    });
                })
                .mockImplementationOnce((_url: string, options?: any) => {
                    mockFetchCalls.push({
                        url: _url,
                        body: options?.body ? JSON.parse(options.body) : null,
                    });
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: "OK",
                        text: () =>
                            Promise.resolve(
                                JSON.stringify({
                                    results: [
                                        {
                                            type: "Post",
                                            id: postId,
                                            title: `in GitHub: commit ${commitHash.substring(0, 7)}`,
                                            bodySnippet: {
                                                text: `commit ${commitHash.substring(0, 7)} in GitHub`,
                                                matches: [],
                                            },
                                            author: {botId: "paul-bot-id"},
                                        },
                                        {
                                            type: "Post",
                                            id: "builds-post-id",
                                            title: `in Builds: Build failed for ${commitHash.substring(0, 7)}`,
                                            bodySnippet: {
                                                text: `Build failed for ${commitHash.substring(0, 7)}`,
                                                matches: [],
                                            },
                                            author: {botId: "paul-bot-id"},
                                        },
                                    ],
                                }),
                            ),
                    });
                })
                .mockImplementationOnce((_url: string, options?: any) => {
                    mockFetchCalls.push({
                        url: _url,
                        body: options?.body ? JSON.parse(options.body) : null,
                    });
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: "OK",
                        text: () => Promise.resolve(JSON.stringify({id: "comment-id"})),
                    });
                });

            const payload = createGitHubFixture({
                workflow_run: {
                    ...createGitHubFixture().workflow_run,
                    head_sha: commitHash,
                    conclusion: "failure",
                    workflow_id: deployGithubWorkflowId,
                },
            });

            await handleGitHubWorkflowRunPayload(payload);

            expect(mockFetchCalls.length).toBe(6);

            expect(mockFetchCalls[1]?.url).toBe(`https://api.test.cyberworlds.com/posts`);

            const commentCallIndex = 4;
            expect(mockFetchCalls[commentCallIndex]?.url).toBe(
                `https://api.test.cyberworlds.com/posts/${postId}/messages`,
            );
            expect(mockFetchCalls[5]?.url).toBe(
                "https://api.test.cyberworlds.com/posts/builds-post-id/messages",
            );

            expect(mockFetchCalls[commentCallIndex]!.body).toEqual({
                content: {elements: []},
                files: [
                    {
                        element: {
                            type: "Preview",
                            reference: {
                                type: "Post",
                                id: "builds-post-id",
                            },
                        },
                    },
                ],
            });
        });

        test("handles case when no posts are found with commit hash", async () => {
            const commitHash = "abc123def456";
            const spaceId = "test-space-id";

            mockFetch.mockClear();
            mockFetchCalls = [];

            mockFetch
                .mockImplementationOnce((_url: string, options?: any) => {
                    mockFetchCalls.push({
                        url: _url,
                        body: options?.body ? JSON.parse(options.body) : null,
                    });
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: "OK",
                        text: () =>
                            Promise.resolve(
                                JSON.stringify({
                                    spaceId,
                                    channel: {},
                                }),
                            ),
                    });
                })
                .mockImplementationOnce((_url: string, options?: any) => {
                    mockFetchCalls.push({
                        url: _url,
                        body: options?.body ? JSON.parse(options.body) : null,
                    });
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: "OK",
                        text: () =>
                            Promise.resolve(
                                JSON.stringify({
                                    results: [],
                                }),
                            ),
                    });
                });

            const payload = createGitHubFixture({
                workflow_run: {
                    ...createGitHubFixture().workflow_run,
                    head_sha: commitHash,
                    conclusion: "success",
                    workflow_id: deployGithubWorkflowId,
                },
            });

            await handleGitHubWorkflowRunPayload(payload);

            expect(mockFetchCalls.length).toBe(2);
        });

        test("comments on posts with commit hash when any workflow fails", async () => {
            const commitHash = "abc123def456";
            const spaceId = "test-space-id";
            const postId = "test-post-id";

            mockFetch.mockClear();
            mockFetchCalls = [];

            mockFetch
                .mockImplementationOnce((_url: string, options?: any) => {
                    mockFetchCalls.push({
                        url: _url,
                        body: options?.body ? JSON.parse(options.body) : null,
                    });
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: "OK",
                        text: () =>
                            Promise.resolve(
                                JSON.stringify({
                                    spaceId,
                                    channel: {id: sendAlertAvailableChannels.builds},
                                }),
                            ),
                    });
                })
                .mockImplementationOnce((_url: string, options?: any) => {
                    mockFetchCalls.push({
                        url: _url,
                        body: options?.body ? JSON.parse(options.body) : null,
                    });
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: "OK",
                        text: () =>
                            Promise.resolve(
                                JSON.stringify({
                                    post: {id: "builds-post-id"},
                                    spaceId,
                                }),
                            ),
                    });
                })
                .mockImplementationOnce((_url: string, options?: any) => {
                    mockFetchCalls.push({
                        url: _url,
                        body: options?.body ? JSON.parse(options.body) : null,
                    });
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: "OK",
                        text: () =>
                            Promise.resolve(
                                JSON.stringify({
                                    spaceId,
                                    channel: {},
                                }),
                            ),
                    });
                })
                .mockImplementationOnce((_url: string, options?: any) => {
                    mockFetchCalls.push({
                        url: _url,
                        body: options?.body ? JSON.parse(options.body) : null,
                    });
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: "OK",
                        text: () =>
                            Promise.resolve(
                                JSON.stringify({
                                    results: [
                                        {
                                            type: "Post",
                                            id: postId,
                                            title: `in GitHub: commit ${commitHash.substring(0, 7)}`,
                                            bodySnippet: {
                                                text: `commit ${commitHash.substring(0, 7)} in GitHub`,
                                                matches: [],
                                            },
                                            author: {botId: "paul-bot-id"},
                                        },
                                        {
                                            type: "Post",
                                            id: "builds-post-id",
                                            title: `in Builds: Build failed for ${commitHash.substring(0, 7)}`,
                                            bodySnippet: {
                                                text: `Build failed for ${commitHash.substring(0, 7)}`,
                                                matches: [],
                                            },
                                            author: {botId: "paul-bot-id"},
                                        },
                                    ],
                                }),
                            ),
                    });
                })
                .mockImplementationOnce((_url: string, options?: any) => {
                    mockFetchCalls.push({
                        url: _url,
                        body: options?.body ? JSON.parse(options.body) : null,
                    });
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: "OK",
                        text: () => Promise.resolve(JSON.stringify({id: "comment-id"})),
                    });
                });

            const payload = createGitHubFixture({
                workflow_run: {
                    ...createGitHubFixture().workflow_run,
                    head_sha: commitHash,
                    conclusion: "failure",
                    workflow_id: nonDeployGithubWorkflowId,
                },
            });

            await handleGitHubWorkflowRunPayload(payload);

            expect(mockFetchCalls.length).toBe(6);

            expect(mockFetchCalls[1]?.url).toBe(`https://api.test.cyberworlds.com/posts`);

            const commentCallIndex = 4;
            expect(mockFetchCalls[commentCallIndex]?.url).toBe(
                `https://api.test.cyberworlds.com/posts/${postId}/messages`,
            );
            expect(mockFetchCalls[5]?.url).toBe(
                "https://api.test.cyberworlds.com/posts/builds-post-id/messages",
            );

            expect(mockFetchCalls[commentCallIndex]!.body).toEqual({
                content: {elements: []},
                files: [
                    {
                        element: {
                            type: "Preview",
                            reference: {
                                type: "Post",
                                id: "builds-post-id",
                            },
                        },
                    },
                ],
            });
        });

        test("does not comment on posts with commit hash when a non-deploy workflow succeeds", async () => {
            const payload = createGitHubFixture({
                workflow_run: {
                    ...createGitHubFixture().workflow_run,
                    conclusion: "success",
                    workflow_id: nonDeployGithubWorkflowId,
                },
            });

            await handleGitHubWorkflowRunPayload(payload);

            expect(mockFetchCalls).toHaveLength(0);
        });
    });
});
