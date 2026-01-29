import Link from "next/link";
import { listDealSessions } from "@/src/platform/db";

export const runtime = "nodejs";

export default async function DealsPage() {
  const deals = await listDealSessions(50);

  return (
    <main style={{ padding: "24px", fontFamily: "system-ui, sans-serif" }}>
      <h1>Deals</h1>

      {deals.length === 0 ? (
        <p>No deal sessions yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: "8px" }}>
                Deal ID
              </th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: "8px" }}>
                State
              </th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: "8px" }}>
                Draft Version
              </th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: "8px" }}>
                Updated At
              </th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: "8px" }}>
                Expires At
              </th>
            </tr>
          </thead>
          <tbody>
            {deals.map((deal) => (
              <tr key={deal.id}>
                <td style={{ padding: "8px", borderBottom: "1px solid #eee" }}>
                  <Link href={`/ops/deals/${deal.deal_id}`}>{deal.deal_id}</Link>
                </td>
                <td style={{ padding: "8px", borderBottom: "1px solid #eee" }}>{deal.state}</td>
                <td style={{ padding: "8px", borderBottom: "1px solid #eee" }}>{deal.draft_version}</td>
                <td style={{ padding: "8px", borderBottom: "1px solid #eee" }}>{deal.updated_at}</td>
                <td style={{ padding: "8px", borderBottom: "1px solid #eee" }}>{deal.expires_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
