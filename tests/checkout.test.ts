import { describe, expect, it } from "vitest";
import {
  CHECKOUT_POLL_LIMIT,
  checkoutAbandoned,
  checkoutReturnPath,
  checkoutShowsIncomplete,
  shouldPollCheckout,
} from "../src/checkout";

describe("checkout return", () => {
  it("marks dismiss and failure as not completed and does not keep polling", () => {
    expect(checkoutAbandoned("dismissed")).toBe(true);
    expect(checkoutAbandoned("failed")).toBe(true);
    expect(checkoutAbandoned(null)).toBe(false);
    expect(checkoutReturnPath("order-1", "dismissed")).toBe("/checkout/return?order=order-1&result=dismissed");
    expect(checkoutReturnPath("order-1", "failed")).toContain("result=failed");
    expect(checkoutReturnPath("order-1", "completed")).toBe("/checkout/return?order=order-1");

    expect(shouldPollCheckout({ status: "created", abandoned: true, attempts: 0 })).toBe(false);
    expect(checkoutShowsIncomplete({ status: "created", abandoned: true, attempts: 0 })).toBe(true);
    expect(checkoutShowsIncomplete({ status: null, abandoned: true, attempts: 0 })).toBe(true);
    expect(checkoutShowsIncomplete({ status: "paid", abandoned: true, attempts: 0 })).toBe(false);
  });

  it("stops on a terminal status and after the poll limit", () => {
    expect(shouldPollCheckout({ status: "paid", abandoned: false, attempts: 1 })).toBe(false);
    expect(shouldPollCheckout({ status: "failed", abandoned: false, attempts: 1 })).toBe(false);
    expect(shouldPollCheckout({ status: "refunded", abandoned: false, attempts: 1 })).toBe(false);
    expect(shouldPollCheckout({ status: "created", abandoned: false, attempts: 1 })).toBe(true);
    expect(shouldPollCheckout({ status: "created", abandoned: false, attempts: CHECKOUT_POLL_LIMIT })).toBe(false);
    expect(checkoutShowsIncomplete({ status: "created", abandoned: false, attempts: CHECKOUT_POLL_LIMIT })).toBe(true);
    expect(checkoutShowsIncomplete({ status: "created", abandoned: false, attempts: 1 })).toBe(false);
    expect(checkoutShowsIncomplete({ status: "failed", abandoned: false, attempts: CHECKOUT_POLL_LIMIT })).toBe(false);
  });
});
