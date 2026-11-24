/**
 * Cloudflare Pages Function: /api/catalog
 * Permite que el Backoffice (/admin.html) guarde cambios en tiempo real ($0/mes).
 *
 * Configuración en Cloudflare Pages (Settings -> Functions / Environment Variables):
 *   1. KV Namespace Binding: PANACEA_KV
 *   2. Secret:              ADMIN_PIN
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

export async function loadCatalog({ request, env }) {
  const asset = await env.ASSETS.fetch(new URL("/data.js", request.url));
  if (!asset.ok) throw new Error("Catálogo base no disponible");
  const source = (await asset.text()).match(/window\.PANACEA_DATA\s*=\s*([\s\S]*);\s*$/);
  const base = JSON.parse(source?.[1] ?? "");
  const override = await env.PANACEA_KV?.get(KV_KEY, { type: "json" });
  return { ...base, ...override };
}

export async function onRequestGet(context) {
  try {
    return jsonResp({
      catalog: await loadCatalog(context),
      requiresPin: true,
      backend: context.env.PANACEA_KV ? "Cloudflare Pages + KV en vivo" : "Cloudflare Pages (falta enlazar KV PANACEA_KV)",
    });
  } catch {
    return jsonResp({ error: "Catálogo no disponible" }, 503);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_PIN) {
    return jsonResp({ error: "Configura el acceso administrativo en Cloudflare Pages" }, 503);
  }
  const body = await request.json().catch(() => null);
  if (body?.action === "verifyPin") {
    if (String(body.pin) === String(env.ADMIN_PIN)) {
      return jsonResp({ ok: true });
    }
    return jsonResp({ ok: false, error: "PIN incorrecto" }, 401);
  }
  return jsonResp({ error: "Acción no soportada" }, 400);
}

export async function onRequestPut({ request, env }) {
  if (!env.ADMIN_PIN) {
    return jsonResp({ error: "Configura el acceso administrativo en Cloudflare Pages" }, 503);
  }
  if (request.headers.get("X-Admin-Pin") !== String(env.ADMIN_PIN)) {
    return jsonResp({ error: "No autorizado" }, 401);
  }
  if (!env.PANACEA_KV) {
    return jsonResp({ error: "Falta configurar PANACEA_KV en Cloudflare Pages" }, 500);
  }
  const data = await request.json().catch(() => null);
  if (!data || !Array.isArray(data.products)) {
    return jsonResp({ error: "Catálogo inválido" }, 400);
  }
  await env.PANACEA_KV.put(KV_KEY, JSON.stringify(data));
  return jsonResp({ ok: true, updatedAt: new Date().toISOString() });
}
