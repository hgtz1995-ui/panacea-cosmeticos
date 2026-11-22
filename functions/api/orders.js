/**
 * Cloudflare Pages Function: /api/orders
 * Guarda y administra pedidos de Panacea Cosméticos en Cloudflare KV ($0/mes).
 * Usa el mismo binding PANACEA_KV y secreto ADMIN_PIN que /api/catalog.
 */

const ORDERS_KEY = "panacea_orders_v1";

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function isAuthorized(request, env) {
  if (!env.ADMIN_PIN) return true;
  const sent = request.headers.get("X-Admin-Pin") || "";
  return sent === String(env.ADMIN_PIN);
}

export async function onRequestGet({ request, env }) {
  if (!isAuthorized(request, env)) {
    return jsonResp({ error: "No autorizado" }, 401);
  }
  if (!env.PANACEA_KV) {
    return jsonResp({ orders: [], note: "Falta enlazar PANACEA_KV" });
  }
  const raw = await env.PANACEA_KV.get(ORDERS_KEY);
  return jsonResp({ orders: raw ? JSON.parse(raw) : [] });
}

export async function onRequestPost({ request, env }) {
  if (!env.PANACEA_KV) {
    return jsonResp({ ok: false, error: "Falta enlazar PANACEA_KV" }, 500);
  }
  const order = await request.json().catch(() => null);
  if (!order || !Array.isArray(order.items) || !order.items.length) {
    return jsonResp({ error: "Pedido inválido" }, 400);
  }
  const raw = await env.PANACEA_KV.get(ORDERS_KEY);
  const list = raw ? JSON.parse(raw) : [];
  const cleanOrder = {
    id: String(order.id || "PED-" + String(Date.now()).slice(-6)),
    createdAt: order.createdAt || new Date().toISOString(),
    status: String(order.status || "nuevo"),
    customerName: String(order.customerName || "").slice(0, 120),
    phone: String(order.phone || "").slice(0, 40),
    delivery: String(order.delivery || "").slice(0, 120),
    payment: String(order.payment || "").slice(0, 120),
    coupon: String(order.coupon || "").slice(0, 40),
    total: Number(order.total || 0),
    items: order.items.slice(0, 50).map((i) => ({
      title: String(i.title || "").slice(0, 160),
      qty: Number(i.qty || 1),
      price: Number(i.price || 0),
    })),
  };
  list.unshift(cleanOrder);
  await env.PANACEA_KV.put(ORDERS_KEY, JSON.stringify(list.slice(0, 500)));
  return jsonResp({ ok: true, id: cleanOrder.id }, 201);
}

export async function onRequestPut({ request, env }) {
  if (!isAuthorized(request, env)) {
    return jsonResp({ error: "No autorizado" }, 401);
  }
  if (!env.PANACEA_KV) {
    return jsonResp({ error: "Falta enlazar PANACEA_KV" }, 500);
  }
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.orders)) {
    return jsonResp({ error: "Lista de pedidos inválida" }, 400);
  }
  await env.PANACEA_KV.put(ORDERS_KEY, JSON.stringify(body.orders.slice(0, 500)));
  return jsonResp({ ok: true });
}
