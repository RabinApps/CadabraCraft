import { factRows, us, type Competitor } from "@/data/competitors";

export function ComparisonTable({ c }: { c: Competitor }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full min-w-[560px] text-left text-sm">
        <caption className="sr-only">CadabraCraft compared with {c.name}</caption>
        <thead className="bg-sidebar">
          <tr>
            <th scope="col" className="px-5 py-3 font-semibold">
              Feature
            </th>
            <th scope="col" className="px-5 py-3 font-semibold text-accent">
              CadabraCraft
            </th>
            <th scope="col" className="px-5 py-3 font-semibold">
              {c.name}
            </th>
          </tr>
        </thead>
        <tbody>
          {factRows.map((r) => (
            <tr key={r.key} className="border-t border-border">
              <th scope="row" className="px-5 py-3 font-medium">
                {r.label}
              </th>
              <td className="px-5 py-3 text-accent">{us[r.key]}</td>
              <td className="px-5 py-3 text-ink-muted">{c.facts[r.key].value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
