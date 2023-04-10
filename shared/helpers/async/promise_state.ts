/**
 * States that a promise may be in. Naming taken from `Promise.allSettled()`.
 */
export type PromiseState<Value> =
    | {
          readonly status: "pending";
          readonly value?: undefined;
          readonly reason?: undefined;
      }
    | {
          readonly status: "fulfilled";
          readonly value: Value;
          readonly reason?: undefined;
      }
    | {
          readonly status: "rejected";
          readonly reason: unknown;
          readonly value?: undefined;
      };
