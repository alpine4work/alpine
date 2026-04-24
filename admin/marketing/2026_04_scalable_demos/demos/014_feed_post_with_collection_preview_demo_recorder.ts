import {CalendarDateTime, today} from "@internationalized/date";
import {createDemoSpace} from "~/admin/environment/demo_space/create_demo_space.js";
import {runScalableDemoRecorder} from "~/admin/marketing/2026_04_scalable_demos/helpers/run_scalable_demo_recorder.js";
import {scalableDemoDefaultViewport} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {addSearchAffinityEntityPointsForTest} from "~/server/search/data/table/search_entity_actions.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {FeedEntry, FeedEntrySchema} from "~/shared/feed/feed_entry_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {UrlPath} from "~/shared/helpers/http/url_path.js";
import {getCurrentTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {markdown} from "~/shared/helpers/string/markdown.js";
import {Schema} from "~/shared/schema/schema.js";

runScalableDemoRecorder(async (context, services, recorder) => {
    const {space, accounts} = await createDemoSpace(context, services.getAppServiceTokenAgent());

    const timeZone = getCurrentTimeZone();
    const currentDate = today(timeZone);

    const daysAgoAt = (days: number, hour: number, minute: number) =>
        new CalendarDateTime(currentDate.year, currentDate.month, currentDate.day, hour, minute)
            .subtract({days})
            .toDate(timeZone);

    const spaceId = space.id;
    const accountId = accounts.cassCade.account.id;

    // ── Documents ──────────────────────────────────────────────────────

    const spaceUrl = `https://alpine.inc/s/${spaceId}`;
    const mentionUrl = (accountSession: {account: {id: string}}) =>
        `${spaceUrl}/accounts/${accountSession.account.id}?mention=short`;

    const q2UpdateDoc = await TestDocument.create(accounts.cassCade, {
        title: "FY2026 Q2 Update",
        access: "Public",
        body: markdown`
Quick update on where we landed at the end of Q2 and what\u2019s on deck. Big push this quarter was
stabilizing realtime and kicking off the mobile redesign.

## Engineering

[Elle](ELLE_MENTION)\u2019s realtime reliability work shipped. Reconnection logic is solid, jittered
backoff is live, and we haven\u2019t had a sync incident since the rollout. Health checks and
alerting are in place.

[Mason](MASON_MENTION) and [Matt](MATT_MENTION) closed out tables in the editor. Column resizing
landed as snap by default with Alt for freeform. [Holly](HOLLY_MENTION)\u2019s help doc and forum
announcement went out the same week.

## Product

Top themes from the Q3 customer survey: table support (shipped), notification control, and search
speed on large workspaces. Notification control is the leading candidate for Q3.

## Sales

[Cliff](CLIFF_MENTION) closed two deals this quarter and has a strong pipeline heading into Q3. The
updated one-pager and demo script are in rotation. First customer case study drove a solid inbound
lead.

## Hiring

Senior backend engineer offer went out. Start date is early Q3.
        `
            .replace("ELLE_MENTION", mentionUrl(accounts.elleKappaTan))
            .replace("MASON_MENTION", mentionUrl(accounts.masonClay))
            .replace("MATT_MENTION", mentionUrl(accounts.mattRHorn))
            .replace("HOLLY_MENTION", mentionUrl(accounts.hollyEvergreen))
            .replace("CLIFF_MENTION", mentionUrl(accounts.cliffWeathers)),
    });

    await q2UpdateDoc.updateContentPreview();

    // ── Task Collections ─────────────────────────────────────────────

    const [fy26Q3Collection, mobileRedesignCollection, infrastructureCollection] =
        await runAllPromises([
            TestTaskCollection.create(accounts.cassCade, {name: "FY26Q3", access: "Public"}),
            TestTaskCollection.create(accounts.cassCade, {
                name: "Mobile App Redesign",
                access: "Public",
            }),
            TestTaskCollection.create(accounts.cassCade, {
                name: "Infrastructure",
                access: "Public",
            }),
        ]);

    await runAllPromises([
        fy26Q3Collection.updateColor(accounts.cassCade, "green"),
        mobileRedesignCollection.updateColor(accounts.cassCade, "orange"),
        infrastructureCollection.updateColor(accounts.cassCade, "blue"),
    ]);

    // ── Channels + Posts ───────────────────────────────────────────────

    const [leadsChannel, engineeringChannel, announcementsChannel] = await runAllPromises([
        TestChannel.create(accounts.cassCade, {name: "Leads", access: "Public"}),
        TestChannel.create(accounts.cassCade, {name: "Engineering", access: "Public"}),
        TestChannel.create(accounts.cassCade, {name: "Announcements", access: "Public"}),
    ]);

    // Rose\u2019s Q3 roadmap post in Leads, mentioning the Q2 Update doc with a
    // preview.
    const q2UpdateMentionUrl = `${spaceUrl}/documents/${q2UpdateDoc.id}?mention`;
    const q2UpdatePreviewUrl = `${spaceUrl}/documents/${q2UpdateDoc.id}?preview`;
    const fy26Q3MentionUrl = `${spaceUrl}/tasks/collections/${fy26Q3Collection.id}?mention`;
    const rosePost = await leadsChannel.createPost(
        accounts.roseCompas,
        markdown`
### Q3 Roadmap

Sharing the high-level plan for Q3. We\u2019re building on the momentum from Q2. Full context in the
[FY2026 Q2 Update](Q2_UPDATE_MENTION_URL).

[FY2026 Q2 Update](Q2_UPDATE_PREVIEW_URL)

**Three priorities this quarter:**

1. **Notification control.** Per-channel mute, inbox filters, quiet hours. This was the #2 request
   in the customer survey and we\u2019re feeling it internally too.

2. **Mobile app redesign.** [Mason](MASON_MENTION) is leading. Parity rebuild on a shared design
   system, refreshed foundations. No new features, just making mobile feel like the same product as
   desktop.

3. **Enterprise SSO.** [Elle](ELLE_MENTION)\u2019s scoping is done. Implementation starts this
   quarter. [Cliff](CLIFF_MENTION) has three prospects blocked on this.

Timeline is aggressive but realistic. Tracking everything in [FY26Q3](FY26Q3_MENTION_URL). I want
weekly check-ins in this channel.
        `
            .replace("Q2_UPDATE_MENTION_URL", q2UpdateMentionUrl)
            .replace("Q2_UPDATE_PREVIEW_URL", q2UpdatePreviewUrl)
            .replace("FY26Q3_MENTION_URL", fy26Q3MentionUrl)
            .replace("MASON_MENTION", mentionUrl(accounts.masonClay))
            .replace("ELLE_MENTION", mentionUrl(accounts.elleKappaTan))
            .replace("CLIFF_MENTION", mentionUrl(accounts.cliffWeathers)),
        {overrideCreatedTime: daysAgoAt(0, 9, 15)},
    );

    await rosePost.setReaction(accounts.cassCade, "Heart");
    await rosePost.setReaction(accounts.masonClay, "GenericLike");
    await rosePost.setReaction(accounts.cliffWeathers, "Celebrate");
    await rosePost.setReaction(accounts.hollyEvergreen, "GenericLike");

    // Elle's engineering post about realtime reliability completion.
    const ellePost = await engineeringChannel.createPost(
        accounts.elleKappaTan,
        markdown`
### Realtime reliability: shipped

Rollout is done. Jittered exponential backoff is live on all clients, health checks are wired into
the deploy pipeline, and alerting fires on reconnect spikes above baseline.

No sync incidents in the last three weeks. Closing the project out.
        `,
        {overrideCreatedTime: daysAgoAt(2, 14, 30)},
    );

    await ellePost.setReaction(accounts.cassCade, "Celebrate");
    await ellePost.setReaction(accounts.masonClay, "ThankYou");
    await ellePost.setReaction(accounts.mattRHorn, "Happy");

    // Holly's announcement about the customer case study.
    const hollyPost = await announcementsChannel.createPost(
        accounts.hollyEvergreen,
        markdown`
### First customer case study is live

Published the Meridian Labs case study this morning. It covers how their 40-person eng team
consolidated from five tools to Alpine over two months. [Cliff](CLIFF_MENTION) already got an
inbound lead from it.

Link is in the #Sales channel. Share freely.
        `.replace("CLIFF_MENTION", mentionUrl(accounts.cliffWeathers)),
        {overrideCreatedTime: daysAgoAt(3, 10, 45)},
    );

    await hollyPost.setReaction(accounts.cliffWeathers, "Celebrate");
    await hollyPost.setReaction(accounts.roseCompas, "Heart");

    // ── Tasks ─────────────────────────────────────────────────────────

    // Mobile App Redesign project — assigned to Mason, in FY26Q3.
    const mobileAppRedesign = await TestTask.create(accounts.cassCade, {
        title: "Mobile App Redesign",
        layout: "Project",
        assignee: accounts.masonClay,
        collections: [fy26Q3Collection, mobileRedesignCollection],
    });

    await mobileAppRedesign.updateAssigneeStatus(accounts.masonClay, "Active");

    // Other Q3 roadmap tasks in the FY26Q3 collection.
    const [notificationControl, enterpriseSso, searchPerformance] = await runAllPromises([
        TestTask.create(accounts.cassCade, {
            title: "Notification Control",
            layout: "Project",
            assignee: accounts.masonClay,
            collections: [fy26Q3Collection],
            priority: "High",
        }),
        TestTask.create(accounts.cassCade, {
            title: "Enterprise SSO",
            layout: "Project",
            assignee: accounts.elleKappaTan,
            collections: [fy26Q3Collection, infrastructureCollection],
            priority: "High",
        }),
        TestTask.create(accounts.cassCade, {
            title: "Search Performance Improvements",
            layout: "Project",
            assignee: accounts.elleKappaTan,
            collections: [fy26Q3Collection, infrastructureCollection],
            priority: "Medium",
        }),
    ]);

    // Subtasks for Mobile App Redesign.
    await runAllPromises([
        TestTask.create(accounts.cassCade, {
            parent: mobileAppRedesign,
            title: "Design system audit",
            assignee: accounts.mattRHorn,
            priority: "High",
        }).then(task => task.updateStatus(accounts.mattRHorn, "Closed")),
        TestTask.create(accounts.cassCade, {
            parent: mobileAppRedesign,
            title: "Color token migration",
            assignee: accounts.masonClay,
            priority: "High",
        }).then(task => task.updateAssigneeStatus(accounts.masonClay, "Active")),
        TestTask.create(accounts.cassCade, {
            parent: mobileAppRedesign,
            title: "Typography scale refresh",
            assignee: accounts.mattRHorn,
            priority: "Medium",
        }).then(task => task.updateStatus(accounts.mattRHorn, "Closed")),
        TestTask.create(accounts.cassCade, {
            parent: mobileAppRedesign,
            title: "Tab bar navigation rebuild",
            assignee: accounts.masonClay,
            priority: "Medium",
        }),
        TestTask.create(accounts.cassCade, {
            parent: mobileAppRedesign,
            title: "Sign-in and sign-up screens",
            assignee: accounts.masonClay,
            priority: "High",
        }),
        TestTask.create(accounts.cassCade, {
            parent: mobileAppRedesign,
            title: "Dark mode support",
            assignee: accounts.masonClay,
            priority: "Medium",
        }),
        TestTask.create(accounts.cassCade, {
            parent: mobileAppRedesign,
            title: "Biometric auth integration",
            assignee: accounts.elleKappaTan,
            priority: "Medium",
        }),
        TestTask.create(accounts.cassCade, {
            parent: mobileAppRedesign,
            title: "Push notification permissions",
            assignee: accounts.masonClay,
            priority: "Low",
        }),
    ]);

    // Subtasks for Notification Control.
    await runAllPromises([
        TestTask.create(accounts.cassCade, {
            parent: notificationControl,
            title: "Per-channel mute",
            assignee: accounts.masonClay,
            priority: "High",
        }),
        TestTask.create(accounts.cassCade, {
            parent: notificationControl,
            title: "Inbox filters",
            assignee: accounts.masonClay,
            priority: "High",
        }),
        TestTask.create(accounts.cassCade, {
            parent: notificationControl,
            title: "Quiet hours",
            assignee: accounts.elleKappaTan,
            priority: "Medium",
        }),
    ]);

    // Subtasks for Enterprise SSO.
    await runAllPromises([
        TestTask.create(accounts.cassCade, {
            parent: enterpriseSso,
            title: "SAML integration",
            assignee: accounts.elleKappaTan,
            priority: "High",
        }),
        TestTask.create(accounts.cassCade, {
            parent: enterpriseSso,
            title: "OIDC integration",
            assignee: accounts.elleKappaTan,
            priority: "High",
        }),
        TestTask.create(accounts.cassCade, {
            parent: enterpriseSso,
            title: "Admin UI for identity providers",
            assignee: accounts.masonClay,
            priority: "Medium",
        }),
        TestTask.create(accounts.cassCade, {
            parent: enterpriseSso,
            title: "Account migration path",
            assignee: accounts.elleKappaTan,
            priority: "Medium",
        }),
    ]);

    // Subtasks for Search Performance.
    await runAllPromises([
        TestTask.create(accounts.cassCade, {
            parent: searchPerformance,
            title: "Index sharding for large workspaces",
            assignee: accounts.elleKappaTan,
            priority: "High",
        }),
        TestTask.create(accounts.cassCade, {
            parent: searchPerformance,
            title: "Query result caching layer",
            assignee: accounts.elleKappaTan,
            priority: "Medium",
        }),
    ]);

    // ── Additional documents for feed + suggestions ────────────────────

    const [surveySummaryDoc, salesOnePagerDoc, ssoScopingDoc, reliabilitySpecDoc, casStudyDoc] =
        await runAllPromises([
            TestDocument.create(accounts.hollyEvergreen, {
                title: "Q3 Customer Survey Summary",
                access: "Public",
                body: markdown`
We sent the Q3 customer survey to 84 accounts at the end of August and heard back from 51 (61%
response rate, up from 48% last quarter).

## Top themes

1. **Table support in documents.** 34 of 51 respondents mentioned this unprompted. The most common
   phrasing was some version of \u201CI still copy data into a spreadsheet to make a table and paste
   a screenshot back.\u201D Good timing given what [Mason](MASON_MENTION) is building.

2. **Notification control.** 28 respondents. Per-channel mute, inbox filters, and quiet hours were
   the three most-requested features. Several people said they mute entire apps when Alpine gets
   noisy, which means they miss things that matter.

3. **Search speed on large workspaces.** 19 respondents. Mostly from teams with 50+ members. Queries
   take 2-4 seconds on workspaces with heavy document history. A few people mentioned giving up and
   scrolling the sidebar instead.

## Representative quotes

> \u201CI love Alpine for docs and chat but I dread opening my inbox. There\u2019s no way to tell it
> what\u2019s important.\u201D

> \u201CSearch is fine for small teams but we have 200 docs and it chokes.\u201D

> \u201CTables. Please. I\u2019m begging.\u201D

## What\u2019s working

Collaborative editing, task tracker, and chat reliability all scored above 4/5. Several respondents
called out the recent stability improvements, which lines up with [Elle](ELLE_MENTION)\u2019s
realtime work.
                `
                    .replace("MASON_MENTION", mentionUrl(accounts.masonClay))
                    .replace("ELLE_MENTION", mentionUrl(accounts.elleKappaTan)),
            }),
            TestDocument.create(accounts.hollyEvergreen, {
                title: "Sales One-Pager (Final)",
                access: "Public",
                body: markdown`
## What is Alpine?

Alpine is a productivity suite for technical teams. Documents, tasks, chat, forum, inbox, and search
in one product. Built for teams of 10-200 who are tired of juggling five disconnected tools.

## Why teams switch

- **One workspace, not five tabs.** Engineers write specs in the same tool where they track tasks
  and discuss tradeoffs. No context switching.
- **Real collaboration.** Live co-editing in documents, threaded chat, and a forum for decisions
  that shouldn\u2019t disappear in a chat stream.
- **Search that knows your work.** Alpine\u2019s search ranks results by what you\u2019ve been
  working on, not just keyword matches. The right document surfaces first.

## Who it\u2019s for

Product and engineering teams at growing companies. Teams that have outgrown basic tools but
don\u2019t want the overhead of enterprise suites.

## What customers say

> \u201CWe consolidated from five tools to one and onboarded in a week.\u201D \u2014 Meridian Labs

> \u201CThe search alone saves me 20 minutes a day.\u201D \u2014 DataCo engineering lead

## Pricing

Free for teams up to 5. Pro plan at $12/seat/month. Enterprise pricing available.
                `,
            }),
            TestDocument.create(accounts.elleKappaTan, {
                title: "Enterprise SSO Technical Scope",
                access: "Public",
                body: markdown`
## Overview

Adding SAML 2.0 and OIDC support so enterprise customers can enforce SSO through their existing
identity provider. Three prospects are currently blocked on this.

## Auth flow

1. User visits Alpine login page and enters their email.
2. Alpine looks up the account\u2019s organization and checks for an SSO configuration.
3. If SSO is configured, redirect to the identity provider\u2019s login page.
4. IdP authenticates the user and posts a SAML assertion or OIDC token back to our callback URL.
5. Alpine validates the response, creates or updates the session, and redirects to the workspace.

## Identity provider integrations

**SAML 2.0:** Okta, Azure AD, OneLogin, Google Workspace. Standard SP-initiated flow. We\u2019ll
need to support IdP-initiated as well for Azure AD customers who launch from the app portal.

**OIDC:** Generic OIDC support covers most other providers. Authorization code flow with PKCE.

## Admin UI

New settings page under workspace admin: configure IdP metadata URL or upload XML, toggle
enforcement (allow password fallback vs. require SSO), manage domain verification.

## Migration path

Existing password-based accounts need a smooth transition. Plan: admin enables SSO, existing users
link their IdP identity on next login, grace period of 30 days before password fallback is disabled.

## Open questions

- Do we support multiple IdPs per workspace? Probably not in v1.
- SCIM provisioning is out of scope for this phase but we should design the user model to support
  it.
- Session duration policy: should admins control max session length?

## Estimate

8-10 weeks of implementation after scoping is finalized. Targeting Q3.
                `,
            }),
            TestDocument.create(accounts.elleKappaTan, {
                title: "Realtime Reliability Technical Spec",
                access: "Public",
                body: markdown`
## Background

On August 30 a routine deployment caused a 12-minute sync outage for roughly 15% of connected
clients. The postmortem identified two root causes: no health check gating on new instances, and a
thundering herd on reconnect after recovery.

## Goals

1. Zero sync outages from routine deployments.
2. Graceful degradation under partial failure.
3. Observability: know within 60 seconds when reconnect rates spike.

## Reconnection logic

Current behavior: clients reconnect immediately on disconnect with a fixed 1-second retry. This
creates a thundering herd when a server restarts.

New behavior: jittered exponential backoff. Base delay 500ms, max 30 seconds, jitter factor 0.5.
Clients also listen for a server-sent \u201Cready\u201D signal before resuming sync, so they
don\u2019t hammer an instance that\u2019s still warming up.

## Deployment health checks

New instances must pass a readiness check before receiving traffic. The check verifies:

- WebSocket listener is accepting connections
- Database connection pool is initialized
- Cache is warm (at minimum, hot partition keys are loaded)

ECS task definition updated to use the new health check endpoint. Rolling deployments wait for the
new instance to be healthy before draining the old one.

## Alerting

CloudWatch alarm on reconnect rate: if the 1-minute reconnect count exceeds 3x the trailing 5-minute
average, page the on-call. Dashboard in Grafana showing connection count, reconnect rate, and
message delivery latency.

## Rollout

Incremental. Backoff logic ships first (client-side, no deployment risk). Health checks and
deployment gating second. Alerting third.

## Results

Three weeks post-rollout: zero sync incidents. Reconnect spikes during deploys dropped from 8,000+
to under 200. p99 message delivery latency unchanged.
                `,
            }),
            TestDocument.create(accounts.hollyEvergreen, {
                title: "Case Study: Meridian Labs",
                access: "Public",
                body: markdown`
## How Meridian Labs consolidated five tools into Alpine in two months

**Company:** Meridian Labs, 40-person engineering team building climate monitoring infrastructure.

**Challenge:** The team was spread across Slack, Notion, Linear, Google Docs, and email. Context
lived in five places. Engineers spent more time searching for information than writing code.

> \u201CEvery morning I\u2019d open five tabs just to figure out what happened overnight. By the
> time I had context, I\u2019d lost 30 minutes.\u201D \u2014 Jamie Torres, Engineering Manager

## Why Alpine

Meridian evaluated three options. They chose Alpine because it was the only product where documents,
tasks, and communication lived in the same workspace with shared search.

## Migration

Meridian migrated in two phases over eight weeks:

**Phase 1 (weeks 1-4):** Documents and tasks. They imported 400+ Notion pages and 200 Linear issues.
The Alpine import tool handled the bulk of it. A few complex Notion databases needed manual cleanup.

**Phase 2 (weeks 5-8):** Chat and forum. They ran Slack and Alpine chat in parallel for two weeks,
then cut over. The forum replaced their \u201Cdecisions\u201D Slack channel, which had become
unsearchable.

## Results

- **Tool count:** 5 to 1.
- **Onboarding time for new engineers:** 3 days to 1 day.
- **Time to find a past decision:** \u201CMinutes instead of never.\u201D (Jamie Torres)

> \u201CThe biggest win wasn\u2019t any single feature. It\u2019s that everything is in one place
> and search actually works. I type a keyword and the right document is the first result.\u201D
> \u2014 Jamie Torres

## What they\u2019d do differently

Start with the forum earlier. The async decision-making channel became the team\u2019s most-used
feature, and they wish they\u2019d had it from week one.
                `,
            }),
        ]);

    await runAllPromises([
        surveySummaryDoc.updateContentPreview(),
        salesOnePagerDoc.updateContentPreview(),
        ssoScopingDoc.updateContentPreview(),
        reliabilitySpecDoc.updateContentPreview(),
        casStudyDoc.updateContentPreview(),
    ]);

    // ── Chats for suggestions ────────────────────���─────────────────────

    const cassRoseChat = await TestChat.get(accounts.cassCade, accounts.roseCompas);
    await cassRoseChat.sendMessage(accounts.cassCade, "quick sync on Q3 priorities later?");

    const cassElleChat = await TestChat.get(accounts.cassCade, accounts.elleKappaTan);
    await cassElleChat.sendMessage(accounts.cassCade, "how\u2019s the SSO scoping going?");

    // ── Suggested list (~30 entries) ───────────────────────────────────

    const randomDocTitles = [
        "Company Values",
        "All Hands \u2014 September 2025",
        "Team Offsite Planning",
        "Benefits Overview",
        "Hiring Rubric: Product Designer",
        "Vendor Contracts Index",
        "Press Kit Draft",
        "Brand Voice Guide",
        "Weekly Metrics Digest",
        "Customer References List",
        "1:1 Template",
        "Board Deck Outline \u2014 Q2 2026",
        "Go-to-Market Playbook",
        "Competitive Landscape Notes",
        "PTO Policy",
    ];

    await runAllPromises([
        // 1 — Q2 Update doc (the one Rose's post mentions).
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Document:${q2UpdateDoc.id}`,
            points: 999_000_000,
        }),
        // 2 — Rose's account.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Account:${accounts.roseCompas.account.id}`,
            points: 998_000_000,
        }),
        // 3 — FY26Q3 collection.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `TaskCollection:${fy26Q3Collection.id}`,
            points: 997_000_000,
        }),
        // 4 — Matt's account.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Account:${accounts.mattRHorn.account.id}`,
            points: 996_000_000,
        }),
        // 5 — Leads channel.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Channel:${leadsChannel.id}`,
            points: 995_000_000,
        }),
        // 6 — Survey summary doc.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Document:${surveySummaryDoc.id}`,
            points: 994_000_000,
        }),
        // 7 — Elle's account.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Account:${accounts.elleKappaTan.account.id}`,
            points: 993_000_000,
        }),
        // 8 — Mobile App Redesign project.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Task:${mobileAppRedesign.id}`,
            points: 992_000_000,
        }),
        // 9 — Cass <> Rose chat.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Chat:${cassRoseChat.id}`,
            points: 991_000_000,
        }),
        // 10 — Engineering channel.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Channel:${engineeringChannel.id}`,
            points: 990_000_000,
        }),
        // 11 — SSO scoping doc.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Document:${ssoScopingDoc.id}`,
            points: 989_000_000,
        }),
        // 12 — Mobile App Redesign collection.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `TaskCollection:${mobileRedesignCollection.id}`,
            points: 988_000_000,
        }),
        // 13 — Reliability spec.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Document:${reliabilitySpecDoc.id}`,
            points: 987_000_000,
        }),
        // 14 — Cass <> Elle chat.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Chat:${cassElleChat.id}`,
            points: 986_000_000,
        }),
        // 15 — Announcements channel.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Channel:${announcementsChannel.id}`,
            points: 985_000_000,
        }),
        // 16 — Sales one-pager.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Document:${salesOnePagerDoc.id}`,
            points: 984_000_000,
        }),
        // 17 — Personal tasks.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: "TaskPersonal",
            points: 983_000_000,
        }),
        // 18 — Infrastructure collection.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `TaskCollection:${infrastructureCollection.id}`,
            points: 982_000_000,
        }),
        // 19 — Case study doc.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Document:${casStudyDoc.id}`,
            points: 981_000_000,
        }),
        // 20 — Notification Control project.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Task:${notificationControl.id}`,
            points: 980_000_000,
        }),
        // 21 — Enterprise SSO project.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Task:${enterpriseSso.id}`,
            points: 979_000_000,
        }),
        // 22 — Mason's account.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Account:${accounts.masonClay.account.id}`,
            points: 978_000_000,
        }),
        // 23 — Cliff's account.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Account:${accounts.cliffWeathers.account.id}`,
            points: 977_000_000,
        }),
        // 24 — Holly's account.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Account:${accounts.hollyEvergreen.account.id}`,
            points: 976_000_000,
        }),
        // 25 — Search Performance project.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Task:${searchPerformance.id}`,
            points: 975_000_000,
        }),
        // 26–40 — Random docs filling out the tail.
        ...randomDocTitles.map((title, index) =>
            TestDocument.create(accounts.cassCade, {title}).then(doc =>
                addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
                    spaceId,
                    accountId,
                    entityId: `Document:${doc.id}`,
                    points: 974_000_000 - index * 1_000_000,
                }),
            ),
        ),
    ]);

    // ── Feed entries ───────────────────────────────────────────────────

    const entries: Array<FeedEntry> = [
        {
            type: "Document",
            documentId: surveySummaryDoc.id,
            sharedTime: daysAgoAt(0, 11, 20),
            sharerId: accounts.hollyEvergreen.account.id,
            creator: {id: accounts.hollyEvergreen.account.id, from: null},
            event: "SharedWithAccessPolicyDefaultGrant",
        },
        {
            type: "Post",
            postId: ellePost.id,
            channelId: engineeringChannel.id,
            authorId: accounts.elleKappaTan.account.id,
            createdTime: ellePost.createdTime,
        },
        {
            type: "Post",
            postId: rosePost.id,
            channelId: leadsChannel.id,
            authorId: accounts.roseCompas.account.id,
            createdTime: rosePost.createdTime,
        },
        {
            type: "TaskCollection",
            collectionId: fy26Q3Collection.id,
            sharedTime: daysAgoAt(2, 9, 0),
            sharerId: accounts.cassCade.account.id,
            creatorId: accounts.cassCade.account.id,
            event: "SharedWithAccessPolicyDefaultGrant",
        },
        {
            type: "Post",
            postId: hollyPost.id,
            channelId: announcementsChannel.id,
            authorId: accounts.hollyEvergreen.account.id,
            createdTime: hollyPost.createdTime,
        },
        {
            type: "Document",
            documentId: q2UpdateDoc.id,
            sharedTime: daysAgoAt(4, 14, 0),
            sharerId: accounts.cassCade.account.id,
            creator: {id: accounts.cassCade.account.id, from: null},
            event: "SharedWithAccessPolicyDefaultGrant",
        },
    ];

    const url = new UrlPath(`/s/${spaceId}/dev/feed`);
    url.searchParams.set(
        "entries",
        JSON.stringify(Schema.array(FeedEntrySchema).serialize(entries)),
    );

    await recorder.record({
        instructions: markdown`
1. The feed loads with Holly\u2019s Q3 Customer Survey Summary at the top. Scroll down slowly
   through the feed entries to show the variety: Elle\u2019s engineering post, Rose\u2019s Q3
   Roadmap post with the FY26Q3 collection mention and Q2 Update doc preview, the FY26Q3 task
   collection, Holly\u2019s case study announcement, and the Q2 Update doc.

2. Look at the suggested list on the right side of the feed. Scroll through it to show the full list
   of documents, people, channels, tasks, and collections.
        `,
        session: accounts.cassCade,
        path: url.toString(),
        viewport: scalableDemoDefaultViewport,
    });
});
