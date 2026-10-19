import { useEffect, useState } from "react";
import { ANALYTICS_COUNT_COPY } from "../../shared/commercial";
import { legalOperatorCopy, REFUND_WALLET_LIMITATION, type PublicBillingStatus } from "../../shared/payments";
import { api } from "../api";
import { SiteLinks } from "../components/SiteLinks";

const UPDATED = "14 October 2026";

export type LegalDoc = "privacy" | "terms" | "cookies" | "refunds";

interface Section {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
}

interface LegalCopy {
  title: string;
  intro: string;
  sections: Section[];
}

function legalCopy(doc: LegalDoc): LegalCopy {
  switch (doc) {
    case "privacy":
      return {
        title: "Privacy",
        intro: "This page says what CustomJobSeek keeps, who can see it, and how you take it back. It is written in plain language.",
        sections: [
          {
            heading: "The account",
            paragraphs: ["We store your email and a scrambled form of your password. We also store your plan and how many credits you have left."],
          },
          {
            heading: "What you type in",
            paragraphs: [
              "Your profile, uploaded resume text, tailored resumes, contacts, and message notes are encrypted before they are saved. Jobs you paste, statuses, and companies you ask us to scan are stored so the product can work.",
              "We do not sell this. We do not use it to train a model. The product does not call a language model to write your resume.",
            ],
          },
          {
            heading: "Email",
            paragraphs: [
              "Sign-up and password codes are emailed when mail is configured. We store a hash of the code, not the code itself.",
              "Mail that a scan finished, that credits are low, or that a paid plan is about to expire is on unless you turn it off in Account. The low-credit note states how many fit checks and resumes are left. It does not pitch a plan. A weekly note and one setup reminder are sent only if you opt in, and each one has a link to stop them.",
            ],
          },
          {
            heading: "Payments",
            paragraphs: ["When checkout is open, Razorpay handles the card. We store the plan, the amount in INR, and whether it was paid. We do not store the card number. A raw payment notice is not saved, because it can contain an email or a phone number. Credits are added only after Razorpay confirms the payment."],
          },
          {
            heading: "Notices to us",
            paragraphs: ["If owner email is configured, we may send ourselves a short note that a support request arrived or that a public job-board reader is failing. That note does not include your resume, your password, your sign-in code, or the text of your message."],
          },
          {
            heading: "Your copy, and deletion",
            paragraphs: ["On the Account page you can download a copy of your data. Anonymous product counts are not in that download, because they are not stored on your account. Deleting the account removes your profile, jobs, resumes, credits, and the other rows tied to you."],
          },
        ],
      };
    case "terms":
      return {
        title: "Terms",
        intro: "These are the rules for using CustomJobSeek. The pricing page is what you are buying. If this page and the pricing page ever disagree about a number, the pricing page wins.",
        sections: [
          {
            heading: "What the product does",
            paragraphs: [
              "You keep a factual record of your work. For a job you choose, the product scores the fit and builds a resume by selecting lines you wrote. It does not invent experience, and it does not apply to jobs for you.",
              "A fit score is a clue. It is not a promise of an interview.",
            ],
          },
          {
            heading: "Credits",
            paragraphs: [
              "The free plan includes 3 application packs and 1 scan, as listed on the pricing page. Paid plans add more packs and scans. Paid plan credits last 180 days from the day Razorpay confirms the payment.",
              "Paid plans and scan runs are one-time purchases in INR. They do not renew. While checkout is closed, nothing on the pricing page charges a card. Returning to this site after checkout does not add credits by itself.",
            ],
          },
          {
            heading: "Your part",
            paragraphs: ["Put in information you have the right to use. Do not try to break the service, scrape it, or store someone else's private information in it. We can pause an account that keeps running into the limits on purpose."],
          },
          {
            heading: "Job boards",
            paragraphs: ["The scan reads public employer career pages, including company sites that publish jobs as JSON-LD or job links. It can miss a job or read a page wrong. LinkedIn, Naukri, Shine and similar aggregators are not scraped."],
          },
        ],
      };
    case "cookies":
      return {
        title: "Cookies",
        intro: "The site uses one cookie so you can stay signed in. It does not use advertising cookies.",
        sections: [
          {
            heading: "The sign-in cookie",
            paragraphs: ["The cookie is named cjs_session. It lasts 30 days. Page scripts cannot read it, and it is only sent back to this site."],
          },
          {
            heading: "Anonymous counts",
            paragraphs: [ANALYTICS_COUNT_COPY],
          },
        ],
      };
    case "refunds":
      return {
        title: "Refunds",
        intro: "If checkout is closed, there is nothing to refund. When a purchase is confirmed, these are the rules.",
        sections: [
          {
            heading: "Before you have used the purchase",
            paragraphs: ["Write to support within 7 days of the payment. If the credits and scan runs from that purchase are still in the wallet, we refund them."],
          },
          {
            heading: "After you have used some of it",
            paragraphs: [REFUND_WALLET_LIMITATION],
          },
          {
            heading: "The free plan",
            paragraphs: ["The free plan does not charge anything, so there is no refund to make."],
          },
        ],
      };
    default: {
      const unexpected: never = doc;
      throw new Error(String(unexpected));
    }
  }
}

const CLOSED_OPERATOR: PublicBillingStatus = { paymentsEnabled: false, operator: null };

function OperatorNote() {
  const [status, setStatus] = useState<PublicBillingStatus>(CLOSED_OPERATOR);
  useEffect(() => {
    api.billingStatus().then(setStatus).catch(() => setStatus(CLOSED_OPERATOR));
  }, []);
  return <p className="legal-operator">{legalOperatorCopy(status)}</p>;
}

export function LegalPage({ doc }: { doc: LegalDoc }) {
  const copy = legalCopy(doc);
  return (
    <div className="page narrow-wide legal">
      <h1>{copy.title}</h1>
      <p className="muted small">Updated {UPDATED}</p>
      <OperatorNote />
      <p className="lede">{copy.intro}</p>
      {copy.sections.map((section) => (
        <section key={section.heading}>
          <h2>{section.heading}</h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          {section.bullets && (
            <ul>
              {section.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
      <p className="see-also muted">
        Also see <SiteLinks />
      </p>
    </div>
  );
}
