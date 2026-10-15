(function () {
  "use strict";

  const cfg = window.CONFIG || {};
  const DB_NAME = "atencion_pacientes";
  const STORE = "registros";
  const ROLES = ["ADMINISTRADOR", "MEDICO", "ENFERMERIA", "TENS", "RESCATISTA"];
  const ROL_LABEL = { ADMINISTRADOR: "ADMINISTRADOR", MEDICO: "MÉDICO", ENFERMERIA: "ENFERMERA(O)", TENS: "TENS", RESCATISTA: "RESCATISTA" };
  function rolLabel(r) { return ROL_LABEL[r] || r; }
  const UNITS = { fc: "(LTM)", fr: "(RPM)", sat: "(% AMBIENTE)", egt: "(MG/DL)" };

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
  let currentRecordId = null;
  let currentFolio = null;
  let realtimeChannel = null;
  let syncing = false;
  let toastTimer;
  let usuariosCache = [];

  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => Array.prototype.slice.call(document.querySelectorAll(sel));
  const val = (id) => { const el = $(id); return el ? el.value.trim() : ""; };

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
    rb.textContent = rolLabel(r);
    rb.className = "badge badge-role badge-rol-" + r;
    $("usuariosCard").classList.toggle("hidden", !esAdmin());
    $("reportesCard").classList.toggle("hidden", !esAdmin());
    $("realtimeCard").classList.toggle("hidden", !puedeVerTodo());
    if (esAdmin()) loadUsuarios();
    if (!puedeVerTodo()) {
      $("realtimeList").innerHTML = '<div class="empty">Su rol solo permite ingresar información.</div>';
    }
  }

  function subscribeRealtime() {
    if (!sb || realtimeChannel || !puedeVerTodo()) return;
    realtimeChannel = sb.channel("atenciones-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "atenciones" }, function () { loadRealtime(); })
      .subscribe(function (status) {
        $("liveDot").classList.toggle("on", status === "SUBSCRIBED");
      });
  }

  async function loadRealtime() {
    if (!sb || !navigator.onLine || !puedeVerTodo()) return;
    const res = await sb.from("atenciones")
      .select("id, folio, nombre, run, quien_atiende, fecha, hora, creado_cliente, signos(id)")
      .order("creado_cliente", { ascending: false })
      .limit(50);
    if (res.error) return;
    renderRealtime(res.data || []);
  }

  function renderRealtime(rows) {
    const box = $("realtimeList");
    if (!rows.length) { box.innerHTML = '<div class="empty">Sin registros todavía.</div>'; return; }
    box.innerHTML = rows.map(function (r) {
      const n = (r.signos || []).length;
      let tags = "";
      if (r.folio != null) tags += '<span class="tag">#' + esc(r.folio) + "</span>";
      if (r.run) tags += '<span class="tag">RUN ' + esc(r.run) + "</span>";
      if (n) tags += '<span class="tag">' + n + " toma(s) SV</span>";
      const actions = esAdmin()
        ? '<div class="rt-actions"><button class="btn-mini dark" data-edit="' + esc(r.id) + '">Editar</button><button class="btn-mini danger" data-del="' + esc(r.id) + '">Eliminar</button></div>'
        : "";
      return '<div class="rt-item">' +
        '<div class="rt-name">' + esc(r.nombre || "(sin nombre)") + "</div>" +
        '<div class="rt-meta">' + esc(r.fecha || "") + " " + esc(r.hora || "") + " · " + esc(r.quien_atiende || "") + "</div>" +
        '<div class="rt-tags">' + tags + "</div>" + actions +
        "</div>";
    }).join("");
  }

  function updateConn() {
    const online = navigator.onLine;
    const b = $("connBadge");
    b.textContent = online ? "En línea" : "Offline";
    b.className = "badge " + (online ? "badge-online" : "badge-offline");
    $("syncBanner").classList.toggle("hidden", online);
    if (!online) $("syncBannerText").textContent = "Sin conexión. Los datos quedan guardados en este dispositivo.";
    if (online) { loadRealtime(); syncPending(); }
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
        const payload = Object.assign({}, rec.atencion, {
          user_id: currentUser ? currentUser.id : null,
          creado_cliente: rec.creado_cliente,
          sincronizado_at: new Date().toISOString()
        });
        const r1 = await sb.from("atenciones").upsert(payload, { onConflict: "id" }).select("folio").maybeSingle();
        if (r1.error) throw r1.error;
        if (r1.data && r1.data.folio != null) {
          rec.folio = r1.data.folio;
          if (currentRecordId === rec.id) { currentFolio = rec.folio; $("folio").value = "#" + rec.folio; }
        }
        if (rec.signos && rec.signos.length) {
          const rows = rec.signos.map(function (s) { return Object.assign({}, s, { atencion_id: rec.atencion.id }); });
          const r2 = await sb.from("signos").upsert(rows, { onConflict: "id" });
          if (r2.error) throw r2.error;
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
    }
  }

  function tomaHTML(n) {
    return '' +
      '<div class="toma" data-seccion="signos">' +
        '<div class="toma-head">' +
          '<span class="toma-title">SIGNOS VITALES ' + n + "</span>" +
          '<button type="button" class="remove-btn" data-remove>×</button>' +
        "</div>" +
        '<div class="row">' +
          '<label class="field"><span>Hora</span><input type="time" data-field="hora" value="' + nowHM() + '" readonly></label>' +
          '<label class="field"><span>PA</span><input type="text" data-field="pa" placeholder="120/80"></label>' +
        "</div>" +
        '<div class="row">' +
          '<label class="field"><span>FC <span class="unit">(LTM)</span></span><input type="text" data-field="fc" inputmode="numeric"></label>' +
          '<label class="field"><span>FR <span class="unit">(RPM)</span></span><input type="text" data-field="fr" inputmode="numeric"></label>' +
        "</div>" +
        '<div class="row">' +
          '<label class="field"><span>SAT <span class="unit">(% AMBIENTE)</span></span><input type="text" data-field="sat"></label>' +
          '<label class="field"><span>EGT <span class="unit">(MG/DL)</span></span><input type="text" data-field="egt"></label>' +
        "</div>" +
        '<div class="row">' +
          '<label class="field"><span>T°</span><input type="text" data-field="temp"></label>' +
          '<label class="field"><span>EVA</span><input type="text" data-field="eva"></label>' +
        "</div>" +
        '<label class="field"><span>CINCINNATI</span><input type="text" data-field="cincinnati"></label>' +
      "</div>";
  }

  function fillToma(node, d) {
    const set = function (f, v) { const i = node.querySelector('[data-field="' + f + '"]'); if (i) i.value = v == null ? "" : v; };
    ["hora", "pa", "fc", "fr", "sat", "egt", "temp", "eva", "cincinnati"].forEach(function (f) { set(f, d[f]); });
    if (d.id) node.dataset.id = d.id;
  }

  function renumber(list) {
    list.querySelectorAll(".toma").forEach(function (el, i) {
      const t = el.querySelector(".toma-title");
      if (t) t.textContent = "SIGNOS VITALES " + (i + 1);
    });
  }

  function addToma(data) {
    const list = $("signosList");
    const n = list.querySelectorAll(".toma").length + 1;
    const wrap = document.createElement("div");
    wrap.innerHTML = tomaHTML(n);
    const node = wrap.firstElementChild;
    node.querySelector("[data-remove]").addEventListener("click", function () { node.remove(); renumber(list); });
    list.appendChild(node);
    if (data) fillToma(node, data);
    renumber(list);
  }

  function toggleControl(show, autoAdd) {
    $("controlContainer").classList.toggle("hidden", !show);
    if (show) {
      if (autoAdd !== false && $("signosList").querySelectorAll(".toma").length === 0) addToma();
    } else {
      $("signosList").innerHTML = "";
    }
  }

  function toggleTraslado(show) {
    $("trasladoContainer").classList.toggle("hidden", !show);
  }

  function readToma(el, orden) {
    const g = function (f) { const i = el.querySelector('[data-field="' + f + '"]'); return i ? i.value.trim() : ""; };
    if (!el.dataset.id) el.dataset.id = uuid();
    return {
      id: el.dataset.id, seccion: "signos", orden: orden,
      hora: g("hora"), pa: g("pa"), fc: g("fc"), fr: g("fr"),
      sat: g("sat"), egt: g("egt"), temp: g("temp"), eva: g("eva"), cincinnati: g("cincinnati")
    };
  }

  function cargosSeleccionados() {
    return $$("#cargoAtiendeGroup input:checked").map(function (c) { return c.value; }).join(", ");
  }

  function marcarCargos(valor) {
    const set = String(valor || "").split(",").map(function (s) { return s.trim(); });
    $$("#cargoAtiendeGroup input").forEach(function (c) { c.checked = set.indexOf(c.value) >= 0; });
  }

  function collect() {
    const traslado = $("trasladoSi").checked ? "SI" : ($("trasladoNo").checked ? "NO" : "");
    const atencion = {
      id: currentRecordId || uuid(),
      fecha: val("fecha"),
      hora: val("hora"),
      cargo_atiende: cargosSeleccionados(),
      quien_atiende: val("quienAtiende"),
      nombre: val("nombre"),
      run: val("run"),
      edad: val("edad"),
      domicilio: val("domicilio"),
      fono: val("fono"),
      enfermedades_base: val("enfermedades"),
      medicamentos: val("medicamentos"),
      motivo_consulta: val("motivoConsulta"),
      tratamiento: val("tratamiento"),
      medicamentos_admin: val("medicamentosAdmin"),
      traslado: traslado,
      traslado_lugar: traslado === "SI" ? val("trasladoLugar") : "",
      traslado_ambulancia: traslado === "SI" ? val("trasladoAmbulancia") : "",
      traslado_personal: traslado === "SI" ? val("trasladoPersonal") : "",
      dispositivo: cfg.DISPOSITIVO || ""
    };
    const signos = [];
    $$("#signosList .toma").forEach(function (el, i) { signos.push(readToma(el, i + 1)); });
    return { atencion: atencion, signos: signos };
  }

  async function guardar() {
    const data = collect();
    if (!data.atencion.nombre) { toast("Ingrese el nombre del lesionado", "err"); return; }
    currentRecordId = data.atencion.id;
    const rec = {
      id: data.atencion.id,
      atencion: data.atencion,
      signos: data.signos,
      folio: currentFolio,
      synced: false,
      creado_cliente: new Date().toISOString()
    };
    await idbPut(rec);
    toast(navigator.onLine ? "Guardado. Sincronizando..." : "Guardado en el dispositivo", "ok");
    await refreshPending();
    syncPending();
  }

  function resetForm() {
    currentRecordId = null;
    currentFolio = null;
    $("folio").value = "";
    $("fecha").value = todayLocal();
    $("hora").value = nowHM();
    ["quienAtiende", "nombre", "run", "edad", "domicilio", "fono", "enfermedades", "medicamentos", "motivoConsulta", "tratamiento", "medicamentosAdmin", "trasladoLugar", "trasladoAmbulancia", "trasladoPersonal"].forEach(function (id) {
      const el = $(id);
      if (el) el.value = "";
    });
    marcarCargos("");
    $("signosList").innerHTML = "";
    $("controlSi").checked = false;
    $("controlNo").checked = false;
    toggleControl(false);
    $("trasladoSi").checked = false;
    $("trasladoNo").checked = false;
    toggleTraslado(false);
    showEditBanner(false);
  }

  function nuevoPaciente() {
    const conDatos = ["nombre", "run", "edad", "domicilio", "fono", "motivoConsulta", "tratamiento", "medicamentosAdmin"].some(function (id) { return val(id); });
    if (conDatos && !confirm("¿Iniciar un nuevo paciente? Se limpiará el formulario actual y los datos no guardados se perderán.")) return;
    resetForm();
    $("fecha").value = todayLocal();
    $("hora").value = nowHM();
    try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (e) { window.scrollTo(0, 0); }
    toast("Nuevo paciente listo", "ok");
  }

  function showEditBanner(on, texto) {
    $("editBanner").classList.toggle("hidden", !on);
    if (on) $("editBannerText").textContent = texto || "";
  }

  async function loadAtencion(id) {
    if (!esAdmin()) return;
    const res = await sb.from("atenciones").select("*, signos(*)").eq("id", id).maybeSingle();
    if (res.error || !res.data) { toast("No se pudo cargar el informe", "err"); return; }
    const a = res.data;
    currentRecordId = a.id;
    currentFolio = a.folio;
    $("folio").value = a.folio != null ? "#" + a.folio : "";
    $("fecha").value = a.fecha || todayLocal();
    $("hora").value = a.hora || nowHM();
    marcarCargos(a.cargo_atiende);
    $("quienAtiende").value = a.quien_atiende || "";
    $("nombre").value = a.nombre || "";
    $("run").value = a.run || "";
    $("edad").value = a.edad || "";
    $("domicilio").value = a.domicilio || "";
    $("fono").value = a.fono || "";
    $("enfermedades").value = a.enfermedades_base || "";
    $("medicamentos").value = a.medicamentos || "";
    $("medicamentosAdmin").value = a.medicamentos_admin || "";
    $("motivoConsulta").value = a.motivo_consulta || "";
    $("tratamiento").value = a.tratamiento || "";
    const tras = a.traslado || "";
    $("trasladoSi").checked = (tras === "SI");
    $("trasladoNo").checked = (tras === "NO");
    toggleTraslado(tras === "SI");
    $("trasladoLugar").value = a.traslado_lugar || "";
    $("trasladoAmbulancia").value = a.traslado_ambulancia || "";
    $("trasladoPersonal").value = a.traslado_personal || "";

    $("signosList").innerHTML = "";
    const list = (a.signos || []).slice().sort(function (x, y) { return (x.orden || 0) - (y.orden || 0); });
    if (list.length) {
      $("controlSi").checked = true;
      toggleControl(true, false);
      list.forEach(function (s) { addToma(s); });
    } else {
      $("controlNo").checked = true;
      toggleControl(false);
    }
    showEditBanner(true, "Editando informe #" + (a.folio != null ? a.folio : "") + " (solo ADMINISTRADOR puede guardar cambios)");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function eliminarAtencion(id) {
    if (!esAdmin()) { toast("Solo ADMINISTRADOR puede eliminar", "err"); return; }
    if (!confirm("¿Eliminar este informe? Esta acción no se puede deshacer.")) return;
    const res = await sb.from("atenciones").delete().eq("id", id);
    if (res.error) { toast("No se pudo eliminar: " + traducir(res.error.message), "err"); return; }
    toast("Informe eliminado", "ok");
    if (currentRecordId === id) resetForm();
    loadRealtime();
  }

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
        return '<option value="' + r + '"' + (r === u.rol ? " selected" : "") + ">" + rolLabel(r) + "</option>";
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
    toast("Rol actualizado a " + rolLabel(nuevo), "ok");
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
        headers: {
          "Content-Type": "application/json",
          "apikey": cfg.SUPABASE_ANON_KEY || "",
          "Authorization": "Bearer " + token
        },
        body: JSON.stringify(payload)
      });
      let body = null;
      try { body = await resFetch.json(); } catch (e) {}
      return { ok: resFetch.ok, status: resFetch.status, body: body, sinFuncion: resFetch.status === 404 };
    } catch (e) {
      return { ok: false, status: 0, body: null, sinFuncion: true };
    }
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
      $("uEmail").value = ""; $("uPassword").value = ""; $("uNombre").value = "";
      toast("Usuario creado: " + email, "ok");
      loadUsuarios();
      return;
    }
    if (!res.sinFuncion) {
      setBtn("btnCrearUsuario", false, "CREAR USUARIO");
      const m = res.body && res.body.error ? res.body.error : "No se pudo crear el usuario";
      toast(traducir(m), "err");
      return;
    }
    const res2 = await sbAdmin.auth.signUp({ email: email, password: password, options: { data: { nombre: nombre } } });
    if (res2.error) {
      setBtn("btnCrearUsuario", false, "CREAR USUARIO");
      toast(traducir(res2.error.message), "err");
      return;
    }
    const uid = res2.data && res2.data.user ? res2.data.user.id : null;
    if (uid) {
      const upd = await sb.from("perfiles").update({ rol: r, nombre: nombre || email }).eq("id", uid);
      if (upd.error) toast("Usuario creado, pero no se pudo asignar el rol: " + traducir(upd.error.message), "err");
    }
    setBtn("btnCrearUsuario", false, "CREAR USUARIO");
    $("uEmail").value = ""; $("uPassword").value = ""; $("uNombre").value = "";
    toast("Usuario creado: " + email, "ok");
    loadUsuarios();
  }

  async function eliminarUsuario(id) {
    if (!esAdmin()) return;
    if (currentUser && id === currentUser.id) { toast("No puede eliminarse a sí mismo", "err"); return; }
    const u = usuariosCache.filter(function (x) { return x.id === id; })[0];
    const etq = u ? (u.nombre || u.email) : id;
    if (!confirm('¿Eliminar al usuario "' + etq + '"? Esta acción no se puede deshacer.')) return;
    const res = await callAdminUsers({ accion: "eliminar", id: id });
    if (res.ok && res.body && res.body.ok) {
      toast("Usuario eliminado: " + etq, "ok");
      loadUsuarios();
      return;
    }
    if (res.sinFuncion) {
      const del = await sb.from("perfiles").delete().eq("id", id);
      if (del.error) { toast("No se pudo eliminar: " + traducir(del.error.message), "err"); return; }
      toast("Usuario deshabilitado (perfil eliminado): " + etq, "ok");
      loadUsuarios();
      return;
    }
    const m = res.body && res.body.error ? res.body.error : "No se pudo eliminar el usuario";
    toast(traducir(m), "err");
  }

  function addTomaSections(sections, signos) {
    signos.forEach(function (s, idx) {
      const items = [];
      if (s.hora) items.push({ label: "Hora", value: s.hora });
      if (s.pa) items.push({ label: "PA", value: s.pa });
      if (s.fc) items.push({ label: "FC", value: s.fc + " " + UNITS.fc });
      if (s.fr) items.push({ label: "FR", value: s.fr + " " + UNITS.fr });
      if (s.sat) items.push({ label: "SAT", value: s.sat + " " + UNITS.sat });
      if (s.egt) items.push({ label: "EGT", value: s.egt + " " + UNITS.egt });
      if (s.temp) items.push({ label: "T°", value: s.temp });
      if (s.eva) items.push({ label: "EVA", value: s.eva });
      if (s.cincinnati) items.push({ label: "CINCINNATI", value: s.cincinnati });
      if (items.length) sections.push({ title: "SIGNOS VITALES " + (idx + 1), items: items });
    });
  }

  function buildModel() {
    const data = collect();
    const a = data.atencion;
    if (!a.nombre) return null;

    const sections = [];
    const head = [];
    if (currentFolio != null) head.push({ label: "ID / Folio", value: "#" + currentFolio });
    if (a.fecha) head.push({ label: "Fecha", value: a.fecha });
    if (a.hora) head.push({ label: "Hora", value: a.hora });
    if (a.cargo_atiende) head.push({ label: "Quién atiende", value: a.cargo_atiende });
    if (a.quien_atiende) head.push({ label: "Nombre de quien atiende", value: a.quien_atiende });
    if (head.length) sections.push({ title: "ATENCIÓN DE PACIENTES", items: head });

    const les = [];
    if (a.nombre) les.push({ label: "Nombre", value: a.nombre });
    if (a.run) les.push({ label: "RUN", value: a.run });
    if (a.edad) les.push({ label: "Edad", value: a.edad });
    if (a.domicilio) les.push({ label: "Domicilio", value: a.domicilio });
    if (a.fono) les.push({ label: "Fono", value: a.fono });
    if (les.length) sections.push({ title: "DATOS DEL LESIONADO", items: les });

    addTomaSections(sections, data.signos);

    if (a.enfermedades_base) sections.push({ title: "ENFERMEDADES DE BASE", items: [{ label: "", value: a.enfermedades_base }] });
    if (a.medicamentos) sections.push({ title: "MEDICAMENTOS", items: [{ label: "", value: a.medicamentos }] });
    if (a.motivo_consulta) sections.push({ title: "MOTIVO DE LA CONSULTA", items: [{ label: "", value: a.motivo_consulta }] });
    if (a.tratamiento) sections.push({ title: "TRATAMIENTO", items: [{ label: "", value: a.tratamiento }] });
    if (a.medicamentos_admin) sections.push({ title: "MEDICAMENTOS ADMINISTRADOS", items: [{ label: "", value: a.medicamentos_admin }] });

    if (a.traslado) {
      const tr = [{ label: "¿Se traslada?", value: a.traslado }];
      if (a.traslado === "SI") {
        if (a.traslado_lugar) tr.push({ label: "Lugar de traslado", value: a.traslado_lugar });
        if (a.traslado_ambulancia) tr.push({ label: "Ambulancia", value: a.traslado_ambulancia });
        if (a.traslado_personal) tr.push({ label: "Personal a cargo", value: a.traslado_personal });
      }
      sections.push({ title: "TRASLADO", items: tr });
    }

    return { paciente: a.nombre, fecha: a.fecha, folio: currentFolio, sections: sections };
  }

  function modelToWhatsapp(m) {
    let out = "";
    m.sections.forEach(function (sec) {
      out += "*" + sec.title + "*\n";
      sec.items.forEach(function (it) {
        if (it.label) out += "*" + it.label + ":* " + it.value + "\n";
        else out += it.value + "\n";
      });
      out += "\n";
    });
    return out.trim();
  }

  function enviarWhatsapp() {
    const m = buildModel();
    if (!m) { toast("Ingrese el nombre del lesionado", "err"); return; }
    const text = modelToWhatsapp(m);
    window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank");
  }

  function generarPDF() {
    const m = buildModel();
    if (!m) { toast("Ingrese el nombre del lesionado", "err"); return; }
    const jsPDF = window.jspdf.jsPDF;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const M = 14, W = 210, H = 297;
    let y = M;

    function ensure(sp) { if (y + sp > H - M) { doc.addPage(); y = M; } }

    y = addLogoPDF(doc, W, y, 28) + 4;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(11, 114, 133);
    doc.text("SAFE MEDICAL", W / 2, y, { align: "center" });
    y += 9;
    doc.setFontSize(14);
    doc.text("ATENCIÓN DE PACIENTES", W / 2, y, { align: "center" });
    y += 7;
    if (m.folio != null) {
      doc.setFontSize(11);
      doc.setTextColor(80, 80, 80);
      doc.text("ID / Folio: #" + m.folio, W / 2, y, { align: "center" });
      y += 6;
    }
    doc.setDrawColor(11, 114, 133);
    doc.setLineWidth(0.6);
    doc.line(M, y, W - M, y);
    y += 7;

    m.sections.forEach(function (sec) {
      ensure(10);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(11, 114, 133);
      doc.text(sec.title, M, y);
      y += 6;

      sec.items.forEach(function (it) {
        doc.setFontSize(11);
        doc.setTextColor(30, 30, 30);
        const maxW = W - 2 * M;
        if (it.label) {
          const label = it.label + ": ";
          doc.setFont("helvetica", "bold");
          const lw = doc.getTextWidth(label);
          const lines = doc.splitTextToSize(String(it.value), maxW - lw - 2);
          ensure(6);
          doc.text(label, M, y);
          doc.setFont("helvetica", "normal");
          doc.text(lines[0], M + lw, y);
          for (let i = 1; i < lines.length; i++) { y += 6; ensure(6); doc.text(lines[i], M, y); }
        } else {
          doc.setFont("helvetica", "normal");
          const lines = doc.splitTextToSize(String(it.value), maxW);
          lines.forEach(function (ln) { ensure(6); doc.text(ln, M, y); y += 6; });
          y -= 6;
        }
        y += 6;
      });
      y += 3;
    });

    const base = m.folio != null ? "Folio_" + m.folio + "_" : "";
    const safe = (m.paciente || "paciente").replace(/[^\w\-]+/g, "_").slice(0, 40);
    const filename = "Atencion_" + base + safe + "_" + (m.fecha || "") + ".pdf";
    const blob = doc.output("blob");
    const file = new File([blob], filename, { type: "application/pdf" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: "Atención de pacientes", text: "Registro de atención" })
        .catch(function () { doc.save(filename); toast("PDF generado", "ok"); });
    } else {
      doc.save(filename);
      toast("PDF generado", "ok");
    }
  }

  function fitText(doc, text, maxW) {
    text = String(text == null ? "" : text);
    if (doc.getTextWidth(text) <= maxW) return text;
    let t = text;
    while (t.length > 0 && doc.getTextWidth(t + "\u2026") > maxW) t = t.slice(0, -1);
    return t + "\u2026";
  }

  async function fetchTodasAtenciones() {
    if (sb && navigator.onLine) {
      try {
        const res = await sb.from("atenciones")
          .select("id, folio, nombre, run, edad, fecha, hora, cargo_atiende, quien_atiende, traslado, traslado_lugar, creado_cliente, signos(id)")
          .order("folio", { ascending: true });
        if (!res.error && res.data) return { rows: res.data, local: false };
      } catch (e) {}
    }
    const local = await idbAll();
    const rows = local.map(function (r) {
      return Object.assign({}, r.atencion, { folio: r.folio, signos: r.signos || [] });
    });
    rows.sort(function (a, b) {
      const fa = a.folio == null ? Infinity : a.folio;
      const fb = b.folio == null ? Infinity : b.folio;
      return fa - fb;
    });
    return { rows: rows, local: true };
  }

  async function generarPDFGlobal() {
    if (!esAdmin()) return;
    toast("Generando reporte...", "ok");
    const data = await fetchTodasAtenciones();
    const rows = data.rows;
    const total = rows.length;

    const jsPDF = window.jspdf.jsPDF;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const M = 12, W = 210, H = 297;
    const usableW = W - 2 * M;
    const cols = [
      { key: "folio", label: "#", w: 10 },
      { key: "nombre", label: "Nombre", w: 44 },
      { key: "run", label: "RUN", w: 24 },
      { key: "edad", label: "Edad", w: 10 },
      { key: "fecha", label: "Fecha", w: 20 },
      { key: "hora", label: "Hora", w: 12 },
      { key: "cargo_atiende", label: "Quién atiende", w: 30 },
      { key: "traslado", label: "Traslado", w: 26 },
      { key: "sv", label: "SV", w: 10 }
    ];
    let y = M;

    function drawTableHeader() {
      doc.setFillColor(11, 114, 133);
      doc.rect(M, y, usableW, 7, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(255, 255, 255);
      let x = M;
      cols.forEach(function (c) { doc.text(c.label, x + 1.5, y + 4.8); x += c.w; });
      y += 7;
    }

    y = addLogoPDF(doc, W, y, 28) + 4;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(11, 114, 133);
    doc.text("SAFE MEDICAL", W / 2, y, { align: "center" });
    y += 9;
    doc.setFontSize(14);
    doc.text("ATENCIÓN DE PACIENTES", W / 2, y, { align: "center" });
    y += 7;
    doc.setFontSize(11);
    doc.setTextColor(80, 80, 80);
    doc.text("REPORTE GENERAL DE ATENCIONES", W / 2, y, { align: "center" });
    y += 6;
    doc.setFontSize(9.5);
    doc.text("Emitido: " + todayLocal() + " " + nowHM(), W / 2, y, { align: "center" });
    y += 6;
    doc.setDrawColor(11, 114, 133);
    doc.setLineWidth(0.6);
    doc.line(M, y, W - M, y);
    y += 8;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(30, 30, 30);
    doc.text("Total de pacientes atendidos: " + total, M, y);
    y += 8;
    if (data.local) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(170, 70, 70);
      doc.text("(Sin conexión: listado local de este dispositivo)", M, y);
      y += 6;
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(200, 40, 40);
    doc.text("En rojo: pacientes trasladados a un centro asistencial.", M, y);
    doc.setTextColor(30, 30, 30);
    y += 6;

    drawTableHeader();

    rows.forEach(function (r, i) {
      if (y + 6 > H - M - 8) { doc.addPage(); y = M; drawTableHeader(); }
      if (i % 2 === 1) { doc.setFillColor(240, 245, 247); doc.rect(M, y, usableW, 6, "F"); }
      doc.setFontSize(9);
      const trasladoSi = (r.traslado === "SI");
      const vals = [
        r.folio != null ? "#" + r.folio : "",
        r.nombre || "",
        r.run || "",
        r.edad || "",
        r.fecha || "",
        r.hora || "",
        r.cargo_atiende || "",
        trasladoSi ? ("SI - " + (r.traslado_lugar || "")) : (r.traslado === "NO" ? "No" : ""),
        String((r.signos || []).length)
      ];
      let x = M;
      vals.forEach(function (v, j) {
        const rojo = (cols[j].key === "traslado") && trasladoSi;
        doc.setFont("helvetica", rojo ? "bold" : "normal");
        doc.setTextColor(rojo ? 200 : 30, rojo ? 40 : 30, rojo ? 40 : 30);
        doc.text(fitText(doc, v, cols[j].w - 3), x + 1.5, y + 4.2);
        x += cols[j].w;
      });
      doc.setDrawColor(222, 226, 230);
      doc.setLineWidth(0.2);
      doc.line(M, y + 6, M + usableW, y + 6);
      y += 6;
    });

    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text("Atención de Pacientes - Reporte general", M, H - 6);
      doc.text("Página " + p + " de " + pages, W - M, H - 6, { align: "right" });
    }

    const filename = "Reporte_Atenciones_" + total + "_" + todayLocal() + ".pdf";
    const blob = doc.output("blob");
    const file = new File([blob], filename, { type: "application/pdf" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: "Reporte general", text: "Total de pacientes atendidos: " + total })
        .catch(function () { doc.save(filename); toast("Reporte generado", "ok"); });
    } else {
      doc.save(filename);
      toast("Reporte generado", "ok");
    }
  }

  async function fetchAllAtencionesFull() {
    if (!sb || !navigator.onLine) throw new Error("Necesita conexión para generar el respaldo");
    const pageSize = 1000;
    let from = 0;
    let all = [];
    for (;;) {
      const res = await sb.from("atenciones")
        .select("*, signos(*)")
        .order("folio", { ascending: true })
        .range(from, from + pageSize - 1);
      if (res.error) throw res.error;
      const chunk = res.data || [];
      all = all.concat(chunk);
      if (chunk.length < pageSize) break;
      from += pageSize;
    }
    return all;
  }

  function csvCell(v) {
    const s = String(v == null ? "" : v);
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function saveViaAnchor(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  function descargarArchivo(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: filename }).catch(function () { saveViaAnchor(blob, filename); });
    } else {
      saveViaAnchor(blob, filename);
    }
  }

  async function respaldoJSON() {
    if (!esAdmin()) return;
    toast("Preparando respaldo...", "ok");
    try {
      const all = await fetchAllAtencionesFull();
      const payload = { generado: new Date().toISOString(), total: all.length, atenciones: all };
      descargarArchivo("Respaldo_Atenciones_" + todayLocal() + ".json", JSON.stringify(payload, null, 2), "application/json");
      toast("Respaldo JSON generado (" + all.length + " registros)", "ok");
    } catch (e) {
      toast("No se pudo generar el respaldo: " + traducir(e.message || e), "err");
    }
  }

  async function respaldoCSV() {
    if (!esAdmin()) return;
    toast("Preparando respaldo...", "ok");
    try {
      const all = await fetchAllAtencionesFull();
      const cols = ["folio", "fecha", "hora", "cargo_atiende", "quien_atiende", "nombre", "run", "edad",
        "domicilio", "fono", "enfermedades_base", "medicamentos", "motivo_consulta", "tratamiento", "medicamentos_admin",
        "traslado", "traslado_lugar", "traslado_ambulancia", "traslado_personal", "dispositivo",
        "creado_cliente", "sincronizado_at", "id", "user_id"];
      const lines = [];
      lines.push(cols.concat(["signos"]).map(csvCell).join(","));
      all.forEach(function (r) {
        const sig = (r.signos || []).map(function (s, i) {
          const parts = [];
          ["hora", "pa", "fc", "fr", "sat", "egt", "temp", "eva", "cincinnati"].forEach(function (f) {
            if (s[f]) parts.push(f.toUpperCase() + " " + s[f]);
          });
          return (i + 1) + ") " + parts.join(" ");
        }).join(" | ");
        const row = cols.map(function (c) { return r[c]; }).concat([sig]);
        lines.push(row.map(csvCell).join(","));
      });
      descargarArchivo("Respaldo_Atenciones_" + todayLocal() + ".csv", "\ufeff" + lines.join("\r\n"), "text/csv");
      toast("Respaldo CSV generado (" + all.length + " registros)", "ok");
    } catch (e) {
      toast("No se pudo generar el respaldo: " + traducir(e.message || e), "err");
    }
  }

  async function enterApp(user) {
    currentUser = user;
    $("userEmail").textContent = user.email || "";
    $("loginView").classList.add("hidden");
    $("appView").classList.remove("hidden");
    let okPerfil = await loadPerfil();
    if (!okPerfil) { await new Promise(function (r) { setTimeout(r, 900); }); okPerfil = await loadPerfil(); }
    if (!okPerfil) {
      currentUser = null;
      currentPerfil = null;
      $("appView").classList.add("hidden");
      $("loginView").classList.remove("hidden");
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
    if (puedeVerTodo()) loadRealtime();
  }

  async function initAuth() {
    const res = await sb.auth.getSession();
    const session = res.data ? res.data.session : null;
    if (session && session.user) enterApp(session.user);
    else $("loginView").classList.remove("hidden");

    sb.auth.onAuthStateChange(function (event, session2) {
      if (event === "SIGNED_OUT") {
        currentUser = null;
        currentPerfil = null;
        $("appView").classList.add("hidden");
        $("loginView").classList.remove("hidden");
      } else if (session2 && session2.user && !currentUser) {
        enterApp(session2.user);
      }
    });
  }

  function wire() {
    $("btnLogin").addEventListener("click", doLogin);
    $("btnSignup").addEventListener("click", doSignup);
    $("btnLogout").addEventListener("click", doLogout);
    $("btnAddSigno").addEventListener("click", function () { addToma(); });
    $("cargoAtiendeGroup").addEventListener("change", function (e) {
      if (e.target.checked) {
        $$("#cargoAtiendeGroup input").forEach(function (b) { if (b !== e.target) b.checked = false; });
      }
    });
    $("controlSi").addEventListener("change", function () { toggleControl(true); });
    $("controlNo").addEventListener("change", function () { toggleControl(false); });
    $("trasladoSi").addEventListener("change", function () { toggleTraslado(true); });
    $("trasladoNo").addEventListener("change", function () { toggleTraslado(false); });
    $("btnWhatsapp").addEventListener("click", enviarWhatsapp);
    $("btnPdf").addEventListener("click", generarPDF);
    $("btnPdfGlobal").addEventListener("click", generarPDFGlobal);
    $("btnBackupJson").addEventListener("click", respaldoJSON);
    $("btnBackupCsv").addEventListener("click", respaldoCSV);
    $("btnGuardar").addEventListener("click", guardar);
    $("btnNuevoPaciente").addEventListener("click", nuevoPaciente);
    $("btnSyncNow").addEventListener("click", function () { refreshPending(); syncPending(); });
    $("btnCancelEdit").addEventListener("click", resetForm);
    $("btnCrearUsuario").addEventListener("click", crearUsuario);
    $("btnLimpiar").addEventListener("click", function () {
      if (confirm("¿Limpiar el formulario actual? Los datos no guardados se perderán.")) resetForm();
    });
    $("realtimeList").addEventListener("click", function (e) {
      const ed = e.target.closest("[data-edit]");
      const dl = e.target.closest("[data-del]");
      if (ed) loadAtencion(ed.getAttribute("data-edit"));
      if (dl) eliminarAtencion(dl.getAttribute("data-del"));
    });
    $("usuariosList").addEventListener("change", function (e) {
      const sel = e.target.closest("[data-rol]");
      if (sel) cambiarRol(sel.getAttribute("data-rol"), sel.value);
    });
    $("usuariosList").addEventListener("click", function (e) {
      const del = e.target.closest("[data-deluser]");
      if (del) eliminarUsuario(del.getAttribute("data-deluser"));
    });
    $("loginPassword").addEventListener("keydown", function (e) { if (e.key === "Enter") doLogin(); });
    window.addEventListener("online", function () { updateConn(); loadRealtime(); syncPending(); });
    window.addEventListener("offline", updateConn);
  }

  function main() {
    wire();
    $("fecha").value = todayLocal();
    $("hora").value = nowHM();
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
