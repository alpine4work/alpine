# \[2023-06-29\] App Service on AWS

## Context

We previously [decided to use Cloudflare Workers](../../2022/11/2022_11_01_cloudflare_workers.md) to
deploy our application code. However, at this point we are blocked from deploying new application
code to Cloudflare Workers.

Every time we go to deploy, we hit the
[200ms Cloudflare Worker script startup time limit](https://developers.cloudflare.com/workers/platform/limits/).
So we make some optimizations to startup time. Two examples: 1) lazy loading email related code, 2)
not checking DynamoDB schema backwards compatibility. We make these optimizations to get past the
deploy but by the time we need to deploy again we’ve added some new schemas that add to startup time
and we’re past the limit again. At this point, there are no more easy wins. Even if there were we’d
constantly be battling the startup time limit. We’re effectively _blocked_ from deploying to
Cloudflare Workers. We’ve asked for Cloudflare to raise our startup time limit but haven’t heard
back.

So we need to change up our architecture to account for script startup time.

Secondarily, we have many DynamoDB request waterfalls in our application code. This is ok on the
server when you’re running close to DynamoDB (so latency is negligible). However, Cloudflare Workers
runs on the edge near the user. So a user in London has to pay the London to AWS `us-east-1` latency
penalty every request waterfall hop. This makes performance for global users pretty bad. Cloudflare
Workers now has a
[smart placement](https://developers.cloudflare.com/workers/platform/smart-placement/) option which
will automatically put your worker near DynamoDB which would fix this issue.

## Decision

We’re moving our application code into AWS. We will keep realtime code in
[Cloudflare Durable Objects](https://developers.cloudflare.com/workers/learning/using-durable-objects/)
since it still makes sense for realtime services to run on the edge. Our Durable Objects will no
longer directly communicate with DynamoDB but instead will make RPC calls to our application code.

The new service names are as follows:

- **App Service:** Our Remix application. Runs on Node.js in AWS. Has React server rendered routes
  and API routes. All communication with DynamoDB goes through this service.
- **Edge Service:** A Cloudflare Worker for code that benefits from running on the edge. Caches
  immutable static assets served by the app service, forwards HTTP requests to Durable Objects, and
  in the future will authenticate attachments.
- **Edge Service Family:** Our Durable Object services Document Collaboration Service, Chat Realtime
  Service, Post Realtime Service, and My Account Service are logically separate services but are
  deployed with Edge Service so we call this the “Edge Service Family”. In the future we may deploy
  our Durable Objects separately. Particularly if we run into the worker startup time limit again.

While the primary reason we are doing this is to unblock deployments it also has a secondary
performance benefit. In distributed systems you generally want to do data processing as close to the
data as possible to avoid costly network transfers. Now all data processing and HTML generation is
done in one AWS region and users only pay the network roundtrip cost from their location to our
servers once.

## Consequences

Our service map used to be simple. Everything lived in Cloudflare, was configured in a
`wrangler.toml` file, and could be deployed with one command. Now we have to configure...

- AWS EC2
- AWS ECS (and auto scaling)
- AWS Elastic Load Balancer
- AWS Certificate Manager
- AWS IAM
- AWS Secrets Manager
- AWS Logs
- Docker images

All through AWS CloudFormation and their CDK.

There’s a lot of expertise needed to set this up properly considering performance, security, and
price. I (Caleb) did my best with the assistance of a friend who knows considerably more about AWS
than me (Marcello Gozza). Now we have to maintain this going forward.

The choice to use the CDK helps a lot. Our AWS configuration is plain, declarative, code that you
can read/write if you know TypeScript. In the long term, having tight control over our
infrastructure and the ability to easily integrate with any AWS service will likely be beneficial
for our developers. Even this year I (Caleb) imagine needing another service or two for search
indexing and attachment processing.

## Alternatives considered

- Find a way to code split our app service on Cloudflare so that each individual split has fast
  startup time. Finding these splits would probably need to be automated so that we don’t have to
  fight start time limits every deploy. One way to do this could be code splitting by route but
  that’s not currently something Remix supports (Next.js does support this though). Even if we did
  code split by route some routes still need most of the code in our app (like `/s/$spaceId/inbox`
  which can render a notification from anything).

- Another option would be to deploy to a container deployment platform that does more out of the box
  like [Fly.io](https://fly.io/) instead of AWS. However, we’re already in the AWS ecosystem with
  our use of DynamoDB. Introducing another platform would make developer life harder. We’re doubling
  down on our platform commitment to AWS and Cloudflare with this decision.

- Given we were previously deploying to Cloudflare Workers (a serverless platform), AWS Lambda may
  seem like a natural choice. My (Caleb’s) impression is that AWS Lambda is a terrible choice for a
  web server. Cold starts add significant latency to requests that can’t use an existing instance
  and lambdas have a concurrency limit that’s pretty low (1000) given each instance can only handle
  one request at a time. The concurrency limitations are really unfortunate when our runtime
  (Node.js) is designed to be highly concurrent. Marcello enthusiastically agreed with this
  assessment.

- A couple smaller decisions made during this migration:
    - AWS ECS instead of AWS EKS: We’re already locked into AWS with our use of DynamoDB, might as
      well leverage the best the platform has to offer. This
      [blog post makes a good argument for ECS](https://www.cloudzero.com/blog/ecs-vs-eks).
    - AWS EC2 instead of AWS Fargate: Fargate sounds nice in theory. It takes some operational
      burden off our plate. This
      [blog post recommends it](https://containersonaws.com/blog/2023/ec2-or-aws-fargate/) for a
      startup that hasn’t yet achieved product market fit (which is us!). However, when doing
      pricing calculations Fargate is significantly more expensive than EC2 for our current light
      workload. Though I (Caleb) may have been measuring their “active duration” metric wrong. EC2
      wasn’t too much more difficult to setup with the CDK and from Marcello’s experience Fargate
      was best for running occasional batch jobs not a web server that needs to be alive 24/7.
