import {createDemoSpace} from "~/admin/environment/demo_space/create_demo_space.js";
import {runScalableDemoRecorder} from "~/admin/marketing/2026_04_scalable_demos/helpers/run_scalable_demo_recorder.js";
import {scalableDemoWideViewportWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_wide_viewport.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {markdown} from "~/shared/helpers/string/markdown.js";

runScalableDemoRecorder(async (context, services, recorder) => {
    const {space, accounts} = await createDemoSpace(context, services.getAppServiceTokenAgent());

    // Elle owns the realtime reliability work. This is her technical design doc for
    // the reconnection and health check changes she\u2019s shipping in week 3 of the
    // UNIVERSE.md timeline. Matt and Mason leave comments during their design review.
    const doc = await TestDocument.create(accounts.elleKappaTan, {
        title: "Realtime Reliability: Reconnection Design",
        access: "Public",
        body: markdown`
## Overview

Alpine\u2019s realtime layer powers live co-editing, chat delivery, presence, and task live-updates.
A deployment last week triggered a thundering herd: all disconnected clients reconnected
simultaneously, overwhelming the new instance before it finished warming up. This document covers
the changes we\u2019re making to prevent recurrence.

## Root cause

Our reconnection logic uses a fixed 2-second retry interval. When a server restarts, every client
disconnects and retries at the same time. The new instance receives a burst of connections before
it\u2019s fully initialized \u2014 enough to trigger cascading timeouts.

## Proposed changes

### Jittered exponential backoff

Replace the fixed interval with jittered exponential backoff: base 500ms, max 30s, \u00b130% jitter.
This spreads reconnection attempts across a window instead of spiking all at once.

### Deployment health checks

Add a readiness probe to the realtime server that returns unhealthy until the connection pool is
warmed up. The load balancer will not route traffic until the probe passes. Warm-up target: 80% of
the previous instance\u2019s connection count or 30 seconds, whichever comes first.

### Alerting

Add two alerts: connection drop rate \u2265 5% over 60s and reconnection success rate \u2264 95%
over 5 min.

## Rollout

1. Deploy client backoff change. No server changes, zero risk.
2. Deploy readiness probe behind a flag; soak in staging for one week.
3. Enable probe in production with a 20% canary, then full rollout.
4. Enable alerts.

## Open questions

1. Jitter strategy: additive vs multiplicative? Additive is simpler; multiplicative spreads better
   at high delays.
2. Warm-up threshold: 80% of previous connection count, or time-based (30s)?
3. Dead-letter handling: hold messages during a reconnection window or drop and re-fetch?
        `,
    });
    await doc.updateContentPreview();

    // Thread 1 \u2014 Mason on \u201Call disconnected clients\u201D in Overview
    await doc.createCommentThread(
        accounts.masonClay,
        {from: 227, to: 253},
        markdown`
the simultaneous retry is the whole problem \u2014 the fix is less about reconnect count and more
about timing spread
        `,
    );

    // Thread 2 \u2014 Matt on \u201Cthundering herd\u201D in Overview
    await doc.createCommentThread(
        accounts.mattRHorn,
        {from: 316, to: 348},
        "Worth linking the postmortem here \u2014 the exact blast radius numbers will help readers calibrate whether these changes are proportionate.",
    );

    // Thread 3 \u2014 Elle on \u201Cfixed 2-second retry interval\u201D in Root cause
    await doc.createCommentThread(
        accounts.elleKappaTan,
        {from: 398, to: 457},
        markdown`
caught this in the postmortem but didnt document it as the root cause explicitly. adding a note
there
        `,
    );

    // Thread 4 \u2014 Matt on \u201Cjittered exponential backoff\u201D in Proposed
    // changes
    await doc.createCommentThread(
        accounts.mattRHorn,
        {from: 768, to: 800},
        markdown`
The jitter range matters here. \u00b130% at 30s max gives \u00b19s of spread. I\u2019d use a uniform
random in [0, delay] for better distribution at the high end.
        `,
    );

    // Thread 5 \u2014 Mason on \u201Cconnection pool is warmed up\u201D in health
    // checks
    await doc.createCommentThread(
        accounts.masonClay,
        {from: 1009, to: 1018},
        markdown`
how are we defining \u2018warmed up\u2019 \u2014 just connection count or are we also waiting on
cache hydration?
        `,
    );

    // Thread 6 \u2014 Matt on \u201Cconnection drop rate\u201D in Alerting
    await doc.createCommentThread(
        accounts.mattRHorn,
        {from: 1214, to: 1239},
        markdown`
5% is a high bar to page on. I\u2019d start at 2% and reserve the page for consecutive failures or a
longer window.
        `,
    );

    // Thread 7 \u2014 Elle on \u201Creconnection success rate\u201D in Alerting
    await doc.createCommentThread(
        accounts.elleKappaTan,
        {from: 1274, to: 1284},
        markdown`
95% is the right baseline. adding a rolling 1hr p99 chart to grafana alongside this
        `,
    );

    // Thread 8 \u2014 All three on \u201CJitter strategy: additive vs
    // multiplicative?\u201D in Open questions \u2014 this is the thread Cass clicks
    // open
    const jitterThread = await doc.createCommentThread(
        accounts.mattRHorn,
        {from: 1544, to: 1559},
        markdown`
Multiplicative wins at high delays \u2014 \u00b130% of 30s is \u00b19s versus \u00b13s for additive.
The spread matters most when the server is slow to recover, which is exactly when you want maximum
distribution.
        `,
    );
    await jitterThread.createComment(
        accounts.masonClay,
        markdown`
multiplicative makes the math harder when debugging a reconnect storm at 2am. additive is fine for
v1, revisit if we still see clustering
        `,
    );
    await jitterThread.createComment(
        accounts.elleKappaTan,
        "multiplicative. additive jitter at high delays is basically no jitter",
    );

    await recorder.record({
        instructions: markdown`
# Demo: document comment highlights

Alpine keeps documents readable even when they have lots of comments. Rather than showing full
comment threads inline, it highlights commented text and shows just the commenter avatars and count
\u2014 so you can read without wading through every thread.

Elle\u2019s realtime reliability design doc has 8 comment threads from Matt, Mason, and Elle spread
across it.

1. Start recording. The document is open at the top. Scroll slowly and steadily from the top,
   pausing briefly at each highlighted section so the viewer can see the highlight chips (avatar
   icons + count) on each commented passage.

2. Continue scrolling down to \u201CRollout\u201D. Find item 2: \u201CDeploy readiness
   probe...\u201D and select the text \u201Cone week\u201D to open the context menu.

3. Click the \u201CComment\u201D button to add a comment and type \u201CLet\u2019s make it two
   weeks\u201D then press Enter to send.

4. Pause so the viewer can see the new comment.
        `,
        session: accounts.cassCade,
        path: `/s/${space.id}/documents/${doc.id}`,
        viewport: {width: scalableDemoWideViewportWidth},
        prepare: async page => {
            await page.evaluate("dev.spaceSideBar.toggleVisibility()");
        },
    });
});
