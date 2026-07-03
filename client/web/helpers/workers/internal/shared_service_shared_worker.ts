const mapClientIdToPort = new Map<string, MessagePort>();

globalThis.addEventListener("connect", (event: Event) => {
    const workerPort = (event as MessageEvent).ports[0]!;
    workerPort.addEventListener(
        "message",
        (connectEvent: MessageEvent<{clientId: string}>) => {
            const {clientId} = connectEvent.data;
            mapClientIdToPort.set(clientId, workerPort);

            // Remove the entry when the client goes away, which we detect when the lock on its
            // name becomes available.
            navigator.locks.request(clientId, {mode: "shared"}, () => {
                mapClientIdToPort.get(clientId)?.close();
                mapClientIdToPort.delete(clientId);
            });

            // Subsequent messages will be forwarded.
            workerPort.addEventListener(
                "message",
                (forwardEvent: MessageEvent<{clientId: string}>) => {
                    const port = mapClientIdToPort.get(forwardEvent.data.clientId);
                    port?.postMessage(
                        forwardEvent.data,
                        forwardEvent.ports as unknown as Array<Transferable>,
                    );
                },
            );
        },
        {once: true},
    );
    workerPort.start();
});
