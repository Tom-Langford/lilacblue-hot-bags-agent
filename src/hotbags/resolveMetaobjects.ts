import { shopifyGraphQL } from "@/src/platform/shopifyAdmin";
import { getMetaobjectFromCache, logEvent, upsertMetaobjectCache } from "@/src/platform/db";
import type { AutomationEventEnvelope } from "@/src/platform/types";

type ResolveArgs = {
  shop: string;
  type_handle: string;
  label: string;
};

type ResolveResult = {
  id: string;
  label: string;
  displayName: string;
};

export class ResolveMetaobjectError extends Error {
  code: "not_found" | "ambiguous";
  candidates?: string[];

  constructor(message: string, code: "not_found" | "ambiguous", candidates?: string[]) {
    super(message);
    this.code = code;
    this.candidates = candidates;
  }
}

type MetaobjectNode = {
  id: string;
  displayName: string;
};

type MetaobjectQueryResponse = {
  metaobjects: {
    nodes: MetaobjectNode[];
  };
};

function normalizeLabel(label: string) {
  return label.trim().toLowerCase();
}

function normalizeColourDisplayName(displayName: string) {
  const stripped = displayName.replace(/^\S+\s+\S+\s+/, "");
  return normalizeLabel(stripped);
}

function buildEvent(args: {
  type: string;
  correlation_id: string;
  data: Record<string, unknown>;
}): AutomationEventEnvelope {
  return {
    event_id: crypto.randomUUID(),
    source: "internal",
    type: args.type,
    occurred_at: new Date().toISOString(),
    correlation_id: args.correlation_id,
    shop: null,
    data: args.data,
  };
}

function buildQuery(label: string, type_handle: string, first: number, exact: boolean) {
  const query = exact
    ? `display_name:'${label.replace(/'/g, "\\'")}'`
    : `display_name:${label.replace(/'/g, "\\'")}`;

  return {
    query: `
      query Metaobjects($type: String!, $first: Int!, $query: String!) {
        metaobjects(type: $type, first: $first, query: $query) {
          nodes {
            id
            displayName
          }
        }
      }
    `,
    variables: { type: type_handle, first, query },
  };
}

export async function resolveMetaobject(args: ResolveArgs): Promise<ResolveResult> {
  const normalized_label = normalizeLabel(args.label);

  const cached = await getMetaobjectFromCache({
    shop: args.shop,
    type_handle: args.type_handle,
    normalized_label,
  });

  if (cached) {
    return { id: cached.gid, label: cached.input_label, displayName: cached.display_name };
  }

  const isColour = args.type_handle === "hermes_colour";
  const { query, variables } = buildQuery(args.label, args.type_handle, isColour ? 25 : 10, !isColour);
  const data = await shopifyGraphQL<MetaobjectQueryResponse>(query, variables);
  const candidates = data.metaobjects.nodes ?? [];

  const filtered = candidates.filter((node) => {
    const normalized = isColour
      ? normalizeColourDisplayName(node.displayName)
      : normalizeLabel(node.displayName);
    return normalized === normalized_label;
  });

  if (filtered.length === 0) {
    throw new Error(`No metaobject match for ${args.type_handle} "${args.label}"`);
  }

  let chosen = filtered[0];
  if (filtered.length > 1) {
    chosen = filtered.reduce((prev, current) =>
      current.displayName.length < prev.displayName.length ? current : prev
    );

    await logEvent(
      buildEvent({
        type: "dev.metaobject_resolve_warning",
        correlation_id: args.shop,
        data: {
          type_handle: args.type_handle,
          label: args.label,
          normalized_label,
          candidate_display_names: filtered.map((node) => node.displayName),
          chosen_display_name: chosen.displayName,
        },
      })
    );
  }

  await upsertMetaobjectCache({
    shop: args.shop,
    type_handle: args.type_handle,
    input_label: args.label,
    normalized_label,
    gid: chosen.id,
    displayName: chosen.displayName,
  });

  return { id: chosen.id, label: args.label, displayName: chosen.displayName };
}

export async function resolveMetaobjectStrict(args: ResolveArgs): Promise<ResolveResult> {
  const normalized_label = normalizeLabel(args.label);

  const cached = await getMetaobjectFromCache({
    shop: args.shop,
    type_handle: args.type_handle,
    normalized_label,
  });

  if (cached) {
    return { id: cached.gid, label: cached.input_label, displayName: cached.display_name };
  }

  const isColour = args.type_handle === "hermes_colour";
  const { query, variables } = buildQuery(args.label, args.type_handle, isColour ? 25 : 10, !isColour);
  const data = await shopifyGraphQL<MetaobjectQueryResponse>(query, variables);
  const candidates = data.metaobjects.nodes ?? [];

  const filtered = candidates.filter((node) => {
    const normalized = isColour
      ? normalizeColourDisplayName(node.displayName)
      : normalizeLabel(node.displayName);
    return normalized === normalized_label;
  });

  if (filtered.length === 0) {
    throw new ResolveMetaobjectError(
      `No metaobject match for ${args.type_handle} "${args.label}"`,
      "not_found"
    );
  }

  if (filtered.length > 1) {
    throw new ResolveMetaobjectError(
      `Ambiguous metaobject match for ${args.type_handle} "${args.label}"`,
      "ambiguous",
      filtered.map((node) => node.displayName)
    );
  }

  const chosen = filtered[0];

  await upsertMetaobjectCache({
    shop: args.shop,
    type_handle: args.type_handle,
    input_label: args.label,
    normalized_label,
    gid: chosen.id,
    displayName: chosen.displayName,
  });

  return { id: chosen.id, label: args.label, displayName: chosen.displayName };
}
