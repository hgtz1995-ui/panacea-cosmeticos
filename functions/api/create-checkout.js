/**
 * Cloudflare Pages Function: POST /api/create-checkout
 * Conecta directamente con Mercado Pago Checkout Pro (0% comisión Shopify).
 * Variables de entorno en Cloudflare Pages -> Settings -> Environment variables:
 *   MERCADOPAGO_ACCESS_TOKEN
 *   SITE_URL (ej. https://panacea-cosmeticos.com)
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  const token = env.MERCADOPAGO_ACCESS_TOKEN;
  const siteUrl = env.SITE_URL || "https://panacea-cosmeticos.com";

  if (!token) {
    return Response.json(
      { error: "Falta configurar MERCADOPAGO_ACCESS_TOKEN en Cloudflare Pages" },
      { status: 500 }
    );
  }

  try {
    const { items = [], shippingCost = 0, customer = {}, coupon = "" } = await request.json();
    if (!items.length) {
      return Response.json({ error: "Carrito vacío" }, { status: 400 });
    }

    const body = {
      items: items.map((item) => ({
        id: item.id,
        title: item.title,
        quantity: Number(item.qty || 1),
        unit_price: Number(item.price),
        currency_id: "MXN",
        picture_url: item.image || undefined,
      })),
      payer: {
        name: customer.name || "",
        email: customer.email || undefined,
      },
      shipments: {
        cost: Number(shippingCost || 0),
        mode: "not_specified",
      },
      payment_methods: {
        installments: 6,
      },
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
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await mpRes.json();
    if (!mpRes.ok) {
      return Response.json({ error: data.message || "Error Mercado Pago", details: data }, { status: mpRes.status });
    }

    return Response.json({
      id: data.id,
      checkoutUrl: data.init_point,
      sandboxUrl: data.sandbox_init_point,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
