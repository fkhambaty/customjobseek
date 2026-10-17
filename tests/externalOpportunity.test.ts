import { describe, expect, it } from "vitest";
import { parseExternalOpportunity } from "../shared/engine/externalOpportunity";
import { routeFromUrl } from "../shared/engine/classify";

const UNIMORPH = `Hello Fakhruddin,
I have reviewed your profile on LInkedIN, We have below position as Data modeler for Pune loc. Let me know if interested.

Role : Data Modeler
Exp : 7-10 Yrs
Location : Pune
Type : Contractor | Full time

# Key Skills :
enterprise data modeling, dimensional modeling, data warehousing, cloud data platforms, and modern Lakehouse architectures,Modern Data modeling Datavault,
fact & dimension design, unity catalog, logical data modeling, dimensional modeling, lakehouse architecture, relational data modeling, databricks / delta lake, physical data modeling, master & reference data modeling, ER modeling, Data vault modeling, normalization / denormalization

Interested candidates can share resume at "info@unimorphtech.com"`;

describe("external opportunity paste", () => {
  it("parses a LinkedIn recruiter hiring message", () => {
    const job = parseExternalOpportunity(UNIMORPH);
    expect(job.title).toMatch(/data modeler/i);
    expect(job.company).toMatch(/unimorph/i);
    expect(job.location).toMatch(/pune/i);
    expect(job.contactEmail).toBe("info@unimorphtech.com");
    expect(job.description.length).toBeGreaterThanOrEqual(150);
    expect(job.description).toMatch(/lakehouse/i);
    expect(job.sourceLabel).toBe("External");
  });

  it("labels jobs without a URL as External", () => {
    expect(routeFromUrl("")).toBe("External");
  });
});
