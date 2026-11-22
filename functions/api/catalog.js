/**
 * Cloudflare Pages Function: /api/catalog
 * Permite que el Backoffice (/admin.html) guarde cambios en tiempo real ($0/mes).
 *
 * Configuración en Cloudflare Pages (Settings -> Functions / Environment Variables):
 *   1. KV Namespace Binding: PANACEA_KV
 *   2. Secret / Env var:     ADMIN_PIN  (ej. una clave fácil para tu tía)
 */

const KV_KEY = "panacea_catalog_v1";

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function onRequestGet({ env }) {
  const requiresPin = Boolean(env.ADMIN_PIN);
  if (!env.PANACEA_KV) {
    return jsonResp({
      catalog: null,
      requiresPin,
      backend: "Cloudflare Pages (falta enlazar KV PANACEA_KV)",
    });
  }
  const raw = await env.PANACEA_KV.get(KV_KEY);
  return jsonResp({
    catalog: raw ? JSON.parse(raw) : null,
    requiresPin,
    backend: "Cloudflare Pages + KV en vivo",
  });
}

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  if (body.action === "verifyPin") {
    if (!env.ADMIN_PIN || String(body.pin) === String(env.ADMIN_PIN)) {
      return jsonResp({ ok: true });
    }
    return jsonResp({ ok: false, error: "PIN incorrecto" }, 401);
  }
  return jsonResp({ error: "Acción no soportada" }, 400);
}

export async function onRequestPut({ request, env }) {
  if (env.ADMIN_PIN) {
    const sent = request.headers.get("X-Admin-Pin") || "";
    if (sent !== String(env.ADMIN_PIN)) {
      return jsonResp({ error: "No autorizado" }, 401);
    }
  }
  if (!env.PANACEA_KV) {
    return jsonResp({ error: "Falta configurar PANACEA_KV en Cloudflare Pages" }, 500);
  }
  const data = await request.json();
  if (!data || !Array.isArray(data.products)) {
    return jsonResp({ error: "Catálogo inválido" }, 400);
  }
  await env.PANACEA_KV.put(KV_KEY, JSON.stringify(data));
  return jsonResp({ ok: true, updatedAt: new Date().toISOString() });
}
