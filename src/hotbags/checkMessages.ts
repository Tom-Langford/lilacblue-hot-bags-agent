import type { DraftProduct, CheckMessage } from "./schema";

export function buildDeterministicTitle(d: DraftProduct): string {
  // Strip the "Hermès " prefix once for readability in title (optional)
  const style = d.bag_style.value.replace(/^Hermès\s+/, "");
  return `Hermès ${style} ${d.bag_size_cm.value}cm ${d.hermes_colour.value.label} ${d.hermes_material.value.label} ${d.hermes_hardware.value.label}`;
}

function formatReceipt(receipt: string): string {
  if (!receipt) return "Not stated";
  const normalized = receipt.toLowerCase();
  if (normalized.includes("not") || normalized.includes("no") || normalized.includes("without")) {
    return "Not provided";
  }
  return "Provided";
}

export function buildCheckMessage(args: {
  deal_id: string;
  draft_version: number;
  draft: DraftProduct;
}): CheckMessage {
  const { deal_id, draft_version, draft } = args;

  const title = buildDeterministicTitle(draft);

  const dims = draft.dimensions.value;
  const dimsText =
    dims.length_cm || dims.width_cm || dims.height_cm
      ? `${dims.length_cm ?? "?"}×${dims.width_cm ?? "?"}×${dims.height_cm ?? "?"} cm`
      : "-";

  const lines: CheckMessage["lines"] = [
    { key: "Brand", value: draft.brand, confidence: "high", required: true },

    { key: "Bag Style", value: draft.bag_style.value, confidence: draft.bag_style.confidence, required: true },
    { key: "Bag Size (cm)", value: String(draft.bag_size_cm.value), confidence: draft.bag_size_cm.confidence, required: true },

    { key: "Hermès Colour", value: draft.hermes_colour.value.label, confidence: draft.hermes_colour.confidence, required: true },
    { key: "Hermès Material", value: draft.hermes_material.value.label, confidence: draft.hermes_material.confidence, required: true },
    { key: "Hermès Hardware", value: draft.hermes_hardware.value.label, confidence: draft.hermes_hardware.confidence, required: true },
    { key: "Hermès Construction", value: draft.hermes_construction.value.label, confidence: draft.hermes_construction.confidence, required: false },

    { key: "Dimensions", value: dimsText, confidence: draft.dimensions.confidence, required: false },

    { key: "Stamp", value: draft.stamp.value || "-", confidence: draft.stamp.confidence, required: false },
    { key: "Condition", value: draft.condition.value, confidence: draft.condition.confidence, required: true },

    {
      key: "Price",
      value: `${draft.currency.value} ${draft.price.value.toLocaleString("en-GB")}`,
      confidence: draft.price.confidence,
      required: true,
    },

    {
      key: "Receipt",
      value: formatReceipt(draft.receipt.value),
      confidence: draft.receipt.confidence,
      required: false,
    },
    { key: "Accessories", value: draft.accessories.value || "Not stated", confidence: draft.accessories.confidence, required: false },
    { key: "Notes", value: draft.notes.value || "-", confidence: draft.notes.confidence, required: false },

    { key: "Image", value: draft.image_status, confidence: "unknown", required: false },
  ];

  return {
    deal_id,
    draft_version,
    state: "awaiting_confirmation",
    summary_title: `CHECK — ${title}`,
    lines,
    instructions: [
      "Reply YES to publish",
      "Reply CANCEL to stop",
      "Reply EDIT then key=value lines (e.g. bag_size_cm=25)",
    ],
  };
}