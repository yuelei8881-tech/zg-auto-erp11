const FORWARD_TO = "+16265080888";
const TWILIO_NUMBER = "+16265087198";

const xml = (body: string) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    headers: { "content-type": "text/xml; charset=utf-8" },
  });

const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const toBase64 = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)));

async function validTwilioSignature(
  url: string,
  params: URLSearchParams,
  signature: string,
) {
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!token || !signature) return false;

  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const payload = url + sorted.map(([key, value]) => `${key}${value}`).join("");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(token),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return toBase64(digest) === signature;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const params = new URLSearchParams(await request.text());
  const signature = request.headers.get("x-twilio-signature") ?? "";
  if (!(await validTwilioSignature(request.url, params, signature))) {
    return new Response("Invalid Twilio signature", { status: 403 });
  }

  const channel = new URL(request.url).searchParams.get("channel");
  if (channel === "voice") {
    return xml(
      `<Dial callerId="${TWILIO_NUMBER}" answerOnBridge="true" timeout="25">${FORWARD_TO}</Dial>`,
    );
  }

  if (channel === "sms") {
    const from = params.get("From") ?? "未知号码";
    const body = (params.get("Body") ?? "").trim();
    if (/^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT)$/i.test(body)) return xml("");

    const forwarded = `Z&G 客户短信\n来自 ${from}\n${body || "（无文字，可能含图片）"}`;
    return xml(`<Message to="${FORWARD_TO}">${escapeXml(forwarded)}</Message>`);
  }

  return new Response("Unknown channel", { status: 400 });
});
