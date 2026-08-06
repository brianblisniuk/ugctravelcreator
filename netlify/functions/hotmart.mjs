// netlify/functions/hotmart.mjs
// Recibe el webhook de Hotmart y sincroniza compradores con las listas de Brevo.
//
// Variables de entorno necesarias en Netlify (solo DOS):
//   BREVO_API_KEY    -> la misma que ya usa /api/subscribe (revisá el nombre exacto ahí)
//   HOTMART_HOTTOK   -> el token que Hotmart muestra en la pantalla del webhook
//
// Las listas ya vienen puestas: Compradores Ebook = 8, Compradores Bundle = 9.
//
// Ruta pública: /api/hotmart  (ver redirect en netlify.toml al final del archivo)

const BREVO = "https://api.brevo.com/v3";

// ── Identificadores de producto ───────────────────────────────────────────────
// Hotmart manda varios: id numérico, ucode, y el código de oferta.
// Poné acá TODOS los que veas en el primer evento real (el log te los muestra).
const EBOOK_IDS = ["K106884716O"];   // Creador UGC de Viajes · USD 39
const BUNDLE_IDS = ["K106920373F"];  // Bundle Creador · USD 69

// Respaldo por NOMBRE del producto: si el id no coincide, se mira el nombre.
// Con esto la función funciona aunque Hotmart mande otros identificadores.
const BUNDLE_NOMBRE = /bundle/i;
const EBOOK_NOMBRE = /creador\s*ugc|guia|guía/i;

// TEMPORAL · solo para validar el circuito con los eventos de prueba de Hotmart.
// El producto ficticio "Produto test postback2" se trata como si fuera el ebook.
// BORRAR ESTA LÍNEA una vez verificado que entra y sale de la lista 8.
const TEST_NOMBRE = /produto\s*test\s*postback/i;

// Listas de Brevo (se pueden pisar con variables de entorno si algún día cambian)
const ID_LISTA_EBOOK = Number(process.env.LIST_EBOOK || 8);
const ID_LISTA_BUNDLE = Number(process.env.LIST_BUNDLE || 9);

// Eventos: se reconocen por patrón, no por nombre exacto, para no depender
// de la ortografía exacta que use Hotmart en cada versión de su webhook.
const ALTA_RE = /APPROVED|COMPLETE|APROBAD|COMPLETA/i;
const BAJA_RE = /REFUND|CHARGEBACK|CANCEL|PROTEST|EXPIRED|DISPUTE|REEMBOLS|CANCELAD/i;

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // 1 · Autenticación: Hotmart firma cada llamada con el hottok
  const hottok =
    event.headers["x-hotmart-hottok"] || event.headers["X-HOTMART-HOTTOK"];
  if (!process.env.HOTMART_HOTTOK || hottok !== process.env.HOTMART_HOTTOK) {
    console.warn("hotmart: hottok inválido o ausente");
    return { statusCode: 401, body: "Unauthorized" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: "Bad JSON" };
  }

  // 2 · Log completo del primer evento: acá vas a ver los ids reales del producto
  console.log("hotmart payload:", JSON.stringify(payload));

  const data = payload.data || payload;
  const evento = payload.event || payload.status || "";

  const email =
    data?.buyer?.email || data?.buyer_email || data?.subscriber?.email || null;
  const nombre =
    data?.buyer?.name || data?.buyer?.first_name || data?.buyer_name || "";

  if (!email) {
    console.warn("hotmart: evento sin email de comprador", evento);
    return { statusCode: 422, body: `evento sin email de comprador (${evento})` };
  }

  // 3 · Identificar el producto probando todos los campos posibles
  const candidatos = [
    data?.product?.id,
    data?.product?.ucode,
    data?.product?.code,
    data?.purchase?.offer?.code,
    data?.prod,
    data?.prod_ucode,
  ]
    .filter(Boolean)
    .map(String);

  const nombreProd = String(data?.product?.name || data?.prod_name || "");

  let esBundle = candidatos.some((c) => BUNDLE_IDS.includes(c));
  let esEbook = candidatos.some((c) => EBOOK_IDS.includes(c));

  // Si el id no coincidió, decidimos por el nombre del producto
  if (!esBundle && !esEbook) {
    if (BUNDLE_NOMBRE.test(nombreProd)) esBundle = true;
    else if (EBOOK_NOMBRE.test(nombreProd)) esEbook = true;
    else if (TEST_NOMBRE.test(nombreProd)) esEbook = true; // TEMPORAL, ver arriba
  }

  if (!esEbook && !esBundle) {
    console.warn("hotmart: producto no reconocido", candidatos, nombreProd, evento);
    return {
      statusCode: 422,
      body: `producto no mapeado: "${nombreProd}" ids=${candidatos.join(",")}`,
    };
  }

  const listId = esBundle ? ID_LISTA_BUNDLE : ID_LISTA_EBOOK;

  const headers = {
    "api-key": process.env.BREVO_API_KEY,
    "Content-Type": "application/json",
    accept: "application/json",
  };

  try {
    // 4a · ALTA — crea el contacto si no existe y lo mete en la lista
    if (ALTA_RE.test(evento)) {
      const r = await fetch(`${BREVO}/contacts`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          email,
          attributes: { NOMBRE: nombre },
          listIds: [listId],
          updateEnabled: true, // si ya existe, lo actualiza y lo suma a la lista
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        console.error("brevo alta falló", r.status, t);
        return { statusCode: 502, body: "brevo error" };
      }
      console.log(`hotmart: ${email} agregado a lista ${listId} (${evento})`);
      return { statusCode: 200, body: "ok alta" };
    }

    // 4b · BAJA — reembolso o cancelación: sale de la lista de compradores
    if (BAJA_RE.test(evento)) {
      const r = await fetch(`${BREVO}/contacts/lists/${listId}/contacts/remove`, {
        method: "POST",
        headers,
        body: JSON.stringify({ emails: [email] }),
      });
      // 404 = el contacto ya no estaba en la lista: para nosotros es éxito
      if (!r.ok && r.status !== 404) {
        const t = await r.text();
        console.error("brevo baja falló", r.status, t);
        return { statusCode: 502, body: `brevo baja error ${r.status}: ${t}` };
      }
      console.log(`hotmart: ${email} removido de lista ${listId} (${evento})`);
      return { statusCode: 200, body: "ok baja" };
    }

    // Evento que no da alta ni baja: devolvemos 422 a propósito, así el estatus
    // en Hotmart nos dice qué pasó en vez de mostrar un 200 engañoso.
    console.log("hotmart: evento no clasificado", evento);
    return { statusCode: 422, body: `evento no clasificado: ${evento}` };
  } catch (err) {
    console.error("hotmart: error inesperado", err);
    return { statusCode: 500, body: "error" };
  }
};

/* ─────────────────────────────────────────────────────────────────────────────
   En netlify.toml, junto al redirect que ya tenés para /api/subscribe:

   [[redirects]]
     from = "/api/hotmart"
     to = "/.netlify/functions/hotmart"
     status = 200

   Si tu función de Brevo actual usa otro nombre de variable para la API key
   (por ejemplo BREVO_KEY o SIB_API_KEY), cambiá process.env.BREVO_API_KEY
   por ese nombre para no duplicar credenciales.
───────────────────────────────────────────────────────────────────────────── */
