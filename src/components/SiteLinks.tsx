import { Link } from "react-router-dom";

export const SITE_LINKS = [
  { to: "/privacy", label: "Privacy" },
  { to: "/terms", label: "Terms" },
  { to: "/cookies", label: "Cookies" },
  { to: "/refunds", label: "Refunds" },
  { to: "/support", label: "Support" },
] as const;

export function SiteLinks({ className }: { className?: string }) {
  const links = SITE_LINKS.map((link) => (
    <Link key={link.to} to={link.to}>{link.label}</Link>
  ));
  const classes = className ? `site-links ${className}` : "site-links";
  return <span className={classes}>{links}</span>;
}
