import { describe, expect, it } from "vitest";
import { employerTier, estimateAsJobPay, estimatePayBand, titleGrade } from "../shared/engine/payEstimate";

describe("pay estimate", () => {
  it("bands Precision AQ Principal Data Engineer as a T5 staff/principal seat", () => {
    const band = estimatePayBand({
      title: "Principal Data Engineer",
      company: "Precision AQ",
      description: "Explain your experience with Snowflake, including performance tuning and Snowpipe.",
    });
    expect(band).toMatchObject({ tier: "T5", grade: "staff_principal", lowLpa: 28, highLpa: 45 });
    expect(band?.expectedCtc).toContain("₹28–45 LPA");
    expect(estimateAsJobPay(band!).payLow).toBe(2_800_000);
  });

  it("treats Euler as T4 senior IC for a bare Data Engineer title", () => {
    expect(employerTier("EULER").tier).toBe("T4");
    expect(titleGrade("Data Engineer", "T4")).toBe("senior_ic");
    const band = estimatePayBand({ title: "Data Engineer", company: "EULER" });
    expect(band).toMatchObject({ lowLpa: 32, highLpa: 52 });
  });

  it("does not invent a USD band", () => {
    expect(estimatePayBand({ title: "Engineer", company: "Acme", currency: "USD" })).toBeNull();
  });
});
