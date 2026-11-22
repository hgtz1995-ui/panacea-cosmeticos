/**
 * Vercel Serverless Function: /api/create-checkout
 * Conecta directamente con Mercado Pago Checkout Pro (0% comisión Shopify).
 * Soporta Tarjetas (3 y 6 MSI), OXXO, SPEI y saldo Mercado Pago en México.
 *
 * Variable de entorno requerida en Vercel:
 *   MERCADOPAGO_ACCESS_TOKEN=APP_USR-xxxxxxxx
 *   SITE_URL=https://panacea-cosmeticos.com
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  const siteUrl = process.env.SITE_URL || "https://panacea-cosmeticos.com";
  if (!token) {
    return res.status(500).json({ error: "Falta configurar MERCADOPAGO_ACCESS_TOKEN" });
  }

  try {
    const { items = [], shippingCost = 0, customer = {}, coupon = "" } = req.body || {};
    if (!items.length) {
      return res.status(400).json({ error: "Carrito vacío" });
    }

    const mpItems = items.map((item) => ({
      id: item.id,
      title: item.title,
      quantity: Number(item.qty || 1),
      unit_price: Number(item.price),
      currency_id: "MXN",
      picture_url: item.image || undefined,
    }));

    const body = {
      items: mpItems,
      payer: {
        name: customer.name || "",
        email: customer.email || undefined,
      },
      shipments: {
        cost: Number(shippingCost || 0),
        mode: "not_specified",
      },
      payment_methods: {
        installments: 6, // Hasta 6 Meses Sin Intereses en México
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
      return res.status(mpRes.status).json({ error: data.message || "Error Mercado Pago", details: data });
    }

    return res.status(200).json({
      id: data.id,
      checkoutUrl: data.init_point,
      sandboxUrl: data.sandbox_init_point,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
