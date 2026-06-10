// NOTE(calebmer, 2025-02-20): This file holds the Cloudflare Worker that runs on
// https://cyberworlds.dev. Before we named the company Alpine we named the
// codebase Cyberworlds. And hosted the product on https://cyberworlds.dev. Now
// that we've named the company Alpine, bought the domain https://alpine.inc, and
// are starting to get customers we moved the app to our company's real domain
// https://alpine.inc. To make sure any links from before 2025-02-20 don't break we
// run a Cloudflare Worker that redirects all valid routes from before 2025-02-20
// to https://alpine.inc.
//
// I imagine the engineering team will have a use for https://cyberworlds.dev in
// the future. For example, to host internal developer UIs. If that happens you can
// add support to this worker. Ideally as long as it doesn't conflict with the URLs
// we need to redirect. Though it's very unlikely there are many of these URLs
// floating around in the wild.

// All `SpaceId`s from before 2025-02-20. There may be https://cyberworlds.dev
// links to these spaces out in the wild that we need to redirect to
// https://alpine.inc.
const redirectSpaceIds = new Set([
    "asgbnw5d448vsc018aq9bpgd3w",
    "5tq6evkghw3zy43nw0w4f1a3hg",
    "dwrczsbpvw1gm426h0enafs2p8",
    "81qk10571246w1r82gqae7y5z0",
    "nz82s5pkb5yf33s4vd0z7xr9q8",
    "9qm9qwebpa0a2xq5gsgkwr1h70",
    "3j9jv84vzxgwky5dnb2ejfccag",
    "c2pwxmpv3z7b3db19tsn6y1qfg",
    "3gfcq9yacgwevr1m4d0ztdye64",
    "rdj46qft91adssrtz2225ejqx0",
    "2hjstznx0w4w4wc705ntxxnk1w",
    "3jsebabqc06vh3dg527vebjm98",
    "d8gvqq540kwpt0z8y0j99373dg",
    "1w6p1xb5fbjmk3enb8w021gjgg",
    "jqed33ps4ksr8srv0pekqee97r",
    "p0zzntkm4529c42rc2hx7ah86r",
    "7rzyfb06y2pdptxset37bbyz4c",
    "myzzcagscj7qqzyh3ymfwrh6w8",
    "z6j3jxcdvk60d9035txg4aw9t8",
    "111hc413nfdxa6vwspnhm3ejsc",
    "7ca305fw7kakpzjyj3z5dvvrxc",
]);

// All non-space routes from before 2025-02-20. There may be
// https://cyberworlds.dev links to these routes out in the wild that we need to
// redirect to https://alpine.inc.
const redirectPathnames = new Set([
    "/",
    "/api/internal/alpha-email-addresses",
    "/api/internal/deploy",
    "/api/task-realtime-service-routes",
    "/api/tracer",
    "/internal/alpha",
    "/internal/blobs",
    "/internal/design",
    "/internal/virtualized",
    "/sign-out",
    "/switch-space",
]);

// eslint-disable-next-line import/no-default-export
export default {
    fetch: (request: Request) => {
        const url = new URL(request.url);

        if (redirectPathnames.has(url.pathname)) {
            return Response.redirect(`https://alpine.inc${url.pathname}${url.search}`, 301);
        }

        const pathnameParts = url.pathname.slice(1).split("/");

        if (
            pathnameParts.length >= 2 &&
            pathnameParts[0] === "s" &&
            redirectSpaceIds.has(pathnameParts[1]!)
        ) {
            return Response.redirect(`https://alpine.inc${url.pathname}${url.search}`, 301);
        }

        if (pathnameParts.length >= 1 && pathnameParts[0] === "sign-in") {
            return Response.redirect(`https://alpine.inc${url.pathname}${url.search}`, 301);
        }

        if (pathnameParts.length >= 2 && pathnameParts[0] === "api" && pathnameParts[1] === "rpc") {
            return Response.redirect(`https://alpine.inc${url.pathname}${url.search}`, 301);
        }

        if (
            pathnameParts.length >= 2 &&
            pathnameParts[0] === "internal" &&
            pathnameParts[1] === "emails"
        ) {
            return Response.redirect(`https://alpine.inc${url.pathname}${url.search}`, 301);
        }

        return new Response("Not Found", {
            status: 404,
            headers: {"content-type": "text/plain"},
        });
    },
};
