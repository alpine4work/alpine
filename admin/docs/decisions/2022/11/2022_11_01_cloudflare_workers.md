# \[2022-11-01\] Cloudflare Workers

## Context

There are two related problems we're solving with this decision:

1. Where are we going to host our web server code?
2. How are we going to deliver realtime events to users?

Let's start with the first one. Early on I decided to use a React framework with server-side
rendering. Ultimately I settled on Remix (see the decision log entry on Remix) but was also
considering Next.js.

For our web server host we ideally want:

- A managed platform that removes ops concerns from our team for as long as possible.
- On demand pricing so costs start low and automatically scale with usage. Horizontally scaling with
  a couple clicks also acceptable.
- A platform with a global [edge network](https://en.wikipedia.org/wiki/Edge_computing) to achieve
  lowest possible latencies for users interacting with our services.

Again, these aren't requirements. [AWS EC2](https://aws.amazon.com/pm/ec2) could serve us well
without meeting these points.

For delivering realtime events to users here are some considerations I have:

- What is the end-to-end latency for events?
- Does the realtime broker have ordering guarantees to simplify code?
- Does the realtime broker have the ability to replay recent events? If the server-side load fetches
  data at time `t` and the WebSocket connection happens at time `t + 100ms` what happens if a
  realtime event occurs at `t + 20ms`? The realtime broker needs to be able to replay events in a
  short window of time.
- Can we make sure clients are only ever capable of receiving events for data they are authorized to
  see?
- Can realtime events include data with potential permissions filters per-user? Or would we need to
  broadcast an invalidation message to all users that triggers read requests on the client?

## Alternatives considered

For web server hosting I was initially leaning towards using [Vercel](https://vercel.com/). I have
some friends who work there and I'm generally impressed by the level of open source technical talent
they have scooped up.

For realtime I was looking at [Pusher](https://pusher.com/) and [Ably](https://ably.com/), leaning
towards Ably. Both of these products are pure message brokers where the client directly connects to
the message broker. The server publishes events to all clients, there is no server in the middle to
transform the realtime request for the client (e.g. apply permission rules).

I originally implemented document collaboration with Ably but I was talking about my document
collaboration implementation with Alex Dytrych and she introduced me to
[Cloudflare Durable Objects](https://developers.cloudflare.com/workers/learning/using-durable-objects/).
She even rewrote the realtime implementation powering document collaboration to use Cloudflare
Durable Objects.

The code for Durable Objects was much simpler (there were ordering guarantees we got with Durable
Objects we couldn't get with my previous Ably-based implementation) and was much faster! Leveraging
Cloudflare's edge network meant we got ridiculously low WebSocket latency.

As I considered permanently switching the document realtime implementation to Durable Objects I was
learning more about the [Cloudflare Workers](https://workers.cloudflare.com/) platform and realized
it would also be viable to host the web server there too, simplifying deploys.

## Decision

I decided to go with [Cloudflare Workers](https://workers.cloudflare.com/) as a web server host and
[Cloudflare Durable Objects](https://developers.cloudflare.com/workers/learning/using-durable-objects/)
(a feature of the workers platform) for realtime.

Cloudflare Workers provides best in class performance with their edge network which was built out to
support one of the world's most widely deployed CDNs. Cloudflare Workers solved not one, but two of
my technical requirements (both web server host and realtime message delivery) allowing my code and
architecture to stay simple.

[Vercel](https://vercel.com/) seems more focused on bundling generic one size fits all workflow
tools like branch previews, comment reviews, and analytics. Not solving the actual technical
requirements I have (realtime, CRON, event queues, caching) or delivering best-in-class performance
(edge network, CDN). Cloudflare delivers on performance and primitives then gets out of the way.

## Consequences

I've discovered this more recently but while latency from device to server is incredibly fast
wherever you are on the globe, latency from Cloudflare to DynamoDB in the AWS `us-east-1` region can
be slow depending on your geography. If you compare distributed traces in
[Honeycomb](https://www.honeycomb.io/) (our observability vendor) between me (Caleb Meredith) in New
York City and Alex Dytrych in London, Alex's requests to DynamoDB consistently have longer
latencies.

Given we end up talking with DynamoDB a lot over the course of a request, these latencies can really
add up. We may need to change our architecture where instead of Cloudflare Workers talking directly
to DynamoDB it's talking to an API that lives in `us-east-1` so you only pay the latency cost once
and processing is done near the data.

Or we store data close to users. So at a workspace level we decide the AWS data center all the
workspace's data will live in. Data domiciling is also good practice for compliance when we look to
international expansion. That doesn't help Alex if she's collaborating with a workspace based in the
US though so the answer might be a combination of both approaches.

We can also be using more of Cloudflare's
[edge network caching](https://developers.cloudflare.com/workers/runtime-apis/cache/) to cache
commonly accessed data like session and account information we have to fetch on every request for
authorization.
