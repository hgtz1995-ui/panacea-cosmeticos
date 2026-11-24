// Orders written by the old deployment are read from the legacy array.
const LEGACY_KEY = "panacea_orders_v1";
const ORDER_PREFIX = "panacea_order_v2:";
const STATUS = ["nuevo", "pendiente_pago", "pagado", "enviado", "entregado"];

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function isAuthorized(request, env) {
  return Boolean(env.ADMIN_PIN) && request.headers.get("X-Admin-Pin") === String(env.ADMIN_PIN);
}

export async function saveOrder(env, order) {
  await env.PANACEA_KV.put(
    ORDER_PREFIX + order.id,
    JSON.stringify({ createdAt: new Date().toISOString(), ...order }),
  );
}

export async function onRequestGet({ request, env }) {
  if (!isAuthorized(request, env)) return json({ error: "No autorizado" }, 401);
  const kv = env.PANACEA_KV;
  if (!kv) return json({ error: "Falta enlazar PANACEA_KV" }, 503);
  const legacy = await kv.get(LEGACY_KEY, { type: "json" }) ?? [];
  const orders = new Map(legacy.map(order => [order.id, order]));
  let cursor;
  do {
    const page = await kv.list({ prefix: ORDER_PREFIX, cursor, limit: 1000 });
    for (const { name, metadata } of page.keys) {
      if (metadata?.deleted) orders.delete(name.slice(ORDER_PREFIX.length));
    }
    const records = page.keys.filter(key => !key.metadata?.deleted);
    for (let i = 0; i < records.length; i += 100) {
      const batch = await kv.get(records.slice(i, i + 100).map(key => key.name), { type: "json" });
      for (const order of batch.values()) {
        if (order) orders.set(order.id, order);
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  const latest = [...orders.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return json({ orders: latest.slice(0, 500), individualUpdates: true });
}

export async function onRequestPost({ request, env }) {
  const kv = env.PANACEA_KV;
  if (!kv || !env.ADMIN_PIN) return json({ error: "Pedidos no configurados" }, 503);
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.items) || !body.items.length || body.items.length > 50 ||
      body.items.some(item => !item || typeof item.title !== "string" ||
        !Number.isInteger(item.qty) || item.qty < 1 || item.qty > 99)) {
    return json({ error: "Pedido inválido" }, 400);
  }

  const admin = isAuthorized(request, env);
  const id = typeof body.id === "string" && /^PED-[a-f0-9-]{8,36}$/i.test(body.id)
    ? body.id : "PED-" + crypto.randomUUID();
  if (await kv.get(ORDER_PREFIX + id)) return json({ ok: true, id });
  const text = (value, length) => typeof value === "string" ? value.trim().slice(0, length) : "";
  const total = Number(body.total);
  await saveOrder(env, {
    id,
    status: "nuevo",
    customerName: text(body.customerName, 120),
    phone: text(body.phone, 40),
    delivery: text(body.delivery, 120),
    address: text(body.address, 400),
    zip: text(body.zip, 5),
    payment: admin ? text(body.payment, 120) : "WhatsApp",
    coupon: text(body.coupon, 40),
    total: Number.isFinite(total) && total >= 0 ? total : 0,
    items: body.items.map(item => ({ title: text(item.title, 160), qty: item.qty })),
    notes: admin ? text(body.notes, 400) : "",
  });
  return json({ ok: true, id }, 201);
}

export async function onRequestPut({ request, env }) {
  if (!isAuthorized(request, env)) return json({ error: "No autorizado" }, 401);
  const kv = env.PANACEA_KV;
  if (!kv) return json({ error: "Falta enlazar PANACEA_KV" }, 503);
  const body = await request.json().catch(() => null);
  const id = body?.id;
  if (typeof id !== "string" || !id || id.length > 120 || (!body.remove && !STATUS.includes(body.status))) {
    return json({ error: "Cambio de pedido inválido" }, 400);
  }
  const key = ORDER_PREFIX + id;
  const record = await kv.getWithMetadata(key, { type: "json" });
  if (record.metadata?.deleted) return json({ error: "Pedido eliminado" }, 404);
  const legacy = record.value ? [] : await kv.get(LEGACY_KEY, { type: "json" }) ?? [];
  const order = record.value ?? legacy.find(entry => entry.id === id);
  if (!order) return json({ error: "Pedido no encontrado" }, 404);
  if (body.remove) {
    await kv.put(key, "{}", { metadata: { deleted: true } });
  } else if (order.status !== body.status) {
    if (order.status !== body.previousStatus) return json({ error: "El pedido ya cambió" }, 409);
    await saveOrder(env, { ...order, status: body.status });
  }
  return json({ ok: true });
}
