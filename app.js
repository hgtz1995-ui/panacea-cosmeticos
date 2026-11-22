(() => {
  let { products = [], concerns = [], testimonials = [], articles = [], freeShippingThreshold, whatsappNumber, coupons, announcementText = "" } = window.PANACEA_DATA;

  async function hydrateLiveCatalog() {
    let live = null;
    try {
      const resp = await fetch("/api/catalog", { cache: "no-store" });
      if (resp.ok) {
        const json = await resp.json();
        if (json && json.catalog && Array.isArray(json.catalog.products)) live = json.catalog;
      }
    } catch (_) {}
    if (!live) {
      try {
        const raw = localStorage.getItem("panacea_catalog_override_v1");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.products)) live = parsed;
        }
      } catch (_) {}
    }
    if (!live) return;
    if (Array.isArray(live.products)) products = live.products;
    if (Array.isArray(live.concerns) && live.concerns.length) concerns = live.concerns;
    if (Array.isArray(live.testimonials)) testimonials = live.testimonials;
    if (Array.isArray(live.articles)) articles = live.articles;
    if (typeof live.freeShippingThreshold === "number") freeShippingThreshold = live.freeShippingThreshold;
    if (live.whatsappNumber) whatsappNumber = live.whatsappNumber;
    if (live.coupons && typeof live.coupons === "object") coupons = live.coupons;
    if (typeof live.announcementText === "string" && live.announcementText.trim()) announcementText = live.announcementText.trim();
  }

  function applyStoreSettings() {
    if (announcementText) {
      const bar = document.querySelector(".announcement");
      if (bar) bar.textContent = announcementText;
    }
    if (whatsappNumber) {
      document.querySelectorAll('a[href*="wa.me/"]').forEach((a) => {
        a.href = a.href.replace(/wa\.me\/\d+/, `wa.me/${whatsappNumber}`);
      });
    }
  }

  const state = {
    category: "all",
    concern: null,
    search: "",
    sort: "featured",
    visibleCount: 16,
    showAllArticles: false,
    cart: JSON.parse(localStorage.getItem("panacea_cart_v1") || "[]"),
    coupon: localStorage.getItem("panacea_coupon_v1") || "",
    quizStep: 0,
    quizAnswers: { concern: null, skinType: null, goal: null }
  };

  const mxn = (n) =>
    new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function saveCart() {
    localStorage.setItem("panacea_cart_v1", JSON.stringify(state.cart));
    localStorage.setItem("panacea_coupon_v1", state.coupon);
  }

  window.showToast = function showToast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  };

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ---------- Render Skin Concerns ---------- */
  function renderConcerns() {
    const grid = $("#concernsGrid");
    grid.innerHTML = concerns
      .map(
        (c) => `
      <article class="concern-card" data-concern="${c.id}" tabindex="0">
        <img src="${c.image}" alt="${escapeHtml(c.title)} — Panacea Cosméticos" loading="lazy" />
        <div class="concern-overlay">
          <span class="concern-pill">${escapeHtml(c.badge)}</span>
          <div>
            <h3>${escapeHtml(c.title)}</h3>
            <p>${escapeHtml(c.subtitle)}</p>
            <span class="concern-link">Ver fórmulas recomendadas →</span>
          </div>
        </div>
      </article>`
      )
      .join("");

    $$(".concern-card").forEach((card) => {
      card.addEventListener("click", () => {
        state.concern = card.dataset.concern;
        state.category = "all";
        state.visibleCount = 24;
        updateCategoryPills();
        renderProducts();
        $("#catalogo").scrollIntoView({ behavior: "smooth" });
      });
    });
  }

  /* ---------- Category Counts in Pills ---------- */
  function hydratePillCounts() {
    const counts = {
      all: products.length,
      best: products.filter((p) => p.bestSeller).length,
      kits: products.filter((p) => p.category === "kits").length,
      facial: products.filter((p) => p.category === "facial").length,
      tonicos: products.filter((p) => p.category === "tonicos").length,
      capilar: products.filter((p) => p.category === "capilar").length,
      corporal: products.filter((p) => p.category === "corporal").length,
      bebe: products.filter((p) => p.category === "bebe").length,
      higienicos: products.filter((p) => p.category === "higienicos").length
    };
    $$("#categoryPills .pill-btn").forEach((btn) => {
      const cat = btn.dataset.cat;
      const baseLabel = btn.dataset.label || btn.textContent.replace(/\s*\(\d+\)$/, "");
      btn.dataset.label = baseLabel;
      if (counts[cat] !== undefined) {
        btn.textContent = `${baseLabel} (${counts[cat]})`;
        btn.style.display = counts[cat] === 0 && cat !== "all" ? "none" : "";
      }
    });
  }

  /* ---------- Render Catalog ---------- */
  function getFilteredProducts() {
    let list = [...products];
    if (state.category === "best") list = list.filter((p) => p.bestSeller);
    else if (state.category !== "all") list = list.filter((p) => p.category === state.category);

    if (state.concern) list = list.filter((p) => (p.concerns || []).includes(state.concern));

    if (state.search.trim()) {
      const q = state.search.toLowerCase();
      list = list.filter((p) => {
        const accText = Object.values(p.accordions || {}).join(" ").toLowerCase();
        return (
          (p.title || "").toLowerCase().includes(q) ||
          (p.subtitle || "").toLowerCase().includes(q) ||
          (p.description || "").toLowerCase().includes(q) ||
          (p.productType || "").toLowerCase().includes(q) ||
          accText.includes(q)
        );
      });
    }

    if (state.sort === "price-asc") list.sort((a, b) => a.price - b.price);
    if (state.sort === "price-desc") list.sort((a, b) => b.price - a.price);
    if (state.sort === "alpha") list.sort((a, b) => a.title.localeCompare(b.title, "es"));

    return list;
  }

  function renderProducts() {
    const grid = $("#productsGrid");
    const loadMoreWrap = $("#loadMoreWrap");
    const list = getFilteredProducts();
    const visible = list.slice(0, state.visibleCount);
    const status = $("#catalogStatusText");

    const concernObj = concerns.find((c) => c.id === state.concern);
    status.innerHTML = concernObj
      ? `Filtrado por necesidad: <strong>${escapeHtml(concernObj.title)}</strong> (${list.length} fórmulas) · <a href="#catalogo" id="clearConcernBtn" style="color:var(--wax-red);text-decoration:underline;">Quitar filtro</a>`
      : `Catálogo completo importado desde Shopify: mostrando <strong>${visible.length} de ${list.length}</strong> fórmulas botánicas reales.`;

    const clearBtn = $("#clearConcernBtn");
    if (clearBtn) {
      clearBtn.addEventListener("click", (e) => {
        e.preventDefault();
        state.concern = null;
        renderProducts();
      });
    }

    if (!list.length) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px 0;">
        <p style="margin-bottom:12px;">No encontramos productos con ese filtro.</p>
        <button class="btn btn-outline btn-sm" id="emptyResetBtn">Mostrar todo el catálogo</button>
      </div>`;
      loadMoreWrap.innerHTML = "";
      $("#emptyResetBtn").addEventListener("click", () => {
        state.category = "all";
        state.concern = null;
        state.search = "";
        $("#searchInput").value = "";
        updateCategoryPills();
        renderProducts();
      });
      return;
    }

    grid.innerHTML = visible
      .map((p) => {
        const badgeClass = p.category === "kits" ? "badge-red" : p.badge === "Fórmula Médica" ? "badge-sage" : "";
        const msiText = p.price >= 1000 ? `o 6 MSI de ${mxn(p.price / 6)} sin intereses` : "";
        const hasVariants = p.variants && p.variants.length > 1;
        const ratingLine = p.reviews > 0
          ? `★★★★★ <span>${Number(p.rating || 5).toFixed(1)} (${p.reviews})</span>`
          : `★★★★★ <span>Fórmula Botica</span>`;
        return `
        <article class="product-card">
          <div class="product-img-wrap" data-open-pdp="${p.id}">
            <span class="product-badge ${badgeClass}">${escapeHtml(p.badge || "100% Natural")}</span>
            <img src="${p.image}" data-orig="${p.image}" data-hover="${p.hoverImage || p.image}" alt="${escapeHtml(p.title)}" loading="lazy" />
          </div>
          <div class="product-body">
            <div class="product-rating">${ratingLine}</div>
            <h3 class="product-title" data-open-pdp="${p.id}">${escapeHtml(p.title)}</h3>
            <p class="product-sub">${escapeHtml(p.subtitle)}</p>
            <div class="product-price-row">
              <span class="price-current">${mxn(p.price)} MXN</span>
              ${p.comparePrice ? `<span class="price-compare">${mxn(p.comparePrice)}</span>` : ""}
            </div>
            ${msiText ? `<div class="msi-note">${msiText}</div>` : ""}
            <div class="product-card-actions">
              ${
                p.available === false
                  ? `<button class="btn btn-outline" disabled style="opacity:0.6;cursor:not-allowed;">Agotado</button>`
                  : hasVariants
                    ? `<button class="btn btn-primary" data-open-pdp="${p.id}">Elegir opción</button>`
                    : `<button class="btn btn-primary" data-add-cart="${p.id}">Agregar</button>`
              }
              <button class="btn btn-outline" data-open-pdp="${p.id}">Ver</button>
            </div>
          </div>
        </article>`;
      })
      .join("");

    // Load more button if needed
    if (list.length > visible.length) {
      loadMoreWrap.innerHTML = `
        <button class="btn btn-outline" id="loadMoreBtn">
          Mostrar más productos (${list.length - visible.length} restantes)
        </button>`;
      $("#loadMoreBtn").addEventListener("click", () => {
        state.visibleCount += 24;
        renderProducts();
      });
    } else {
      loadMoreWrap.innerHTML = "";
    }

    // Hover image swap
    $$(".product-img-wrap img").forEach((img) => {
      if (img.dataset.hover && img.dataset.hover !== img.dataset.orig) {
        img.parentElement.addEventListener("mouseenter", () => (img.src = img.dataset.hover));
        img.parentElement.addEventListener("mouseleave", () => (img.src = img.dataset.orig));
      }
    });

    $$("[data-add-cart]").forEach((btn) =>
      btn.addEventListener("click", () => addToCart(btn.dataset.addCart, false))
    );
    $$("[data-open-pdp]").forEach((el) =>
      el.addEventListener("click", () => openPDP(el.dataset.openPdp))
    );
  }

  function updateCategoryPills() {
    $$("#categoryPills .pill-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.cat === state.category);
    });
  }

  /* ---------- Interactive Routine Quiz ---------- */
  function renderQuiz() {
    const panel = $("#quizPanel");

    if (state.quizStep === 0) {
      panel.innerHTML = `
        <div class="quiz-step-label">Paso 1 de 3 · Diagnóstico Rápido</div>
        <div class="quiz-question">¿Cuál es la prioridad #1 de tu piel hoy?</div>
        <div class="quiz-options">
          <button class="quiz-opt" data-q="concern" data-v="acne">Acné, poros o grasa<small>Brotes, brillo y marquitas</small></button>
          <button class="quiz-opt" data-q="concern" data-v="antiedad">Firmeza y líneas finas<small>Prevención o piel madura</small></button>
          <button class="quiz-opt" data-q="concern" data-v="manchas">Manchas o tono apagado<small>Sol, paño y luminosidad</small></button>
          <button class="quiz-opt" data-q="concern" data-v="sensible">Piel sensible o atópica<small>Rojeces, resequedad o dermatitis</small></button>
        </div>`;
    } else if (state.quizStep === 1) {
      panel.innerHTML = `
        <div class="quiz-step-label">Paso 2 de 3 · Tipo de Piel</div>
        <div class="quiz-question">¿Cómo sientes tu piel al mediodía?</div>
        <div class="quiz-options">
          <button class="quiz-opt" data-q="skinType" data-v="grasa">Brillosa en zona T o toda la cara<small>Tendencia a poros visibles</small></button>
          <button class="quiz-opt" data-q="skinType" data-v="seca">Tirante o reseca<small>Necesita nutrición constante</small></button>
          <button class="quiz-opt" data-q="skinType" data-v="mixta">Equilibrada / mixta<small>Algunas zonas secas, otras normales</small></button>
          <button class="quiz-opt" data-q="skinType" data-v="reactiva">Se enrojece fácilmente<small>Reacciona a productos comerciales</small></button>
        </div>`;
    } else if (state.quizStep === 2) {
      panel.innerHTML = `
        <div class="quiz-step-label">Paso 3 de 3 · Formato Ideal</div>
        <div class="quiz-question">¿Cómo prefieres iniciar tu cambio?</div>
        <div class="quiz-options">
          <button class="quiz-opt" data-q="goal" data-v="kit">Ritual completo (Kit)<small>Envío gratis + guía AM/PM</small></button>
          <button class="quiz-opt" data-q="goal" data-v="duo">Empezar con 1 esencial estrella<small>Probar el favorito primero</small></button>
        </div>`;
    } else {
      const recMap = {
        acne: { kit: "kit-anti-acne", duo: "sulfur" },
        antiedad: { kit: "kit-ritual-anti-edad", duo: "melatonina" },
        manchas: { kit: "kit-ritual-para-manchas", duo: "vitamina-c" },
        sensible: { kit: "kit-pieles-atopicas-auxiliar-en-rosacea-eczema-psoriasis-y-otras-dermatitis", duo: "calendula" }
      };
      const pickKey = state.quizAnswers.concern || "antiedad";
      const targetId = recMap[pickKey][state.quizAnswers.goal || "kit"];
      const prod = products.find((p) => p.id === targetId) || products.find((p) => (p.concerns || []).includes(pickKey)) || products[0];

      panel.innerHTML = `
        <div class="quiz-step-label">✓ Tu Recomendación de Botica</div>
        <div class="quiz-question">Tu fórmula ideal está lista</div>
        <div class="quiz-result-card">
          <img src="${prod.image}" alt="${escapeHtml(prod.title)}" />
          <div>
            <span class="quiz-coupon">Cupón desbloqueado: BIENVENIDA10 (10% OFF)</span>
            <h4>${escapeHtml(prod.title)}</h4>
            <p>${escapeHtml(prod.subtitle)} · <strong>${mxn(prod.price)} MXN</strong></p>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn btn-primary btn-sm" id="quizAddBtn">Agregar con 10% OFF</button>
              <button class="btn btn-outline btn-sm" id="quizRestartBtn">Repetir test</button>
            </div>
          </div>
        </div>`;

      $("#quizAddBtn").addEventListener("click", () => {
        state.coupon = "BIENVENIDA10";
        addToCart(prod.id, false);
        showToast("Rutina agregada con cupón BIENVENIDA10 aplicado");
      });
      $("#quizRestartBtn").addEventListener("click", () => {
        state.quizStep = 0;
        renderQuiz();
      });
      return;
    }

    $$(".quiz-opt").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.quizAnswers[btn.dataset.q] = btn.dataset.v;
        state.quizStep += 1;
        renderQuiz();
      });
    });
  }

  /* ---------- Reviews ---------- */
  function renderReviews() {
    $("#reviewsGrid").innerHTML = testimonials
      .map(
        (t) => `
      <article class="review-card">
        <div>
          <div class="review-stars">★★★★★</div>
          <p class="review-quote">"${escapeHtml(t.quote)}"</p>
        </div>
        <div class="review-meta">
          <strong>${escapeHtml(t.name)}</strong>
          <span>${escapeHtml(t.city)} · Usó <u>${escapeHtml(t.product)}</u></span>
          <div class="review-verified">✓ Compra verificada</div>
        </div>
      </article>`
      )
      .join("");
  }

  /* ---------- Blog / Diario de Botica ---------- */
  function renderBlog() {
    const grid = $("#blogGrid");
    const toggleBtn = $("#toggleAllArticlesBtn");
    if (!grid || !articles.length) return;

    const shown = state.showAllArticles ? articles : articles.slice(0, 6);
    if (toggleBtn) {
      toggleBtn.textContent = state.showAllArticles
        ? "Mostrar menos"
        : `Ver los ${articles.length} artículos`;
    }

    grid.innerHTML = shown
      .map(
        (a) => `
      <article class="blog-card" data-open-article="${a.slug}">
        ${a.image ? `<img src="${a.image}" alt="${escapeHtml(a.title)}" loading="lazy" />` : ""}
        <div class="blog-card-body">
          <div class="blog-date">${escapeHtml(a.date || "Botica Panacea")}</div>
          <h3>${escapeHtml(a.title)}</h3>
          <p>${escapeHtml(a.excerpt)}</p>
          <span style="font-size:0.8rem;font-weight:700;color:var(--wax-red);">Leer artículo completo →</span>
        </div>
      </article>`
      )
      .join("");

    $$("[data-open-article]").forEach((card) => {
      card.addEventListener("click", () => openArticle(card.dataset.openArticle));
    });
  }

  function openArticle(slug) {
    const a = articles.find((x) => x.slug === slug);
    if (!a) return;
    const modal = $("#pdpModal");
    modal.innerHTML = `
      <div class="article-reader">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;">
          <div>
            <span class="eyebrow" style="margin-bottom:6px;">Diario de Botica · ${escapeHtml(a.date)}</span>
            <h2 style="font-family:var(--font-serif);font-size:2rem;line-height:1.12;">${escapeHtml(a.title)}</h2>
          </div>
          <button class="close-btn" id="closeArtBtn" aria-label="Cerrar">✕</button>
        </div>
        ${a.image ? `<img src="${a.image}" alt="${escapeHtml(a.title)}" />` : ""}
        <div class="article-content">${escapeHtml(a.content || a.excerpt)}</div>
        <div style="margin-top:24px;padding-top:16px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
          <span style="font-size:0.84rem;color:var(--ink-muted);">¿Quieres incorporar este ingrediente a tu rutina?</span>
          <button class="btn btn-primary btn-sm" id="artToQuizBtn">Armar mi rutina en 45 seg →</button>
        </div>
      </div>`;
    $("#backdrop").classList.add("open");
    modal.classList.add("open");
    $("#closeArtBtn").addEventListener("click", closeAllOverlays);
    $("#artToQuizBtn").addEventListener("click", () => {
      closeAllOverlays();
      $("#quiz").scrollIntoView({ behavior: "smooth" });
    });
  }

  /* ---------- Product Detail Modal (PDP) ---------- */
  function openPDP(id) {
    const p = products.find((x) => x.id === id);
    if (!p) return;

    let subscribe = false;
    let activeImg = p.image;
    let selectedVariantIdx = 0;
    const modal = $("#pdpModal");
    const gallery = p.gallery && p.gallery.length ? p.gallery : [p.image];
    const hasVariants = p.variants && p.variants.length > 1;

    const draw = () => {
      const basePrice = hasVariants ? p.variants[selectedVariantIdx].price : p.price;
      const variantName = hasVariants ? p.variants[selectedVariantIdx].name : "";
      const unitPrice = subscribe ? Math.round(basePrice * 0.9) : basePrice;
      const accEntries = Object.entries(p.accordions || {});

      modal.innerHTML = `
        <div style="display:flex;justify-content:flex-end;padding:16px 20px 0;">
          <button class="close-btn" id="closePdpBtn" aria-label="Cerrar">✕</button>
        </div>
        <div class="pdp-grid" style="padding-top:8px;">
          <div>
            <img class="pdp-img" src="${activeImg}" alt="${escapeHtml(p.title)}" />
            ${
              gallery.length > 1
                ? `<div class="pdp-thumbs">
                    ${gallery
                      .map(
                        (g) =>
                          `<img class="pdp-thumb ${g === activeImg ? "active" : ""}" src="${g}" data-thumb="${g}" alt="Vista ${escapeHtml(p.title)}" />`
                      )
                      .join("")}
                   </div>`
                : ""
            }
            <div style="display:flex;gap:8px;margin-top:12px;font-size:0.78rem;color:var(--sage);font-weight:600;flex-wrap:wrap;">
              <span>✓ Retiro gratis en Monterrey (2h)</span>
              <span>·</span>
              <span>✓ Envío gratis +$799 MXN</span>
            </div>
          </div>
          <div>
            <span class="eyebrow" style="margin-bottom:6px;">${escapeHtml(p.badge || "Botica Panacea")}</span>
            <h2 style="font-family:var(--font-serif);font-size:1.95rem;line-height:1.1;">${escapeHtml(p.title)}</h2>
            <div class="product-rating" style="margin:6px 0 10px;">
              ★★★★★ <span>${p.reviews > 0 ? `${Number(p.rating || 5).toFixed(1)} · ${p.reviews} reseñas verificadas` : "Fórmula 100% natural verificada"}</span>
            </div>
            <div class="product-price-row">
              <span class="price-current" style="font-size:1.35rem;">${mxn(unitPrice)} MXN</span>
              ${subscribe ? `<span class="price-compare">${mxn(basePrice)} MXN</span>` : p.comparePrice ? `<span class="price-compare">${mxn(p.comparePrice)} MXN</span>` : ""}
            </div>
            ${basePrice >= 1000 ? `<div class="msi-note">Hasta 6 Meses Sin Intereses de ${mxn(unitPrice / 6)} MXN</div>` : ""}
            <p style="font-size:0.89rem;color:var(--ink-muted);margin-bottom:12px;white-space:pre-line;">${escapeHtml(p.description || p.subtitle)}</p>

            ${
              hasVariants
                ? `<div>
                    <div style="font-size:0.76rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--ink-muted);">Selecciona presentación / tono:</div>
                    <div class="variant-pills">
                      ${p.variants
                        .map(
                          (v, i) =>
                            `<button type="button" class="variant-btn ${i === selectedVariantIdx ? "active" : ""}" data-vidx="${i}">${escapeHtml(v.name)} · ${mxn(v.price)}</button>`
                        )
                        .join("")}
                    </div>
                  </div>`
                : ""
            }

            <div class="sub-options">
              <div class="sub-opt ${!subscribe ? "active" : ""}" id="optOnce">
                <span><strong>Compra única</strong></span>
                <strong>${mxn(basePrice)} MXN</strong>
              </div>
              <div class="sub-opt ${subscribe ? "active" : ""}" id="optSub">
                <span><strong>Suscríbete cada 45 días</strong> <small style="color:var(--wax-red);font-weight:700;">AHORRA 10%</small></span>
                <strong>${mxn(Math.round(basePrice * 0.9))} MXN</strong>
              </div>
            </div>

            <button class="btn btn-primary btn-block" id="pdpAddBtn" style="margin-bottom:16px;">
              Agregar al carrito — ${mxn(unitPrice)} MXN
            </button>

            <div class="pdp-accordion">
              ${
                accEntries.length
                  ? accEntries
                      .map(
                        ([k, v], idx) => `
                        <details ${idx === 0 ? "open" : ""}>
                          <summary>${escapeHtml(k)}</summary>
                          <p style="white-space:pre-line;">${escapeHtml(v)}</p>
                        </details>`
                      )
                      .join("")
                  : ""
              }
              <details ${accEntries.length === 0 ? "open" : ""}>
                <summary>Envíos, pagos y retiro en tienda</summary>
                <p>Envío gratis a todo México desde $799 MXN (Skydropx / FedEx / Estafeta). Mensajería local en Monterrey y CDMX. Retiro gratis listo en 2h en Monterrey. Aceptamos tarjetas (3 y 6 MSI), OXXO, SPEI, Kueski Pay y PayPal.</p>
              </details>
            </div>
          </div>
        </div>`;

      $("#closePdpBtn").addEventListener("click", closeAllOverlays);
      $$("[data-thumb]").forEach((th) => {
        th.addEventListener("click", () => {
          activeImg = th.dataset.thumb;
          draw();
        });
      });
      $$("[data-vidx]").forEach((vb) => {
        vb.addEventListener("click", () => {
          selectedVariantIdx = Number(vb.dataset.vidx);
          draw();
        });
      });
      $("#optOnce").addEventListener("click", () => {
        subscribe = false;
        draw();
      });
      $("#optSub").addEventListener("click", () => {
        subscribe = true;
        draw();
      });
      $("#pdpAddBtn").addEventListener("click", () => {
        addToCart(p.id, subscribe, variantName, basePrice);
        modal.classList.remove("open");
      });
    };

    draw();
    $("#backdrop").classList.add("open");
    modal.classList.add("open");
  }

  /* ---------- Cart Logic ---------- */
  function addToCart(id, subscribe = false, variantName = "", customBasePrice = null) {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    const base = customBasePrice || p.price;
    const key = `${id}:${variantName || "std"}:${subscribe ? "sub" : "once"}`;
    const existing = state.cart.find((item) => item.key === key);
    if (existing) {
      existing.qty += 1;
    } else {
      state.cart.push({
        key,
        id: p.id,
        title: variantName ? `${p.title} (${variantName})` : p.title,
        image: p.image,
        subscribe,
        price: subscribe ? Math.round(base * 0.9) : base,
        qty: 1
      });
    }
    saveCart();
    renderCart();
    openCart();
  }

  function updateQty(key, delta) {
    const idx = state.cart.findIndex((i) => i.key === key);
    if (idx === -1) return;
    state.cart[idx].qty += delta;
    if (state.cart[idx].qty <= 0) state.cart.splice(idx, 1);
    saveCart();
    renderCart();
  }

  function getTotals() {
    const subtotal = state.cart.reduce((acc, i) => acc + i.price * i.qty, 0);
    const couponObj = coupons[state.coupon.toUpperCase()];
    const discount = couponObj ? Math.round(subtotal * couponObj.discount) : 0;
    const afterDiscount = Math.max(0, subtotal - discount);
    const shipping = afterDiscount === 0 || afterDiscount >= freeShippingThreshold ? 0 : 129;
    return { subtotal, discount, afterDiscount, shipping, total: afterDiscount + shipping, couponObj };
  }

  function renderCart() {
    const count = state.cart.reduce((acc, i) => acc + i.qty, 0);
    $("#cartCount").textContent = count;
    $("#drawerCount").textContent = count;

    const { subtotal, discount, afterDiscount, shipping, total, couponObj } = getTotals();
    const missing = Math.max(0, freeShippingThreshold - afterDiscount);
    const pct = Math.min(100, (afterDiscount / freeShippingThreshold) * 100);

    $("#shippingMeter").innerHTML =
      missing > 0
        ? `Te faltan <strong>${mxn(missing)} MXN</strong> para desbloquear <strong>envío gratis a todo México</strong>
           <div class="meter-bar"><div class="meter-fill" style="width:${pct}%"></div></div>`
        : `<strong style="color:var(--sage);">✓ ¡Felicidades! Tienes envío gratis a todo México</strong>
           <div class="meter-bar"><div class="meter-fill unlocked" style="width:100%"></div></div>`;

    const container = $("#cartItemsContainer");
    if (!state.cart.length) {
      container.innerHTML = `
        <div style="text-align:center;padding:42px 12px;">
          <p style="font-family:var(--font-serif);font-size:1.45rem;margin-bottom:8px;">Tu carrito está vacío</p>
          <p style="font-size:0.86rem;color:var(--ink-muted);margin-bottom:18px;">Descubre nuestros favoritos o arma tu rutina personalizada.</p>
          <button class="btn btn-primary btn-sm" id="emptyCartQuizBtn">Hacer Quiz de Piel</button>
        </div>`;
      $("#emptyCartQuizBtn").addEventListener("click", () => {
        closeAllOverlays();
        $("#quiz").scrollIntoView({ behavior: "smooth" });
      });
    } else {
      const upsellCandidate = products.find(
        (p) => (p.id === "shampoo-solido-para-caida-de-romero" || p.id === "karite" || p.price <= 220) && !state.cart.some((i) => i.id === p.id)
      );
      container.innerHTML =
        state.cart
          .map(
            (item) => `
          <div class="cart-item">
            <img src="${item.image}" alt="${escapeHtml(item.title)}" />
            <div class="cart-item-info">
              <h4>${escapeHtml(item.title)}</h4>
              <div class="cart-item-meta">${item.subscribe ? "Suscripción cada 45 días (-10%)" : "Compra única"}</div>
              <div class="qty-row">
                <div class="qty-ctrl">
                  <button data-dec="${escapeHtml(item.key)}">−</button>
                  <span>${item.qty}</span>
                  <button data-inc="${escapeHtml(item.key)}">+</button>
                </div>
                <strong>${mxn(item.price * item.qty)} MXN</strong>
              </div>
            </div>
          </div>`
          )
          .join("") +
        (missing > 0 && upsellCandidate
          ? `<div class="upsell-box">
              <img src="${upsellCandidate.image}" alt="${escapeHtml(upsellCandidate.title)}" />
              <div style="flex:1;">
                <div style="font-size:0.72rem;color:var(--wax-red);font-weight:700;">COMPLETA TU ENVÍO GRATIS</div>
                <strong style="font-size:0.84rem;">${escapeHtml(upsellCandidate.title)}</strong>
                <div style="font-size:0.78rem;color:var(--ink-muted);">${mxn(upsellCandidate.price)} MXN</div>
              </div>
              <button class="btn btn-dark btn-sm" id="upsellAddBtn">+ Agregar</button>
            </div>`
          : "");

      $$("[data-dec]").forEach((b) => b.addEventListener("click", () => updateQty(b.dataset.dec, -1)));
      $$("[data-inc]").forEach((b) => b.addEventListener("click", () => updateQty(b.dataset.inc, 1)));
      const upBtn = $("#upsellAddBtn");
      if (upBtn && upsellCandidate) upBtn.addEventListener("click", () => addToCart(upsellCandidate.id, false));
    }

    $("#cartFooter").innerHTML = `
      <div class="coupon-row">
        <input type="text" id="couponInput" placeholder="Cupón (ej. BIENVENIDA10)" value="${escapeHtml(state.coupon)}" />
        <button class="btn btn-outline btn-sm" id="applyCouponBtn">Aplicar</button>
      </div>
      <div class="totals-line"><span>Subtotal</span><span>${mxn(subtotal)} MXN</span></div>
      ${discount ? `<div class="totals-line" style="color:var(--sage);"><span>Descuento (${couponObj.label})</span><span>−${mxn(discount)} MXN</span></div>` : ""}
      <div class="totals-line"><span>Envío estimado</span><span>${shipping === 0 ? "GRATIS" : mxn(shipping) + " MXN"}</span></div>
      <div class="totals-line grand"><span>Total</span><span>${mxn(total)} MXN</span></div>
      <button class="btn btn-primary btn-block" id="checkoutBtn" style="margin-top:12px;" ${!state.cart.length ? "disabled" : ""}>
        Finalizar compra (0% Shopify) →
      </button>`;

    $("#applyCouponBtn").addEventListener("click", () => {
      const code = $("#couponInput").value.trim().toUpperCase();
      if (!code) {
        state.coupon = "";
        saveCart();
        renderCart();
        return;
      }
      if (coupons[code]) {
        state.coupon = code;
        saveCart();
        renderCart();
        showToast(`Cupón ${code} aplicado (${coupons[code].label})`);
      } else {
        showToast("Cupón no válido. Prueba BIENVENIDA10");
      }
    });

    $("#checkoutBtn").addEventListener("click", openCheckout);
  }

  /* ---------- Checkout Independiente México ---------- */
  function openCheckout() {
    if (!state.cart.length) return;
    const { total, shipping } = getTotals();
    const modal = $("#checkoutModal");
    $("#cartDrawer").classList.remove("open");

    modal.innerHTML = `
      <div class="checkout-box">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <div>
            <span class="eyebrow" style="margin-bottom:4px;">Checkout Directo México</span>
            <h2 style="font-family:var(--font-serif);font-size:1.85rem;">Finaliza tu pedido Panacea</h2>
          </div>
          <button class="close-btn" id="closeCheckoutBtn">✕</button>
        </div>

        <form id="checkoutForm">
          <div class="checkout-grid">
            <div class="field-group">
              <label>Nombre completo</label>
              <input type="text" name="name" required placeholder="Ej. Ana Sofía Garza" />
            </div>
            <div class="field-group">
              <label>WhatsApp / Teléfono</label>
              <input type="tel" name="phone" required placeholder="81 1234 5678" />
            </div>
            <div class="field-group">
              <label>Tipo de entrega</label>
              <select name="delivery">
                <option value="Envío Nacional (Skydropx)">Envío Nacional México (${shipping === 0 ? "GRATIS" : mxn(shipping)})</option>
                <option value="Mensajería Local Monterrey / San Pedro">Mensajería Local Monterrey / San Pedro</option>
                <option value="Mensajería Local CDMX">Mensajería Local CDMX</option>
                <option value="Retiro en Tienda Panacea MTY (2 horas)">Retiro gratis en tienda Panacea MTY (listo en 2h)</option>
              </select>
            </div>
            <div class="field-group">
              <label>Método de pago</label>
              <select name="payment">
                <option value="Tarjeta / 3 y 6 MSI (Mercado Pago / Stripe)">Tarjeta Crédito/Débito o 3 y 6 MSI</option>
                <option value="OXXO / Transferencia SPEI">OXXO o Transferencia SPEI</option>
                <option value="Kueski Pay / Aplazo">Kueski Pay / Aplazo (Quincenas)</option>
                <option value="PayPal">PayPal</option>
                <option value="Efectivo contra entrega Monterrey">Efectivo contra entrega (solo Monterrey)</option>
              </select>
            </div>
          </div>

          <div style="background:var(--ivory);border:1px solid var(--border);border-radius:10px;padding:14px;margin:14px 0;font-size:0.86rem;">
            <strong>Resumen (${state.cart.reduce((a, i) => a + i.qty, 0)} artículos):</strong>
            ${state.cart.map((i) => `${i.qty}× ${escapeHtml(i.title)}`).join(" · ")}
            <div style="margin-top:6px;font-size:1rem;"><strong>Total a pagar: ${mxn(total)} MXN</strong></div>
          </div>

          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <button type="submit" class="btn btn-primary" style="flex:1;">Confirmar y enviar pedido por WhatsApp</button>
            <button type="button" class="btn btn-outline" id="demoPayBtn">Simular pago con Mercado Pago / Stripe</button>
          </div>
          <p style="font-size:0.74rem;color:var(--ink-muted);margin-top:10px;">
            * En producción este formulario conecta directo con API de Mercado Pago / Stripe (0% comisión Shopify) + Skydropx para guía automática.
          </p>
        </form>
      </div>`;

    $("#backdrop").classList.add("open");
    modal.classList.add("open");

    $("#closeCheckoutBtn").addEventListener("click", closeAllOverlays);

    $("#demoPayBtn").addEventListener("click", async () => {
      const form = $("#checkoutForm");
      const fd = new FormData(form);
      const { shipping } = getTotals();
      try {
        const res = await fetch("/api/create-checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: state.cart,
            shippingCost: shipping,
            coupon: state.coupon,
            customer: { name: fd.get("name") || "", phone: fd.get("phone") || "" }
          })
        });
        const data = await res.json();
        if (res.ok && data.checkoutUrl) {
          window.location.href = data.checkoutUrl;
          return;
        }
        showToast(data.error || "Conecta MERCADOPAGO_ACCESS_TOKEN en Vercel para cobrar en vivo.");
      } catch {
        showToast("Modo local: al desplegar en Vercel conecta directo con Mercado Pago (MSI, OXXO y SPEI).");
      }
    });

    $("#checkoutForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const lines = [
        `Hola Panacea, quiero confirmar mi pedido:`,
        ...state.cart.map((i) => `• ${i.qty}x ${i.title} (${mxn(i.price * i.qty)} MXN)`),
        state.coupon ? `Cupón: ${state.coupon}` : "",
        `Total: ${mxn(total)} MXN`,
        `Nombre: ${fd.get("name")}`,
        `Tel: ${fd.get("phone")}`,
        `Entrega: ${fd.get("delivery")}`,
        `Pago: ${fd.get("payment")}`
      ].filter(Boolean);
      const waUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(lines.join("\n"))}`;
      window.open(waUrl, "_blank", "noopener");
      showToast("Pedido estructurado listo en WhatsApp");
    });
  }

  function openCart() {
    $("#backdrop").classList.add("open");
    $("#cartDrawer").classList.add("open");
  }

  function closeAllOverlays() {
    $("#backdrop").classList.remove("open");
    $("#cartDrawer").classList.remove("open");
    $("#pdpModal").classList.remove("open");
    $("#checkoutModal").classList.remove("open");
  }

  /* ---------- SEO 301 Redirect Deep-Link Handler ---------- */
  function handleHashRoute() {
    const h = window.location.hash || "";
    if (h.startsWith("#producto=")) {
      const handle = decodeURIComponent(h.replace("#producto=", ""));
      if (products.some((p) => p.id === handle)) openPDP(handle);
    } else if (h.startsWith("#categoria=")) {
      state.category = h.replace("#categoria=", "");
      updateCategoryPills();
      renderProducts();
      $("#catalogo").scrollIntoView({ behavior: "smooth" });
    } else if (h.startsWith("#necesidad=")) {
      state.concern = h.replace("#necesidad=", "");
      renderProducts();
      $("#catalogo").scrollIntoView({ behavior: "smooth" });
    } else if (h.startsWith("#blog=")) {
      const slug = decodeURIComponent(h.replace("#blog=", ""));
      if (articles.some((a) => a.slug === slug)) openArticle(slug);
    }
  }

  /* ---------- Event Wiring ---------- */
  async function init() {
    await hydrateLiveCatalog();
    applyStoreSettings();
    hydratePillCounts();
    renderConcerns();
    renderQuiz();
    renderProducts();
    renderReviews();
    renderBlog();
    renderCart();
    handleHashRoute();

    window.addEventListener("hashchange", handleHashRoute);

    $$("#categoryPills .pill-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.category = btn.dataset.cat;
        state.visibleCount = 24;
        updateCategoryPills();
        renderProducts();
      });
    });

    $$("[data-quick-cat]").forEach((a) => {
      a.addEventListener("click", () => {
        state.category = a.dataset.quickCat;
        state.concern = null;
        state.visibleCount = 24;
        updateCategoryPills();
        renderProducts();
        $("#mobileNav").classList.remove("open");
      });
    });

    $("#resetFiltersLink").addEventListener("click", () => {
      state.category = "all";
      state.concern = null;
      state.search = "";
      state.visibleCount = 24;
      $("#searchInput").value = "";
      updateCategoryPills();
      renderProducts();
    });

    $("#searchInput").addEventListener("input", (e) => {
      state.search = e.target.value;
      state.visibleCount = 24;
      renderProducts();
    });

    $("#sortSelect").addEventListener("change", (e) => {
      state.sort = e.target.value;
      renderProducts();
    });

    $("#focusSearchBtn").addEventListener("click", () => {
      $("#catalogo").scrollIntoView({ behavior: "smooth" });
      setTimeout(() => $("#searchInput").focus(), 350);
    });

    const toggleArtBtn = $("#toggleAllArticlesBtn");
    if (toggleArtBtn) {
      toggleArtBtn.addEventListener("click", () => {
        state.showAllArticles = !state.showAllArticles;
        renderBlog();
      });
    }

    $("#openCartBtn").addEventListener("click", openCart);
    $("#closeCartBtn").addEventListener("click", closeAllOverlays);
    $("#backdrop").addEventListener("click", closeAllOverlays);

    $("#mobileMenuBtn").addEventListener("click", () => {
      $("#mobileNav").classList.toggle("open");
    });

    $("#newsletterForm").addEventListener("submit", (e) => {
      e.preventDefault();
      state.coupon = "BIENVENIDA10";
      saveCart();
      renderCart();
      e.target.reset();
      showToast("¡Bienvenido! Tu código BIENVENIDA10 (10% OFF) ya quedó activado en tu carrito.");
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAllOverlays();
    });
  }

  init();
})();
