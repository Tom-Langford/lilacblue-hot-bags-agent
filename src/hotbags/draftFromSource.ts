import {
  BagStyleEnum,
  CurrencyEnum,
  DraftProductSchema,
  type DraftProduct,
} from "./schema";

export function buildCorrelationId(from: string, messageId: string): string {
  return `wa_${from}_${messageId}`;
}

export function mergeSourceText(existing: string | undefined, next: string): string {
  if (!existing) return next;
  if (existing.includes(next)) return existing;
  return `${existing}\n${next}`;
}

export function normalizeSourceMessageIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string");
}

export function extractFromSourceText(source_text: string) {
  const text = source_text.toLowerCase();

  let bag_style: DraftProduct["bag_style"]["value"] | null = null;
  for (const style of BagStyleEnum.options) {
    if (text.includes(style.toLowerCase())) {
      bag_style = style;
      break;
    }
  }

  let bag_size_cm: number | null = null;
  const sizeMatch =
    source_text.match(/\b(\d{2})\s?cm\b/i) ||
    source_text.match(/\b(\d{2})\b/);
  if (sizeMatch) {
    const parsed = Number.parseInt(sizeMatch[1], 10);
    if (Number.isFinite(parsed)) {
      bag_size_cm = parsed;
    }
  }

  let currency: DraftProduct["currency"]["value"] | null = null;
  if (/[£]/.test(source_text) || text.includes("gbp")) currency = "GBP";
  if (/[€]/.test(source_text) || text.includes("eur")) currency = "EUR";
  if (/[$]/.test(source_text) || text.includes("usd")) currency = "USD";

  let price: number | null = null;
  const priceMatch = source_text.match(/([£€$])\s?([\d,]+(?:\.\d+)?)/);
  if (priceMatch) {
    const parsed = Number.parseFloat(priceMatch[2].replace(/,/g, ""));
    if (Number.isFinite(parsed)) price = parsed;
  }

  let receipt: boolean | null = null;
  if (text.includes("receipt")) {
    if (text.includes("no receipt") || text.includes("without receipt")) {
      receipt = false;
    } else {
      receipt = true;
    }
  }

  let stamp: string | null = null;
  const stampMatch = source_text.match(/stamp[:\s]+([A-Za-z0-9-]+)/i);
  if (stampMatch) {
    stamp = stampMatch[1];
  }

  return {
    bag_style,
    bag_size_cm,
    currency: currency ? CurrencyEnum.parse(currency) : null,
    price,
    receipt,
    stamp,
  };
}

export function buildStubDraft(
  source_text: string,
  source_message_id: string,
  source_chat_id: string
): DraftProduct {
  const base: DraftProduct = {
    brand: "Hermès",
    bag_style: {
      value: "Hermès Birkin",
      confidence: "medium",
      source: "deterministic",
    },
    bag_size_cm: {
      value: 25,
      confidence: "medium",
      source: "deterministic",
    },
    hermes_colour: {
      value: { label: "Gold" },
      confidence: "medium",
      source: "deterministic",
    },
    hermes_material: {
      value: { label: "Togo" },
      confidence: "medium",
      source: "deterministic",
    },
    hermes_hardware: {
      value: { label: "Gold" },
      confidence: "medium",
      source: "deterministic",
    },
    hermes_construction: {
      value: { label: "Sellier" },
      confidence: "low",
      source: "deterministic",
    },
    dimensions: {
      value: { length_cm: 25, width_cm: 12, height_cm: 20 },
      confidence: "low",
      source: "deterministic",
    },
    stamp: { value: "", confidence: "unknown", source: "deterministic" },
    condition: { value: "Excellent", confidence: "medium", source: "deterministic" },
    price: { value: 18000, confidence: "low", source: "deterministic" },
    currency: { value: "GBP", confidence: "high", source: "deterministic" },
    receipt: { value: "", confidence: "unknown", source: "deterministic" },
    accessories: { value: "", confidence: "unknown", source: "deterministic" },
    notes: { value: "", confidence: "unknown", source: "deterministic" },
    image_status: "reseller",
    provenance: { source_text, source_message_id, source_chat_id },
  };

  const extracted = extractFromSourceText(source_text);

  if (extracted.bag_style) {
    base.bag_style.value = extracted.bag_style;
    base.bag_style.confidence = "high";
  }

  if (extracted.bag_size_cm) {
    base.bag_size_cm.value = extracted.bag_size_cm;
    base.bag_size_cm.confidence = "high";
  }

  if (extracted.currency) {
    base.currency.value = extracted.currency;
    base.currency.confidence = "high";
  }

  if (extracted.price) {
    base.price.value = extracted.price;
    base.price.confidence = "high";
  }

  if (extracted.receipt !== null) {
    base.receipt.value = extracted.receipt ? "Provided" : "Not provided";
    base.receipt.confidence = "high";
  }

  if (extracted.stamp) {
    base.stamp.value = extracted.stamp;
    base.stamp.confidence = "high";
  }

  return base;
}
