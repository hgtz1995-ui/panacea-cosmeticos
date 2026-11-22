/**
 * Cloudflare Pages Function: /api/create-checkout
 * Soporta cobros reales en México (0% comisión Shopify):
 *  - Mercado Pago Checkout Pro (Tarjetas, 3 y 6 MSI, OXXO, SPEI, Saldo MP)
 *  - Stripe Checkout (Visa/MC/Amex, Apple Pay, Google Pay, OXXO)
 *
 * Variables de entorno en Cloudflare Pages (Settings -> Variables and Secrets):
 *   MERCADOPAGO_ACCESS_TOKEN = APP_USR-xxxxxxxx        (para Mercado Pago)
 *   STRIPE_SECRET_KEY        = sk_live_xxxxxxxx        (opcional, para Stripe)
 *   SITE_URL                 = https://panacea-cosmeticos.com
 */

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function onRequestPost({ request, env }) {
  const siteUrl = (env.SITE_URL || "https://panacea-cosmeticos.com").replace(/\/$/, "");
  const payload = await request.json().catch(() => ({}));
  const { items = [], shippingCost = 0, customer = {}, coupon = "", provider = "auto" } = payload;

  if (!Array.isArray(items) || !items.length) {
    return jsonResp({ error: "Carrito vacío" }, 400);
  }

  const useStripe = provider === "stripe" || (!env.MERCADOPAGO_ACCESS_TOKEN && env.STRIPE_SECRET_KEY);

  // 1) Mercado Pago Checkout Pro
  if (!useStripe && env.MERCADOPAGO_ACCESS_TOKEN) {
    const mpBody = {
      items: items.map((item) => ({
        id: String(item.id || "prod"),
        title: String(item.title || "Producto Panacea"),
        quantity: Number(item.qty || 1),
        unit_price: Number(item.price),
        currency_id: "MXN",
      })),
      payer: {
        name: customer.name || "",
        email: customer.email || undefined,
      },
      shipments: {
        cost: Number(shippingCost || 0),
        mode: "not_specified",
      },
      payment_methods: { installments: 6 },
      back_urls: {
        success: `${siteUrl}/?pago=aprobado`,
        pending: `${siteUrl}/?pago=pendiente`,
        failure: `${siteUrl}/?pago=error`,
      },
      auto_return: "approved",
      external_reference: `PANACEA-${Date.now()}${coupon ? "-" + coupon : ""}`,
      statement_descriptor: "PANACEA COSMETICOS",
    };

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.MERCADOPAGO_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(mpBody),
    });
    const data = await mpRes.json();
    if (!mpRes.ok) {
      return jsonResp({ error: data.message || "Error Mercado Pago", details: data }, mpRes.status);
    }
    return jsonResp({ provider: "mercadopago", id: data.id, checkoutUrl: data.init_point });
  }

  // 2) Stripe Checkout (Tarjetas, Apple Pay, Google Pay, OXXO)
  if (env.STRIPE_SECRET_KEY) {
    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("success_url", `${siteUrl}/?pago=aprobado`);
    form.set("cancel_url", `${siteUrl}/?pago=cancelado`);
    form.append("payment_method_types[0]", "card");
    form.append("payment_method_types[1]", "oxxo");
    items.forEach((item, i) => {
      form.set(`line_items[${i}][price_data][currency]`, "mxn");
      form.set(`line_items[${i}][price_data][product_data][name]`, String(item.title || "Producto Panacea"));
      form.set(`line_items[${i}][price_data][unit_amount]`, String(Math.round(Number(item.price) * 100)));
      form.set(`line_items[${i}][quantity]`, String(Number(item.qty || 1)));
    });
    if (Number(shippingCost) > 0) {
      const idx = items.length;
      form.set(`line_items[${idx}][price_data][currency]`, "mxn");
      form.set(`line_items[${idx}][price_data][product_data][name]`, "Envío Nacional México");
      form.set(`line_items[${idx}][price_data][unit_amount]`, String(Math.round(Number(shippingCost) * 100)));
      form.set(`line_items[${idx}][quantity]`, "1");
    }

    const stRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    const data = await stRes.json();
    if (!stRes.ok) {
      return jsonResp({ error: data.error?.message || "Error Stripe", details: data }, stRes.status);
    }
    return jsonResp({ provider: "stripe", id: data.id, checkoutUrl: data.url });
  }

  return jsonResp(
    { error: "Falta configurar MERCADOPAGO_ACCESS_TOKEN o STRIPE_SECRET_KEY en Cloudflare Pages." },
    501
  );
}
