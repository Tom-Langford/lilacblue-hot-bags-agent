import { DraftProductSchema } from "@/src/hotbags/schema";
import { buildCheckMessage } from "@/src/hotbags/checkMessages";
import { getDealSession } from "@/src/platform/db";

export const runtime = "nodejs";

type DealPageProps = {
  params: { deal_id: string };
};

export default async function DealPage({ params }: DealPageProps) {
  const deal = await getDealSession(params.deal_id);

  if (!deal) {
    return (
      <main style={{ padding: "24px", fontFamily: "system-ui, sans-serif" }}>
        <h1>Deal not found</h1>
        <p>No deal session exists for {params.deal_id}.</p>
      </main>
    );
  }

  let checkMessage: ReturnType<typeof buildCheckMessage> | null = null;
  let draftError: string | null = null;

  try {
    const draft = DraftProductSchema.parse(deal.draft_product ?? {});
    checkMessage = buildCheckMessage({
      deal_id: deal.deal_id,
      draft_version: deal.draft_version,
      draft,
    });
  } catch (error) {
    draftError =
      error instanceof Error ? error.message : "Draft product validation failed.";
  }

  return (
    <main style={{ padding: "24px", fontFamily: "system-ui, sans-serif" }}>
      <h1>Deal {deal.deal_id}</h1>

      <section style={{ marginBottom: "24px" }}>
        <h2>Metadata</h2>
        <p>State: {deal.state}</p>
        <p>Draft version: {deal.draft_version}</p>
        <p>Expires at: {deal.expires_at}</p>
        <p>Updated at: {deal.updated_at}</p>
      </section>

      <section style={{ marginBottom: "24px" }}>
        <h2>Draft Product</h2>
        <pre
          style={{
            background: "#f7f7f7",
            padding: "12px",
            overflowX: "auto",
          }}
        >
          {JSON.stringify(deal.draft_product ?? {}, null, 2)}
        </pre>
      </section>

      <section>
        <h2>CHECK Message</h2>
        {draftError ? (
          <p style={{ color: "crimson" }}>{draftError}</p>
        ) : checkMessage ? (
          <>
            <h3>{checkMessage.summary_title}</h3>
            <ul>
              {checkMessage.lines.map((line, index) => (
                <li key={`${line.key}-${index}`}>
                  {line.key}: {line.value} ({line.confidence})
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>No check message available.</p>
        )}
      </section>
    </main>
  );
}
