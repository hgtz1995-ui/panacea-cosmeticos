/**
 * Vercel Serverless Function: /api/shipping-quote
 * Cotiza envíos reales en todo México vía Skydropx (FedEx, Estafeta, DHL, 99minutos).
 * Respeta automáticamente Envío Gratis >= $799 MXN y Retiro en Tienda Monterrey (2h).
 *
 * Variable de entorno requerida en Vercel:
 *   SKYDROPX_API_KEY=xxxxxxxx
 *   ORIGIN_ZIP=66200 (San Pedro Garza García / Monterrey, NL)
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { destinationZip, subtotal = 0, weightKg = 0.5 } = req.body || {};

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
    return res.status(200).json({ options });
  }

  const apiKey = process.env.SKYDROPX_API_KEY;
  if (!apiKey || !destinationZip) {
    options.unshift({
      id: "flat-mx",
      carrier: "Paquetería Nacional",
      service: "Envío Estándar a todo México",
      price: 129,
      days: "2–4 días hábiles",
    });
    return res.status(200).json({ options });
  }

  try {
    const resp = await fetch("https://api.skydropx.com/v1/quotations", {
      method: "POST",
      headers: {
        Authorization: `Token token=${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        zip_from: process.env.ORIGIN_ZIP || "66200",
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
    return res.status(200).json({ options: [...mapped, ...options] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
