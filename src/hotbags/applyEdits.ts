import {
  BagStyleEnum,
  ConditionEnum,
  CurrencyEnum,
  DraftProductSchema,
  type DraftProduct,
} from "./schema";

type ApplyEditsResult =
  | { ok: true; draft: DraftProduct }
  | { ok: false; error: string };

const operatorSource = "operator";
const operatorConfidence = "high";

export function applyEdits(
  draft: DraftProduct,
  edits: Record<string, string>
): ApplyEditsResult {
  const allowedKeys = new Set([
    "bag_style",
    "bag_size_cm",
    "hermes_colour.label",
    "hermes_material.label",
    "hermes_hardware.label",
    "hermes_construction.label",
    "condition",
    "price",
    "currency",
    "stamp",
    "receipt",
    "accessories",
    "notes",
  ]);

  for (const key of Object.keys(edits)) {
    if (!allowedKeys.has(key)) {
      return { ok: false, error: `Unsupported edit key "${key}"` };
    }
  }

  const next = JSON.parse(JSON.stringify(draft)) as DraftProduct;

  for (const [key, value] of Object.entries(edits)) {
    switch (key) {
      case "bag_style": {
        const parsed = BagStyleEnum.safeParse(value);
        if (!parsed.success) {
          return { ok: false, error: `Invalid bag_style "${value}"` };
        }
        next.bag_style.value = parsed.data;
        next.bag_style.source = operatorSource;
        next.bag_style.confidence = operatorConfidence;
        break;
      }
      case "bag_size_cm": {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed)) {
          return { ok: false, error: `Invalid bag_size_cm "${value}"` };
        }
        next.bag_size_cm.value = parsed;
        next.bag_size_cm.source = operatorSource;
        next.bag_size_cm.confidence = operatorConfidence;
        break;
      }
      case "hermes_colour.label": {
        if (!value) {
          return { ok: false, error: "hermes_colour.label cannot be empty" };
        }
        next.hermes_colour.value.label = value;
        next.hermes_colour.source = operatorSource;
        next.hermes_colour.confidence = operatorConfidence;
        break;
      }
      case "hermes_material.label": {
        if (!value) {
          return { ok: false, error: "hermes_material.label cannot be empty" };
        }
        next.hermes_material.value.label = value;
        next.hermes_material.source = operatorSource;
        next.hermes_material.confidence = operatorConfidence;
        break;
      }
      case "hermes_hardware.label": {
        if (!value) {
          return { ok: false, error: "hermes_hardware.label cannot be empty" };
        }
        next.hermes_hardware.value.label = value;
        next.hermes_hardware.source = operatorSource;
        next.hermes_hardware.confidence = operatorConfidence;
        break;
      }
      case "hermes_construction.label": {
        if (!value) {
          return { ok: false, error: "hermes_construction.label cannot be empty" };
        }
        next.hermes_construction.value.label = value;
        next.hermes_construction.source = operatorSource;
        next.hermes_construction.confidence = operatorConfidence;
        break;
      }
      case "condition": {
        const parsed = ConditionEnum.safeParse(value);
        if (!parsed.success) {
          return { ok: false, error: `Invalid condition "${value}"` };
        }
        next.condition.value = parsed.data;
        next.condition.source = operatorSource;
        next.condition.confidence = operatorConfidence;
        break;
      }
      case "price": {
        const parsed = Number.parseFloat(value);
        if (!Number.isFinite(parsed)) {
          return { ok: false, error: `Invalid price "${value}"` };
        }
        next.price.value = parsed;
        next.price.source = operatorSource;
        next.price.confidence = operatorConfidence;
        break;
      }
      case "currency": {
        const parsed = CurrencyEnum.safeParse(value);
        if (!parsed.success) {
          return { ok: false, error: `Invalid currency "${value}"` };
        }
        next.currency.value = parsed.data;
        next.currency.source = operatorSource;
        next.currency.confidence = operatorConfidence;
        break;
      }
      case "stamp": {
        next.stamp.value = value;
        next.stamp.source = operatorSource;
        next.stamp.confidence = operatorConfidence;
        break;
      }
      case "receipt": {
        next.receipt.value = value;
        next.receipt.source = operatorSource;
        next.receipt.confidence = operatorConfidence;
        break;
      }
      case "accessories": {
        next.accessories.value = value;
        next.accessories.source = operatorSource;
        next.accessories.confidence = operatorConfidence;
        break;
      }
      case "notes": {
        next.notes.value = value;
        next.notes.source = operatorSource;
        next.notes.confidence = operatorConfidence;
        break;
      }
    }
  }

  try {
    const parsed = DraftProductSchema.parse(next);
    return { ok: true, draft: parsed };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Draft validation failed";
    return { ok: false, error: message };
  }
}
