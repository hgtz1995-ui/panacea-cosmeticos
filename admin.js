(() => {
  const LS_KEY = "panacea_catalog_override_v1";
  const LS_ORDERS_KEY = "panacea_orders_v1";
  const PIN_KEY = "panacea_admin_pin_v1";
  const ORDER_FLOW = {
    nuevo: { label: "🟡 Nuevo", next: "pagado", nextBtn: "💚 Marcar como Pagado" },
    pagado: { label: "💚 Pagado", next: "enviado", nextBtn: "🚚 Marcar como Enviado" },
    enviado: { label: "🚚 Enviado", next: "entregado", nextBtn: "✅ Marcar Entregado" },
    entregado: { label: "✅ Entregado", next: null, nextBtn: null }
  };
  const CAT_LABELS = {
    kits: "🎁 Kits y Rituales",
    facial: "🧴 Facial",
    tonicos: "💧 Tónicos",
    capilar: "🌿 Capilar",
    corporal: "✨ Corporal",
    bebe: "👶 Bebés",
    higienicos: "🧼 Higiénicos"
  };

  let catalog = null;
  let orders = [];
  let orderFilter = "all";
  let undoStack = [];
  let storageMode = "local"; // "api" | "browser"
  let prodFilterStatus = "all";
  let prodSearchText = "";
  let prodCatFilter = "all";

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const mxn = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(Number(n || 0));

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function slugify(text) {
    return String(text || "producto")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || ("item-" + Date.now());
  }

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(window.__admToast);
    window.__admToast = setTimeout(() => el.classList.remove("show"), 2800);
  }

  function setSaveState(state, text) {
    const pill = $("#savePill");
    pill.className = "save-pill " + state;
    pill.textContent = text;
  }

  function pushUndo() {
    undoStack.push(JSON.stringify(catalog));
    if (undoStack.length > 20) undoStack.shift();
    $("#undoBtn").disabled = undoStack.length === 0;
  }

  function cloneBaseData() {
    const d = JSON.parse(JSON.stringify(window.PANACEA_DATA || {}));
    if (!d.products) d.products = [];
    if (!d.coupons) d.coupons = {};
    if (!d.testimonials) d.testimonials = [];
    if (!d.articles) d.articles = [];
    if (!d.freeShippingThreshold) d.freeShippingThreshold = 799;
    if (!d.whatsappNumber) d.whatsappNumber = "528110188422";
    if (!d.announcementText) {
      d.announcementText = "Envío gratis a todo México desde $799 MXN · Retiro listo en 2h en Monterrey · Código BIENVENIDA10 (10% OFF)";
    }
    return d;
  }

  /* ---------- Load & Save (API Cloudflare/Local + Fallback navegador) ---------- */
  async function loadCatalog() {
    try {
      const resp = await fetch("/api/catalog", { cache: "no-store" });
      if (resp.ok) {
        const json = await resp.json();
        storageMode = "api";
        if (json.requiresPin && !sessionStorage.getItem(PIN_KEY)) {
          showPinScreen();
        }
        if (json.catalog && Array.isArray(json.catalog.products)) {
          catalog = Object.assign(cloneBaseData(), json.catalog);
          updateStorageInfo(json.backend || "Servidor en vivo");
          return;
        }
        catalog = cloneBaseData();
        updateStorageInfo(json.backend || "Servidor en vivo");
        return;
      }
    } catch (_) {
      // Sin backend activo: modo vista previa local
    }
    storageMode = "browser";
    const saved = localStorage.getItem(LS_KEY);
    if (saved) {
      try {
        catalog = Object.assign(cloneBaseData(), JSON.parse(saved));
      } catch (_) {
        catalog = cloneBaseData();
      }
    } else {
      catalog = cloneBaseData();
    }
    updateStorageInfo("Modo vista previa en este navegador (para guardar directo al archivo, abre con python3 server.py o sube a Cloudflare Pages).");
  }

  function updateStorageInfo(desc) {
    const el = $("#storageModeInfo");
    if (el) el.textContent = desc;
  }

  async function saveCatalog(successMsg = "✅ Cambios guardados") {
    catalog.updatedAt = new Date().toISOString();
    setSaveState("saving", "⏳ Guardando...");
    localStorage.setItem(LS_KEY, JSON.stringify(catalog));

    if (storageMode === "api") {
      try {
        const headers = { "Content-Type": "application/json" };
        const pin = sessionStorage.getItem(PIN_KEY);
        if (pin) headers["X-Admin-Pin"] = pin;

        const resp = await fetch("/api/catalog", {
          method: "PUT",
          headers,
          body: JSON.stringify(catalog)
        });
        if (resp.status === 401) {
          sessionStorage.removeItem(PIN_KEY);
          showPinScreen("Tu clave venció o es incorrecta. Escríbela de nuevo.");
          setSaveState("error", "🔐 Falta tu clave");
          return false;
        }
        if (!resp.ok) throw new Error("Error guardando");
      } catch (err) {
        setSaveState("error", "⚠️ Guardado solo en este navegador");
        toast("Guardado en este navegador (no respondió el servidor)");
        return false;
      }
    }

    setSaveState("saved", "✅ Todo guardado");
    toast(successMsg);
    renderAll();
    return true;
  }

  /* ---------- PIN Screen ---------- */
  function showPinScreen(errMsg) {
    $("#pinScreen").classList.remove("hidden");
    const err = $("#pinError");
    if (errMsg) {
      err.textContent = errMsg;
      err.classList.remove("hidden");
    } else {
      err.classList.add("hidden");
    }
    setTimeout(() => $("#pinInput").focus(), 100);
  }

  $("#pinForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pin = $("#pinInput").value.trim();
    if (!pin) return;
    try {
      const resp = await fetch("/api/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verifyPin", pin })
      });
      if (resp.ok) {
        sessionStorage.setItem(PIN_KEY, pin);
        $("#pinScreen").classList.add("hidden");
        $("#pinInput").value = "";
        toast("¡Bienvenida a Mi Tienda Panacea!");
      } else {
        $("#pinError").textContent = "Clave incorrecta. Intenta de nuevo.";
        $("#pinError").classList.remove("hidden");
      }
    } catch (_) {
      sessionStorage.setItem(PIN_KEY, pin);
      $("#pinScreen").classList.add("hidden");
    }
  });

  /* ---------- Image Upload & Compression ---------- */
  function compressImage(file, maxSide = 900) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          let w = img.width;
          let h = img.height;
          if (w > maxSide || h > maxSide) {
            if (w >= h) { h = Math.round((h * maxSide) / w); w = maxSide; }
            else { w = Math.round((w * maxSide) / h); h = maxSide; }
          }
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.82));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function handlePhotoUpload(file, targetInput, previewImg) {
    if (!file) return;
    toast("Preparando foto...");
    try {
      const dataUrl = await compressImage(file, 900);
      let finalUrl = dataUrl;
      if (storageMode === "api") {
        try {
          const headers = { "Content-Type": "application/json" };
          const pin = sessionStorage.getItem(PIN_KEY);
          if (pin) headers["X-Admin-Pin"] = pin;
          const up = await fetch("/api/upload", {
            method: "POST",
            headers,
            body: JSON.stringify({ filename: file.name, dataUrl })
          });
          if (up.ok) {
            const j = await up.json();
            if (j.url) finalUrl = j.url;
          }
        } catch (_) {
          // Si no existe /api/upload (ej. sin R2), usa la foto comprimida directamente
        }
      }
      targetInput.value = finalUrl;
      if (previewImg) previewImg.src = finalUrl;
      toast("📷 Foto lista");
    } catch (_) {
      toast("No se pudo leer esa foto. Intenta con JPG o PNG.");
    }
  }

  /* ---------- Navigation ---------- */
  function switchTab(tabId) {
    $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.tab === tabId));
    $$(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + tabId));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  $$(".nav-item").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));

  /* ---------- Render Home ---------- */
  function renderHome() {
    const total = catalog.products.length;
    const avail = catalog.products.filter((p) => p.available !== false).length;
    const soldout = total - avail;
    const couponCount = Object.keys(catalog.coupons || {}).length;

    $("#navProdCount").textContent = total;
    $("#navCouponCount").textContent = couponCount;

    $("#homeStats").innerHTML = `
      <div class="stat-card">
        <div class="stat-lbl">✅ Productos activos</div>
        <div class="stat-num" style="color:var(--green);">${avail}</div>
        <div class="stat-lbl">de ${total} en total</div>
      </div>
      <div class="stat-card">
        <div class="stat-lbl">⛔ Agotados</div>
        <div class="stat-num" style="color:${soldout ? "var(--red)" : "var(--ink)"};">${soldout}</div>
        <div class="stat-lbl">${soldout ? "puedes encenderlos en 1 clic" : "todo en existencia"}</div>
      </div>
      <div class="stat-card">
        <div class="stat-lbl">🏷️ Cupones activos</div>
        <div class="stat-num">${couponCount}</div>
        <div class="stat-lbl">descuentos vigentes</div>
      </div>
      <div class="stat-card">
        <div class="stat-lbl">🚚 Envío gratis desde</div>
        <div class="stat-num">${mxn(catalog.freeShippingThreshold)}</div>
        <div class="stat-lbl">a todo México</div>
      </div>
    `;
  }

  /* ---------- Render Products ---------- */
  function renderProducts() {
    let list = [...catalog.products];
    if (prodFilterStatus === "available") list = list.filter((p) => p.available !== false);
    if (prodFilterStatus === "soldout") list = list.filter((p) => p.available === false);
    if (prodFilterStatus === "best") list = list.filter((p) => p.bestSeller);
    if (prodCatFilter !== "all") list = list.filter((p) => p.category === prodCatFilter);

    if (prodSearchText.trim()) {
      const q = prodSearchText.toLowerCase();
      list = list.filter(
        (p) =>
          (p.title || "").toLowerCase().includes(q) ||
          (p.subtitle || "").toLowerCase().includes(q) ||
          (p.badge || "").toLowerCase().includes(q)
      );
    }

    const wrap = $("#productsList");
    if (!list.length) {
      wrap.innerHTML = `<div class="card" style="text-align:center;padding:40px;">
        <p style="font-size:1.1rem;font-weight:700;">No hay productos con ese filtro.</p>
        <p class="hint" style="margin:6px 0 16px;">Prueba borrar la búsqueda o tocar "Todos".</p>
        <button class="big-btn btn-outline" id="resetProdFiltersBtn">Ver todos mis productos</button>
      </div>`;
      $("#resetProdFiltersBtn").addEventListener("click", () => {
        prodFilterStatus = "all";
        prodCatFilter = "all";
        prodSearchText = "";
        $("#prodSearch").value = "";
        $("#prodCatFilter").value = "all";
        $$("#prodStatusPills .pill").forEach((b) => b.classList.toggle("active", b.dataset.filter === "all"));
        renderProducts();
      });
      return;
    }

    wrap.innerHTML = list
      .map((p) => {
        const isAvail = p.available !== false;
        return `
        <article class="prod-row ${isAvail ? "" : "is-soldout"}">
          <img class="prod-thumb" src="${esc(p.image || "")}" alt="${esc(p.title)}" loading="lazy" />
          <div class="prod-info">
            <h3>${esc(p.title)}</h3>
            <div class="prod-meta">
              <span class="cat-tag">${CAT_LABELS[p.category] || p.category || "Tienda"}</span>
              ${p.comparePrice ? `<span>Antes ${mxn(p.comparePrice)}</span>` : ""}
              ${p.variants && p.variants.length > 1 ? `<span>${p.variants.length} tamaños</span>` : ""}
            </div>
          </div>
          <label class="quick-price-box" title="Cambia el precio directo aquí">
            <span>$</span>
            <input type="number" class="quick-price-input" min="0" step="1" value="${Number(p.price || 0)}" data-quick-price="${esc(p.id)}" />
            <span>MXN</span>
          </label>
          <button class="status-toggle-btn ${isAvail ? "on" : "off"}" data-toggle-avail="${esc(p.id)}">
            ${isAvail ? "✅ Disponible" : "⛔ Agotado"}
          </button>
          <div class="row-btns">
            <button class="star-btn ${p.bestSeller ? "active" : ""}" data-toggle-best="${esc(p.id)}" title="Marcar como Más Vendido">
              ${p.bestSeller ? "⭐" : "☆"}
            </button>
            <button class="big-btn btn-outline btn-sm" data-edit-prod="${esc(p.id)}">✏️ Editar</button>
          </div>
        </article>`;
      })
      .join("");

    // Eventos en cada fila
    $$("[data-toggle-avail]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const p = catalog.products.find((x) => x.id === btn.dataset.toggleAvail);
        if (!p) return;
        pushUndo();
        p.available = p.available === false ? true : false;
        saveCatalog(p.available ? `✅ "${p.title}" ya está disponible` : `⛔ "${p.title}" marcado como agotado`);
      })
    );

    $$("[data-toggle-best]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const p = catalog.products.find((x) => x.id === btn.dataset.toggleBest);
        if (!p) return;
        pushUndo();
        p.bestSeller = !p.bestSeller;
        saveCatalog(p.bestSeller ? `⭐ "${p.title}" agregado a Más Vendidos` : `"${p.title}" quitado de Más Vendidos`);
      })
    );

    $$("[data-quick-price]").forEach((inp) =>
      inp.addEventListener("change", () => {
        const p = catalog.products.find((x) => x.id === inp.dataset.quickPrice);
        const val = Math.max(0, Number(inp.value || 0));
        if (!p || val === Number(p.price)) return;
        pushUndo();
        p.price = val;
        saveCatalog(`💰 Precio de "${p.title}" actualizado a ${mxn(val)}`);
      })
    );

    $$("[data-edit-prod]").forEach((btn) =>
      btn.addEventListener("click", () => openProductModal(btn.dataset.editProd))
    );
  }

  /* ---------- Product Modal ---------- */
  function setCategoryChoice(cat) {
    $("#pfCategory").value = cat || "facial";
    $$("#pfCategoryChoices .choice-btn").forEach((b) => b.classList.toggle("selected", b.dataset.cat === (cat || "facial")));
  }

  function setConcernChoices(list) {
    const arr = Array.isArray(list) ? list : [];
    $$("#pfConcernChoices .choice-btn").forEach((b) => b.classList.toggle("selected", arr.includes(b.dataset.concern)));
  }

  function renderVariantRows(variants) {
    const wrap = $("#variantsContainer");
    wrap.innerHTML = "";
    (variants || []).forEach((v) => addVariantRow(v.name || v.title || "", v.price || ""));
  }

  function addVariantRow(name = "", price = "") {
    const row = document.createElement("div");
    row.className = "variant-row";
    row.innerHTML = `
      <input type="text" class="var-name" placeholder="Ej. 30 ml o Chico" value="${esc(name)}" />
      <input type="number" class="var-price" min="0" step="1" placeholder="$ Precio" value="${esc(price)}" />
      <button type="button" class="big-btn btn-danger btn-sm var-remove">✕</button>
    `;
    row.querySelector(".var-remove").addEventListener("click", () => row.remove());
    $("#variantsContainer").appendChild(row);
  }

  function updateAvailLabel() {
    $("#pfAvailableLabel").textContent = $("#pfAvailable").checked
      ? "✅ Disponible para vender"
      : "⛔ Agotado (no se puede comprar)";
  }

  function openProductModal(prodId) {
    const p = prodId ? catalog.products.find((x) => x.id === prodId) : null;
    $("#prodModalTitle").textContent = p ? "Editar producto" : "➕ Nuevo producto";
    $("#pfId").value = p ? p.id : "";
    $("#pfTitle").value = p ? p.title || "" : "";
    $("#pfPrice").value = p ? p.price ?? "" : "";
    $("#pfComparePrice").value = p && p.comparePrice ? p.comparePrice : "";
    $("#pfAvailable").checked = p ? p.available !== false : true;
    $("#pfBestSeller").checked = p ? !!p.bestSeller : false;
    updateAvailLabel();

    $("#pfImage").value = p ? p.image || "" : "";
    $("#pfImagePreview").src = p && p.image ? p.image : "";
    $("#pfHoverImage").value = p ? p.hoverImage || "" : "";
    $("#pfHoverPreview").src = p && p.hoverImage ? p.hoverImage : "";

    setCategoryChoice(p ? p.category : "facial");
    setConcernChoices(p ? p.concerns : []);

    $("#pfBadge").value = p ? p.badge || "100% Natural" : "Nuevo";
    $("#pfSubtitle").value = p ? p.subtitle || "" : "";
    $("#pfDescription").value = p ? p.description || "" : "";
    renderVariantRows(p ? p.variants : []);

    $("#duplicateProductBtn").classList.toggle("hidden", !p);
    $("#deleteProductBtn").classList.toggle("hidden", !p);

    $("#productModal").classList.remove("hidden");
    setTimeout(() => $("#pfTitle").focus(), 80);
  }

  function closeProductModal() {
    $("#productModal").classList.add("hidden");
  }

  $("#pfAvailable").addEventListener("change", updateAvailLabel);
  $("#pfImage").addEventListener("input", (e) => ($("#pfImagePreview").src = e.target.value));
  $("#pfHoverImage").addEventListener("input", (e) => ($("#pfHoverPreview").src = e.target.value));
  $("#pfImageFile").addEventListener("change", (e) => handlePhotoUpload(e.target.files[0], $("#pfImage"), $("#pfImagePreview")));
  $("#pfHoverFile").addEventListener("change", (e) => handlePhotoUpload(e.target.files[0], $("#pfHoverImage"), $("#pfHoverPreview")));

  $$("#pfCategoryChoices .choice-btn").forEach((b) =>
    b.addEventListener("click", () => setCategoryChoice(b.dataset.cat))
  );
  $$("#pfConcernChoices .choice-btn").forEach((b) =>
    b.addEventListener("click", () => b.classList.toggle("selected"))
  );

  $("#addVariantBtn").addEventListener("click", () => addVariantRow("", $("#pfPrice").value || ""));
  $("#closeProductModal").addEventListener("click", closeProductModal);
  $("#cancelProductBtn").addEventListener("click", closeProductModal);

  $("#productForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const existingId = $("#pfId").value;
    const title = $("#pfTitle").value.trim();
    const price = Math.max(0, Number($("#pfPrice").value || 0));
    const compareRaw = $("#pfComparePrice").value.trim();
    const comparePrice = compareRaw ? Number(compareRaw) : null;
    const image = $("#pfImage").value.trim();
    const hoverImage = $("#pfHoverImage").value.trim() || image;
    const concerns = $$("#pfConcernChoices .choice-btn.selected").map((b) => b.dataset.concern);
    const variants = $$("#variantsContainer .variant-row")
      .map((r) => ({
        name: r.querySelector(".var-name").value.trim(),
        price: Number(r.querySelector(".var-price").value || price)
      }))
      .filter((v) => v.name);

    pushUndo();

    if (existingId) {
      const p = catalog.products.find((x) => x.id === existingId);
      if (p) {
        p.title = title;
        p.price = price;
        p.comparePrice = comparePrice;
        p.available = $("#pfAvailable").checked;
        p.bestSeller = $("#pfBestSeller").checked;
        p.image = image;
        p.hoverImage = hoverImage;
        p.gallery = Array.from(new Set([image, hoverImage, ...(p.gallery || [])].filter(Boolean)));
        p.category = $("#pfCategory").value || "facial";
        p.concerns = concerns;
        p.badge = $("#pfBadge").value.trim() || "100% Natural";
        p.subtitle = $("#pfSubtitle").value.trim();
        p.description = $("#pfDescription").value.trim();
        p.variants = variants;
      }
      closeProductModal();
      saveCatalog(`💾 "${title}" guardado`);
    } else {
      let id = slugify(title);
      if (catalog.products.some((x) => x.id === id)) id += "-" + Math.floor(Math.random() * 900 + 100);
      catalog.products.unshift({
        id,
        title,
        subtitle: $("#pfSubtitle").value.trim() || "Fórmula 100% natural de Panacea Cosméticos",
        category: $("#pfCategory").value || "facial",
        productType: "",
        concerns,
        price,
        comparePrice,
        available: $("#pfAvailable").checked,
        bestSeller: $("#pfBestSeller").checked,
        badge: $("#pfBadge").value.trim() || "Nuevo",
        rating: 5.0,
        reviews: 0,
        image,
        hoverImage,
        gallery: [image, hoverImage].filter(Boolean),
        description: $("#pfDescription").value.trim(),
        accordions: {},
        variants
      });
      closeProductModal();
      saveCatalog(`🎉 Producto "${title}" agregado a tu tienda`);
    }
  });

  $("#duplicateProductBtn").addEventListener("click", () => {
    const id = $("#pfId").value;
    const orig = catalog.products.find((x) => x.id === id);
    if (!orig) return;
    pushUndo();
    const copy = JSON.parse(JSON.stringify(orig));
    copy.id = slugify(orig.title) + "-copia-" + Math.floor(Math.random() * 90 + 10);
    copy.title = orig.title + " (Copia)";
    catalog.products.unshift(copy);
    closeProductModal();
    saveCatalog(`📋 Se creó copia de "${orig.title}"`);
    openProductModal(copy.id);
  });

  $("#deleteProductBtn").addEventListener("click", () => {
    const id = $("#pfId").value;
    const p = catalog.products.find((x) => x.id === id);
    if (!p) return;
    if (!confirm(`¿Segura que quieres borrar "${p.title}"?\n\nSi cambias de opinión, puedes tocar "Deshacer" arriba.`)) return;
    pushUndo();
    catalog.products = catalog.products.filter((x) => x.id !== id);
    closeProductModal();
    saveCatalog(`🗑️ "${p.title}" borrado (puedes deshacer arriba)`);
  });

  /* ---------- Coupons ---------- */
  function renderCoupons() {
    const wrap = $("#couponsList");
    const entries = Object.entries(catalog.coupons || {});
    if (!entries.length) {
      wrap.innerHTML = `<div class="card"><p class="hint">Todavía no tienes cupones activos. Crea uno arriba en 5 segundos.</p></div>`;
      return;
    }
    wrap.innerHTML = entries
      .map(
        ([code, info]) => `
        <div class="coupon-card">
          <div class="coupon-code-tag">${esc(code)}</div>
          <strong>${Math.round(Number(info.discount || 0) * 100)}% de descuento</strong>
          <p class="hint">${esc(info.label || "")}</p>
          <div style="display:flex;gap:8px;margin-top:8px;">
            <button type="button" class="big-btn btn-outline btn-sm" data-copy-coupon="${esc(code)}">📋 Copiar código</button>
            <button type="button" class="big-btn btn-danger btn-sm" data-del-coupon="${esc(code)}">🗑️ Quitar</button>
          </div>
        </div>`
      )
      .join("");

    $$("[data-copy-coupon]").forEach((b) =>
      b.addEventListener("click", () => {
        navigator.clipboard?.writeText(b.dataset.copyCoupon);
        toast(`📋 Código "${b.dataset.copyCoupon}" copiado`);
      })
    );
    $$("[data-del-coupon]").forEach((b) =>
      b.addEventListener("click", () => {
        const code = b.dataset.delCoupon;
        if (!confirm(`¿Quitar el cupón "${code}"?`)) return;
        pushUndo();
        delete catalog.coupons[code];
        saveCatalog(`🗑️ Cupón "${code}" eliminado`);
      })
    );
  }

  $$(".mini-chip").forEach((c) =>
    c.addEventListener("click", () => {
      $("#couponPct").value = c.dataset.pct;
    })
  );

  $("#couponForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const code = $("#couponCode").value.trim().toUpperCase().replace(/\s+/g, "");
    const pct = Math.min(90, Math.max(1, Number($("#couponPct").value || 10)));
    const label = $("#couponLabel").value.trim() || `${pct}% OFF en tu compra`;
    if (!code) return;
    pushUndo();
    catalog.coupons[code] = { discount: Number((pct / 100).toFixed(2)), label };
    e.target.reset();
    $("#couponPct").value = "10";
    saveCatalog(`🏷️ Cupón "${code}" (${pct}% OFF) creado`);
  });

  /* ---------- Store Settings & Reviews ---------- */
  function renderStoreSettings() {
    $("#settingAnnouncement").value = catalog.announcementText || "";
    $("#bannerPreview").textContent = catalog.announcementText || "(Sin texto)";
    $("#settingShipping").value = catalog.freeShippingThreshold ?? 799;
    $("#settingWhatsapp").value = catalog.whatsappNumber || "528110188422";
    const integ = catalog.integrations || {};
    if ($("#settingGa4")) $("#settingGa4").value = integ.ga4Id || "G-WTJDDNZHX2";
    if ($("#settingKlaviyo")) $("#settingKlaviyo").value = integ.klaviyoId || "XnsDsN";
    if ($("#settingMetaPixel")) $("#settingMetaPixel").value = integ.metaPixelId || "";
    if ($("#settingTiktokPixel")) $("#settingTiktokPixel").value = integ.tiktokPixelId || "";

    const revWrap = $("#reviewsAdminList");
    revWrap.innerHTML = (catalog.testimonials || [])
      .map(
        (t, idx) => `
        <div class="simple-row">
          <div class="simple-row-main">
            <strong>★★★★★ ${esc(t.name)} · ${esc(t.city)} (${esc(t.product)})</strong>
            <p>"${esc(t.quote)}"</p>
          </div>
          <button type="button" class="big-btn btn-outline btn-sm" data-edit-rev="${idx}">✏️ Editar</button>
        </div>`
      )
      .join("");

    $$("[data-edit-rev]").forEach((b) =>
      b.addEventListener("click", () => openReviewModal(Number(b.dataset.editRev)))
    );
  }

  $("#settingAnnouncement").addEventListener("input", (e) => {
    $("#bannerPreview").textContent = e.target.value || "(Sin texto)";
  });

  $("#storeSettingsForm").addEventListener("submit", (e) => {
    e.preventDefault();
    pushUndo();
    catalog.announcementText = $("#settingAnnouncement").value.trim();
    catalog.freeShippingThreshold = Math.max(0, Number($("#settingShipping").value || 799));
    catalog.whatsappNumber = $("#settingWhatsapp").value.replace(/\D/g, "") || "528110188422";
    catalog.integrations = {
      ga4Id: ($("#settingGa4")?.value || "G-WTJDDNZHX2").trim(),
      klaviyoId: ($("#settingKlaviyo")?.value || "XnsDsN").trim(),
      metaPixelId: ($("#settingMetaPixel")?.value || "").trim(),
      tiktokPixelId: ($("#settingTiktokPixel")?.value || "").trim()
    };
    saveCatalog("📢 Configuración de tu tienda guardada");
  });

  /* ---------- Review Modal ---------- */
  function openReviewModal(idx) {
    const isEdit = typeof idx === "number" && idx >= 0;
    const t = isEdit ? catalog.testimonials[idx] : null;
    $("#rfIdx").value = isEdit ? String(idx) : "";
    $("#rfName").value = t ? t.name : "";
    $("#rfCity").value = t ? t.city : "Monterrey, NL";
    $("#rfProduct").value = t ? t.product : "";
    $("#rfQuote").value = t ? t.quote : "";
    $("#deleteReviewBtn").classList.toggle("hidden", !isEdit);
    $("#reviewModal").classList.remove("hidden");
  }
  const closeReviewModal = () => $("#reviewModal").classList.add("hidden");
  $("#addReviewBtn").addEventListener("click", () => openReviewModal(-1));
  $("#closeReviewModal").addEventListener("click", closeReviewModal);
  $("#cancelReviewBtn").addEventListener("click", closeReviewModal);

  $("#reviewForm").addEventListener("submit", (e) => {
    e.preventDefault();
    pushUndo();
    const obj = {
      name: $("#rfName").value.trim(),
      city: $("#rfCity").value.trim(),
      product: $("#rfProduct").value.trim(),
      productId: "",
      quote: $("#rfQuote").value.trim()
    };
    const idxStr = $("#rfIdx").value;
    if (idxStr !== "") catalog.testimonials[Number(idxStr)] = obj;
    else catalog.testimonials.unshift(obj);
    closeReviewModal();
    saveCatalog("💬 Opinión guardada");
  });

  $("#deleteReviewBtn").addEventListener("click", () => {
    const idx = Number($("#rfIdx").value);
    if (!confirm("¿Borrar esta opinión?")) return;
    pushUndo();
    catalog.testimonials.splice(idx, 1);
    closeReviewModal();
    saveCatalog("🗑️ Opinión borrada");
  });

  /* ---------- Blog Articles ---------- */
  function renderArticles() {
    const wrap = $("#articlesAdminList");
    wrap.innerHTML = (catalog.articles || [])
      .map(
        (a) => `
        <div class="simple-row">
          ${a.image ? `<img class="simple-row-thumb" src="${esc(a.image)}" alt="" />` : ""}
          <div class="simple-row-main">
            <strong>${esc(a.title)}</strong>
            <p>${esc(a.date || "")} · ${esc((a.excerpt || "").slice(0, 95))}</p>
          </div>
          <button type="button" class="big-btn btn-outline btn-sm" data-edit-art="${esc(a.slug)}">✏️ Editar</button>
        </div>`
      )
      .join("");

    $$("[data-edit-art]").forEach((b) =>
      b.addEventListener("click", () => openArticleModal(b.dataset.editArt))
    );
  }

  function openArticleModal(slug) {
    const a = slug ? catalog.articles.find((x) => x.slug === slug) : null;
    $("#artModalTitle").textContent = a ? "Editar artículo" : "➕ Nuevo artículo";
    $("#afSlug").value = a ? a.slug : "";
    $("#afTitle").value = a ? a.title : "";
    $("#afDate").value = a && a.date ? a.date : new Date().toISOString().slice(0, 10);
    $("#afImage").value = a ? a.image || "" : "";
    $("#afExcerpt").value = a ? a.excerpt || "" : "";
    $("#afContent").value = a ? a.content || "" : "";
    $("#deleteArticleBtn").classList.toggle("hidden", !a);
    $("#articleModal").classList.remove("hidden");
  }
  const closeArticleModal = () => $("#articleModal").classList.add("hidden");
  $("#addArticleBtn").addEventListener("click", () => openArticleModal(null));
  $("#closeArticleModal").addEventListener("click", closeArticleModal);
  $("#cancelArticleBtn").addEventListener("click", closeArticleModal);
  $("#afImageFile").addEventListener("change", (e) => handlePhotoUpload(e.target.files[0], $("#afImage"), null));

  $("#articleForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const existing = $("#afSlug").value;
    const title = $("#afTitle").value.trim();
    const content = $("#afContent").value.trim();
    const obj = {
      slug: existing || slugify(title),
      title,
      date: $("#afDate").value || new Date().toISOString().slice(0, 10),
      image: $("#afImage").value.trim(),
      excerpt: $("#afExcerpt").value.trim() || content.slice(0, 130) + "…",
      content
    };
    pushUndo();
    if (existing) {
      const idx = catalog.articles.findIndex((x) => x.slug === existing);
      if (idx >= 0) catalog.articles[idx] = obj;
    } else {
      catalog.articles.unshift(obj);
    }
    closeArticleModal();
    saveCatalog("📰 Artículo guardado");
  });

  $("#deleteArticleBtn").addEventListener("click", () => {
    const slug = $("#afSlug").value;
    if (!confirm("¿Borrar este artículo?")) return;
    pushUndo();
    catalog.articles = catalog.articles.filter((x) => x.slug !== slug);
    closeArticleModal();
    saveCatalog("🗑️ Artículo borrado");
  });

  /* ---------- Backup Export / Import & Undo ---------- */
  $("#undoBtn").addEventListener("click", () => {
    if (!undoStack.length) return;
    catalog = JSON.parse(undoStack.pop());
    $("#undoBtn").disabled = undoStack.length === 0;
    saveCatalog("↩️ Se deshizo el último cambio");
  });

  $("#exportBackupBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(catalog, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `panacea-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("⬇️ Respaldo descargado");
  });

  $("#importBackupInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!Array.isArray(parsed.products)) throw new Error("Archivo inválido");
        if (!confirm(`¿Restaurar este respaldo con ${parsed.products.length} productos?`)) return;
        pushUndo();
        catalog = Object.assign(cloneBaseData(), parsed);
        saveCatalog("📂 Respaldo restaurado correctamente");
      } catch (_) {
        toast("❌ Ese archivo no es un respaldo válido de Panacea");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  /* ---------- Global Wiring ---------- */
  $("#qaNewProduct").addEventListener("click", () => { switchTab("productos"); openProductModal(null); });
  $("#qaEditProducts").addEventListener("click", () => switchTab("productos"));
  $("#qaCoupons").addEventListener("click", () => switchTab("cupones"));
  $("#qaBanner").addEventListener("click", () => switchTab("tienda"));
  $("#addProductBtn").addEventListener("click", () => openProductModal(null));

  $("#prodSearch").addEventListener("input", (e) => {
    prodSearchText = e.target.value;
    renderProducts();
  });
  $("#prodCatFilter").addEventListener("change", (e) => {
    prodCatFilter = e.target.value;
    renderProducts();
  });
  $$("#prodStatusPills .pill").forEach((b) =>
    b.addEventListener("click", () => {
      prodFilterStatus = b.dataset.filter;
      $$("#prodStatusPills .pill").forEach((x) => x.classList.toggle("active", x === b));
      renderProducts();
    })
  );

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeProductModal();
      closeArticleModal();
      closeReviewModal();
    }
  });

  /* ---------- Orders (Load, Save, Render) ---------- */
  async function loadOrders() {
    let loaded = null;
    if (storageMode === "api") {
      try {
        const headers = {};
        const pin = sessionStorage.getItem(PIN_KEY);
        if (pin) headers["X-Admin-Pin"] = pin;
        const r = await fetch("/api/orders", { headers, cache: "no-store" });
        if (r.ok) {
          const j = await r.json();
          if (Array.isArray(j.orders)) loaded = j.orders;
        }
      } catch (_) {}
    }
    if (!loaded) {
      try {
        loaded = JSON.parse(localStorage.getItem(LS_ORDERS_KEY) || "[]");
      } catch (_) {
        loaded = [];
      }
    }
    orders = Array.isArray(loaded) ? loaded : [];
  }

  async function saveOrders(msg = "📦 Pedidos actualizados") {
    localStorage.setItem(LS_ORDERS_KEY, JSON.stringify(orders));
    if (storageMode === "api") {
      try {
        const headers = { "Content-Type": "application/json" };
        const pin = sessionStorage.getItem(PIN_KEY);
        if (pin) headers["X-Admin-Pin"] = pin;
        await fetch("/api/orders", {
          method: "PUT",
          headers,
          body: JSON.stringify({ orders })
        });
      } catch (_) {}
    }
    toast(msg);
    renderOrders();
  }

  function renderOrders() {
    const pendingCount = orders.filter((o) => o.status !== "entregado").length;
    const badge = $("#navOrdersCount");
    if (badge) badge.textContent = pendingCount;

    const list = orderFilter === "all" ? orders : orders.filter((o) => o.status === orderFilter);
    const wrap = $("#ordersList");
    if (!wrap) return;

    if (!list.length) {
      wrap.innerHTML = `<div class="card" style="text-align:center;padding:38px;">
        <p style="font-size:1.15rem;font-weight:800;">${orders.length ? "No hay pedidos en esta pestaña" : "Todavía no hay pedidos registrados"}</p>
        <p class="hint" style="margin:6px 0 16px;">Cuando alguien haga un pedido en tu tienda aparecerá aquí solito, o puedes anotar uno de WhatsApp arriba.</p>
      </div>`;
      return;
    }

    wrap.innerHTML = list
      .map((o) => {
        const st = ORDER_FLOW[o.status] || ORDER_FLOW.nuevo;
        const dateStr = o.createdAt ? new Date(o.createdAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) : "";
        const itemsHtml = (o.items || []).map((i) => `${i.qty || 1}× ${esc(i.title || i)}`).join(" · ") || esc(o.notes || "Pedido");
        const cleanPhone = String(o.phone || "").replace(/\D/g, "");
        const waPhone = cleanPhone.length === 10 ? "52" + cleanPhone : cleanPhone;
        const waMsg = encodeURIComponent(`Hola ${o.customerName}, te escribimos de Panacea Cosméticos sobre tu pedido ${o.id} (${st.label}).`);
        return `
        <article class="order-card">
          <div class="order-head">
            <div>
              <strong style="font-size:1.15rem;">${esc(o.customerName)}</strong>
              <span class="hint" style="margin-left:8px;">${esc(o.id)} · ${esc(dateStr)}</span>
            </div>
            <span class="order-badge ${esc(o.status || "nuevo")}">${st.label}</span>
          </div>
          <div class="order-items">
            <strong>${mxn(o.total)} MXN</strong> — ${itemsHtml}
            ${o.delivery ? `<div class="hint" style="margin-top:4px;">🚚 ${esc(o.delivery)} ${o.payment ? "· 💳 " + esc(o.payment) : ""}</div>` : ""}
            ${o.notes ? `<div class="hint" style="margin-top:4px;">📝 ${esc(o.notes)}</div>` : ""}
          </div>
          <div class="order-actions">
            ${st.next ? `<button type="button" class="big-btn btn-green btn-sm" data-next-order="${esc(o.id)}" data-next-st="${st.next}">${st.nextBtn}</button>` : ""}
            ${waPhone ? `<a class="big-btn btn-outline btn-sm" href="https://wa.me/${waPhone}?text=${waMsg}" target="_blank" rel="noopener">💬 Escribir por WhatsApp</a>` : ""}
            <button type="button" class="big-btn btn-danger btn-sm" data-del-order="${esc(o.id)}" style="margin-left:auto;">🗑️ Borrar</button>
          </div>
        </article>`;
      })
      .join("");

    $$("[data-next-order]").forEach((b) =>
      b.addEventListener("click", () => {
        const o = orders.find((x) => x.id === b.dataset.nextOrder);
        if (!o) return;
        o.status = b.dataset.nextSt;
        saveOrders(`Pedido ${o.id} cambiado a ${ORDER_FLOW[o.status].label}`);
      })
    );
    $$("[data-del-order]").forEach((b) =>
      b.addEventListener("click", () => {
        if (!confirm("¿Borrar este pedido de la lista?")) return;
        orders = orders.filter((x) => x.id !== b.dataset.delOrder);
        saveOrders("🗑️ Pedido eliminado");
      })
    );
  }

  $$("#orderStatusPills .pill").forEach((b) =>
    b.addEventListener("click", () => {
      orderFilter = b.dataset.ostatus;
      $$("#orderStatusPills .pill").forEach((x) => x.classList.toggle("active", x === b));
      renderOrders();
    })
  );

  const closeOrderModal = () => $("#orderModal").classList.add("hidden");
  $("#addOrderBtn").addEventListener("click", () => $("#orderModal").classList.remove("hidden"));
  $("#closeOrderModal").addEventListener("click", closeOrderModal);
  $("#cancelOrderBtn").addEventListener("click", closeOrderModal);

  $("#orderForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const order = {
      id: "PED-" + String(Date.now()).slice(-6),
      createdAt: new Date().toISOString(),
      status: "nuevo",
      customerName: $("#ofName").value.trim(),
      phone: $("#ofPhone").value.trim(),
      delivery: $("#ofDelivery").value.trim(),
      payment: "WhatsApp / Directo",
      total: Number($("#ofTotal").value || 0),
      items: [{ qty: 1, title: $("#ofItems").value.trim() }],
      notes: $("#ofNotes").value.trim()
    };
    orders.unshift(order);
    e.target.reset();
    $("#ofDelivery").value = "Envío Nacional";
    closeOrderModal();
    saveOrders(`📦 Pedido de ${order.customerName} anotado`);
  });

  function renderAll() {
    renderHome();
    renderOrders();
    renderProducts();
    renderCoupons();
    renderStoreSettings();
    renderArticles();
  }

  (async () => {
    await loadCatalog();
    await loadOrders();
    renderAll();
  })();
})();
