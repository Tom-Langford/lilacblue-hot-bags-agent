function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function shopifyGraphQL<T>(
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const shop = requireEnv("SHOPIFY_SHOP");
  const token = requireEnv("SHOPIFY_ADMIN_ACCESS_TOKEN");
  const version = requireEnv("SHOPIFY_API_VERSION");

  const response = await fetch(
    `https://${shop}/admin/api/${version}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
    }
  );

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(
      `Shopify GraphQL error: ${response.status} ${response.statusText}`
    );
  }

  if (payload.errors?.length) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(payload.errors)}`);
  }

  return payload.data as T;
}
