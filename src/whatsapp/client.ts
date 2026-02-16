type SendTextMessageArgs = {
  phoneNumberId: string;
  token: string;
  to: string;
  body: string;
  apiVersion?: string;
};

export async function sendTextMessage(args: SendTextMessageArgs): Promise<void> {
  const version = args.apiVersion ?? "v24.0";
  const url = `https://graph.facebook.com/${version}/${args.phoneNumberId}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: args.to,
      type: "text",
      text: { body: args.body },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`WhatsApp send failed (${response.status}): ${body}`);
  }
}
