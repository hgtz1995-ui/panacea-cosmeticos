/**
 * Cloudflare Pages Function: /api/orders
 * Recibe pedidos desde el checkout de la tienda (POST) y permite a tu tía
 * verlos y cambiarles el estado desde /admin.html (GET/PUT con ADMIN_PIN).
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

function isAuthed(request, env) {
  if (!env.ADMIN_PIN) return true;
  return (request.headers.get("X-Admin-Pin") || "") === String(env.ADMIN_PIN);
}

async function readOrders(env) {
  if (!env.PANACEA_KV) return [];
  const raw = await env.PANACEA_KV.get(ORDERS_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function onRequestGet({ request, env }) {
  if (!isAuthed(request, env)) return jsonResp({ error: "No autorizado" }, 401);
  return jsonResp({ orders: await readOrders(env) });
}

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null);
  if (!body || !body.customerName) return jsonResp({ error: "Pedido incompleto" }, 400);

  const orders = await readOrders(env);
  const order = {
    id: body.id || ("PED-" + String(Date.now()).slice(-6)),
    createdAt: body.createdAt || new Date().toISOString(),
    status: body.status || "nuevo",
    customerName: String(body.customerName).slice(0, 120),
    phone: String(body.phone || "").slice(0, 40),
    delivery: String(body.delivery || "").slice(0, 120),
    payment: String(body.payment || "").slice(0, 120),
    coupon: String(body.coupon || "").slice(0, 40),
    total: Number(body.total || 0),
    items: Array.isArray(body.items) ? body.items.slice(0, 50) : [],
    notes: String(body.notes || "").slice(0, 400),
  };
  orders.unshift(order);
  if (env.PANACEA_KV) {
    await env.PANACEA_KV.put(ORDERS_KEY, JSON.stringify(orders.slice(0, 500)));
  }
  return jsonResp({ ok: true, order }, 201);
}

export async function onRequestPut({ request, env }) {
  if (!isAuthed(request, env)) return jsonResp({ error: "No autorizado" }, 401);
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.orders)) return jsonResp({ error: "Lista inválida" }, 400);
  if (env.PANACEA_KV) {
    await env.PANACEA_KV.put(ORDERS_KEY, JSON.stringify(body.orders.slice(0, 500)));
  }
  return jsonResp({ ok: true });
}
