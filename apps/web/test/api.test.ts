import { describe, expect, it } from "vitest";
import { ApiError, formatWait, rateLimitedMessage } from "../src/lib/api.js";

describe("formatWait: Arabic number agreement", () => {
  const cases: Array<[number, string]> = [
    // Seconds, under a minute.
    [0, "ثانية واحدة"],
    [1, "ثانية واحدة"],
    [2, "ثانيتين"],
    [3, "3 ثوانٍ"],
    [10, "10 ثوانٍ"],
    [11, "11 ثانية"],
    [59, "59 ثانية"],
    // Minutes, from a minute to an hour and a half; partial minutes round up.
    [60, "دقيقة واحدة"],
    [61, "دقيقتين"],
    [120, "دقيقتين"],
    [180, "3 دقائق"],
    [600, "10 دقائق"],
    [601, "11 دقيقة"],
    [900, "15 دقيقة"],
    [3600, "60 دقيقة"],
    [5400, "90 دقيقة"],
    // Hours, above ninety minutes.
    [5401, "ساعتين"],
    [7200, "ساعتين"],
    [10800, "3 ساعات"],
    [36000, "10 ساعات"],
    [39600, "11 ساعة"],
    // The daily download ceiling: a day, never «1440 دقيقة».
    [86400, "24 ساعة"],
    [86399, "24 ساعة"],
  ];

  for (const [seconds, expected] of cases) {
    it(`${seconds}s → ${expected}`, () => {
      expect(formatWait(seconds)).toBe(expected);
    });
  }
});

describe("rateLimitedMessage", () => {
  it("names the wait from Retry-After", () => {
    expect(rateLimitedMessage(new ApiError(429, undefined, 86400))).toBe(
      "طلبات كثيرة في وقت قصير. حاول مرة أخرى بعد 24 ساعة.",
    );
    expect(rateLimitedMessage(new ApiError(429, undefined, 5))).toBe(
      "طلبات كثيرة في وقت قصير. حاول مرة أخرى بعد 5 ثوانٍ.",
    );
  });

  it("falls back to a wait without a number when the server gave none", () => {
    expect(rateLimitedMessage(new ApiError(429))).toBe(
      "طلبات كثيرة في وقت قصير. انتظر قليلاً ثم حاول مرة أخرى.",
    );
    expect(rateLimitedMessage(new Error("network"))).toBe(
      "طلبات كثيرة في وقت قصير. انتظر قليلاً ثم حاول مرة أخرى.",
    );
  });
});
