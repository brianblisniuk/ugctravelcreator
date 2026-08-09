// netlify/functions/brevo-events.mjs
// Recibe los eventos del webhook transaccional de Brevo (aperturas, clics,
// rebotes, quejas de spam) y los guarda en la tabla public.brevo_events
// del proyecto de Supabase.
//
// Variables de entorno necesarias en Netlify (scope: Functions):
//   SUPABASE_SERVICE_ROLE_KEY  -> Supabase → Project Settings → API → service_role
//   BREVO_WEBHOOK_TOKEN        -> una palabra secreta que inventes vos
//
// URL que hay que pegar en Brevo (con el token al final):
//   https://ugctravelcreator.com/api/brevo-events?token=TU_TOKEN

const SUPABASE_URL = "https://pptldpjwggrnbkvppolu.supabase.co";
const TABLA = "brevo_events";

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // 1 · Autenticación. Brevo no firma sus webhooks, así que usamos un token
  //     en la URL. Sin esto, cualquiera podría inyectar eventos falsos.
  const token =
    (event.queryStringParameters && event.queryStringParameters.token) || "";
  if (!process.env.BREVO_WEBHOOK_TOKEN || token !== process.env.BREVO_WEBHOOK_TOKEN) {
    console.warn("brevo-events: token inválido");
    return { statusCode: 401, body: "Unauthorized" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: "Bad JSON" };
  }

  // Brevo puede mandar un objeto suelto o un lote de eventos
  const eventos = Array.isArray(payload) ? payload : [payload];

  const filas = eventos.map((e) => {
    // La fecha viene como ts (epoch en segundos) o como date (texto)
    let cuando = null;
    if (typeof e.ts === "number") cuando = new Date(e.ts * 1000).toISOString();
    else if (typeof e.ts_event === "number") cuando = new Date(e.ts_event * 1000).toISOString();
    else if (e.date) {
      const d = new Date(String(e.date).replace(" ", "T"));
      if (!isNaN(d)) cuando = d.toISOString();
    }

    return {
      event: String(e.event || "desconocido"),
      email: e.email ? String(e.email).trim().toLowerCase() : null,
      subject: e.subject || null,
      tag: e.tag || (Array.isArray(e.tags) ? e.tags.join(",") : null),
      link: e.link || e.URL || null,
      reason: e.reason || null,
      message_id: e["message-id"] || e.message_id || null,
      event_at: cuando,
      raw: e,
    };
  });

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${TABLA}`, {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(filas),
    });

    if (!r.ok) {
      const t = await r.text();
      console.error("supabase error", r.status, t);
      // 502 hace que Brevo reintente el envío más tarde
      return { statusCode: 502, body: `supabase ${r.status}` };
    }

    console.log(`brevo-events: ${filas.length} evento(s) guardado(s)`);
    return { statusCode: 200, body: `ok ${filas.length}` };
  } catch (err) {
    console.error("brevo-events: error inesperado", err);
    return { statusCode: 500, body: "error" };
  }
};
