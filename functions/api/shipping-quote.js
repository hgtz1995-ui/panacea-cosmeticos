/**
 * Cloudflare Pages Function: /api/shipping-quote
 * Cotiza envíos en México vía Envia.com o Skydropx + Envío Gratis (+$799 MXN) + Retiro Monterrey.
 *
 * Variables de entorno opcionales en Cloudflare Pages:
 *   ENVIA_API_KEY   = xxxxxxxx  (Envia.com — el proveedor ya detectado en Panacea)
 *   SKYDROPX_API_KEY = xxxxxxxx (alternativa Skydropx)
 *   ORIGIN_ZIP      = 66220     (Monterrey / San Pedro Garza García, NL)
 */

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function onRequestPost({ request, env }) {
  const { destinationZip = "", subtotal = 0, weightKg = 0.5 } = await request.json().catch(() => ({}));

  const options = [
    {
      id: "pickup-mty",
      carrier: "Panacea Monterrey",
      service: "Retiro en tienda (listo en 2 horas)",
      price: 0,
      days: "Hoy mismo",
    },
  ];

  if (Number(subtotal) >= 799) {
    options.unshift({
      id: "free-mx",
      carrier: "Envío Estándar México",
      service: "Envío Gratis (+$799 MXN)",
      price: 0,
      days: "2–4 días hábiles",
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
          zip_from: env.ORIGIN_ZIP || "66220",
          zip_to: String(destinationZip),
          parcel: { weight: Number(weightKg), height: 15, width: 20, length: 20 },
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
      if (mapped.length) return jsonResp({ options: [...mapped, ...options] });
    } catch (_) {}
  }

  options.unshift({
    id: "flat-mx",
    carrier: "Paquetería Nacional",
    service: "Envío Estándar a todo México",
    price: 129,
    days: "2–4 días hábiles",
  });
  return jsonResp({ options });
}
