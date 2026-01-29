import { z } from "zod";

export type FieldSource = "deterministic" | "ai" | "operator" | "unknown";
export const ConfidenceEnum = z.enum(["high", "medium", "low", "unknown"]);
export const SourceEnum = z.enum(["deterministic", "ai", "operator", "unknown"]);

export const BagStyleEnum = z.enum([
  "Hermès Birkin",
  "Hermès Kelly",
  "Hermès Kelly Elan",
  "Hermès Constance",
  "Hermès Picotin",
  "Hermès Lindy",
  "Hermès Herbag",
  "Hermès Bolide",
  "Hermès Evelyne",
  "Hermès Jige",
  "Hermès Garden Party",
  "Hermès Aline",
  "Hermès Berline",
  "Hermès Egee",
  "Hermès Farming",
  "Hermès Geta",
  "Hermès H Passant",
  "Hermès Hac a Dos",
  "Hermès Medor",
  "Hermès Minuit au Faubourg",
  "Hermès Multiplis",
  "Hermès Rio",
  "Hermès Roulis",
  "Hermès Sac a Depeche",
  "Hermès Sac Mallette",
  "Hermès Sac a Pansage",
  "Hermès Toolbox",
  "Hermès Verrou",
  "Hermès 2002",
  "Hermès Boucle Sellier Chaîne",
]);

export const ConditionEnum = z.enum([
  "Brand new",
  "Excellent",
  "Lightly used",
  "Used",
]);

export const CurrencyEnum = z.enum(["GBP", "EUR", "USD", "Unknown"]);

export const ImageStatusEnum = z.enum(["reseller", "ai_placeholder", "none"]);

/**
 * Metaobject reference representation (internal).
 * Later we will resolve label -> id using Shopify API.
 */
export const MetaobjectRefSchema = z.object({
  id: z.string().optional(),   // Shopify GID once resolved
  label: z.string().min(1),    // human canonical label
  handle: z.string().optional() // optional if you want stable handles
});

export type MetaobjectRef = z.infer<typeof MetaobjectRefSchema>;

export const ExtractedFieldSchema = z.object({
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.record(z.string(), z.any()),
  ]),
  confidence: ConfidenceEnum,
  source: SourceEnum,
  note: z.string().optional(),
});

export const DimensionsSchema = z.object({
  length_cm: z.number().nonnegative().optional(),
  width_cm: z.number().nonnegative().optional(),
  height_cm: z.number().nonnegative().optional(),
  note: z.string().optional(),
});

export const DraftProductSchema = z.object({
  brand: z.literal("Hermès"),

  bag_style: ExtractedFieldSchema.extend({
    value: BagStyleEnum,
  }),

  bag_size_cm: ExtractedFieldSchema.extend({
    value: z.number().int().min(1).max(60),
  }),

  // Metaobjects (canonical)
  hermes_colour: z.object({
    value: MetaobjectRefSchema,
    confidence: ConfidenceEnum,
    source: SourceEnum,
    note: z.string().optional(),
  }),

  hermes_material: z.object({
    value: MetaobjectRefSchema,
    confidence: ConfidenceEnum,
    source: SourceEnum,
    note: z.string().optional(),
  }),

  hermes_hardware: z.object({
    value: MetaobjectRefSchema,
    confidence: ConfidenceEnum,
    source: SourceEnum,
    note: z.string().optional(),
  }),

  hermes_construction: z.object({
    value: MetaobjectRefSchema,
    confidence: ConfidenceEnum,
    source: SourceEnum,
    note: z.string().optional(),
  }),

  // Additional fields
  dimensions: z.object({
    value: DimensionsSchema,
    confidence: ConfidenceEnum,
    source: SourceEnum,
    note: z.string().optional(),
  }),

  stamp: ExtractedFieldSchema.extend({
    value: z.string().default(""),
  }),

  condition: ExtractedFieldSchema.extend({
    value: ConditionEnum,
  }),

  price: ExtractedFieldSchema.extend({
    value: z.number().positive(),
  }),

  currency: ExtractedFieldSchema.extend({
    value: CurrencyEnum,
  }),

  receipt: ExtractedFieldSchema.extend({
    value: z.string().default(""),
  }),

  accessories: ExtractedFieldSchema.extend({
    value: z.string().default(""),
  }),

  notes: ExtractedFieldSchema.extend({
    value: z.string().default(""),
  }),

  image_status: ImageStatusEnum.default("reseller"),

  provenance: z.object({
    source_text: z.string().default(""),
    source_message_id: z.string().optional(),
    source_chat_id: z.string().optional(),
  }),
});

export type DraftProduct = z.infer<typeof DraftProductSchema>;

/**
 * CHECK message payload
 */
export const CheckMessageSchema = z.object({
  deal_id: z.string(),
  draft_version: z.number().int().min(1),
  state: z.enum(["awaiting_confirmation"]),
  summary_title: z.string(),
  lines: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
      confidence: ConfidenceEnum,
      required: z.boolean(),
      warning: z.string().optional(),
    })
  ),
  instructions: z.array(z.string()),
});

export type CheckMessage = z.infer<typeof CheckMessageSchema>;

export const OperatorCommandSchema = z.object({
  intent: z.enum(["YES", "CANCEL", "EDIT", "UNKNOWN"]),
  edits: z.record(z.string(), z.string()).default({}),
});

export type OperatorCommand = z.infer<typeof OperatorCommandSchema>;