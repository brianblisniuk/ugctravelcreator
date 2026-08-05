/* ============================================================
   UGCTRAVELCREATOR.COM — popup de lead magnet + formularios
   ------------------------------------------------------------
   CIRCUITO DE LA GUÍA GRATUITA (doble opt-in):
   1. La visitante deja su email (popup o cualquier formulario).
   2. El email se guarda en Netlify Forms (respaldo) y se envía
      al proveedor de email marketing si FORM_ENDPOINT está
      configurado (MailerLite / Kit / Brevo).
   3. Redirigimos a gracias.html → "revisa tu email".
   4. El proveedor envía el email de confirmación (doble opt-in).
   5. Al confirmar, el proveedor redirige a /confirmado.html,
      la ÚNICA página con el botón de descarga del PDF.
   → Sin confirmar el email, no hay guía. La página confirmado.html
     no está enlazada desde ningún sitio y lleva noindex.
   ------------------------------------------------------------
   CONFIGURACIÓN:
   ============================================================ */
var UGC_CONFIG = {
  // Pega aquí el endpoint del formulario de tu herramienta de email.
  // Ejemplo Kit (ConvertKit): "https://app.kit.com/forms/XXXXXX/subscriptions"
  FORM_ENDPOINT: "",
  // Función serverless propia que dispara el doble opt-in de Brevo
  // conservando nuestro formulario y nuestro diseño. Ver netlify/functions/subscribe.mjs
  SUBSCRIBE_ENDPOINT: "/api/subscribe",
  POPUP_DELAY_MS: 9000,
  POPUP_SCROLL_PCT: 45,
  POPUP_COOLDOWN_H: 24
};

(function () {
  "use strict";

  function storeGet(k) {
    try { return window.localStorage.getItem(k); } catch (e) { return null; }
  }
  function storeSet(k, v) {
    try { window.localStorage.setItem(k, v); } catch (e) { /* sin persistencia */ }
  }

  /* ---------- popup ---------- */
  var popup = document.getElementById("ugc-popup");
  var overlay = document.getElementById("ugc-popup-overlay");
  var shown = false;

  function popupAllowed() {
    if (!popup) return false;
    if (document.body.classList.contains("no-popup")) return false;
    var last = parseInt(storeGet("ugc_popup_last") || "0", 10);
    return (Date.now() - last) > UGC_CONFIG.POPUP_COOLDOWN_H * 3600 * 1000;
  }

  function openPopup(force) {
    if (!popup || shown) return;
    if (!force && !popupAllowed()) return;
    shown = true;
    popup.classList.add("is-open");
    overlay.classList.add("is-open");
    storeSet("ugc_popup_last", String(Date.now()));
  }

  function closePopup() {
    if (!popup) return;
    popup.classList.remove("is-open");
    overlay.classList.remove("is-open");
  }

  if (popup) {
    setTimeout(function () { openPopup(false); }, UGC_CONFIG.POPUP_DELAY_MS);

    window.addEventListener("scroll", function onScroll() {
      var h = document.documentElement;
      var pct = (h.scrollTop / (h.scrollHeight - h.clientHeight)) * 100;
      if (pct >= UGC_CONFIG.POPUP_SCROLL_PCT) {
        openPopup(false);
        window.removeEventListener("scroll", onScroll);
      }
    }, { passive: true });

    document.addEventListener("mouseout", function (e) {
      if (!e.relatedTarget && e.clientY <= 0) openPopup(false);
    });

    overlay.addEventListener("click", closePopup);
    popup.querySelector(".ugc-popup-close").addEventListener("click", closePopup);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closePopup();
    });

    document.querySelectorAll(".js-open-popup").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.preventDefault();
        shown = false;
        openPopup(true);
      });
    });
  }

  /* ---------- envío de formularios de email ---------- */
  function submitToNetlifyForms(email) {
    // Respaldo: guarda el email en Netlify Forms (panel de Netlify → Forms).
    // Solo funciona con la web servida desde Netlify; en local falla en silencio.
    try {
      return fetch("/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "form-name=newsletter&email=" + encodeURIComponent(email)
      }).catch(function () {});
    } catch (e) { return Promise.resolve(); }
  }

  function submitToSubscribeFn(email) {
    if (!UGC_CONFIG.SUBSCRIBE_ENDPOINT) return Promise.resolve();
    try {
      return fetch(UGC_CONFIG.SUBSCRIBE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email })
      }).catch(function () {});
    } catch (e) { return Promise.resolve(); }
  }

  function submitToESP(email) {
    if (!UGC_CONFIG.FORM_ENDPOINT) return Promise.resolve();
    try {
      var data = new FormData();
      data.append("email_address", email);
      data.append("email", email);
      return fetch(UGC_CONFIG.FORM_ENDPOINT, { method: "POST", body: data, mode: "no-cors" })
        .catch(function () {});
    } catch (e) { return Promise.resolve(); }
  }

  document.querySelectorAll("form.ugc-subscribe").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = form.querySelector('input[type="email"]');
      if (!email || !email.value || email.value.indexOf("@") < 1) {
        email && email.focus();
        return;
      }
      var btn = form.querySelector("button");
      if (btn) { btn.disabled = true; btn.style.opacity = "0.6"; }

      Promise.all([submitToNetlifyForms(email.value), submitToSubscribeFn(email.value), submitToESP(email.value)])
        .then(function () { window.location.href = "gracias.html"; })
        .catch(function () { window.location.href = "gracias.html"; });
    });
  });
})();
