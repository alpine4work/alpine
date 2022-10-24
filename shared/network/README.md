# Network

Our network directory contains abstractions for communicating between the client and server.
Abstractions include:

-   **Network functions:** A function we can call on the client that executes on the server using a
    [remote procedure call](https://en.wikipedia.org/wiki/Remote_procedure_call). Used to implement
    (among other things) data reads and data mutations.
-   **Network channels:** A channel in which messages are published using the
    [publish-subscribe pattern](https://en.wikipedia.org/wiki/Publish%E2%80%93subscribe_pattern).
    Used to implement realtime capabilities.

All our abstractions share a similar pattern.

1.  We define the network interface in `~/shared/network` with functions like
    `defineNetworkFunction()`.
2.  Then we implement the network interface on the server in `~/server/network` with functions like
    `implementNetworkFunction()`.

We use the schemas in `~/shared/schema` as our interface definition language. Schemas are TypeScript
native data definition formats with support for in-place data format migrations.
