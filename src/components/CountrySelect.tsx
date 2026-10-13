import { countriesForPicker, timeZoneLabel, zonesForCountry } from "../../shared/geo";
import { Field } from "./fields";

export function CountrySelect({
  value,
  emptyLabel,
  onChange,
}: {
  value: string;
  emptyLabel: string;
  onChange: (code: string) => void;
}) {
  const { featured, other } = countriesForPicker();
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{emptyLabel}</option>
      <optgroup label="English-language markets">
        {featured.map((country) => (
          <option key={country.code} value={country.code}>{country.name}</option>
        ))}
      </optgroup>
      <optgroup label="Every other country">
        {other.map((country) => (
          <option key={country.code} value={country.code}>{country.name}</option>
        ))}
      </optgroup>
    </select>
  );
}

export function TimeZoneField({
  country,
  value,
  onChange,
}: {
  country: string;
  value: string;
  onChange: (zone: string) => void;
}) {
  const zones = zonesForCountry(country);
  if (!country) {
    return (
      <p className="muted small">
        No country yet, so a daily scan stays on {timeZoneLabel(value)}. Pick a country when you want a different clock.
      </p>
    );
  }
  if (zones.length < 2) {
    return <p className="muted small">Daily scans use {zones[0]?.label ?? "UTC"}.</p>;
  }
  return (
    <Field label="Time zone" hint="The daily scan hour uses this clock. It does not change how pay is compared.">
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {zones.map((zone) => (
          <option key={zone.id} value={zone.id}>{zone.label}</option>
        ))}
      </select>
    </Field>
  );
}
