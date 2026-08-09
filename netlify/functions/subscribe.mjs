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
  let trampa = "";
  let transcurrido = null;
  try {
    const body = await req.json();
    email = String(body.email || "").trim().toLowerCase();
    trampa = String(body.ugc_hp || "").trim();
    transcurrido = typeof body.t === "number" ? body.t : null;
  } catch { /* body inválido */ }

  // Antibots. Respondemos ok:true a propósito: si el bot recibe un error,
  // reintenta con otra variante. Creyendo que funcionó, se va.
  if (trampa !== "") {
    console.warn("subscribe: campo trampa completado, descartado", email);
    return Response.json({ ok: true });
  }
  // Solo se evalúa si el navegador mandó la marca de tiempo. Si falta
  // (por ejemplo, alguien con el JS viejo en caché) se deja pasar.
  if (transcurrido !== null && transcurrido < 1500) {
    console.warn("subscribe: envío demasiado rápido, descartado", email, transcurrido);
    return Response.json({ ok: true });
  }
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
