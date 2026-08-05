// Suscripción con doble opt-in vía Brevo.
// Variables de entorno en Netlify: BREVO_API_KEY, BREVO_LIST_ID, BREVO_DOI_TEMPLATE_ID
export default async (req) => {
  if (req.method !== "POST") {
    return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }
  const { BREVO_API_KEY, BREVO_LIST_ID, BREVO_DOI_TEMPLATE_ID } = process.env;
  const missing = [
    !BREVO_API_KEY && "BREVO_API_KEY",
    !BREVO_LIST_ID && "BREVO_LIST_ID",
    !BREVO_DOI_TEMPLATE_ID && "BREVO_DOI_TEMPLATE_ID",
  ].filter(Boolean);
  if (missing.length) {
    return Response.json({ ok: false, error: "not_configured", missing }, { status: 503 });
  }
  let email = "";
  try {
    const body = await req.json();
    email = String(body.email || "").trim().toLowerCase();
  } catch { /* body inválido */ }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return Response.json({ ok: false, error: "invalid_email" }, { status: 400 });
  }
  const r = await fetch("https://api.brevo.com/v3/contacts/doubleOptinConfirmation", {
    method: "POST",
    headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      includeListIds: [Number(BREVO_LIST_ID)],
      templateId: Number(BREVO_DOI_TEMPLATE_ID),
      redirectionUrl: "https://ugctravelcreator.com/confirmado",
    }),
  });
  if (r.status === 201 || r.status === 204) return Response.json({ ok: true });
  const detail = await r.text();
  console.error("Brevo error", r.status, detail);
  return Response.json({ ok: false, error: "brevo_error" }, { status: 502 });
};
