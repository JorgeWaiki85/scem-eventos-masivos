(function () {
  "use strict";

  const cfg = window.CONFIG || {};
  const DB_NAME = "scem_eventos_masivos_v2";
  const STORE = "incidentes";
  const ROLES = ["ADMINISTRADOR", "MEDICO", "ENFERMERIA", "TENS", "RESCATISTA"];
  const ROL_LABEL = { ADMINISTRADOR: "ADMINISTRADOR", MEDICO: "MÉDICO", ENFERMERIA: "ENFERMERA(O)", TENS: "TENS", RESCATISTA: "RESCATISTA" };
  const CARGO_LABEL = { MEDICO: "Médico", ENFERMERIA: "Enfermera(o)", TENS: "TENS", RESCATISTA: "Rescatista", CONDUCTOR: "Conductor", PSICOLOGO: "Psicólogo(a)", LOGISTICA: "Logística", OTRO: "Otro" };

  const LOGO = window.LOGO_DATA_URL || "";
  const LOGO_RATIO = 1217 / 1299;

  function addLogoPDF(doc, W, y, iw) {
    if (!LOGO) return y;
    const ih = iw * LOGO_RATIO;
    try { doc.addImage(LOGO, "JPEG", (W - iw) / 2, y, iw, ih); } catch (e) { return y; }
    return y + ih;
  }

  let sb = null;
  let sbAdmin = null;
  let currentUser = null;
  let currentPerfil = null;
  let realtimeChannel = null;
  let syncing = false;
  let toastTimer;
  let usuariosCache = [];
  let incidentes = [];
  let editId = null;
  let currentFolio = null;
  let informeInc = null;

  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => Array.prototype.slice.call(document.querySelectorAll(sel));
  const val = (id) => { const el = $(id); return el ? el.value.trim() : ""; };
  const setVal = (id, v) => { const el = $(id); if (el) el.value = v == null ? "" : v; };

  function rol() { return currentPerfil ? currentPerfil.rol : "RESCATISTA"; }
  function esAdmin() { return rol() === "ADMINISTRADOR"; }
  function puedeVerTodo() { return rol() !== "RESCATISTA"; }

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function todayLocal() {
    const d = new Date();
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function nowHM() {
    const d = new Date();
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  function toast(msg, kind) {
    const t = $("toast");
    t.textContent = msg;
    t.className = "toast" + (kind ? " " + kind : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add("hidden"); }, 3400);
  }

  function loginMsg(text, ok) {
    const el = $("loginMsg");
    el.textContent = text;
    el.className = "login-msg" + (ok ? " ok" : "");
  }

  function setBtn(id, on, label) {
    const b = $(id);
    if (!b) return;
    b.disabled = on;
    b.textContent = on ? "..." : label;
  }

  function traducir(msg) {
    const m = String(msg || "").toLowerCase();
    if (m.indexOf("invalid login") >= 0) return "Correo o contraseña incorrectos";
    if (m.indexOf("email not confirmed") >= 0) return "Debe confirmar su correo (revise su bandeja)";
    if (m.indexOf("already registered") >= 0) return "Ese correo ya está registrado";
    if (m.indexOf("password") >= 0) return "La contraseña debe tener al menos 6 caracteres";
    if (m.indexOf("failed to fetch") >= 0 || m.indexOf("network") >= 0) return "Sin conexión al servidor";
    if (m.indexOf("row-level") >= 0) return "No tiene permisos para esta acción";
    return msg || "Ocurrió un error";
  }

  /* ---------------- IndexedDB ---------------- */
  function openDB() {
    return new Promise(function (resolve, reject) {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function (e) {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  async function idbPut(obj) {
    const db = await openDB();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(obj);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  async function idbAll() {
    const db = await openDB();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE, "readonly");
      const r = tx.objectStore(STORE).getAll();
      r.onsuccess = function () { resolve(r.result || []); };
      r.onerror = function () { reject(r.error); };
    });
  }

  async function idbDelete(id) {
    const db = await openDB();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  /* ---------------- Supabase / Auth ---------------- */
  function initSupabase() {
    const url = cfg.SUPABASE_URL || "";
    const key = cfg.SUPABASE_ANON_KEY || "";
    if (!url || url.indexOf("TU-PROYECTO") >= 0 || !key || key.indexOf("TU-ANON") >= 0) {
      loginMsg("Falta configurar Supabase en js/config.js", false);
      $("btnLogin").disabled = true;
      $("btnSignup").disabled = true;
      return false;
    }
    sb = window.supabase.createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    sbAdmin = window.supabase.createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: "sb-admin-tmp" }
    });
    return true;
  }

  async function doLogin() {
    const email = val("loginEmail");
    const password = val("loginPassword");
    if (!email || !password) { loginMsg("Ingrese correo y contraseña", false); return; }
    if (!navigator.onLine) { loginMsg("Necesita internet para iniciar sesión la primera vez", false); return; }
    setBtn("btnLogin", true, "INGRESAR");
    const res = await sb.auth.signInWithPassword({ email: email, password: password });
    setBtn("btnLogin", false, "INGRESAR");
    if (res.error) loginMsg(traducir(res.error.message), false);
    else loginMsg("Ingresando...", true);
  }

  async function doSignup() {
    const email = val("loginEmail");
    const password = val("loginPassword");
    if (!email || !password) { loginMsg("Ingrese correo y contraseña (mínimo 6 caracteres)", false); return; }
    if (!navigator.onLine) { loginMsg("Necesita internet para crear la cuenta", false); return; }
    setBtn("btnSignup", true, "CREAR CUENTA");
    const res = await sb.auth.signUp({ email: email, password: password });
    setBtn("btnSignup", false, "CREAR CUENTA");
    if (res.error) loginMsg(traducir(res.error.message), false);
    else if (res.data && !res.data.session) loginMsg("Cuenta creada. Confirme su correo para ingresar.", true);
    else loginMsg("Cuenta creada correctamente", true);
  }

  async function doLogout() {
    try { if (sb) await sb.auth.signOut(); } catch (e) {}
    if (sb && realtimeChannel) { sb.removeChannel(realtimeChannel); realtimeChannel = null; }
    currentUser = null;
    currentPerfil = null;
    $("appView").classList.add("hidden");
    $("loginView").classList.remove("hidden");
    $("loginPassword").value = "";
  }

  async function loadPerfil() {
    try {
      const res = await sb.from("perfiles").select("id, email, nombre, rol").eq("id", currentUser.id).maybeSingle();
      if (res.data) { currentPerfil = res.data; return true; }
      if (!res.error) { currentPerfil = null; return false; }
      currentPerfil = { id: currentUser.id, email: currentUser.email, nombre: currentUser.email, rol: "RESCATISTA" };
      return true;
    } catch (e) {
      currentPerfil = { id: currentUser.id, email: currentUser.email, nombre: currentUser.email, rol: "RESCATISTA" };
      return true;
    }
  }

  function applyRole() {
    const r = rol();
    const rb = $("roleBadge");
    rb.textContent = ROL_LABEL[r] || r;
    rb.className = "badge badge-role badge-rol-" + r;
    $$("[data-admin]").forEach(function (el) { el.classList.toggle("hidden", !esAdmin()); });
    $$("[data-ver]").forEach(function (el) { el.classList.toggle("hidden", !puedeVerTodo()); });
    if (esAdmin()) { loadUsuarios(); loadReportes(); }
  }

  /* ---------------- Tabs ---------------- */
  function showTab(name) {
    $$("#tabs .tab").forEach(function (t) { t.classList.toggle("activo", t.getAttribute("data-tab") === name); });
    $$(".vista").forEach(function (v) { v.classList.remove("activa"); });
    const v = $("vista-" + name);
    if (v) v.classList.add("activa");
    if (name === "realtime") loadRealtime();
    if (name === "lista") loadIncidentes();
    if (name === "reportes") loadReportes();
    try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (e) { window.scrollTo(0, 0); }
  }

  /* ---------------- Realtime ---------------- */
  function subscribeRealtime() {
    if (!sb || realtimeChannel || !puedeVerTodo()) return;
    realtimeChannel = sb.channel("incidentes-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "incidentes" }, function () { loadRealtime(); loadIncidentes(); })
      .subscribe(function (status) {
        $("liveDot").classList.toggle("on", status === "SUBSCRIBED");
      });
  }

  async function loadRealtime() {
    if (!sb || !navigator.onLine || !puedeVerTodo()) return;
    const res = await sb.from("incidentes")
      .select("id, folio, tipo, alerta, estado, comuna, direccion, comandante, creado_cliente, personal, recursos")
      .order("creado_cliente", { ascending: false })
      .limit(50);
    if (res.error) return;
    renderRealtime(res.data || []);
  }

  function estadoClass(e) {
    if (e === "Activo") return "badge rojo";
    if (e === "Controlado") return "badge ambar";
    if (e === "Cerrado") return "badge gris";
    return "badge azul";
  }

  function renderRealtime(rows) {
    const box = $("realtimeList");
    if (!rows.length) { box.innerHTML = '<div class="empty">Sin registros todavía.</div>'; return; }
    box.innerHTML = rows.map(function (r) {
      const np = (r.personal || []).length;
      const nr = (r.recursos || []).length;
      let tags = "";
      if (r.folio != null) tags += '<span class="tag">#' + esc(r.folio) + "</span>";
      if (r.alerta) tags += '<span class="tag">' + esc(r.alerta) + "</span>";
      if (np) tags += '<span class="tag">' + np + " personal</span>";
      if (nr) tags += '<span class="tag">' + nr + " recursos</span>";
      const actions = '<div class="rt-actions"><button class="btn-mini dark" data-ver-inc="' + esc(r.id) + '">Ver</button>' +
        (esAdmin() ? '<button class="btn-mini danger" data-del="' + esc(r.id) + '">Eliminar</button>' : "") + "</div>";
      return '<div class="rt-item">' +
        '<div class="fila"><span class="rt-name">' + esc(r.tipo || "(sin tipo)") + '</span><span class="' + estadoClass(r.estado) + '">' + esc(r.estado || "") + "</span></div>" +
        '<div class="rt-meta">' + esc(r.direccion || "") + (r.comuna ? ", " + esc(r.comuna) : "") + "</div>" +
        '<div class="rt-meta">' + esc(r.comandante || "") + "</div>" +
        '<div class="rt-tags">' + tags + "</div>" + actions +
        "</div>";
    }).join("");
  }

  /* ---------------- Conexión / pendientes / sync ---------------- */
  function updateConn() {
    const online = navigator.onLine;
    const b = $("connBadge");
    b.textContent = online ? "En línea" : "Offline";
    b.className = "badge " + (online ? "badge-online" : "badge-offline");
    $("syncBanner").classList.toggle("hidden", online);
    if (!online) $("syncBannerText").textContent = "Sin conexión. Los datos quedan guardados en este dispositivo.";
    if (online) { loadRealtime(); syncPending(); loadIncidentes(); }
  }

  async function refreshPending() {
    const all = await idbAll();
    const n = all.filter(function (r) { return !r.synced; }).length;
    const b = $("pendingBadge");
    if (n > 0) { b.textContent = n + " pendiente" + (n === 1 ? "" : "s"); b.classList.remove("hidden"); }
    else b.classList.add("hidden");
  }

  async function syncPending() {
    if (!sb || !navigator.onLine || syncing) return;
    syncing = true;
    try {
      const all = await idbAll();
      const pend = all.filter(function (r) { return !r.synced; });
      for (const rec of pend) {
        const payload = Object.assign({}, rec.inc, {
          user_id: currentUser ? currentUser.id : null,
          creado_cliente: rec.creado_cliente,
          sincronizado_at: new Date().toISOString()
        });
        if (rec.folio != null) payload.folio = rec.folio; else delete payload.folio;
        const r1 = await sb.from("incidentes").upsert(payload, { onConflict: "id" }).select("folio").maybeSingle();
        if (r1.error) throw r1.error;
        if (r1.data && r1.data.folio != null) {
          rec.folio = r1.data.folio;
          if (editId === rec.id) { currentFolio = rec.folio; setVal("folio", "#" + rec.folio); }
        }
        rec.synced = true;
        await idbPut(rec);
      }
      if (pend.length) toast(pend.length + " registro(s) sincronizado(s)", "ok");
    } catch (e) {
      console.warn("Error de sincronización:", e);
    } finally {
      syncing = false;
      await refreshPending();
      loadRealtime();
      loadIncidentes();
    }
  }

  /* ---------------- Filas dinámicas ---------------- */
  const ROW_SPECS = {
    personal: {
      listId: "personalList",
      title: "PERSONAL",
      fields: [
        { key: "nombre", label: "Nombre", type: "text" },
        { key: "cargo", label: "Cargo", type: "select", options: Object.keys(CARGO_LABEL).map(function (k) { return { v: k, l: CARGO_LABEL[k] }; }) },
        { key: "institucion", label: "Institución", type: "text" },
        { key: "contacto", label: "Contacto", type: "tel" },
        { key: "hora_llegada", label: "Hora llegada", type: "time" }
      ]
    },
    recursos: {
      listId: "recursosList",
      title: "RECURSO",
      fields: [
        { key: "tipo", label: "Tipo", type: "select", options: ["Ambulancia", "Carro bomba", "Vehículo de rescate", "Vehículo de apoyo", "Helicóptero", "Alimentación", "Agua", "Combustible", "Maquinaria", "Otro"].map(function (o) { return { v: o, l: o }; }) },
        { key: "identificacion", label: "Identificación", type: "text" },
        { key: "cantidad", label: "Cantidad", type: "number" },
        { key: "estado", label: "Estado", type: "select", options: ["Operativo", "En uso", "Fuera de servicio"].map(function (o) { return { v: o, l: o }; }) },
        { key: "observacion", label: "Observación", type: "text" }
      ]
    },
    equipos: {
      listId: "equiposList",
      title: "EQUIPO",
      fields: [
        { key: "nombre", label: "Equipo", type: "text" },
        { key: "cantidad", label: "Cantidad", type: "number" },
        { key: "estado", label: "Estado", type: "select", options: ["Operativo", "En uso", "Fuera de servicio"].map(function (o) { return { v: o, l: o }; }) },
        { key: "observacion", label: "Observación", type: "text" }
      ]
    }
  };

  function fieldInput(f, value) {
    const v = value == null ? "" : value;
    if (f.type === "select") {
      const opts = ['<option value=""></option>'].concat(f.options.map(function (o) {
        return '<option value="' + esc(o.v) + '"' + (String(o.v) === String(v) ? " selected" : "") + ">" + esc(o.l) + "</option>";
      })).join("");
      return '<label>' + esc(f.label) + '<select data-field="' + f.key + '">' + opts + "</select></label>";
    }
    const itype = f.type === "number" ? ' type="number" inputmode="numeric"' : (f.type === "time" ? ' type="time"' : (f.type === "tel" ? ' type="tel"' : ' type="text"'));
    return '<label>' + esc(f.label) + "<input" + itype + ' data-field="' + f.key + '" value="' + esc(v) + '"></label>';
  }

  function rowHTML(type, n, data) {
    const spec = ROW_SPECS[type];
    const fields = spec.fields.map(function (f) { return fieldInput(f, data ? data[f.key] : ""); }).join("");
    const idAttr = (data && data.id) ? ' data-id="' + esc(data.id) + '"' : "";
    return '<div class="toma" data-row="' + type + '"' + idAttr + ">" +
      '<div class="toma-head"><span class="toma-title">' + spec.title + " " + n + "</span>" +
      '<button type="button" class="remove-btn" data-remove>×</button></div>' +
      '<div class="form-grid">' + fields + "</div>" +
      "</div>";
  }

  function addRow(type, data) {
    const spec = ROW_SPECS[type];
    const list = $(spec.listId);
    const n = list.querySelectorAll('.toma[data-row="' + type + '"]').length + 1;
    const wrap = document.createElement("div");
    wrap.innerHTML = rowHTML(type, n, data);
    const node = wrap.firstElementChild;
    node.querySelector("[data-remove]").addEventListener("click", function () { node.remove(); renumberRows(type); });
    list.appendChild(node);
    renumberRows(type);
  }

  function renumberRows(type) {
    const spec = ROW_SPECS[type];
    const list = $(spec.listId);
    list.querySelectorAll('.toma[data-row="' + type + '"]').forEach(function (el, i) {
      const t = el.querySelector(".toma-title");
      if (t) t.textContent = spec.title + " " + (i + 1);
    });
  }

  function readRows(type) {
    const spec = ROW_SPECS[type];
    const out = [];
    $(spec.listId).querySelectorAll('.toma[data-row="' + type + '"]').forEach(function (el) {
      const obj = {};
      if (el.dataset.id) obj.id = el.dataset.id;
      spec.fields.forEach(function (f) {
        const i = el.querySelector('[data-field="' + f.key + '"]');
        obj[f.key] = i ? i.value.trim() : "";
      });
      const tiene = spec.fields.some(function (f) { return obj[f.key]; });
      if (tiene) out.push(obj);
    });
    return out;
  }

  /* ---------------- Formulario ---------------- */
  function collect() {
    const inc = {
      id: editId || uuid(),
      tipo: val("tipo"),
      alerta: val("alerta"),
      estado: val("estado") || "Activo",
      fecha_inicio: val("fechaInicio"),
      hora_inicio: val("horaInicio"),
      fecha_control: val("fechaControl"),
      hora_control: val("horaControl"),
      direccion: val("direccion"),
      comuna: val("comuna"),
      cuadrante: val("cuadrante"),
      comandante: val("comandante"),
      punto_comando: val("puntoComando"),
      descripcion: val("descripcion"),
      personal: readRows("personal"),
      recursos: readRows("recursos"),
      equipos: readRows("equipos"),
      puesto_medico: {
        instalado: $("pmSi") && $("pmSi").checked ? "SI" : ($("pmNo") && $("pmNo").checked ? "NO" : ""),
        ubicacion: val("pmUbicacion"),
        responsable: val("pmResponsable"),
        atenciones: val("pmAtenciones"),
        derivaciones: val("pmDerivaciones"),
        observaciones: val("pmObservaciones")
      },
      dispositivo: cfg.DISPOSITIVO || ""
    };
    return inc;
  }

  function resetForm() {
    editId = null;
    currentFolio = null;
    setVal("folio", "");
    setVal("tipo", "");
    setVal("alerta", "");
    setVal("estado", "Activo");
    setVal("fechaInicio", todayLocal());
    setVal("horaInicio", nowHM());
    setVal("fechaControl", "");
    setVal("horaControl", "");
    ["direccion", "comuna", "cuadrante", "comandante", "puntoComando", "descripcion",
      "pmUbicacion", "pmResponsable", "pmAtenciones", "pmDerivaciones", "pmObservaciones"].forEach(function (id) { setVal(id, ""); });
    ["personalList", "recursosList", "equiposList"].forEach(function (id) { $(id).innerHTML = ""; });
    $("pmSi").checked = false;
    $("pmNo").checked = false;
    togglePm(false);
    $("formTitulo").textContent = "Nuevo incidente";
    showEditBanner(false);
  }

  function fillForm(inc) {
    editId = inc.id;
    currentFolio = inc.folio != null ? inc.folio : null;
    setVal("folio", inc.folio != null ? "#" + inc.folio : "");
    setVal("tipo", inc.tipo || "");
    setVal("alerta", inc.alerta || "");
    setVal("estado", inc.estado || "Activo");
    setVal("fechaInicio", inc.fecha_inicio || todayLocal());
    setVal("horaInicio", inc.hora_inicio || nowHM());
    setVal("fechaControl", inc.fecha_control || "");
    setVal("horaControl", inc.hora_control || "");
    setVal("direccion", inc.direccion || "");
    setVal("comuna", inc.comuna || "");
    setVal("cuadrante", inc.cuadrante || "");
    setVal("comandante", inc.comandante || "");
    setVal("puntoComando", inc.punto_comando || "");
    setVal("descripcion", inc.descripcion || "");

    ["personalList", "recursosList", "equiposList"].forEach(function (id) { $(id).innerHTML = ""; });
    (inc.personal || []).forEach(function (p) { addRow("personal", p); });
    (inc.recursos || []).forEach(function (p) { addRow("recursos", p); });
    (inc.equipos || []).forEach(function (p) { addRow("equipos", p); });

    const pm = inc.puesto_medico || {};
    $("pmSi").checked = pm.instalado === "SI";
    $("pmNo").checked = pm.instalado === "NO" || !pm.instalado;
    togglePm(pm.instalado === "SI");
    setVal("pmUbicacion", pm.ubicacion || "");
    setVal("pmResponsable", pm.responsable || "");
    setVal("pmAtenciones", pm.atenciones || "");
    setVal("pmDerivaciones", pm.derivaciones || "");
    setVal("pmObservaciones", pm.observaciones || "");

    $("formTitulo").textContent = "Editar incidente" + (inc.folio != null ? " #" + inc.folio : "");
    showEditBanner(true, "Editando incidente" + (inc.folio != null ? " #" + inc.folio : "") + (esAdmin() ? "" : " (solo ADMINISTRADOR puede guardar cambios)"));
  }

  function togglePm(show) {
    $("pmContainer").classList.toggle("hidden", !show);
  }

  function showEditBanner(on, texto) {
    $("editBanner").classList.toggle("hidden", !on);
    if (on) $("editBannerText").textContent = texto || "";
  }

  async function guardar() {
    const inc = collect();
    if (!inc.tipo && !inc.direccion && !inc.descripcion) {
      toast("Ingrese al menos el tipo, la dirección o la descripción del incidente", "err");
      return;
    }
    editId = inc.id;
    const rec = {
      id: inc.id,
      inc: inc,
      folio: currentFolio,
      synced: false,
      creado_cliente: new Date().toISOString()
    };
    await idbPut(rec);
    toast(navigator.onLine ? "Guardado. Sincronizando..." : "Guardado en el dispositivo", "ok");
    await refreshPending();
    syncPending();
    resetForm();
    showTab("lista");
  }

  function nuevoIncidente() {
    const conDatos = ["tipo", "direccion", "comuna", "comandante", "descripcion"].some(function (id) { return val(id); });
    if (editId || conDatos) {
      if (editId) { toast("Ya está editando un incidente. Guarde o limpie el formulario.", "err"); return; }
    }
    resetForm();
    setVal("fechaInicio", todayLocal());
    setVal("horaInicio", nowHM());
    showTab("nuevo");
    toast("Nuevo incidente listo", "ok");
  }

  /* ---------------- Lista de incidentes ---------------- */
  function mergeIncidentes(serverRows, localRows) {
    const byId = {};
    localRows.forEach(function (r) {
      const inc = Object.assign({}, r.inc, { id: r.id, folio: r.folio });
      byId[r.id] = inc;
      inc._pendiente = !r.synced;
      inc._local = true;
    });
    (serverRows || []).forEach(function (r) {
      const existente = byId[r.id];
      byId[r.id] = Object.assign({}, r, { _server: true });
      if (existente && !r.folio && existente.folio != null) byId[r.id].folio = existente.folio;
    });
    const arr = Object.keys(byId).map(function (k) { return byId[k]; });
    arr.sort(function (a, b) {
      const fa = a.folio == null ? -1 : a.folio;
      const fb = b.folio == null ? -1 : b.folio;
      if (fa !== fb) return fb - fa;
      return String(b.creado_cliente || "").localeCompare(String(a.creado_cliente || ""));
    });
    return arr;
  }

  async function loadIncidentes() {
    const localRows = await idbAll();
    let serverRows = null;
    if (sb && navigator.onLine) {
      const res = await sb.from("incidentes").select("*").order("creado_cliente", { ascending: false }).limit(500);
      if (!res.error) serverRows = res.data || [];
    }
    incidentes = mergeIncidentes(serverRows, localRows);
    renderLista();
    renderStats();
  }

  function renderStats() {
    const total = incidentes.length;
    const activos = incidentes.filter(function (i) { return (i.estado || "Activo") === "Activo"; }).length;
    const personal = incidentes.reduce(function (a, i) { return a + ((i.personal || []).length); }, 0);
    const recursos = incidentes.reduce(function (a, i) { return a + ((i.recursos || []).length); }, 0);
    $("statTotal").textContent = total;
    $("statActivos").textContent = activos;
    $("statPersonal").textContent = personal;
    $("statRecursos").textContent = recursos;
  }

  function filtrados() {
    const q = val("buscador").toLowerCase();
    const est = val("filtroEstado");
    return incidentes.filter(function (i) {
      if (est && (i.estado || "Activo") !== est) return false;
      if (!q) return true;
      const blob = [i.folio, i.tipo, i.direccion, i.comuna, i.cuadrante, i.comandante, i.alerta, i.descripcion].join(" ").toLowerCase();
      return blob.indexOf(q) >= 0;
    });
  }

  function renderLista() {
    const box = $("listaIncidentes");
    const rows = filtrados();
    if (!rows.length) { box.innerHTML = '<div class="vacio">No hay incidentes que mostrar.</div>'; return; }
    box.innerHTML = rows.map(function (i) {
      const np = (i.personal || []).length;
      const nr = (i.recursos || []).length;
      const ne = (i.equipos || []).length;
      const estado = i.estado || "Activo";
      const cls = estado === "Activo" ? "estado-activo" : (estado === "Controlado" ? "estado-espera" : "estado-gris");
      const alerta = i.alerta ? '<span class="etiqueta">' + esc(i.alerta) + "</span>" : "";
      const pend = i._pendiente ? '<span class="badge badge-pending">Pendiente</span>' : "";
      return '<div class="tarjeta ' + cls + '">' +
        '<div class="fila"><span class="titulo">' + esc(i.tipo || "(sin tipo)") + "</span>" +
        '<span class="' + estadoClass(estado) + '">' + esc(estado) + "</span></div>" +
        '<div class="sub">' + (i.folio != null ? "#" + esc(i.folio) + " · " : "") + esc(i.direccion || "") + (i.comuna ? ", " + esc(i.comuna) : "") + "</div>" +
        '<div class="datos">' +
          '<div class="d">Comandante: <b>' + esc(i.comandante || "—") + "</b></div>" +
          '<div class="d">Inicio: <b>' + esc(i.fecha_inicio || "") + " " + esc(i.hora_inicio || "") + "</b></div>" +
          '<div class="d">Personal: <b>' + np + "</b></div>" +
          '<div class="d">Recursos: <b>' + nr + "</b></div>" +
          '<div class="d">Equipos: <b>' + ne + "</b></div>" +
          '<div class="d">' + alerta + " " + pend + "</div>" +
        "</div>" +
        '<div class="pie-tarjeta">' +
          '<button class="btn btn-ghost icono" data-ver-inc="' + esc(i.id) + '">Ver informe</button>' +
          (esAdmin() ? '<button class="btn btn-secondary icono" data-edit-inc="' + esc(i.id) + '">Editar</button>' +
            '<button class="btn btn-danger icono" data-del-inc="' + esc(i.id) + '">Eliminar</button>' : "") +
        "</div>" +
        "</div>";
    }).join("");
  }

  function buscarIncidente(id) {
    return incidentes.filter(function (i) { return i.id === id; })[0] || null;
  }

  function verIncidente(id) {
    const inc = buscarIncidente(id);
    if (!inc) { toast("No se encontró el incidente", "err"); return; }
    mostrarInforme(inc);
  }

  function editarIncidente(id) {
    if (!esAdmin()) { toast("Solo ADMINISTRADOR puede editar", "err"); return; }
    const inc = buscarIncidente(id);
    if (!inc) { toast("No se encontró el incidente", "err"); return; }
    fillForm(inc);
    showTab("nuevo");
  }

  async function eliminarIncidente(id) {
    if (!esAdmin()) { toast("Solo ADMINISTRADOR puede eliminar", "err"); return; }
    if (!confirm("¿Eliminar este incidente? Esta acción no se puede deshacer.")) return;
    if (sb && navigator.onLine) {
      const res = await sb.from("incidentes").delete().eq("id", id);
      if (res.error) { toast("No se pudo eliminar: " + traducir(res.error.message), "err"); return; }
    }
    await idbDelete(id);
    if (editId === id) resetForm();
    toast("Incidente eliminado", "ok");
    loadIncidentes();
    loadRealtime();
  }

  /* ---------------- Informe ---------------- */
  function fmtFechaHora(f, h) {
    return (f || "") + (h ? " " + h : "");
  }

  function buildInformeHTML(inc) {
    const pm = inc.puesto_medico || {};
    const personal = inc.personal || [];
    const recursos = inc.recursos || [];
    const equipos = inc.equipos || [];

    let html = '<div class="encabezado-informe"><div>' +
      "<h2>SAFE MEDICAL</h2>" +
      "<div>Sistema de Comando de Eventos Masivos</div>" +
      "<div>Informe de incidente</div>" +
      "</div><div style=\"text-align:right\">" +
      "<div class=\"codigo\">" + (inc.folio != null ? "#" + esc(inc.folio) : "#—") + "</div>" +
      "<div>" + esc(inc.tipo || "") + "</div>" +
      "<div>" + esc(inc.estado || "") + "</div>" +
      "</div></div>";

    html += "<h3>Identificación</h3><dl>";
    const add = function (k, v) { if (v) html += "<dt>" + esc(k) + "</dt><dd>" + esc(v) + "</dd>"; };
    add("Folio", inc.folio != null ? "#" + inc.folio : "");
    add("Tipo de incidente", inc.tipo);
    add("Alerta", inc.alerta);
    add("Estado", inc.estado);
    add("Inicio", fmtFechaHora(inc.fecha_inicio, inc.hora_inicio));
    add("Control", fmtFechaHora(inc.fecha_control, inc.hora_control));
    html += "</dl>";

    html += "<h3>Ubicación y mando</h3><dl>";
    add("Dirección", inc.direccion);
    add("Comuna", inc.comuna);
    add("Cuadrante / Sector", inc.cuadrante);
    add("Comandante", inc.comandante);
    add("Punto de comando", inc.punto_comando);
    html += "</dl>";

    if (inc.descripcion) html += "<h3>Descripción</h3><div class=\"bloque-txt\">" + esc(inc.descripcion) + "</div>";

    if (personal.length) {
      html += "<h3>Personal desplegado (" + personal.length + ")</h3><div class=\"tabla-wrap\"><table class=\"tabla\"><thead><tr><th>#</th><th>Nombre</th><th>Cargo</th><th>Institución</th><th>Contacto</th><th>Hora</th></tr></thead><tbody>";
      personal.forEach(function (p, i) {
        html += "<tr><td>" + (i + 1) + "</td><td>" + esc(p.nombre) + "</td><td>" + esc(CARGO_LABEL[p.cargo] || p.cargo) + "</td><td>" + esc(p.institucion) + "</td><td>" + esc(p.contacto) + "</td><td>" + esc(p.hora_llegada) + "</td></tr>";
      });
      html += "</tbody></table></div>";
    }

    if (recursos.length) {
      html += "<h3>Recursos (" + recursos.length + ")</h3><div class=\"tabla-wrap\"><table class=\"tabla\"><thead><tr><th>#</th><th>Tipo</th><th>Identificación</th><th>Cantidad</th><th>Estado</th><th>Observación</th></tr></thead><tbody>";
      recursos.forEach(function (p, i) {
        html += "<tr><td>" + (i + 1) + "</td><td>" + esc(p.tipo) + "</td><td>" + esc(p.identificacion) + "</td><td>" + esc(p.cantidad) + "</td><td>" + esc(p.estado) + "</td><td>" + esc(p.observacion) + "</td></tr>";
      });
      html += "</tbody></table></div>";
    }

    if (equipos.length) {
      html += "<h3>Equipos (" + equipos.length + ")</h3><div class=\"tabla-wrap\"><table class=\"tabla\"><thead><tr><th>#</th><th>Equipo</th><th>Cantidad</th><th>Estado</th><th>Observación</th></tr></thead><tbody>";
      equipos.forEach(function (p, i) {
        html += "<tr><td>" + (i + 1) + "</td><td>" + esc(p.nombre) + "</td><td>" + esc(p.cantidad) + "</td><td>" + esc(p.estado) + "</td><td>" + esc(p.observacion) + "</td></tr>";
      });
      html += "</tbody></table></div>";
    }

    html += "<h3>Puesto médico</h3><dl>";
    add("Instalado", pm.instalado);
    if (pm.instalado === "SI") {
      add("Ubicación", pm.ubicacion);
      add("Responsable", pm.responsable);
      add("Atenciones realizadas", pm.atenciones);
      add("Derivaciones", pm.derivaciones);
      add("Observaciones", pm.observaciones);
    }
    html += "</dl>";

    return html;
  }

  function mostrarInforme(inc) {
    informeInc = inc;
    $("informeContenido").innerHTML = buildInformeHTML(inc);
    showTab("informe");
  }

  function verInformeActual() {
    const inc = collect();
    if (currentFolio != null) inc.folio = currentFolio;
    mostrarInforme(inc);
  }

  function informeTexto(inc) {
    const pm = inc.puesto_medico || {};
    let out = "*SAFE MEDICAL*\n*Informe de incidente* " + (inc.folio != null ? "#" + inc.folio : "") + "\n\n";
    const line = function (k, v) { if (v) out += "*" + k + ":* " + v + "\n"; };
    out += "*Identificación*\n";
    line("Tipo", inc.tipo); line("Alerta", inc.alerta); line("Estado", inc.estado);
    line("Inicio", fmtFechaHora(inc.fecha_inicio, inc.hora_inicio));
    line("Control", fmtFechaHora(inc.fecha_control, inc.hora_control));
    out += "*Ubicación y mando*\n";
    line("Dirección", inc.direccion); line("Comuna", inc.comuna); line("Cuadrante", inc.cuadrante);
    line("Comandante", inc.comandante); line("Punto de comando", inc.punto_comando);
    if (inc.descripcion) out += "\n*Descripción*\n" + inc.descripcion + "\n";
    const personal = inc.personal || [], recursos = inc.recursos || [], equipos = inc.equipos || [];
    if (personal.length) {
      out += "\n*Personal (" + personal.length + ")*\n";
      personal.forEach(function (p) { out += "- " + [p.nombre, CARGO_LABEL[p.cargo] || p.cargo, p.institucion, p.contacto].filter(Boolean).join(" · ") + "\n"; });
    }
    if (recursos.length) {
      out += "\n*Recursos (" + recursos.length + ")*\n";
      recursos.forEach(function (p) { out += "- " + [p.tipo, p.identificacion, p.cantidad, p.estado].filter(Boolean).join(" · ") + "\n"; });
    }
    if (equipos.length) {
      out += "\n*Equipos (" + equipos.length + ")*\n";
      equipos.forEach(function (p) { out += "- " + [p.nombre, p.cantidad, p.estado].filter(Boolean).join(" · ") + "\n"; });
    }
    out += "\n*Puesto médico*\n";
    line("Instalado", pm.instalado);
    if (pm.instalado === "SI") { line("Ubicación", pm.ubicacion); line("Responsable", pm.responsable); line("Atenciones", pm.atenciones); line("Derivaciones", pm.derivaciones); }
    return out.trim();
  }

  function informeWhatsapp() {
    if (!informeInc) return;
    window.open("https://wa.me/?text=" + encodeURIComponent(informeTexto(informeInc)), "_blank");
  }

  function informePDF() {
    if (!informeInc) return;
    const inc = informeInc;
    const jsPDF = window.jspdf.jsPDF;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const M = 14, W = 210, H = 297;
    let y = M;
    const ensure = function (sp) { if (y + sp > H - M) { doc.addPage(); y = M; } };
    const usableW = W - 2 * M;

    y = addLogoPDF(doc, W, y, 26) + 4;
    doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(11, 114, 133);
    doc.text("SAFE MEDICAL", W / 2, y, { align: "center" }); y += 8;
    doc.setFontSize(12);
    doc.text("INFORME DE INCIDENTE", W / 2, y, { align: "center" }); y += 6;
    if (inc.folio != null) { doc.setFontSize(11); doc.setTextColor(80, 80, 80); doc.text("Folio: #" + inc.folio, W / 2, y, { align: "center" }); y += 6; }
    doc.setDrawColor(11, 114, 133); doc.setLineWidth(0.6); doc.line(M, y, W - M, y); y += 7;

    const titulo = function (t) { ensure(10); doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(11, 114, 133); doc.text(t, M, y); y += 6; };
    const kv = function (k, v) {
      if (!v) return;
      doc.setFontSize(10.5); doc.setTextColor(30, 30, 30);
      const label = k + ": "; doc.setFont("helvetica", "bold");
      const lw = doc.getTextWidth(label);
      const lines = doc.splitTextToSize(String(v), usableW - lw - 2);
      ensure(6); doc.text(label, M, y); doc.setFont("helvetica", "normal"); doc.text(lines[0], M + lw, y);
      for (let i = 1; i < lines.length; i++) { y += 5.5; ensure(6); doc.text(lines[i], M, y); }
      y += 5.5;
    };
    const parrafo = function (t) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(30, 30, 30);
      doc.splitTextToSize(String(t), usableW).forEach(function (ln) { ensure(6); doc.text(ln, M, y); y += 5.5; });
    };
    const tabla = function (head, rows) {
      const cw = usableW / head.length;
      ensure(8);
      doc.setFillColor(11, 114, 133); doc.rect(M, y, usableW, 6.5, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(255, 255, 255);
      head.forEach(function (h, i) { doc.text(String(h), M + i * cw + 1.5, y + 4.3); });
      y += 6.5;
      doc.setFont("helvetica", "normal"); doc.setTextColor(30, 30, 30);
      rows.forEach(function (r) {
        ensure(6.5);
        r.forEach(function (c, i) {
          const lines = doc.splitTextToSize(String(c == null ? "" : c), cw - 3);
          doc.text(lines[0] || "", M + i * cw + 1.5, y + 4);
        });
        doc.setDrawColor(222, 226, 230); doc.setLineWidth(0.2); doc.line(M, y + 6.5, M + usableW, y + 6.5);
        y += 6.5;
      });
      y += 2;
    };

    titulo("Identificación");
    kv("Tipo de incidente", inc.tipo);
    kv("Alerta", inc.alerta);
    kv("Estado", inc.estado);
    kv("Inicio", fmtFechaHora(inc.fecha_inicio, inc.hora_inicio));
    kv("Control", fmtFechaHora(inc.fecha_control, inc.hora_control));

    titulo("Ubicación y mando");
    kv("Dirección", inc.direccion);
    kv("Comuna", inc.comuna);
    kv("Cuadrante / Sector", inc.cuadrante);
    kv("Comandante", inc.comandante);
    kv("Punto de comando", inc.punto_comando);

    if (inc.descripcion) { titulo("Descripción"); parrafo(inc.descripcion); }

    const personal = inc.personal || [], recursos = inc.recursos || [], equipos = inc.equipos || [];
    if (personal.length) {
      titulo("Personal desplegado (" + personal.length + ")");
      tabla(["#", "Nombre", "Cargo", "Institución", "Contacto"],
        personal.map(function (p, i) { return [i + 1, p.nombre, CARGO_LABEL[p.cargo] || p.cargo, p.institucion, p.contacto]; }));
    }
    if (recursos.length) {
      titulo("Recursos (" + recursos.length + ")");
      tabla(["#", "Tipo", "Identificación", "Cant.", "Estado"],
        recursos.map(function (p, i) { return [i + 1, p.tipo, p.identificacion, p.cantidad, p.estado]; }));
    }
    if (equipos.length) {
      titulo("Equipos (" + equipos.length + ")");
      tabla(["#", "Equipo", "Cantidad", "Estado", "Observación"],
        equipos.map(function (p, i) { return [i + 1, p.nombre, p.cantidad, p.estado, p.observacion]; }));
    }

    const pm = inc.puesto_medico || {};
    titulo("Puesto médico");
    kv("Instalado", pm.instalado);
    if (pm.instalado === "SI") {
      kv("Ubicación", pm.ubicacion); kv("Responsable", pm.responsable);
      kv("Atenciones", pm.atenciones); kv("Derivaciones", pm.derivaciones); kv("Observaciones", pm.observaciones);
    }

    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(120, 120, 120);
      doc.text("Sistema de Comando de Eventos Masivos", M, H - 6);
      doc.text("Página " + p + " de " + pages, W - M, H - 6, { align: "right" });
    }

    const filename = "Incidente_" + (inc.folio != null ? "Folio_" + inc.folio + "_" : "") + todayLocal() + ".pdf";
    const blob = doc.output("blob");
    const file = new File([blob], filename, { type: "application/pdf" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: "Informe de incidente", text: "Informe SCEM" })
        .catch(function () { doc.save(filename); toast("PDF generado", "ok"); });
    } else { doc.save(filename); toast("PDF generado", "ok"); }
  }

  /* ---------------- Reportes ---------------- */
  function loadReportes() {
    const total = incidentes.length;
    const activos = incidentes.filter(function (i) { return (i.estado || "Activo") === "Activo"; }).length;
    const personal = incidentes.reduce(function (a, i) { return a + ((i.personal || []).length); }, 0);
    const recursos = incidentes.reduce(function (a, i) { return a + ((i.recursos || []).length); }, 0);
    $("rpTotal").textContent = total;
    $("rpActivos").textContent = activos;
    $("rpPersonal").textContent = personal;
    $("rpRecursos").textContent = recursos;
    const box = $("reportesTabla");
    if (!total) { box.innerHTML = '<div class="vacio">Sin incidentes registrados.</div>'; return; }
    let html = '<table class="tabla"><thead><tr><th>#</th><th>Folio</th><th>Tipo</th><th>Estado</th><th>Comuna</th><th>Inicio</th><th>Personal</th><th>Recursos</th></tr></thead><tbody>';
    incidentes.slice().sort(function (a, b) { return (a.folio || 0) - (b.folio || 0); }).forEach(function (i) {
      html += "<tr><td>" + (i.folio != null ? "#" + esc(i.folio) : "—") + "</td><td>" + esc(i.folio != null ? i.folio : "") + "</td><td>" + esc(i.tipo) + "</td><td>" + esc(i.estado) + "</td><td>" + esc(i.comuna) + "</td><td>" + esc(fmtFechaHora(i.fecha_inicio, i.hora_inicio)) + "</td><td>" + (i.personal || []).length + "</td><td>" + (i.recursos || []).length + "</td></tr>";
    });
    html += "</tbody></table>";
    box.innerHTML = html;
  }

  function fetchAllFull() {
    if (!sb || !navigator.onLine) throw new Error("Necesita conexión para generar el respaldo");
    return sb.from("incidentes").select("*").order("folio", { ascending: true }).then(function (res) {
      if (res.error) throw res.error;
      return res.data || [];
    });
  }

  function csvCell(v) {
    const s = String(v == null ? "" : v);
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function saveViaAnchor(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  function descargarArchivo(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: filename }).catch(function () { saveViaAnchor(blob, filename); });
    } else { saveViaAnchor(blob, filename); }
  }

  async function generarPDFGlobal() {
    if (!esAdmin()) return;
    toast("Generando reporte...", "ok");
    let rows = incidentes;
    if (sb && navigator.onLine) {
      const res = await sb.from("incidentes").select("*").order("folio", { ascending: true });
      if (!res.error) rows = res.data || [];
    }
    const jsPDF = window.jspdf.jsPDF;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const M = 12, W = 210, H = 297, usableW = W - 2 * M;
    let y = M;
    const cols = [
      { key: "folio", label: "#", w: 12 },
      { key: "tipo", label: "Tipo", w: 40 },
      { key: "estado", label: "Estado", w: 24 },
      { key: "comuna", label: "Comuna", w: 30 },
      { key: "comandante", label: "Comandante", w: 34 },
      { key: "inicio", label: "Inicio", w: 26 },
      { key: "pers", label: "Pers.", w: 12 },
      { key: "rec", label: "Rec.", w: 12 }
    ];
    const drawHeader = function () {
      doc.setFillColor(11, 114, 133); doc.rect(M, y, usableW, 7, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(255, 255, 255);
      let x = M; cols.forEach(function (c) { doc.text(c.label, x + 1.5, y + 4.8); x += c.w; });
      y += 7;
    };
    y = addLogoPDF(doc, W, y, 26) + 4;
    doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(11, 114, 133);
    doc.text("SAFE MEDICAL", W / 2, y, { align: "center" }); y += 8;
    doc.setFontSize(12); doc.text("REPORTE GENERAL DE INCIDENTES", W / 2, y, { align: "center" }); y += 6;
    doc.setFontSize(9.5); doc.setTextColor(80, 80, 80); doc.text("Emitido: " + todayLocal() + " " + nowHM(), W / 2, y, { align: "center" }); y += 6;
    doc.setDrawColor(11, 114, 133); doc.setLineWidth(0.6); doc.line(M, y, W - M, y); y += 8;
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(30, 30, 30);
    doc.text("Total de incidentes: " + rows.length, M, y); y += 8;
    drawHeader();
    rows.forEach(function (r, i) {
      if (y + 6 > H - M - 8) { doc.addPage(); y = M; drawHeader(); }
      if (i % 2 === 1) { doc.setFillColor(240, 245, 247); doc.rect(M, y, usableW, 6, "F"); }
      doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(30, 30, 30);
      const vals = [r.folio != null ? "#" + r.folio : "", r.tipo || "", r.estado || "", r.comuna || "", r.comandante || "",
        ((r.fecha_inicio || "") + " " + (r.hora_inicio || "")).trim(), String((r.personal || []).length), String((r.recursos || []).length)];
      let x = M;
      vals.forEach(function (v, j) {
        const t = (function (txt, w) {
          txt = String(txt);
          if (doc.getTextWidth(txt) <= w - 3) return txt;
          let q = txt; while (q.length && doc.getTextWidth(q + "…") > w - 3) q = q.slice(0, -1); return q + "…";
        })(v, cols[j].w);
        doc.text(t, x + 1.5, y + 4.2); x += cols[j].w;
      });
      doc.setDrawColor(222, 226, 230); doc.setLineWidth(0.2); doc.line(M, y + 6, M + usableW, y + 6);
      y += 6;
    });
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(120, 120, 120);
      doc.text("Reporte general de incidentes", M, H - 6);
      doc.text("Página " + p + " de " + pages, W - M, H - 6, { align: "right" });
    }
    const filename = "Reporte_Incidentes_" + rows.length + "_" + todayLocal() + ".pdf";
    const blob = doc.output("blob");
    const file = new File([blob], filename, { type: "application/pdf" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: "Reporte general" }).catch(function () { doc.save(filename); toast("Reporte generado", "ok"); });
    } else { doc.save(filename); toast("Reporte generado", "ok"); }
  }

  async function respaldoJSON() {
    if (!esAdmin()) return;
    toast("Preparando respaldo...", "ok");
    try {
      const all = await fetchAllFull();
      const payload = { generado: new Date().toISOString(), total: all.length, incidentes: all };
      descargarArchivo("Respaldo_Incidentes_" + todayLocal() + ".json", JSON.stringify(payload, null, 2), "application/json");
      toast("Respaldo JSON generado (" + all.length + " registros)", "ok");
    } catch (e) { toast("No se pudo generar el respaldo: " + traducir(e.message || e), "err"); }
  }

  async function respaldoCSV() {
    if (!esAdmin()) return;
    toast("Preparando respaldo...", "ok");
    try {
      const all = await fetchAllFull();
      const cols = ["folio", "tipo", "alerta", "estado", "fecha_inicio", "hora_inicio", "fecha_control", "hora_control",
        "direccion", "comuna", "cuadrante", "comandante", "punto_comando", "descripcion", "dispositivo",
        "creado_cliente", "sincronizado_at", "id", "user_id"];
      const lines = [];
      lines.push(cols.concat(["personal", "recursos", "equipos", "puesto_medico"]).map(csvCell).join(","));
      all.forEach(function (r) {
        const resumen = function (arr, campos) {
          return (arr || []).map(function (o, i) { return (i + 1) + ") " + campos.map(function (c) { return o[c]; }).filter(Boolean).join(" "); }).join(" | ");
        };
        const row = cols.map(function (c) { return r[c]; }).concat([
          resumen(r.personal, ["nombre", "cargo", "institucion", "contacto"]),
          resumen(r.recursos, ["tipo", "identificacion", "cantidad", "estado"]),
          resumen(r.equipos, ["nombre", "cantidad", "estado"]),
          r.puesto_medico ? JSON.stringify(r.puesto_medico) : ""
        ]);
        lines.push(row.map(csvCell).join(","));
      });
      descargarArchivo("Respaldo_Incidentes_" + todayLocal() + ".csv", "\ufeff" + lines.join("\r\n"), "text/csv");
      toast("Respaldo CSV generado (" + all.length + " registros)", "ok");
    } catch (e) { toast("No se pudo generar el respaldo: " + traducir(e.message || e), "err"); }
  }

  /* ---------------- Usuarios ---------------- */
  async function loadUsuarios() {
    if (!esAdmin()) return;
    const res = await sb.from("perfiles").select("id, email, nombre, rol, creado_at").order("creado_at", { ascending: true });
    usuariosCache = res.data || [];
    renderUsuarios(usuariosCache);
  }

  function renderUsuarios(rows) {
    const box = $("usuariosList");
    if (!rows.length) { box.innerHTML = '<div class="empty">Sin usuarios.</div>'; return; }
    box.innerHTML = rows.map(function (u) {
      const opts = ROLES.map(function (r) {
        return '<option value="' + r + '"' + (r === u.rol ? " selected" : "") + ">" + ROL_LABEL[r] + "</option>";
      }).join("");
      const soyYo = currentUser && u.id === currentUser.id;
      const delBtn = soyYo
        ? '<button class="btn-mini" disabled title="No puede eliminarse a sí mismo">USTED</button>'
        : '<button class="btn-mini danger" data-deluser="' + esc(u.id) + '">ELIMINAR</button>';
      return '<div class="user-row">' +
        '<div class="ur-info"><div class="ur-name">' + esc(u.nombre || "(sin nombre)") + '</div>' +
        '<div class="ur-email">' + esc(u.email || "") + "</div></div>" +
        '<div class="ur-actions"><select data-rol="' + esc(u.id) + '">' + opts + "</select>" + delBtn + "</div>" +
        "</div>";
    }).join("");
  }

  async function cambiarRol(id, nuevo) {
    const res = await sb.from("perfiles").update({ rol: nuevo }).eq("id", id);
    if (res.error) { toast("No se pudo cambiar el rol: " + traducir(res.error.message), "err"); return; }
    toast("Rol actualizado a " + (ROL_LABEL[nuevo] || nuevo), "ok");
    if (currentUser && id === currentUser.id) { await loadPerfil(); applyRole(); }
    loadUsuarios();
  }

  async function callAdminUsers(payload) {
    const base = String(cfg.SUPABASE_URL || "").replace(/\/+$/, "");
    if (!base) return { ok: false, status: 0, body: { error: "Falta SUPABASE_URL" }, sinFuncion: true };
    let token = cfg.SUPABASE_ANON_KEY || "";
    try {
      const s = await sb.auth.getSession();
      if (s.data && s.data.session && s.data.session.access_token) token = s.data.session.access_token;
    } catch (e) {}
    try {
      const resFetch = await fetch(base + "/functions/v1/admin-usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": cfg.SUPABASE_ANON_KEY || "", "Authorization": "Bearer " + token },
        body: JSON.stringify(payload)
      });
      let body = null;
      try { body = await resFetch.json(); } catch (e) {}
      return { ok: resFetch.ok, status: resFetch.status, body: body, sinFuncion: resFetch.status === 404 };
    } catch (e) { return { ok: false, status: 0, body: null, sinFuncion: true }; }
  }

  async function crearUsuario() {
    const email = val("uEmail");
    const password = val("uPassword");
    const nombre = val("uNombre");
    const r = val("uRol") || "RESCATISTA";
    if (!email || !password) { toast("Ingrese correo y contraseña", "err"); return; }
    if (password.length < 6) { toast("La contraseña debe tener al menos 6 caracteres", "err"); return; }
    setBtn("btnCrearUsuario", true, "CREAR USUARIO");
    const res = await callAdminUsers({ accion: "crear", email: email, password: password, nombre: nombre, rol: r });
    if (res.ok && res.body && res.body.ok) {
      setBtn("btnCrearUsuario", false, "CREAR USUARIO");
      setVal("uEmail", ""); setVal("uPassword", ""); setVal("uNombre", "");
      toast("Usuario creado: " + email, "ok"); loadUsuarios(); return;
    }
    if (!res.sinFuncion) {
      setBtn("btnCrearUsuario", false, "CREAR USUARIO");
      toast(traducir(res.body && res.body.error ? res.body.error : "No se pudo crear el usuario"), "err"); return;
    }
    const res2 = await sbAdmin.auth.signUp({ email: email, password: password, options: { data: { nombre: nombre } } });
    if (res2.error) { setBtn("btnCrearUsuario", false, "CREAR USUARIO"); toast(traducir(res2.error.message), "err"); return; }
    const uid = res2.data && res2.data.user ? res2.data.user.id : null;
    if (uid) {
      const upd = await sb.from("perfiles").update({ rol: r, nombre: nombre || email }).eq("id", uid);
      if (upd.error) toast("Usuario creado, pero no se pudo asignar el rol: " + traducir(upd.error.message), "err");
    }
    setBtn("btnCrearUsuario", false, "CREAR USUARIO");
    setVal("uEmail", ""); setVal("uPassword", ""); setVal("uNombre", "");
    toast("Usuario creado: " + email, "ok"); loadUsuarios();
  }

  async function eliminarUsuario(id) {
    if (!esAdmin()) return;
    if (currentUser && id === currentUser.id) { toast("No puede eliminarse a sí mismo", "err"); return; }
    const u = usuariosCache.filter(function (x) { return x.id === id; })[0];
    const etq = u ? (u.nombre || u.email) : id;
    if (!confirm('¿Eliminar al usuario "' + etq + '"? Esta acción no se puede deshacer.')) return;
    const res = await callAdminUsers({ accion: "eliminar", id: id });
    if (res.ok && res.body && res.body.ok) { toast("Usuario eliminado: " + etq, "ok"); loadUsuarios(); return; }
    if (res.sinFuncion) {
      const del = await sb.from("perfiles").delete().eq("id", id);
      if (del.error) { toast("No se pudo eliminar: " + traducir(del.error.message), "err"); return; }
      toast("Usuario deshabilitado (perfil eliminado): " + etq, "ok"); loadUsuarios(); return;
    }
    toast(traducir(res.body && res.body.error ? res.body.error : "No se pudo eliminar el usuario"), "err");
  }

  /* ---------------- Arranque ---------------- */
  async function enterApp(user) {
    currentUser = user;
    $("userEmail").textContent = user.email || "";
    $("loginView").classList.add("hidden");
    $("appView").classList.remove("hidden");
    let okPerfil = await loadPerfil();
    if (!okPerfil) { await new Promise(function (r) { setTimeout(r, 900); }); okPerfil = await loadPerfil(); }
    if (!okPerfil) {
      currentUser = null; currentPerfil = null;
      $("appView").classList.add("hidden"); $("loginView").classList.remove("hidden");
      loginMsg("Usuario no autorizado. Solicite al administrador que le asigne un perfil.", false);
      try { await sb.auth.signOut(); } catch (e) {}
      return;
    }
    applyRole();
    resetForm();
    updateConn();
    await refreshPending();
    syncPending();
    subscribeRealtime();
    await loadIncidentes();
    if (puedeVerTodo()) loadRealtime();
    showTab("lista");
  }

  async function initAuth() {
    const res = await sb.auth.getSession();
    const session = res.data ? res.data.session : null;
    if (session && session.user) enterApp(session.user);
    else $("loginView").classList.remove("hidden");

    sb.auth.onAuthStateChange(function (event, session2) {
      if (event === "SIGNED_OUT") {
        currentUser = null; currentPerfil = null;
        $("appView").classList.add("hidden"); $("loginView").classList.remove("hidden");
      } else if (session2 && session2.user && !currentUser) {
        enterApp(session2.user);
      }
    });
  }

  function wire() {
    $("btnLogin").addEventListener("click", doLogin);
    $("btnSignup").addEventListener("click", doSignup);
    $("btnLogout").addEventListener("click", doLogout);
    $("loginPassword").addEventListener("keydown", function (e) { if (e.key === "Enter") doLogin(); });

    $("tabs").addEventListener("click", function (e) {
      const tab = e.target.closest(".tab");
      if (tab) showTab(tab.getAttribute("data-tab"));
    });

    $("btnIrNuevo").addEventListener("click", nuevoIncidente);
    $("btnAddPersonal").addEventListener("click", function () { addRow("personal"); });
    $("btnAddRecurso").addEventListener("click", function () { addRow("recursos"); });
    $("btnAddEquipo").addEventListener("click", function () { addRow("equipos"); });
    $("pmSi").addEventListener("change", function () { togglePm(true); });
    $("pmNo").addEventListener("change", function () { togglePm(false); });

    $("btnGuardar").addEventListener("click", guardar);
    $("btnVerInforme").addEventListener("click", verInformeActual);
    $("btnLimpiar").addEventListener("click", function () { if (confirm("¿Limpiar el formulario actual? Los datos no guardados se perderán.")) resetForm(); });
    $("btnCancelEdit").addEventListener("click", function () { resetForm(); showTab("nuevo"); });

    $("buscador").addEventListener("input", renderLista);
    $("filtroEstado").addEventListener("change", renderLista);
    $("btnRefresh").addEventListener("click", function () { loadIncidentes(); loadRealtime(); });

    $("btnSyncNow").addEventListener("click", function () { refreshPending(); syncPending(); });

    $("listaIncidentes").addEventListener("click", function (e) {
      const v = e.target.closest("[data-ver-inc]"); if (v) return verIncidente(v.getAttribute("data-ver-inc"));
      const ed = e.target.closest("[data-edit-inc]"); if (ed) return editarIncidente(ed.getAttribute("data-edit-inc"));
      const dl = e.target.closest("[data-del-inc]"); if (dl) return eliminarIncidente(dl.getAttribute("data-del-inc"));
    });

    $("realtimeList").addEventListener("click", function (e) {
      const v = e.target.closest("[data-ver-inc]"); if (v) return verIncidente(v.getAttribute("data-ver-inc"));
      const dl = e.target.closest("[data-del]"); if (dl) return eliminarIncidente(dl.getAttribute("data-del"));
    });

    $("btnInformePdf").addEventListener("click", informePDF);
    $("btnInformeWhatsapp").addEventListener("click", informeWhatsapp);
    $("btnInformeVolver").addEventListener("click", function () { showTab("lista"); });

    $("btnPdfGlobal").addEventListener("click", generarPDFGlobal);
    $("btnBackupJson").addEventListener("click", respaldoJSON);
    $("btnBackupCsv").addEventListener("click", respaldoCSV);

    $("btnCrearUsuario").addEventListener("click", crearUsuario);
    $("usuariosList").addEventListener("change", function (e) {
      const sel = e.target.closest("[data-rol]"); if (sel) cambiarRol(sel.getAttribute("data-rol"), sel.value);
    });
    $("usuariosList").addEventListener("click", function (e) {
      const del = e.target.closest("[data-deluser]"); if (del) eliminarUsuario(del.getAttribute("data-deluser"));
    });

    window.addEventListener("online", function () { updateConn(); loadRealtime(); syncPending(); loadIncidentes(); });
    window.addEventListener("offline", updateConn);
  }

  function main() {
    wire();
    $("loginOffline").style.display = navigator.onLine ? "none" : "block";
    setInterval(function () { if (navigator.onLine && currentUser) syncPending(); }, 45000);
    const ok = initSupabase();
    if (ok) initAuth();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main);
  else main();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }
})();
