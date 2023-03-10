/**
 * States that a promise may be in. Naming taken from `Promise.allSettled()`.
 */
export type PromiseState<Value> =
    | {
          readonly status: "pending";
      }
    | {
          readonly status: "fulfilled";
          readonly value: Value;
      }
    | {
          readonly status: "rejected";
          readonly reason: unknown;
      };
