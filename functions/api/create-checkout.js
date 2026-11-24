import { saveOrder } from "./orders.js";
import { loadCatalog } from "./catalog.js";

const NATIONAL = "national";
const PICKUP = "pickup";

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function enabledProviders(env) {
  return {
    mercadopago: Boolean(env.PANACEA_KV && env.ADMIN_PIN && env.MERCADOPAGO_ACCESS_TOKEN),
    stripe: Boolean(env.PANACEA_KV && env.ADMIN_PIN && env.STRIPE_SECRET_KEY),
  };
}

export function onRequestGet({ env }) {
  return json(enabledProviders(env));
}

function priceOrder(catalog, items, coupon, delivery) {
  const byId = new Map(catalog.products.map(product => [product.id, product]));
  const lines = items.map(({ id, variant, qty, subscribe } = {}) => {
    const product = byId.get(id);
    if (!product?.available || subscribe || !Number.isInteger(qty) || qty < 1 || qty > 99) {
      throw new Error("Revisa la disponibilidad y la cantidad de tus productos. Las suscripciones se coordinan por WhatsApp.");
    }
    const variants = product.variants ?? [];
    const hasVariants = variants.length > 1;
    const option = hasVariants ? variants.find(entry => entry.name === variant) : product;
    if (!option || option.available === false || (!hasVariants && variant)) {
      throw new Error("Selecciona una presentación disponible para cada producto.");
    }
    const price = Math.round(Number(option.price) * 100);
    if (!Number.isSafeInteger(price) || price < 1) throw new Error("Hay un producto sin precio válido.");
    return {
      title: hasVariants ? `${product.title} (${option.name})` : product.title,
      qty,
      price,
    };
  });

  const subtotal = lines.reduce((total, line) => total + line.price * line.qty, 0);
  const coupons = catalog.coupons ?? {};
  const code = String(coupon ?? "").trim().toUpperCase();
  const rate = code && Object.hasOwn(coupons, code) ? Number(coupons[code].discount) : 0;
  if (!Number.isFinite(rate) || rate < 0 || rate >= 1) throw new Error("Cupón inválido.");
  const discount = Math.round(subtotal * rate / 100) * 100;
  const net = subtotal - discount;
  const threshold = Math.round(Number(catalog.freeShippingThreshold ?? 799) * 100);
  const shipping = delivery === PICKUP || net >= threshold ? 0 : net >= 59900 ? 9900 : 15900;
  const total = net + shipping;
  if (!Number.isSafeInteger(total) || net <= 0) throw new Error("Importe de pedido inválido.");

  return { lines, shipping, total };
}

export async function onRequestPost({ env, request }) {
  const input = await request.json().catch(() => null);
  if (!Array.isArray(input?.items) || !input.items.length || input.items.length > 50 ||
      input.items.some(item => !item || typeof item !== "object")) {
    return json({ error: "Carrito inválido" }, 400);
  }
  const { items, coupon, customer, delivery, provider = "auto", expectedTotal } = input;
  if (!["auto", "mercadopago", "stripe"].includes(provider)) {
    return json({ error: "Proveedor de pago inválido." }, 400);
  }
  const available = enabledProviders(env);
  const useStripe = provider === "stripe" || (provider === "auto" && !available.mercadopago);
  if (useStripe ? !available.stripe : !available.mercadopago) {
    return json({ error: "El pago en línea todavía no está disponible. Puedes continuar por WhatsApp." }, 503);
  }
  if (delivery !== NATIONAL && delivery !== PICKUP) {
    return json({ error: "Confirma esta modalidad de entrega por WhatsApp." }, 400);
  }

  const name = typeof customer?.name === "string" ? customer.name.trim().slice(0, 120) : "";
  const phone = typeof customer?.phone === "string" ? customer.phone.trim().slice(0, 40) : "";
  const address = typeof customer?.address === "string" ? customer.address.trim().slice(0, 400) : "";
  const zip = typeof customer?.zip === "string" ? customer.zip.trim() : "";
  if (!name || phone.replace(/\D/g, "").length < 10 ||
      (delivery === NATIONAL && (!address || !/^\d{5}$/.test(zip)))) {
    return json({ error: "Revisa los datos de contacto y de entrega." }, 400);
  }

  let catalog;
  try {
    catalog = await loadCatalog({ request, env });
  } catch {
    return json({ error: "El catálogo no está disponible para verificar precios." }, 503);
  }

  let quote;
  try {
    quote = priceOrder(catalog, items, coupon, delivery);
  } catch (error) {
    return json({ error: error.message }, 400);
  }
  if (!Number.isFinite(expectedTotal) || Math.round(expectedTotal * 100) !== quote.total) {
    return json({ error: "Cambió el importe del carrito. Revisa los precios y el envío antes de pagar." }, 409);
  }

  const siteUrl = new URL(env.SITE_URL || request.url).origin;
  const reference = `PANACEA-${crypto.randomUUID()}`;
  const title = delivery === PICKUP ? "Pedido Panacea · Retiro en tienda" : "Pedido Panacea · Envío nacional";
  const description = quote.lines.map(({ qty, title }) => `${qty} × ${title}`).join(" · ").slice(0, 255);
  const saveCheckout = async (provider, id, checkoutUrl) => {
    await saveOrder(env, {
      id: reference,
      status: "pendiente_pago",
      customerName: name,
      phone,
      delivery: delivery === PICKUP ? "Retiro en tienda" : "Envío nacional",
      address: delivery === NATIONAL ? address : "",
      zip: delivery === NATIONAL ? zip : "",
      payment: provider === "mercadopago" ? "Mercado Pago" : "Stripe",
      providerReference: id,
      coupon: String(coupon ?? "").slice(0, 40),
      total: quote.total / 100,
      items: quote.lines.map(line => ({ ...line, price: line.price / 100 })),
    });
    return json({ provider, id, reference, checkoutUrl });
  };
  try {
    if (!useStripe) {
      const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.MERCADOPAGO_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items: [{ id: reference, title, description, quantity: 1, unit_price: (quote.total - quote.shipping) / 100, currency_id: "MXN" }],
          payer: { name: name },
          shipments: { cost: quote.shipping / 100, mode: "not_specified" },
          payment_methods: { installments: 6 },
          back_urls: {
            success: `${siteUrl}/?pago=enviado`,
            pending: `${siteUrl}/?pago=pendiente`,
            failure: `${siteUrl}/?pago=error`,
          },
          auto_return: "approved",
          external_reference: reference,
          statement_descriptor: "PANACEA COSMETICOS",
        }),
      });
      const result = await response.json();
      const checkoutUrl = env.MERCADOPAGO_SANDBOX === "true" ? result.sandbox_init_point : result.init_point;
      if (response.ok && result.id && checkoutUrl) return await saveCheckout("mercadopago", result.id, checkoutUrl);
    } else {
      const form = new URLSearchParams({
        mode: "payment",
        success_url: `${siteUrl}/?pago=enviado`,
        cancel_url: `${siteUrl}/?pago=cancelado`,
        client_reference_id: reference,
        "payment_method_types[0]": "card",
        "payment_method_types[1]": "oxxo",
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "mxn",
        "line_items[0][price_data][unit_amount]": String(quote.total),
        "line_items[0][price_data][product_data][name]": title,
        "line_items[0][price_data][product_data][description]": description,
      });
      const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
        body: form,
      });
      const result = await response.json();
      if (response.ok && result.url) return await saveCheckout("stripe", result.id, result.url);
    }
  } catch {
    // The order stays in the cart when the provider is unavailable.
  }
  return json({ error: "No se pudo abrir el pago. Tu carrito sigue guardado." }, 502);
}
