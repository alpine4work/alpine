// Type definitions for GitHub event payloads.
// https://docs.github.com/en/webhooks/webhook-events-and-payloads#workflow_run
// https://docs.github.com/en/webhooks/webhook-events-and-payloads#push
// https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#workflow_run

type GitHubActor = {
    /**
     * GitHub login for the account that appears in the payload.
     */
    login: string;

    /**
     * GitHub numeric account identifier.
     */
    id: number;

    /**
     * GitHub global node identifier.
     */
    node_id: string;

    /**
     * URL for the account avatar image.
     */
    avatar_url: string;

    /**
     * Legacy Gravatar identifier, usually an empty string.
     */
    gravatar_id: string;

    /**
     * REST API URL for the account.
     */
    url: string;

    /**
     * Browser URL for the account profile.
     */
    html_url: string;

    /**
     * REST API URL for account followers.
     */
    followers_url: string;

    /**
     * REST API URL template for accounts this account follows.
     */
    following_url: string;

    /**
     * REST API URL template for account gists.
     */
    gists_url: string;

    /**
     * REST API URL template for repositories starred by this account.
     */
    starred_url: string;

    /**
     * REST API URL for repository subscriptions.
     */
    subscriptions_url: string;

    /**
     * REST API URL for organizations this account belongs to.
     */
    organizations_url: string;

    /**
     * REST API URL for repositories owned by this account.
     */
    repos_url: string;

    /**
     * REST API URL template for events performed by this account.
     */
    events_url: string;

    /**
     * REST API URL for events received by this account.
     */
    received_events_url: string;

    /**
     * GitHub account type, such as `User` or `Organization`.
     */
    type: string;

    /**
     * Whether the account is a GitHub site administrator.
     */
    site_admin: boolean;
};

type GitHubOrganization = {
    /**
     * GitHub organization login.
     */
    login: string;

    /**
     * GitHub numeric organization identifier.
     */
    id: number;

    /**
     * GitHub global node identifier for the organization.
     */
    node_id: string;

    /**
     * REST API URL for the organization.
     */
    url: string;

    /**
     * REST API URL for repositories owned by the organization.
     */
    repos_url: string;

    /**
     * REST API URL for organization events.
     */
    events_url: string;

    /**
     * REST API URL for organization hooks.
     */
    hooks_url: string;

    /**
     * REST API URL for organization issues.
     */
    issues_url: string;

    /**
     * REST API URL template for organization members.
     */
    members_url: string;

    /**
     * REST API URL template for public organization members.
     */
    public_members_url: string;

    /**
     * URL for the organization avatar image.
     */
    avatar_url: string;

    /**
     * Organization description.
     */
    description: string | null;
};

type GitHubRepositoryPermissions = {
    /**
     * Whether the installation or actor has admin repository permission.
     */
    admin: boolean;

    /**
     * Whether the installation or actor has maintain repository permission.
     */
    maintain: boolean;

    /**
     * Whether the installation or actor has push repository permission.
     */
    push: boolean;

    /**
     * Whether the installation or actor has triage repository permission.
     */
    triage: boolean;

    /**
     * Whether the installation or actor has pull repository permission.
     */
    pull: boolean;
};

type GitHubRepositoryLicense = {
    /**
     * License key.
     */
    key: string;

    /**
     * License display name.
     */
    name: string;

    /**
     * REST API URL for the license.
     */
    url: string;

    /**
     * SPDX identifier for the license.
     */
    spdx_id: string;

    /**
     * GitHub global node identifier for the license.
     */
    node_id: string;

    /**
     * Browser URL for the license.
     */
    html_url: string;
};

type GitHubRepository = {
    /**
     * GitHub numeric repository identifier.
     */
    id: number;

    /**
     * GitHub global node identifier for the repository.
     */
    node_id: string;

    /**
     * Repository name without the owner.
     */
    name: string;

    /**
     * Repository name including owner, such as `owner/repo`.
     */
    full_name: string;

    /**
     * Whether the repository is private.
     */
    private: boolean;

    /**
     * Account that owns the repository.
     */
    owner: GitHubActor;

    /**
     * Browser URL for the repository.
     */
    html_url: string;

    /**
     * Repository description.
     */
    description: string | null;

    /**
     * Whether the repository is a fork.
     */
    fork: boolean;

    /**
     * REST API URL for the repository.
     */
    url: string;

    /**
     * REST API URL template for repository archives.
     */
    archive_url: string;

    /**
     * REST API URL template for repository assignees.
     */
    assignees_url: string;

    /**
     * REST API URL template for repository blobs.
     */
    blobs_url: string;

    /**
     * REST API URL template for repository branches.
     */
    branches_url: string;

    /**
     * REST API URL template for repository collaborators.
     */
    collaborators_url: string;

    /**
     * REST API URL template for repository commit comments.
     */
    comments_url: string;

    /**
     * REST API URL template for repository commits.
     */
    commits_url: string;

    /**
     * REST API URL template for comparing repository refs.
     */
    compare_url: string;

    /**
     * REST API URL template for repository contents.
     */
    contents_url: string;

    /**
     * REST API URL for repository contributors.
     */
    contributors_url: string;

    /**
     * REST API URL for repository deployments.
     */
    deployments_url: string;

    /**
     * REST API URL for repository downloads.
     */
    downloads_url: string;

    /**
     * REST API URL for repository events.
     */
    events_url: string;

    /**
     * REST API URL for repository forks.
     */
    forks_url: string;

    /**
     * REST API URL template for git commit objects.
     */
    git_commits_url: string;

    /**
     * REST API URL template for git refs.
     */
    git_refs_url: string;

    /**
     * REST API URL template for git tags.
     */
    git_tags_url: string;

    /**
     * Git protocol clone URL.
     */
    git_url: string;

    /**
     * REST API URL template for issue comments.
     */
    issue_comment_url: string;

    /**
     * REST API URL template for issue events.
     */
    issue_events_url: string;

    /**
     * REST API URL template for issues.
     */
    issues_url: string;

    /**
     * REST API URL template for deploy keys.
     */
    keys_url: string;

    /**
     * REST API URL template for labels.
     */
    labels_url: string;

    /**
     * REST API URL for language statistics.
     */
    languages_url: string;

    /**
     * REST API URL for repository merges.
     */
    merges_url: string;

    /**
     * REST API URL template for milestones.
     */
    milestones_url: string;

    /**
     * REST API URL template for repository notifications.
     */
    notifications_url: string;

    /**
     * REST API URL template for pull requests.
     */
    pulls_url: string;

    /**
     * REST API URL template for releases.
     */
    releases_url: string;

    /**
     * SSH clone URL.
     */
    ssh_url: string;

    /**
     * REST API URL for stargazers.
     */
    stargazers_url: string;

    /**
     * REST API URL template for commit statuses.
     */
    statuses_url: string;

    /**
     * REST API URL for subscribers.
     */
    subscribers_url: string;

    /**
     * REST API URL for the repository subscription.
     */
    subscription_url: string;

    /**
     * REST API URL for tags.
     */
    tags_url: string;

    /**
     * REST API URL for teams with repository access.
     */
    teams_url: string;

    /**
     * REST API URL template for git trees.
     */
    trees_url: string;

    /**
     * HTTPS clone URL.
     */
    clone_url: string;

    /**
     * Mirror URL when the repository is mirrored.
     */
    mirror_url: string | null;

    /**
     * REST API URL for repository hooks.
     */
    hooks_url: string;

    /**
     * Subversion URL for the repository.
     */
    svn_url: string;

    /**
     * Repository homepage URL.
     */
    homepage: string | null;

    /**
     * Primary repository language.
     */
    language: string | null;

    /**
     * Number of repository forks.
     */
    forks_count: number;

    /**
     * Number of repository stargazers.
     */
    stargazers_count: number;

    /**
     * Number of repository watchers.
     */
    watchers_count: number;

    /**
     * Repository size in kilobytes.
     */
    size: number;

    /**
     * Default branch name.
     */
    default_branch: string;

    /**
     * Number of open issues.
     */
    open_issues_count: number;

    /**
     * Whether the repository is a template repository.
     */
    is_template: boolean;

    /**
     * Repository topics.
     */
    topics: Array<string>;

    /**
     * Whether issues are enabled.
     */
    has_issues: boolean;

    /**
     * Whether projects are enabled.
     */
    has_projects: boolean;

    /**
     * Whether the wiki is enabled.
     */
    has_wiki: boolean;

    /**
     * Whether GitHub Pages is enabled.
     */
    has_pages: boolean;

    /**
     * Whether downloads are enabled.
     */
    has_downloads: boolean;

    /**
     * Whether the repository is archived.
     */
    archived: boolean;

    /**
     * Whether the repository is disabled.
     */
    disabled: boolean;

    /**
     * Repository visibility, such as `public`, `private`, or `internal`.
     */
    visibility: string;

    /**
     * Timestamp when the repository was last pushed to.
     */
    pushed_at: string;

    /**
     * Timestamp when the repository was created.
     */
    created_at: string;

    /**
     * Timestamp when the repository was last updated.
     */
    updated_at: string;

    /**
     * Permissions for the installation or actor included with the payload.
     */
    permissions: GitHubRepositoryPermissions;

    /**
     * Whether rebase merges are allowed.
     */
    allow_rebase_merge: boolean;

    /**
     * Template repository metadata when this repository came from a template.
     */
    template_repository: unknown;

    /**
     * Temporary clone token supplied by GitHub.
     */
    temp_clone_token: string;

    /**
     * Whether squash merges are allowed.
     */
    allow_squash_merge: boolean;

    /**
     * Whether auto-merge is allowed.
     */
    allow_auto_merge: boolean;

    /**
     * Whether GitHub deletes branches after pull request merges.
     */
    delete_branch_on_merge: boolean;

    /**
     * Whether merge commits are allowed.
     */
    allow_merge_commit: boolean;

    /**
     * Number of repository subscribers.
     */
    subscribers_count: number;

    /**
     * Number of repositories in the repository network.
     */
    network_count: number;

    /**
     * Repository license metadata.
     */
    license: GitHubRepositoryLicense | null;

    /**
     * Number of repository forks.
     */
    forks: number;

    /**
     * Number of open issues.
     */
    open_issues: number;

    /**
     * Number of repository watchers.
     */
    watchers: number;
};

type GitHubCommitPerson = {
    /**
     * Git author or committer name.
     */
    name: string;

    /**
     * Git author or committer email address.
     */
    email: string;
};

type GitHubWorkflowRunHeadCommit = {
    /**
     * Commit SHA.
     */
    id: string;

    /**
     * Tree SHA for the commit.
     */
    tree_id: string;

    /**
     * Commit message.
     */
    message: string;

    /**
     * Timestamp associated with the commit.
     */
    timestamp: string;

    /**
     * Git author metadata.
     */
    author: GitHubCommitPerson;

    /**
     * Git committer metadata.
     */
    committer: GitHubCommitPerson;
};

type GitHubWorkflowRun = {
    /**
     * GitHub numeric workflow run identifier.
     */
    id: number;

    /**
     * Workflow run display name.
     */
    name: string;

    /**
     * GitHub global node identifier for the workflow run.
     */
    node_id: string;

    /**
     * Check suite identifier for the workflow run.
     */
    check_suite_id: number;

    /**
     * Branch for the head commit of the workflow run.
     */
    head_branch: string;

    /**
     * SHA for the head commit of the workflow run.
     */
    head_sha: string;

    /**
     * Path to the workflow file in the repository.
     */
    path: string;

    /**
     * Repository-local workflow run number.
     */
    run_number: number;

    /**
     * Event that triggered the workflow run.
     */
    event: string;

    /**
     * Display title for the workflow run.
     */
    display_title: string;

    /**
     * Current workflow run status.
     */
    status: "queued" | "requested" | "waiting" | "pending" | "in_progress" | "completed";

    /**
     * Final workflow run conclusion when the run is completed.
     */
    conclusion:
        | "action_required"
        | "cancelled"
        | "failure"
        | "neutral"
        | "skipped"
        | "stale"
        | "success"
        | "timed_out"
        | "startup_failure";

    /**
     * Workflow identifier.
     */
    workflow_id: number;

    /**
     * REST API URL for the workflow run.
     */
    url: string;

    /**
     * Browser URL for the workflow run.
     */
    html_url: string;

    /**
     * Pull requests associated with the workflow run.
     */
    pull_requests: Array<unknown>;

    /**
     * Timestamp when the workflow run was created.
     */
    created_at: string;

    /**
     * Timestamp when the workflow run was last updated.
     */
    updated_at: string;

    /**
     * Account that triggered the original workflow run.
     */
    actor: GitHubActor;

    /**
     * Attempt number for this workflow run.
     */
    run_attempt: number;

    /**
     * Timestamp when this workflow run attempt started.
     */
    run_started_at: string;

    /**
     * Account that triggered this workflow run attempt.
     */
    triggering_actor: GitHubActor;

    /**
     * REST API URL for jobs in the workflow run.
     */
    jobs_url: string;

    /**
     * REST API URL for workflow run logs.
     */
    logs_url: string;

    /**
     * REST API URL for workflow run artifacts.
     */
    artifacts_url: string;

    /**
     * REST API URL for canceling the workflow run.
     */
    cancel_url: string;

    /**
     * REST API URL for rerunning the workflow run.
     */
    rerun_url: string;

    /**
     * REST API URL for the workflow definition.
     */
    workflow_url: string;

    /**
     * Head commit for the workflow run.
     */
    head_commit: GitHubWorkflowRunHeadCommit;

    /**
     * Repository where the workflow run occurred.
     */
    repository: GitHubRepository;

    /**
     * Head repository for the workflow run.
     */
    head_repository: GitHubRepository;

    /**
     * Workflows referenced by this workflow run.
     */
    referenced_workflows: Array<unknown>;
};

type GitHubWorkflow = {
    /**
     * GitHub numeric workflow identifier.
     */
    id: number;

    /**
     * GitHub global node identifier for the workflow.
     */
    node_id: string;

    /**
     * Workflow name.
     */
    name: string;

    /**
     * Path to the workflow file in the repository.
     */
    path: string;

    /**
     * Workflow state.
     */
    state: string;

    /**
     * Timestamp when the workflow was created.
     */
    created_at: string;

    /**
     * Timestamp when the workflow was last updated.
     */
    updated_at: string;

    /**
     * REST API URL for the workflow.
     */
    url: string;

    /**
     * Browser URL for the workflow.
     */
    html_url: string;

    /**
     * URL for the workflow status badge.
     */
    badge_url: string;
};

export type GitHubWorkflowRunEventPayload = {
    /**
     * Internal discriminator added from the `x-github-event` header.
     */
    type: "workflow_run";

    /**
     * GitHub workflow run action that caused the webhook.
     */
    action: "completed" | "requested" | "in_progress";

    /**
     * Workflow run that generated the event.
     */
    workflow_run: GitHubWorkflowRun;

    /**
     * Workflow definition associated with the run.
     */
    workflow: GitHubWorkflow | null;

    /**
     * Repository where the event occurred.
     */
    repository: GitHubRepository;

    /**
     * Account that triggered the event.
     */
    sender: GitHubActor;

    /**
     * Organization included when the repository belongs to an organization.
     */
    organization?: GitHubOrganization;
};

type GitHubPushCommitPerson = GitHubCommitPerson & {
    /**
     * GitHub username for the commit identity, when GitHub can map it.
     */
    username: string | null;
};

type GitHubPushCommit = {
    /**
     * Commit SHA.
     */
    id: string;

    /**
     * Tree SHA for the commit.
     */
    tree_id: string;

    /**
     * Whether this commit is distinct from previous pushes.
     */
    distinct: boolean;

    /**
     * Commit message.
     */
    message: string;

    /**
     * Timestamp associated with the commit.
     */
    timestamp: string;

    /**
     * Browser URL for the commit.
     */
    url: string;

    /**
     * Git author metadata for the commit.
     */
    author: GitHubPushCommitPerson;

    /**
     * Git committer metadata for the commit.
     */
    committer: GitHubPushCommitPerson;

    /**
     * Paths added by the commit.
     */
    added: Array<string>;

    /**
     * Paths removed by the commit.
     */
    removed: Array<string>;

    /**
     * Paths modified by the commit.
     */
    modified: Array<string>;
};

export type GitHubPushEventPayload = {
    /**
     * Internal discriminator added from the `x-github-event` header.
     */
    type: "push";

    /**
     * SHA of the most recent commit on `ref` after the push.
     */
    after: string;

    /**
     * Base ref for cross-repository pushes, or `null` for normal pushes.
     */
    base_ref: string | null;

    /**
     * SHA of the most recent commit on `ref` before the push.
     */
    before: string;

    /**
     * Commits included in the compare from `before` to `after`.
     */
    commits: Array<GitHubPushCommit>;

    /**
     * URL showing changes from the `before` commit to the `after` commit.
     */
    compare: string;

    /**
     * Whether this push created the `ref`.
     */
    created: boolean;

    /**
     * Whether this push deleted the `ref`.
     */
    deleted: boolean;

    /**
     * Whether this push force-updated the `ref`.
     */
    forced: boolean;

    /**
     * Head commit after the push, or `null` when the ref was deleted.
     */
    head_commit: GitHubPushCommit | null;

    /**
     * Git author or committer metaproperties for the pusher.
     */
    pusher: GitHubCommitPerson;

    /**
     * Full git ref that was pushed.
     */
    ref: string;

    /**
     * Repository where the push occurred.
     */
    repository: GitHubRepository;

    /**
     * Account that triggered the push event.
     */
    sender: GitHubActor;

    /**
     * Organization included when the repository belongs to an organization.
     */
    organization?: GitHubOrganization;
};

/**
 * Supported GitHub webhook payloads handled by this alert source.
 */
export type GitHubEventPayload = GitHubWorkflowRunEventPayload | GitHubPushEventPayload;
