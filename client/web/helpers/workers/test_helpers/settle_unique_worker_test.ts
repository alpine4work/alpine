/** Wait for all in-flight fake message deliveries and lock grants to settle. */
export async function settleUniqueWorkerTest(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        await new Promise<void>(resolve => {
            setTimeout(resolve, 0);
        });
    }
}
