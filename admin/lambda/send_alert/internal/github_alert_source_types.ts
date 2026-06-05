// Type definitions for GitHub event payloads
// https://docs.github.com/en/webhooks/webhook-events-and-payloads#workflow_run
// https://docs.github.com/en/webhooks/webhook-events-and-payloads#push

type GitHubActor = {
    login: string;
    id: number;
    node_id: string;
    avatar_url: string;
    gravatar_id: string;
    url: string;
    html_url: string;
    followers_url: string;
    following_url: string;
    gists_url: string;
    starred_url: string;
    subscriptions_url: string;
    organizations_url: string;
    repos_url: string;
    events_url: string;
    received_events_url: string;
    type: string;
    site_admin: boolean;
};

type GitHubRepository = {
    id: number;
    node_id: string;
    name: string;
    full_name: string;
    private: boolean;
    owner: GitHubActor;
    html_url: string;
    description: string | null;
    fork: boolean;
    url: string;
    archive_url: string;
    assignees_url: string;
    blobs_url: string;
    branches_url: string;
    collaborators_url: string;
    comments_url: string;
    commits_url: string;
    compare_url: string;
    contents_url: string;
    contributors_url: string;
    deployments_url: string;
    downloads_url: string;
    events_url: string;
    forks_url: string;
    git_commits_url: string;
    git_refs_url: string;
    git_tags_url: string;
    git_url: string;
    issue_comment_url: string;
    issue_events_url: string;
    issues_url: string;
    keys_url: string;
    labels_url: string;
    languages_url: string;
    merges_url: string;
    milestones_url: string;
    notifications_url: string;
    pulls_url: string;
    releases_url: string;
    ssh_url: string;
    stargazers_url: string;
    statuses_url: string;
    subscribers_url: string;
    subscription_url: string;
    tags_url: string;
    teams_url: string;
    trees_url: string;
    clone_url: string;
    mirror_url: string | null;
    hooks_url: string;
    svn_url: string;
    homepage: string | null;
    language: string | null;
    forks_count: number;
    stargazers_count: number;
    watchers_count: number;
    size: number;
    default_branch: string;
    open_issues_count: number;
    is_template: boolean;
    topics: Array<string>;
    has_issues: boolean;
    has_projects: boolean;
    has_wiki: boolean;
    has_pages: boolean;
    has_downloads: boolean;
    archived: boolean;
    disabled: boolean;
    visibility: string;
    pushed_at: string;
    created_at: string;
    updated_at: string;
    permissions: {
        admin: boolean;
        maintain: boolean;
        push: boolean;
        triage: boolean;
        pull: boolean;
    };
    allow_rebase_merge: boolean;
    template_repository: unknown;
    temp_clone_token: string;
    allow_squash_merge: boolean;
    allow_auto_merge: boolean;
    delete_branch_on_merge: boolean;
    allow_merge_commit: boolean;
    subscribers_count: number;
    network_count: number;
    license: {
        key: string;
        name: string;
        url: string;
        spdx_id: string;
        node_id: string;
        html_url: string;
    } | null;
    forks: number;
    open_issues: number;
    watchers: number;
};

export type GitHubWorkflowRunEventPayload = {
    type: "workflow_run";
    action: "completed" | "requested";
    workflow_run: {
        id: number;
        name: string;
        node_id: string;
        check_suite_id: number;
        head_branch: string;
        head_sha: string;
        path: string;
        run_number: number;
        event: string;
        display_title: string;
        status: "queued" | "requested" | "waiting" | "pending" | "in_progress" | "completed";
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
        workflow_id: number;
        url: string;
        html_url: string;
        pull_requests: Array<unknown>;
        created_at: string;
        updated_at: string;
        actor: GitHubActor;
        run_attempt: number;
        run_started_at: string;
        triggering_actor: GitHubActor;
        jobs_url: string;
        logs_url: string;
        artifacts_url: string;
        cancel_url: string;
        rerun_url: string;
        workflow_url: string;
        head_commit: {
            id: string;
            tree_id: string;
            message: string;
            timestamp: string;
            author: {
                name: string;
                email: string;
            };
            committer: {
                name: string;
                email: string;
            };
        };
        repository: GitHubRepository;
        head_repository: GitHubRepository;
        referenced_workflows: Array<unknown>;
    };
    workflow: {
        id: number;
        node_id: string;
        name: string;
        path: string;
        state: string;
        created_at: string;
        updated_at: string;
        url: string;
        html_url: string;
        badge_url: string;
    };
    repository: GitHubRepository;
    sender: GitHubActor;
    organization?: {
        login: string;
        id: number;
        node_id: string;
        url: string;
        repos_url: string;
        events_url: string;
        hooks_url: string;
        issues_url: string;
        members_url: string;
        public_members_url: string;
        avatar_url: string;
        description: string;
    };
};

type GitHubPushCommit = {
    id: string;
    tree_id: string;
    distinct: boolean;
    message: string;
    timestamp: string;
    url: string;
    author: {
        name: string;
        email: string;
        username: string | null;
    };
    committer: {
        name: string;
        email: string;
        username: string | null;
    };
    added: Array<string>;
    removed: Array<string>;
    modified: Array<string>;
};

export type GitHubPushEventPayload = {
    type: "push";
    after: string;
    base_ref: string | null;
    before: string;
    commits: Array<GitHubPushCommit>;
    compare: string;
    created: boolean;
    deleted: boolean;
    forced: boolean;
    head_commit: GitHubPushCommit | null;
    pusher: {
        name: string;
        email: string;
    };
    ref: string;
    repository: GitHubRepository;
    sender: GitHubActor;
    organization?: {
        login: string;
        id: number;
        node_id: string;
        url: string;
        repos_url: string;
        events_url: string;
        hooks_url: string;
        issues_url: string;
        members_url: string;
        public_members_url: string;
        avatar_url: string;
        description: string;
    };
};

export type GitHubEventPayload = GitHubWorkflowRunEventPayload | GitHubPushEventPayload;
