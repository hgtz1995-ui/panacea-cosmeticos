# Panacea Cosméticos — Nueva Tienda Independiente (0% Shopify)

Tienda web independiente, rápida y 100% adaptable (móvil y desktop) construida con todo el catálogo, artículos del blog e historia oficial de **Panacea Cosméticos** bajo dirección de arte *Botica Médica Mexicana*.

## Contenido del proyecto
- `index.html`, `styles.css`, `app.js` — Storefront completo con Quiz "Arma tu Rutina en 45 seg", filtros por necesidad de piel y categoría, PDP con galería/variantes/acordeones/suscripción (-10%), Diario de Botica (17 artículos SEO), carrito con barra de envío gratis ($799 MXN), upsells, cupones y checkout directo México.
- `data.js` & `catalog_backup.json` — Catálogo completo sincronizado desde Shopify + 17 artículos del blog + textos oficiales de *Nosotros* y *La Diosa*.
- `vercel.json` — Redirecciones **301 SEO** desde todas las URLs antiguas de Shopify (`/products/*`, `/collections/*`, `/blogs/news/*`, `/pages/*`) para no perder posicionamiento en Google al cancelar Shopify.
- `import_shopify_csv.py` — Importador en 1 comando para actualizar inventario, pesos/dimensiones, SKUs y variantes desde el CSV oficial de Shopify (`Productos → Exportar`).

## Cómo abrir en Google Chrome
```bash
cd /Users/macminih/flow/projects/archivista/panacea-web
python3 -m http.server 8080
```
Abre `http://localhost:8080` en **Google Chrome**.

## Cómo sincronizar el CSV oficial de Shopify (cuando lo exportes desde Admin)
```bash
python3 /Users/macminih/flow/projects/archivista/panacea-web/import_shopify_csv.py ~/Downloads/products_export.csv
```

## Cómo publicar gratis (0% Shopify) y conectar pagos/envíos reales
1. Subir la carpeta `panacea-web` a **Vercel** o **Cloudflare Pages** ($0/mes, SSL incluido, redirecciones 301 automáticas vía `vercel.json`).
2. Conectar **Mercado Pago Checkout Pro** o **Stripe** para cobrar Tarjetas, 3 y 6 MSI, OXXO y SPEI sin comisión extra de plataforma.
3. Conectar **Skydropx** o **Envia.com** para generación automática de guías (FedEx, Estafeta, DHL, 99minutos local MTY/CDMX).
4. Apuntar el dominio `panacea-cosmeticos.com` desde su proveedor DNS y cancelar la suscripción mensual de Shopify + apps.
