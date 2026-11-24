/**
 * Cloudflare Pages Function: /api/shipping-quote
 * Cotiza envíos en México vía Skydropx + Envío Gratis (+$799 MXN) + Retiro Monterrey.
 *
 * Variables de entorno opcionales en Cloudflare Pages:
 *   SKYDROPX_API_KEY = xxxxxxxx (alternativa Skydropx)
 *   ORIGIN_ZIP      = 66200     (Monterrey / San Pedro Garza García, NL)
 */

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResp({ error: "Solicitud de envío inválida" }, 400);
  }
  const { destinationZip = "", subtotal = 0, weightKg = 0.5 } = body;
  const sub = Number(subtotal);
  const weight = Number(weightKg);
  if (!Number.isFinite(sub) || sub < 0 || !Number.isFinite(weight) || weight <= 0 ||
      (destinationZip !== "" && !/^\d{5}$/.test(String(destinationZip)))) {
    return jsonResp({ error: "Revisa el código postal, subtotal y peso" }, 400);
  }

  const options = [
    {
      id: "pickup-mty",
      carrier: "Panacea San Pedro (Lic. Benito Juárez Nte. 334, CP 66200)",
      service: "Retiro en tienda (listo en 2 horas — confirma por WhatsApp)",
      price: 0,
      days: "Hoy mismo",
    },
  ];

  if (sub >= 500) {
    options.unshift({
      id: "local-mty-free",
      carrier: "Envío Local Monterrey (radio 20 km)",
      service: "Entrega Local Gratis (+$500 MXN)",
      price: 0,
      days: "1–2 días hábiles",
    });
  }

  if (sub >= 799) {
    options.unshift({
      id: "free-mx",
      carrier: "Envío Nacional México",
      service: "Envío Gratis (+$799 MXN)",
      price: 0,
      days: "Despacho en máx. 2 días hábiles (L–V)",
    });
    return jsonResp({ options });
  }

  if (env.SKYDROPX_API_KEY && destinationZip) {
    try {
      const resp = await fetch("https://api.skydropx.com/v1/quotations", {
        method: "POST",
        headers: {
          Authorization: `Token token=${env.SKYDROPX_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          zip_from: env.ORIGIN_ZIP || "66200",
          zip_to: String(destinationZip),
          parcel: { weight, height: 15, width: 20, length: 20 },
        }),
      });
      const rates = await resp.json();
      const mapped = (Array.isArray(rates) ? rates : [])
        .filter((r) => Number(r.total_pricing) > 0)
        .slice(0, 4)
        .map((r) => ({
          id: r.id,
          carrier: r.provider,
          service: r.service_level_name,
          price: Math.ceil(Number(r.total_pricing)),
          days: `${r.days} días hábiles`,
        }));
      if (resp.ok && mapped.length) return jsonResp({ options: [...mapped, ...options] });
    } catch (_) {}
  }

  const tierPrice = sub >= 599 ? 99 : 159;
  options.unshift({
    id: sub >= 599 ? "tier-599" : "tier-base",
    carrier: "Paquetería Nacional México",
    service: sub >= 599 ? "Envío Nacional ($599–$798 MXN)" : "Envío Estándar Nacional",
    price: tierPrice,
    days: "Despacho en máx. 2 días hábiles (L–V)",
  });
  return jsonResp({ options });
}
