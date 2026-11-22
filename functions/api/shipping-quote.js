/**
 * Cloudflare Pages Function: POST /api/shipping-quote
 * Cotiza envíos en México vía Skydropx + Envío Gratis >= $799 + Retiro en tienda MTY (2h).
 * Variables de entorno en Cloudflare Pages -> Settings -> Environment variables:
 *   SKYDROPX_API_KEY
 *   ORIGIN_ZIP (default: 66220)
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  const { destinationZip, subtotal = 0, weightKg = 0.5 } = await request.json();

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
    return Response.json({ options });
  }

  const apiKey = env.SKYDROPX_API_KEY;
  if (!apiKey || !destinationZip) {
    options.unshift({
      id: "flat-mx",
      carrier: "Paquetería Nacional",
      service: "Envío Estándar a todo México",
      price: 129,
      days: "2–4 días hábiles",
    });
    return Response.json({ options });
  }

  try {
    const resp = await fetch("https://api.skydropx.com/v1/quotations", {
      method: "POST",
      headers: {
        Authorization: `Token token=${apiKey}`,
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
    return Response.json({ options: [...mapped, ...options] });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
