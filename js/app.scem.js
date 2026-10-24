(function () {
  "use strict";

  const cfg = window.CONFIG || {};
  const DB_NAME = "scem_eventos_masivos_v3";
  const STORE_EV = "incidentes";
  const STORE_PAC = "atenciones";
  const ROLES = ["ADMINISTRADOR", "MEDICO", "ENFERMERIA", "TENS", "RESCATISTA"];
  const ROL_LABEL = { ADMINISTRADOR: "ADMINISTRADOR", MEDICO: "MÉDICO", ENFERMERIA: "ENFERMERA(O)", TENS: "TENS", RESCATISTA: "RESCATISTA" };
  const CARGO_LABEL = { MEDICO: "Médico", ENFERMERIA: "Enfermera(o)", KINESIOLOGO: "Kinesiólogo(a)", TENS: "TENS", RESCATISTA: "Rescatista", CONDUCTOR: "Conductor", PSICOLOGO: "Psicólogo(a)", LOGISTICA: "Logística", OTRO: "Otro" };
  const UNITS = { fc: "(LTM)", fr: "(RPM)", sat: "(% AMBIENTE)", egt: "(MG/DL)" };
  const AMB_CLASIF = [
    { v: "", l: "Seleccione..." },
    { v: "Básica", l: "Básica" },
    { v: "Mediana complejidad", l: "Mediana complejidad" },
    { v: "Alta complejidad", l: "Alta complejidad" }
  ];
  const AMB_ROLE_LABEL = { conductor: "Conductor", tens: "TENS", enfermero: "Enfermero(a)", medico: "Médico" };
  const AMB_ROLES_CLASIF = {
    "Básica": ["conductor", "tens"],
    "Mediana complejidad": ["conductor", "tens", "enfermero"],
    "Alta complejidad": ["conductor", "tens", "enfermero", "medico"]
  };
  const CARGO_EXTRA = { TENS: "sis", ENFERMERIA: "sis", MEDICO: "rcm", KINESIOLOGO: "rcm", PSICOLOGO: "rcm" };

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
  let evChannel = null;
  let pacChannel = null;
  let syncingEv = false;
  let syncingPac = false;
  let toastTimer;
  let usuariosCache = [];
  let incidentes = [];
  let editId = null;
  let currentFolio = null;
  let informeInc = null;
  let pEditId = null;
  let pCurrentFolio = null;

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
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = function (e) {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_EV)) db.createObjectStore(STORE_EV, { keyPath: "id" });
        if (!db.objectStoreNames.contains(STORE_PAC)) db.createObjectStore(STORE_PAC, { keyPath: "id" });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  async function idbPut(store, obj) {
    const db = await openDB();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(obj);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  async function idbAll(store) {
    const db = await openDB();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(store, "readonly");
      const r = tx.objectStore(store).getAll();
      r.onsuccess = function () { resolve(r.result || []); };
      r.onerror = function () { reject(r.error); };
    });
  }

  async function idbDelete(store, id) {
    const db = await openDB();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(id);
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
    if (sb) {
      if (evChannel) { sb.removeChannel(evChannel); evChannel = null; }
      if (pacChannel) { sb.removeChannel(pacChannel); pacChannel = null; }
    }
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
    if (name === "pacientes") { loadRealtimePac(); cargarSelectorEventos(); }
    try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (e) { window.scrollTo(0, 0); }
  }

  /* ---------------- Funcionarios (personal) ---------------- */
  function personalItems() {
    return readRows("personal");
  }

  function funcOptionsHTML(selected) {
    const persons = personalItems();
    if (!persons.length) return '<div class="hint" style="margin:0">Agregue personal desplegado para asignarlo aquí.</div>';
    return persons.map(function (p) {
      const checked = selected.indexOf(p.id) >= 0 ? " checked" : "";
      const lbl = (p.nombre || "(sin nombre)") + (p.cargo ? " · " + (CARGO_LABEL[p.cargo] || p.cargo) : "");
      return '<label><input type="checkbox" value="' + esc(p.id) + '"' + checked + "> " + esc(lbl) + "</label>";
    }).join("");
  }

  function refreshFuncionarios() {
    $$("[data-func-group]").forEach(function (group) {
      const checked = Array.prototype.map.call(group.querySelectorAll("input:checked"), function (c) { return c.value; });
      group.innerHTML = funcOptionsHTML(checked);
    });
  }

  /* ---------------- Filas dinámicas ---------------- */
  const ROW_SPECS = {
    personal: {
      listId: "personalList", title: "PERSONAL", hasFunc: false,
      fields: [
        { key: "nombre", label: "Nombre", type: "text" },
        { key: "run", label: "RUN", type: "text" },
        { key: "cargo", label: "Cargo", type: "select", options: Object.keys(CARGO_LABEL).map(function (k) { return { v: k, l: CARGO_LABEL[k] }; }) },
        { key: "contacto", label: "Contacto", type: "tel" },
        { key: "hora_llegada", label: "Hora llegada", type: "time" }
      ]
    },
    recursos: {
      listId: "recursosList", title: "RECURSO", hasFunc: false,
      fields: [
        { key: "tipo", label: "Tipo", type: "select", options: ["Ambulancia", "Carro bomba", "Vehículo de rescate", "Vehículo de apoyo", "Helicóptero", "Alimentación", "Agua", "Combustible", "Maquinaria", "Otro"].map(function (o) { return { v: o, l: o }; }) },
        { key: "identificacion", label: "Identificación", type: "text" },
        { key: "cantidad", label: "Cantidad", type: "number" },
        { key: "estado", label: "Estado", type: "select", options: ["Operativo", "En uso", "Fuera de servicio"].map(function (o) { return { v: o, l: o }; }) },
        { key: "observacion", label: "Observación", type: "text" }
      ]
    },
    equipos: {
      listId: "equiposList", title: "EQUIPO", hasFunc: true,
      fields: [
        { key: "nombre", label: "Equipo", type: "text" },
        { key: "observacion", label: "Observación", type: "text" }
      ]
    },
    puestos: {
      listId: "puestosList", title: "PUESTO MÉDICO", hasFunc: true,
      fields: [
        { key: "ubicacion", label: "Ubicación", type: "text" },
        { key: "responsable", label: "Responsable", type: "text" },
        { key: "atenciones", label: "Atenciones", type: "number" },
        { key: "derivaciones", label: "Derivaciones", type: "number" },
        { key: "observaciones", label: "Observaciones", type: "text" }
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
    const ph = f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : "";
    return '<label>' + esc(f.label) + "<input" + itype + ph + ' data-field="' + f.key + '" value="' + esc(v) + '"></label>';
  }

  function rowHTML(type, n, data) {
    const spec = ROW_SPECS[type];
    const fields = spec.fields.map(function (f) { return fieldInput(f, data ? data[f.key] : ""); }).join("");
    const idAttr = (data && data.id) ? ' data-id="' + esc(data.id) + '"' : "";
    let funcBlock = "";
    if (spec.hasFunc) {
      const sel = (data && data.funcionarios) ? data.funcionarios : [];
      funcBlock = '<div class="func-block"><span class="subtitle">Funcionarios asignados</span>' +
        '<div class="func-group" data-func-group>' + funcOptionsHTML(sel) + "</div></div>";
    }
    let extraBlock = "";
    if (type === "personal") extraBlock = '<div class="cargo-extra" data-cargo-extra></div>';
    if (type === "recursos") extraBlock = '<div class="amb-block" data-amb></div>';
    return '<div class="toma" data-row="' + type + '"' + idAttr + ">" +
      '<div class="toma-head"><span class="toma-title">' + spec.title + " " + n + "</span>" +
      '<button type="button" class="remove-btn" data-remove>×</button></div>' +
      '<div class="form-grid">' + fields + "</div>" + extraBlock + funcBlock +
      "</div>";
  }

  function addRow(type, data) {
    const spec = ROW_SPECS[type];
    const list = $(spec.listId);
    const n = list.querySelectorAll('.toma[data-row="' + type + '"]').length + 1;
    const wrap = document.createElement("div");
    wrap.innerHTML = rowHTML(type, n, data);
    const node = wrap.firstElementChild;
    if (type === "personal" && !node.dataset.id) node.dataset.id = uuid();
    node.querySelector("[data-remove]").addEventListener("click", function () {
      node.remove(); renumberRows(type); if (spec.hasFunc || type === "personal") refreshFuncionarios();
    });
    if (type === "personal") {
      const cs = node.querySelector('[data-field="cargo"]');
      if (cs) cs.addEventListener("change", function () { syncCargoExtra(node); });
      syncCargoExtra(node, data);
    }
    if (type === "recursos") {
      const ts = node.querySelector('[data-field="tipo"]');
      if (ts) ts.addEventListener("change", function () { syncAmbulancia(node); });
      syncAmbulancia(node, data);
    }
    list.appendChild(node);
    renumberRows(type);
    if (spec.hasFunc || type === "personal") refreshFuncionarios();
  }

  function renumberRows(type) {
    const spec = ROW_SPECS[type];
    $(spec.listId).querySelectorAll('.toma[data-row="' + type + '"]').forEach(function (el, i) {
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
      el.querySelectorAll("[data-field]").forEach(function (i) {
        obj[i.getAttribute("data-field")] = i.value.trim();
      });
      if (spec.hasFunc) {
        const g = el.querySelector("[data-func-group]");
        obj.funcionarios = g ? Array.prototype.map.call(g.querySelectorAll("input:checked"), function (c) { return c.value; }) : [];
      }
      const tiene = Object.keys(obj).some(function (k) { return k !== "id" && String(obj[k] || "").length; }) || (spec.hasFunc && obj.funcionarios.length);
      if (tiene) { if (!obj.id) obj.id = uuid(); out.push(obj); }
    });
    return out;
  }

  function nombresFuncionarios(ids, personal) {
    const map = {};
    (personal || []).forEach(function (p) { map[p.id] = p; });
    return (ids || []).map(function (id) {
      const p = map[id];
      if (!p) return null;
      return (p.nombre || "(sin nombre)") + (p.cargo ? " (" + (CARGO_LABEL[p.cargo] || p.cargo) + ")" : "");
    }).filter(Boolean);
  }

  /* ---------------- Importar personal desde Excel ---------------- */
  const CARGO_ALIAS = {
    "medico": "MEDICO", "medica": "MEDICO", "doctor": "MEDICO", "doctora": "MEDICO", "dr": "MEDICO", "dra": "MEDICO",
    "enfermeria": "ENFERMERIA", "enfermero": "ENFERMERIA", "enfermera": "ENFERMERIA",
    "kinesiologo": "KINESIOLOGO", "kinesiologa": "KINESIOLOGO", "kinesiologo a": "KINESIOLOGO",
    "tens": "TENS", "tecnico en enfermeria": "TENS", "tecnico": "TENS",
    "rescatista": "RESCATISTA", "rescatista voluntario": "RESCATISTA",
    "conductor": "CONDUCTOR", "chofer": "CONDUCTOR",
    "psicologo": "PSICOLOGO", "psicologa": "PSICOLOGO", "psicologo a": "PSICOLOGO",
    "logistica": "LOGISTICA",
    "otro": "OTRO"
  };

  function normTxt(s) {
    return String(s == null ? "" : s).toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ").trim();
  }

  function cargoDesdeTexto(raw) {
    const n = normTxt(raw);
    if (!n) return "";
    const directo = Object.keys(CARGO_LABEL).filter(function (k) {
      return normTxt(k) === n || normTxt(CARGO_LABEL[k]) === n;
    })[0];
    if (directo) return directo;
    return CARGO_ALIAS[n] || "";
  }

  function celdaExcel(obj, nombres) {
    for (let i = 0; i < nombres.length; i++) {
      for (const k in obj) {
        if (normTxt(k) === nombres[i] && String(obj[k] == null ? "" : obj[k]).trim()) return String(obj[k]).trim();
      }
    }
    return "";
  }

  function normalizarHora(v) {
    const m = String(v || "").match(/(\d{1,2}):(\d{2})/);
    if (!m) return "";
    return String(m[1]).padStart(2, "0") + ":" + m[2];
  }

  function importarPersonalExcel(file) {
    if (!file) return;
    if (!window.XLSX) { toast("No se pudo cargar la librería de Excel", "err"); return; }
    const reader = new FileReader();
    reader.onload = function (ev) {
      try {
        const wb = XLSX.read(new Uint8Array(ev.target.result), { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        if (!ws) { toast("El Excel no tiene hojas", "err"); return; }
        const filas = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
        const existentes = {};
        readRows("personal").forEach(function (p) {
          existentes[normTxt(p.nombre) + "|" + normTxt(p.run)] = true;
        });
        let agregados = 0, repetidos = 0;
        filas.forEach(function (r) {
          const nombre1 = celdaExcel(r, ["nombre completo", "nombre", "nombre funcionario", "funcionario"]);
          const apellido = celdaExcel(r, ["apellidos", "apellido"]);
          let nombre = nombre1;
          if (nombre1 && apellido && normTxt(nombre1).indexOf(normTxt(apellido)) < 0) nombre = nombre1 + " " + apellido;
          const run = celdaExcel(r, ["run", "rut", "cedula", "documento", "identificacion"]);
          const cargoTxt = celdaExcel(r, ["cargo", "rol", "funcion", "perfil"]);
          const contacto = celdaExcel(r, ["contacto", "fono", "telefono", "celular", "movil", "whatsapp"]);
          const hora = normalizarHora(celdaExcel(r, ["hora llegada", "hora de llegada", "hora"]));
          const sis = celdaExcel(r, ["sis"]);
          const rcm = celdaExcel(r, ["rcm"]);
          if (!nombre && !run && !cargoTxt) return;
          const cargo = cargoDesdeTexto(cargoTxt) || (cargoTxt ? "OTRO" : "");
          const firma = normTxt(nombre) + "|" + normTxt(run);
          if (firma !== "|" && existentes[firma]) { repetidos++; return; }
          existentes[firma] = true;
          addRow("personal", {
            nombre: nombre, run: run, cargo: cargo, contacto: contacto,
            hora_llegada: hora, sis: sis, rcm: rcm
          });
          agregados++;
        });
        refreshFuncionarios();
        if (agregados) toast(agregados + " integrante(s) importado(s)" + (repetidos ? " · " + repetidos + " ya existían" : ""), "ok");
        else if (repetidos) toast("Todos los integrantes ya estaban en la lista", "err");
        else toast("No se encontraron filas válidas. Encabezados esperados: Nombre, RUN, Cargo, Contacto, Hora, SIS/RCM.", "err");
      } catch (e) {
        console.warn("Error import Excel:", e);
        toast("No se pudo leer el Excel: " + (e && e.message ? e.message : e), "err");
      }
    };
    reader.onerror = function () { toast("No se pudo abrir el archivo", "err"); };
    reader.readAsArrayBuffer(file);
  }

  /* ---------------- Campos dinámicos: personal (SIS/RCM) y ambulancias ---------------- */
  function personalExtra(p) {
    if (!p) return "";
    if (p.sis) return "SIS: " + p.sis;
    if (p.rcm) return "RCM: " + p.rcm;
    return "";
  }

  function esAmbulancia(p) {
    return String((p && p.tipo) || "").toLowerCase() === "ambulancia";
  }

  function ambRoleFields(role) {
    const fields = [
      { key: "amb_" + role + "_nombre", label: "Nombre", placeholder: "Nombre completo" },
      { key: "amb_" + role + "_run", label: "RUN", placeholder: "12.345.678-9" },
      { key: "amb_" + role + "_fono", label: "Fono", type: "tel", placeholder: "+56 9 ..." }
    ];
    if (role === "medico") fields.push({ key: "amb_medico_rcm", label: "RCM", placeholder: "Números y signos" });
    else if (role !== "conductor") fields.push({ key: "amb_" + role + "_sis", label: "SIS", placeholder: "Números" });
    return fields;
  }

  function ambCrewRows(p) {
    const out = [];
    ["conductor", "tens", "enfermero", "medico"].forEach(function (role) {
      const nombre = p["amb_" + role + "_nombre"], run = p["amb_" + role + "_run"], fono = p["amb_" + role + "_fono"];
      let extraLabel = "", extra = "";
      if (role === "medico") { extraLabel = "RCM"; extra = p["amb_medico_rcm"]; }
      else if (role !== "conductor") { extraLabel = "SIS"; extra = p["amb_" + role + "_sis"]; }
      if (nombre || run || fono || extra) {
        out.push({ label: AMB_ROLE_LABEL[role], nombre: nombre, run: run, fono: fono, extraLabel: extraLabel, extra: extra });
      }
    });
    return out;
  }

  function syncCargoExtra(node, source) {
    const box = node.querySelector("[data-cargo-extra]");
    if (!box) return;
    const cs = node.querySelector('[data-field="cargo"]');
    const key = cs ? CARGO_EXTRA[cs.value] : "";
    if (!key) { box.innerHTML = ""; return; }
    let value = "";
    if (source) value = source[key] || "";
    else { const cur = box.querySelector("[data-field]"); value = (cur && cur.getAttribute("data-field") === key) ? cur.value : ""; }
    box.innerHTML = '<div class="form-grid">' +
      fieldInput({ key: key, label: key.toUpperCase(), placeholder: "Números y signos" }, value) + "</div>";
  }

  function syncAmbulancia(node, source) {
    const block = node.querySelector("[data-amb]");
    if (!block) return;
    const ts = node.querySelector('[data-field="tipo"]');
    const tipo = ts ? ts.value : "";
    if (String(tipo).toLowerCase() !== "ambulancia") { block.innerHTML = ""; return; }

    const prev = {};
    if (source) {
      Object.keys(source).forEach(function (k) { if (k.indexOf("amb") === 0) prev[k] = source[k]; });
    } else {
      block.querySelectorAll("[data-field]").forEach(function (i) { prev[i.getAttribute("data-field")] = i.value; });
    }
    const clasif = prev.ambulancia || "";
    const selHTML = fieldInput({ key: "ambulancia", label: "Clasificación de la ambulancia", type: "select", options: AMB_CLASIF }, clasif);
    let html = '<span class="subtitle">Ambulancia</span><div class="form-grid">' + selHTML + "</div>";
    const roles = AMB_ROLES_CLASIF[clasif] || [];
    if (roles.length) {
      html += '<div class="amb-crew">' + roles.map(function (role) {
        const fields = ambRoleFields(role).map(function (f) { return fieldInput(f, prev[f.key]); }).join("");
        return '<div class="amb-role"><div class="role-title">' + esc(AMB_ROLE_LABEL[role]) + '</div><div class="form-grid">' + fields + "</div></div>";
      }).join("") + "</div>";
    }
    block.innerHTML = html;
    const csel = block.querySelector('[data-field="ambulancia"]');
    if (csel) csel.addEventListener("change", function () { syncAmbulancia(node); });
  }

  /* ---------------- Formulario EVENTO ---------------- */
  function collect() {
    return {
      id: editId || uuid(),
      tipo: val("tipo"),
      nivel: val("nivel"),
      estado: val("estado") || "Activo",
      fecha_inicio: val("fechaInicio"),
      hora_inicio: val("horaInicio"),
      fecha_control: val("fechaControl"),
      hora_control: val("horaControl"),
      direccion: val("direccion"),
      comuna: val("comuna"),
      recinto: val("recinto"),
      encargado: val("encargado"),
      punto_comando: val("puntoComando"),
      descripcion: val("descripcion"),
      personal: readRows("personal"),
      recursos: readRows("recursos"),
      equipos: readRows("equipos"),
      puesto_medico: readRows("puestos"),
      dispositivo: cfg.DISPOSITIVO || ""
    };
  }

  function resetForm() {
    editId = null;
    currentFolio = null;
    setVal("folio", "");
    setVal("tipo", "");
    setVal("nivel", "");
    setVal("estado", "Activo");
    setVal("fechaInicio", todayLocal());
    setVal("horaInicio", nowHM());
    setVal("fechaControl", "");
    setVal("horaControl", "");
    ["direccion", "comuna", "recinto", "encargado", "puntoComando", "descripcion"].forEach(function (id) { setVal(id, ""); });
    ["personalList", "recursosList", "equiposList", "puestosList"].forEach(function (id) { $(id).innerHTML = ""; });
    $("formTitulo").textContent = "Nuevo evento";
    showEditBanner(false);
  }

  function fillForm(inc) {
    editId = inc.id;
    currentFolio = inc.folio != null ? inc.folio : null;
    setVal("folio", inc.folio != null ? "#" + inc.folio : "");
    setVal("tipo", inc.tipo || "");
    setVal("nivel", inc.nivel || "");
    setVal("estado", inc.estado || "Activo");
    setVal("fechaInicio", inc.fecha_inicio || todayLocal());
    setVal("horaInicio", inc.hora_inicio || nowHM());
    setVal("fechaControl", inc.fecha_control || "");
    setVal("horaControl", inc.hora_control || "");
    setVal("direccion", inc.direccion || "");
    setVal("comuna", inc.comuna || "");
    setVal("recinto", inc.recinto || "");
    setVal("encargado", inc.encargado || "");
    setVal("puntoComando", inc.punto_comando || "");
    setVal("descripcion", inc.descripcion || "");

    ["personalList", "recursosList", "equiposList", "puestosList"].forEach(function (id) { $(id).innerHTML = ""; });
    (inc.personal || []).forEach(function (p) { addRow("personal", p); });
    (inc.recursos || []).forEach(function (p) { addRow("recursos", p); });
    (inc.equipos || []).forEach(function (p) { addRow("equipos", p); });
    const puestos = Array.isArray(inc.puesto_medico) ? inc.puesto_medico : [];
    puestos.forEach(function (p) { addRow("puestos", p); });
    refreshFuncionarios();

    $("formTitulo").textContent = "Editar evento" + (inc.folio != null ? " #" + inc.folio : "");
    showEditBanner(true, "Editando evento" + (inc.folio != null ? " #" + inc.folio : "") + (esAdmin() ? "" : " (solo ADMINISTRADOR puede guardar cambios)"));
  }

  function showEditBanner(on, texto) {
    $("editBanner").classList.toggle("hidden", !on);
    if (on) $("editBannerText").textContent = texto || "";
  }

  async function guardar() {
    const inc = collect();
    if (!inc.tipo && !inc.direccion && !inc.descripcion) {
      toast("Ingrese al menos el tipo, la dirección o la descripción del evento", "err");
      return;
    }
    editId = inc.id;
    const rec = { id: inc.id, inc: inc, folio: currentFolio, synced: false, creado_cliente: new Date().toISOString() };
    await idbPut(STORE_EV, rec);
    toast(navigator.onLine ? "Guardado. Sincronizando..." : "Guardado en el dispositivo", "ok");
    await refreshPending();
    syncPending();
    resetForm();
    showTab("lista");
  }

  function nuevoEvento() {
    if (editId) { toast("Ya está editando un evento. Guarde o limpie el formulario.", "err"); return; }
    resetForm();
    setVal("fechaInicio", todayLocal());
    setVal("horaInicio", nowHM());
    showTab("nuevo");
    toast("Nuevo evento listo", "ok");
  }

  /* ---------------- Lista de eventos ---------------- */
  function mergeIncidentes(serverRows, localRows) {
    const byId = {};
    localRows.forEach(function (r) {
      const inc = Object.assign({}, r.inc, { id: r.id, folio: r.folio });
      inc._pendiente = !r.synced;
      byId[r.id] = inc;
    });
    (serverRows || []).forEach(function (r) {
      const existente = byId[r.id];
      byId[r.id] = Object.assign({}, r, { _server: true });
      if (existente && (r.folio == null) && existente.folio != null) byId[r.id].folio = existente.folio;
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
    const localRows = await idbAll(STORE_EV);
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
      const blob = [i.folio, i.tipo, i.direccion, i.comuna, i.recinto, i.encargado, i.nivel, i.descripcion].join(" ").toLowerCase();
      return blob.indexOf(q) >= 0;
    });
  }

  function estadoClass(e) {
    if (e === "Activo") return "badge rojo";
    if (e === "Controlado") return "badge ambar";
    if (e === "Cerrado") return "badge gris";
    return "badge azul";
  }

  function renderLista() {
    const box = $("listaIncidentes");
    const rows = filtrados();
    if (!rows.length) { box.innerHTML = '<div class="vacio">No hay eventos que mostrar.</div>'; return; }
    box.innerHTML = rows.map(function (i) {
      const np = (i.personal || []).length;
      const nr = (i.recursos || []).length;
      const ne = (i.equipos || []).length;
      const estado = i.estado || "Activo";
      const cls = estado === "Activo" ? "estado-activo" : (estado === "Controlado" ? "estado-espera" : "estado-gris");
      const nivel = i.nivel ? '<span class="etiqueta">Nivel ' + esc(i.nivel) + "</span>" : "";
      const pend = i._pendiente ? '<span class="badge badge-pending">Pendiente</span>' : "";
      return '<div class="tarjeta ' + cls + '">' +
        '<div class="fila"><span class="titulo">' + esc(i.tipo || "(sin tipo)") + "</span>" +
        '<span class="' + estadoClass(estado) + '">' + esc(estado) + "</span></div>" +
        '<div class="sub">' + (i.folio != null ? "#" + esc(i.folio) + " · " : "") + esc(i.direccion || "") + (i.recinto ? " · " + esc(i.recinto) : "") + (i.comuna ? ", " + esc(i.comuna) : "") + "</div>" +
        '<div class="datos">' +
          '<div class="d">Encargado(a): <b>' + esc(i.encargado || "—") + "</b></div>" +
          '<div class="d">Inicio: <b>' + esc(i.fecha_inicio || "") + " " + esc(i.hora_inicio || "") + "</b></div>" +
          '<div class="d">Personal: <b>' + np + "</b></div>" +
          '<div class="d">Recursos: <b>' + nr + "</b></div>" +
          '<div class="d">Equipos: <b>' + ne + "</b></div>" +
          '<div class="d">' + nivel + " " + pend + "</div>" +
        "</div>" +
        '<div class="pie-tarjeta">' +
          '<button class="btn btn-ghost icono" data-ver-inc="' + esc(i.id) + '">Ver informe</button>' +
          (esAdmin() ? '<button class="btn btn-secondary icono" data-edit-inc="' + esc(i.id) + '">Editar</button>' +
            '<button class="btn btn-danger icono" data-del-inc="' + esc(i.id) + '">Eliminar</button>' : "") +
        "</div>" +
        "</div>";
    }).join("");
  }

  function buscarIncidente(id) { return incidentes.filter(function (i) { return i.id === id; })[0] || null; }

  function verIncidente(id) {
    const inc = buscarIncidente(id);
    if (!inc) { toast("No se encontró el evento", "err"); return; }
    mostrarInforme(inc);
  }

  function editarIncidente(id) {
    if (!esAdmin()) { toast("Solo ADMINISTRADOR puede editar", "err"); return; }
    const inc = buscarIncidente(id);
    if (!inc) { toast("No se encontró el evento", "err"); return; }
    fillForm(inc);
    showTab("nuevo");
  }

  async function eliminarIncidente(id) {
    if (!esAdmin()) { toast("Solo ADMINISTRADOR puede eliminar", "err"); return; }
    if (!confirm("¿Eliminar este evento? Esta acción no se puede deshacer.")) return;
    if (sb && navigator.onLine) {
      const res = await sb.from("incidentes").delete().eq("id", id);
      if (res.error) { toast("No se pudo eliminar: " + traducir(res.error.message), "err"); return; }
    }
    await idbDelete(STORE_EV, id);
    if (editId === id) resetForm();
    toast("Evento eliminado", "ok");
    loadIncidentes();
    loadRealtime();
  }

  /* ---------------- Informe EVENTO ---------------- */
  function fmtFechaHora(f, h) { return (f || "") + (h ? " " + h : ""); }

  function buildInformeHTML(inc) {
    const personal = inc.personal || [];
    const recursos = inc.recursos || [];
    const equipos = inc.equipos || [];
    const puestos = Array.isArray(inc.puesto_medico) ? inc.puesto_medico : [];

    let html = '<div class="encabezado-informe"><div>' +
      "<h2>SAFE MEDICAL</h2>" +
      "<div>Sistema de Comando de Eventos Masivos</div>" +
      "<div>Informe de evento</div>" +
      "</div><div style=\"text-align:right\">" +
      '<div class="codigo">' + (inc.folio != null ? "#" + esc(inc.folio) : "#—") + "</div>" +
      "<div>" + esc(inc.tipo || "") + "</div>" +
      "<div>" + esc(inc.estado || "") + "</div>" +
      "</div></div>";

    html += "<h3>Identificación</h3><dl>";
    const add = function (k, v) { if (v) html += "<dt>" + esc(k) + "</dt><dd>" + esc(v) + "</dd>"; };
    add("Folio", inc.folio != null ? "#" + inc.folio : "");
    add("Tipo de Evento", inc.tipo);
    add("Nivel", inc.nivel);
    add("Estado", inc.estado);
    add("Inicio", fmtFechaHora(inc.fecha_inicio, inc.hora_inicio));
    add("Control", fmtFechaHora(inc.fecha_control, inc.hora_control));
    html += "</dl>";

    html += "<h3>Ubicación y organización</h3><dl>";
    add("Dirección", inc.direccion);
    add("Comuna", inc.comuna);
    add("Recinto", inc.recinto);
    add("Encargada(o) del evento", inc.encargado);
    add("Punto de comando", inc.punto_comando);
    html += "</dl>";

    if (inc.descripcion) html += "<h3>Descripción</h3><div class=\"bloque-txt\">" + esc(inc.descripcion) + "</div>";

    if (personal.length) {
      html += "<h3>Personal desplegado (" + personal.length + ")</h3><div class=\"tabla-wrap\"><table class=\"tabla\"><thead><tr><th>#</th><th>Nombre</th><th>RUN</th><th>Cargo</th><th>Contacto</th><th>SIS/RCM</th><th>Hora</th></tr></thead><tbody>";
      personal.forEach(function (p, i) {
        html += "<tr><td>" + (i + 1) + "</td><td>" + esc(p.nombre) + "</td><td>" + esc(p.run) + "</td><td>" + esc(CARGO_LABEL[p.cargo] || p.cargo) + "</td><td>" + esc(p.contacto) + "</td><td>" + esc(personalExtra(p)) + "</td><td>" + esc(p.hora_llegada) + "</td></tr>";
      });
      html += "</tbody></table></div>";
    }

    if (recursos.length) {
      html += "<h3>Recursos (" + recursos.length + ")</h3><div class=\"tabla-wrap\"><table class=\"tabla\"><thead><tr><th>#</th><th>Tipo</th><th>Identificación</th><th>Cantidad</th><th>Estado</th><th>Observación</th></tr></thead><tbody>";
      recursos.forEach(function (p, i) {
        const tipoTxt = esc(p.tipo) + (esAmbulancia(p) && p.ambulancia ? " · " + esc(p.ambulancia) : "");
        html += "<tr><td>" + (i + 1) + "</td><td>" + tipoTxt + "</td><td>" + esc(p.identificacion) + "</td><td>" + esc(p.cantidad) + "</td><td>" + esc(p.estado) + "</td><td>" + esc(p.observacion) + "</td></tr>";
      });
      html += "</tbody></table></div>";
    }

    const ambulancias = recursos.filter(esAmbulancia);
    if (ambulancias.length) {
      html += "<h3>Ambulancias (" + ambulancias.length + ")</h3>";
      ambulancias.forEach(function (p, i) {
        html += '<div class="bloque-txt"><b>Ambulancia ' + (i + 1) + "</b>" +
          (p.ambulancia ? " · " + esc(p.ambulancia) : "") +
          (p.identificacion ? " · " + esc(p.identificacion) : "") + "</div>";
        const crew = ambCrewRows(p);
        if (crew.length) {
          html += '<div class="tabla-wrap"><table class="tabla"><thead><tr><th>Rol</th><th>Nombre</th><th>RUN</th><th>Fono</th><th>SIS/RCM</th></tr></thead><tbody>';
          crew.forEach(function (c) {
            html += "<tr><td>" + esc(c.label) + "</td><td>" + esc(c.nombre) + "</td><td>" + esc(c.run) + "</td><td>" + esc(c.fono) + "</td><td>" + esc(c.extra) + "</td></tr>";
          });
          html += "</tbody></table></div>";
        }
      });
    }

    if (equipos.length) {
      html += "<h3>Equipos (" + equipos.length + ")</h3><div class=\"tabla-wrap\"><table class=\"tabla\"><thead><tr><th>#</th><th>Equipo</th><th>Funcionarios</th><th>Observación</th></tr></thead><tbody>";
      equipos.forEach(function (p, i) {
        const funcs = nombresFuncionarios(p.funcionarios, personal).join(", ");
        html += "<tr><td>" + (i + 1) + "</td><td>" + esc(p.nombre) + "</td><td>" + esc(funcs) + "</td><td>" + esc(p.observacion) + "</td></tr>";
      });
      html += "</tbody></table></div>";
    }

    if (puestos.length) {
      html += "<h3>Puestos médicos (" + puestos.length + ")</h3><div class=\"tabla-wrap\"><table class=\"tabla\"><thead><tr><th>#</th><th>Ubicación</th><th>Responsable</th><th>Atenciones</th><th>Derivaciones</th><th>Funcionarios</th><th>Observaciones</th></tr></thead><tbody>";
      puestos.forEach(function (p, i) {
        const funcs = nombresFuncionarios(p.funcionarios, personal).join(", ");
        html += "<tr><td>" + (i + 1) + "</td><td>" + esc(p.ubicacion) + "</td><td>" + esc(p.responsable) + "</td><td>" + esc(p.atenciones) + "</td><td>" + esc(p.derivaciones) + "</td><td>" + esc(funcs) + "</td><td>" + esc(p.observaciones) + "</td></tr>";
      });
      html += "</tbody></table></div>";
    }

    const pacientes = Array.isArray(inc._pacientes) ? inc._pacientes : [];
    if (pacientes.length) {
      html += "<h3>Pacientes atendidos (" + pacientes.length + ")</h3><div class=\"tabla-wrap\"><table class=\"tabla\"><thead><tr><th>#</th><th>Folio</th><th>Nombre</th><th>RUN</th><th>Edad</th><th>Fecha/Hora</th><th>Quién atiende</th></tr></thead><tbody>";
      pacientes.forEach(function (a, i) {
        html += "<tr><td>" + (i + 1) + "</td><td>" + esc(a.folio != null ? "#" + a.folio : "") + "</td><td>" + esc(a.nombre) + "</td><td>" + esc(a.run) + "</td><td>" + esc(a.edad) + "</td><td>" + esc(fmtFechaHora(a.fecha, a.hora)) + "</td><td>" + esc([a.cargo_atiende, a.quien_atiende].filter(Boolean).join(" · ")) + "</td></tr>";
      });
      html += "</tbody></table></div>";
    }

    return html;
  }

  async function mostrarInforme(inc) {
    informeInc = inc;
    inc._pacientes = await cargarPacientesEvento(inc.id);
    $("informeContenido").innerHTML = buildInformeHTML(inc);
    showTab("informe");
  }

  function verInformeActual() {
    const inc = collect();
    if (currentFolio != null) inc.folio = currentFolio;
    mostrarInforme(inc);
  }

  function informeTexto(inc) {
    const personal = inc.personal || [], recursos = inc.recursos || [], equipos = inc.equipos || [];
    const puestos = Array.isArray(inc.puesto_medico) ? inc.puesto_medico : [];
    const pacientes = Array.isArray(inc._pacientes) ? inc._pacientes : [];
    let out = "*SAFE MEDICAL*\n*Informe de evento* " + (inc.folio != null ? "#" + inc.folio : "") + "\n\n";
    const line = function (k, v) { if (v) out += "*" + k + ":* " + v + "\n"; };
    out += "*Identificación*\n";
    line("Tipo de Evento", inc.tipo); line("Nivel", inc.nivel); line("Estado", inc.estado);
    line("Inicio", fmtFechaHora(inc.fecha_inicio, inc.hora_inicio));
    line("Control", fmtFechaHora(inc.fecha_control, inc.hora_control));
    out += "*Ubicación y organización*\n";
    line("Dirección", inc.direccion); line("Comuna", inc.comuna); line("Recinto", inc.recinto);
    line("Encargada(o) del evento", inc.encargado); line("Punto de comando", inc.punto_comando);
    if (inc.descripcion) out += "\n*Descripción*\n" + inc.descripcion + "\n";
    if (personal.length) {
      out += "\n*Personal (" + personal.length + ")*\n";
      personal.forEach(function (p) { out += "- " + [p.nombre, p.run, CARGO_LABEL[p.cargo] || p.cargo, p.contacto, p.sis, p.rcm].filter(Boolean).join(" · ") + "\n"; });
    }
    if (recursos.length) {
      out += "\n*Recursos (" + recursos.length + ")*\n";
      recursos.forEach(function (p) { out += "- " + [p.tipo, p.ambulancia, p.identificacion, p.cantidad, p.estado].filter(Boolean).join(" · ") + "\n"; });
    }
    const ambulancias = recursos.filter(esAmbulancia).filter(function (p) { return ambCrewRows(p).length; });
    if (ambulancias.length) {
      out += "\n*Tripulación de ambulancias*\n";
      ambulancias.forEach(function (p) {
        out += "*Ambulancia:* " + [p.ambulancia, p.identificacion].filter(Boolean).join(" · ") + "\n";
        ambCrewRows(p).forEach(function (c) {
          out += "  - " + [c.label, c.nombre, c.run, c.fono, c.extra ? (c.extraLabel + ": " + c.extra) : ""].filter(Boolean).join(" · ") + "\n";
        });
      });
    }
    if (equipos.length) {
      out += "\n*Equipos (" + equipos.length + ")*\n";
      equipos.forEach(function (p) {
        const f = nombresFuncionarios(p.funcionarios, personal).join(", ");
        out += "- " + [p.nombre, f].filter(Boolean).join(": ") + "\n";
      });
    }
    if (puestos.length) {
      out += "\n*Puestos médicos (" + puestos.length + ")*\n";
      puestos.forEach(function (p, i) {
        const f = nombresFuncionarios(p.funcionarios, personal).join(", ");
        out += "- Puesto " + (i + 1) + ": " + [p.ubicacion, p.responsable, f && ("Funcionarios: " + f)].filter(Boolean).join(" · ") + "\n";
      });
    }
    if (pacientes.length) {
      out += "\n*Pacientes atendidos (" + pacientes.length + ")*\n";
      pacientes.forEach(function (a) {
        out += "- " + [a.folio != null ? "#" + a.folio : "", a.nombre, a.run, a.edad, a.cargo_atiende, a.quien_atiende].filter(Boolean).join(" · ") + "\n";
      });
    }
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
    const M = 14, W = 210, H = 297, usableW = W - 2 * M;
    let y = M;
    const ensure = function (sp) { if (y + sp > H - M) { doc.addPage(); y = M; } };

    y = addLogoPDF(doc, W, y, 26) + 4;
    doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(11, 114, 133);
    doc.text("SAFE MEDICAL", W / 2, y, { align: "center" }); y += 8;
    doc.setFontSize(12); doc.text("INFORME DE EVENTO", W / 2, y, { align: "center" }); y += 6;
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
    const tabla = function (head, rows, widths) {
      const total = usableW;
      let ws = widths || head.map(function () { return total / head.length; });
      const sum = ws.reduce(function (a, b) { return a + b; }, 0);
      ws = ws.map(function (w) { return w / sum * total; });
      ensure(8);
      doc.setFillColor(11, 114, 133); doc.rect(M, y, total, 6.5, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(255, 255, 255);
      let x = M;
      head.forEach(function (h, i) { doc.text(String(h), x + 1.5, y + 4.3); x += ws[i]; });
      y += 6.5;
      doc.setFont("helvetica", "normal"); doc.setTextColor(30, 30, 30);
      rows.forEach(function (r) {
        ensure(6.5);
        let xx = M;
        r.forEach(function (c, i) {
          const lines = doc.splitTextToSize(String(c == null ? "" : c), ws[i] - 3);
          doc.text(lines[0] || "", xx + 1.5, y + 4);
          xx += ws[i];
        });
        doc.setDrawColor(222, 226, 230); doc.setLineWidth(0.2); doc.line(M, y + 6.5, M + total, y + 6.5);
        y += 6.5;
      });
      y += 2;
    };

    titulo("Identificación");
    kv("Tipo de Evento", inc.tipo); kv("Nivel", inc.nivel); kv("Estado", inc.estado);
    kv("Inicio", fmtFechaHora(inc.fecha_inicio, inc.hora_inicio));
    kv("Control", fmtFechaHora(inc.fecha_control, inc.hora_control));
    titulo("Ubicación y organización");
    kv("Dirección", inc.direccion); kv("Comuna", inc.comuna); kv("Recinto", inc.recinto);
    kv("Encargada(o) del evento", inc.encargado); kv("Punto de comando", inc.punto_comando);
    if (inc.descripcion) { titulo("Descripción"); parrafo(inc.descripcion); }

    const personal = inc.personal || [], recursos = inc.recursos || [], equipos = inc.equipos || [];
    const puestos = Array.isArray(inc.puesto_medico) ? inc.puesto_medico : [];
    const pacientes = Array.isArray(inc._pacientes) ? inc._pacientes : [];
    if (personal.length) {
      titulo("Personal desplegado (" + personal.length + ")");
      tabla(["#", "Nombre", "RUN", "Cargo", "Contacto", "SIS/RCM"], personal.map(function (p, i) { return [i + 1, p.nombre, p.run, CARGO_LABEL[p.cargo] || p.cargo, p.contacto, personalExtra(p)]; }), [7, 42, 28, 32, 30, 27]);
    }
    if (recursos.length) {
      titulo("Recursos (" + recursos.length + ")");
      tabla(["#", "Tipo", "Identificación", "Cant.", "Estado"], recursos.map(function (p, i) { return [i + 1, p.tipo + (esAmbulancia(p) && p.ambulancia ? " · " + p.ambulancia : ""), p.identificacion, p.cantidad, p.estado]; }), [8, 48, 42, 16, 40]);
    }
    const ambulancias = recursos.filter(esAmbulancia);
    if (ambulancias.length) {
      titulo("Tripulación de ambulancias");
      ambulancias.forEach(function (p, i) {
        kv("Ambulancia " + (i + 1), [p.ambulancia, p.identificacion].filter(Boolean).join(" · "));
        ambCrewRows(p).forEach(function (c) {
          kv(c.label, [c.nombre, c.run, c.fono, c.extra ? (c.extraLabel + ": " + c.extra) : ""].filter(Boolean).join(" · "));
        });
      });
    }
    if (equipos.length) {
      titulo("Equipos (" + equipos.length + ")");
      tabla(["#", "Equipo", "Funcionarios", "Observación"], equipos.map(function (p, i) { return [i + 1, p.nombre, nombresFuncionarios(p.funcionarios, personal).join(", "), p.observacion]; }), [8, 40, 90, 40]);
    }
    if (puestos.length) {
      titulo("Puestos médicos (" + puestos.length + ")");
      puestos.forEach(function (p, i) {
        kv("Puesto " + (i + 1), p.ubicacion);
        kv("Responsable", p.responsable);
        kv("Atenciones", p.atenciones);
        kv("Derivaciones", p.derivaciones);
        kv("Funcionarios", nombresFuncionarios(p.funcionarios, personal).join(", "));
        kv("Observaciones", p.observaciones);
      });
    }

    if (pacientes.length) {
      titulo("Pacientes atendidos (" + pacientes.length + ")");
      tabla(["#", "Folio", "Nombre", "RUN", "Edad", "Quién atiende"], pacientes.map(function (a, i) { return [i + 1, a.folio != null ? "#" + a.folio : "", a.nombre, a.run, a.edad, [a.cargo_atiende, a.quien_atiende].filter(Boolean).join(" · ")]; }), [7, 16, 48, 30, 12, 43]);
    }

    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(120, 120, 120);
      doc.text("Sistema de Comando de Eventos Masivos", M, H - 6);
      doc.text("Página " + p + " de " + pages, W - M, H - 6, { align: "right" });
    }
    const filename = "Evento_" + (inc.folio != null ? "Folio_" + inc.folio + "_" : "") + todayLocal() + ".pdf";
    const blob = doc.output("blob");
    const file = new File([blob], filename, { type: "application/pdf" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: "Informe de evento" }).catch(function () { doc.save(filename); toast("PDF generado", "ok"); });
    } else { doc.save(filename); toast("PDF generado", "ok"); }
  }

  /* ---------------- Realtime EVENTOS ---------------- */
  function subscribeRealtime() {
    if (!sb) return;
    if (puedeVerTodo() && !evChannel) {
      evChannel = sb.channel("incidentes-live")
        .on("postgres_changes", { event: "*", schema: "public", table: "incidentes" }, function () { loadRealtime(); loadIncidentes(); })
        .subscribe(function (s) { $("liveDot").classList.toggle("on", s === "SUBSCRIBED"); });
    }
    if (!pacChannel) {
      pacChannel = sb.channel("atenciones-live")
        .on("postgres_changes", { event: "*", schema: "public", table: "atenciones" }, function () { loadRealtimePac(); })
        .subscribe(function (s) { $("pLiveDot").classList.toggle("on", s === "SUBSCRIBED"); });
    }
  }

  async function loadRealtime() {
    if (!sb || !navigator.onLine || !puedeVerTodo()) return;
    const res = await sb.from("incidentes")
      .select("id, folio, tipo, nivel, estado, comuna, direccion, encargado, creado_cliente, personal, recursos")
      .order("creado_cliente", { ascending: false }).limit(50);
    if (res.error) return;
    renderRealtime(res.data || []);
  }

  function renderRealtime(rows) {
    const box = $("realtimeList");
    if (!rows.length) { box.innerHTML = '<div class="empty">Sin registros todavía.</div>'; return; }
    box.innerHTML = rows.map(function (r) {
      const np = (r.personal || []).length, nr = (r.recursos || []).length;
      let tags = "";
      if (r.folio != null) tags += '<span class="tag">#' + esc(r.folio) + "</span>";
      if (r.nivel) tags += '<span class="tag">Nivel ' + esc(r.nivel) + "</span>";
      if (np) tags += '<span class="tag">' + np + " personal</span>";
      if (nr) tags += '<span class="tag">' + nr + " recursos</span>";
      const actions = '<div class="rt-actions"><button class="btn-mini dark" data-ver-inc="' + esc(r.id) + '">Ver</button>' +
        (esAdmin() ? '<button class="btn-mini danger" data-del="' + esc(r.id) + '">Eliminar</button>' : "") + "</div>";
      return '<div class="rt-item"><div class="fila"><span class="rt-name">' + esc(r.tipo || "(sin tipo)") + '</span><span class="' + estadoClass(r.estado) + '">' + esc(r.estado || "") + "</span></div>" +
        '<div class="rt-meta">' + esc(r.direccion || "") + (r.recinto ? " · " + esc(r.recinto) : "") + (r.comuna ? ", " + esc(r.comuna) : "") + "</div>" +
        '<div class="rt-meta">' + esc(r.encargado || "") + "</div>" +
        '<div class="rt-tags">' + tags + "</div>" + actions + "</div>";
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
    if (online) { loadRealtime(); syncPending(); loadIncidentes(); loadRealtimePac(); }
  }

  async function refreshPending() {
    const a = await idbAll(STORE_EV);
    const b = await idbAll(STORE_PAC);
    const n = a.filter(function (r) { return !r.synced; }).length + b.filter(function (r) { return !r.synced; }).length;
    const badge = $("pendingBadge");
    if (n > 0) { badge.textContent = n + " pendiente" + (n === 1 ? "" : "s"); badge.classList.remove("hidden"); }
    else badge.classList.add("hidden");
  }

  async function syncPending() {
    if (!sb || !navigator.onLine) return;
    await syncPendingEventos();
    await syncPendingPacientes();
    await refreshPending();
  }

  async function syncPendingEventos() {
    if (syncingEv) return;
    syncingEv = true;
    try {
      const all = await idbAll(STORE_EV);
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
        await idbPut(STORE_EV, rec);
      }
      if (pend.length) toast(pend.length + " evento(s) sincronizado(s)", "ok");
    } catch (e) {
      console.warn("Error sync eventos:", e);
      const info = e ? [e.code, e.message, e.details, e.hint].filter(Boolean).join(" · ") : String(e);
      toast("No se pudo sincronizar un evento: " + (info || "error desconocido"), "err");
    }
    finally { syncingEv = false; }
  }

  /* ============================================================
     ATENCION DE PACIENTES
     ============================================================ */
  function pTomaHTML(n) {
    return '<div class="toma" data-seccion="signos">' +
      '<div class="toma-head"><span class="toma-title">SIGNOS VITALES ' + n + "</span>" +
      '<button type="button" class="remove-btn" data-remove>×</button></div>' +
      '<div class="row"><label class="field"><span>Hora</span><input type="time" data-field="hora" value="' + nowHM() + '" readonly></label>' +
      '<label class="field"><span>PA</span><input type="text" data-field="pa" placeholder="120/80"></label></div>' +
      '<div class="row"><label class="field"><span>FC <span class="unit">(LTM)</span></span><input type="text" data-field="fc" inputmode="numeric"></label>' +
      '<label class="field"><span>FR <span class="unit">(RPM)</span></span><input type="text" data-field="fr" inputmode="numeric"></label></div>' +
      '<div class="row"><label class="field"><span>SAT <span class="unit">(% AMBIENTE)</span></span><input type="text" data-field="sat"></label>' +
      '<label class="field"><span>EGT <span class="unit">(MG/DL)</span></span><input type="text" data-field="egt"></label></div>' +
      '<div class="row"><label class="field"><span>T°</span><input type="text" data-field="temp"></label>' +
      '<label class="field"><span>EVA</span><input type="text" data-field="eva"></label></div>' +
      '<label class="field"><span>CINCINNATI</span><input type="text" data-field="cincinnati"></label></div>';
  }

  function pFillToma(node, d) {
    const set = function (f, v) { const i = node.querySelector('[data-field="' + f + '"]'); if (i) i.value = v == null ? "" : v; };
    ["hora", "pa", "fc", "fr", "sat", "egt", "temp", "eva", "cincinnati"].forEach(function (f) { set(f, d[f]); });
    if (d.id) node.dataset.id = d.id;
  }

  function pRenumber(list) {
    list.querySelectorAll(".toma").forEach(function (el, i) {
      const t = el.querySelector(".toma-title");
      if (t) t.textContent = "SIGNOS VITALES " + (i + 1);
    });
  }

  function pAddToma(data) {
    const list = $("pSignosList");
    const n = list.querySelectorAll(".toma").length + 1;
    const wrap = document.createElement("div");
    wrap.innerHTML = pTomaHTML(n);
    const node = wrap.firstElementChild;
    node.querySelector("[data-remove]").addEventListener("click", function () { node.remove(); pRenumber(list); });
    list.appendChild(node);
    if (data) pFillToma(node, data);
    pRenumber(list);
  }

  function pToggleControl(show, autoAdd) {
    $("pControlContainer").classList.toggle("hidden", !show);
    if (show) { if (autoAdd !== false && $("pSignosList").querySelectorAll(".toma").length === 0) pAddToma(); }
    else { $("pSignosList").innerHTML = ""; }
  }

  function pToggleTraslado(show) { $("pTrasladoContainer").classList.toggle("hidden", !show); }

  function pReadToma(el, orden) {
    const g = function (f) { const i = el.querySelector('[data-field="' + f + '"]'); return i ? i.value.trim() : ""; };
    if (!el.dataset.id) el.dataset.id = uuid();
    return { id: el.dataset.id, seccion: "signos", orden: orden, hora: g("hora"), pa: g("pa"), fc: g("fc"), fr: g("fr"), sat: g("sat"), egt: g("egt"), temp: g("temp"), eva: g("eva"), cincinnati: g("cincinnati") };
  }

  function pCargosSeleccionados() {
    return $$("#pCargoGroup input:checked").map(function (c) { return c.value; }).join(", ");
  }

  function pMarcarCargos(valor) {
    const set = String(valor || "").split(",").map(function (s) { return s.trim(); });
    $$("#pCargoGroup input").forEach(function (c) { c.checked = set.indexOf(c.value) >= 0; });
  }

  /* ---------------- Vínculo evento <-> atención de pacientes ---------------- */
  async function opcionesEventos() {
    const mapa = {};
    try {
      const local = await idbAll(STORE_EV);
      local.forEach(function (r) {
        if (r && r.inc && r.inc.id) mapa[r.inc.id] = { id: r.inc.id, folio: r.folio, tipo: r.inc.tipo, estado: r.inc.estado };
      });
    } catch (e) {}
    if (sb && navigator.onLine) {
      try {
        const res = await sb.from("incidentes").select("id, folio, tipo, estado").order("folio", { ascending: false }).limit(500);
        if (!res.error && res.data) res.data.forEach(function (r) { mapa[r.id] = r; });
      } catch (e) {}
    }
    return Object.keys(mapa).map(function (k) { return mapa[k]; }).sort(function (a, b) { return (b.folio || 0) - (a.folio || 0); });
  }

  async function cargarSelectorEventos(seleccion) {
    const sel = $("pEvento");
    if (!sel) return;
    const actual = (seleccion != null) ? seleccion : sel.value;
    const lista = await opcionesEventos();
    let html = '<option value="">Sin evento</option>';
    lista.forEach(function (e) {
      const label = (e.folio != null ? "#" + e.folio + " · " : "") + (e.tipo || "(sin tipo)") + (e.estado ? " · " + e.estado : "");
      html += '<option value="' + esc(e.id) + '">' + esc(label) + "</option>";
    });
    sel.innerHTML = html;
    sel.value = actual || "";
    if (sel.value !== (actual || "")) sel.value = "";
  }

  async function cargarPacientesEvento(incId) {
    if (!incId) return [];
    if (sb && navigator.onLine) {
      try {
        const res = await sb.from("atenciones")
          .select("id, folio, nombre, run, edad, fecha, hora, cargo_atiende, quien_atiende, traslado, creado_cliente")
          .eq("incidente_id", incId).order("folio", { ascending: true });
        if (!res.error) return res.data || [];
      } catch (e) {}
    }
    try {
      const local = await idbAll(STORE_PAC);
      return local.filter(function (r) { return r.atencion && r.atencion.incidente_id === incId; })
        .map(function (r) { return Object.assign({}, r.atencion, { folio: r.folio }); })
        .sort(function (a, b) { return (a.folio == null ? Infinity : a.folio) - (b.folio == null ? Infinity : b.folio); });
    } catch (e) { return []; }
  }

  function pCollect() {
    const traslado = $("pTrasladoSi").checked ? "SI" : ($("pTrasladoNo").checked ? "NO" : "");
    const atencion = {
      id: pEditId || uuid(),
      fecha: val("pFecha"), hora: val("pHora"),
      cargo_atiende: pCargosSeleccionados(), quien_atiende: val("pQuienAtiende"),
      nombre: val("pNombre"), run: val("pRun"), edad: val("pEdad"),
      domicilio: val("pDomicilio"), fono: val("pFono"),
      enfermedades_base: val("pEnfermedades"), medicamentos: val("pMedicamentos"),
      motivo_consulta: val("pMotivoConsulta"), tratamiento: val("pTratamiento"),
      medicamentos_admin: val("pMedicamentosAdmin"),
      traslado: traslado,
      traslado_lugar: traslado === "SI" ? val("pTrasladoLugar") : "",
      traslado_ambulancia: traslado === "SI" ? val("pTrasladoAmbulancia") : "",
      traslado_personal: traslado === "SI" ? val("pTrasladoPersonal") : "",
      incidente_id: val("pEvento") || null,
      dispositivo: cfg.DISPOSITIVO || ""
    };
    const signos = [];
    $$("#pSignosList .toma").forEach(function (el, i) { signos.push(pReadToma(el, i + 1)); });
    return { atencion: atencion, signos: signos };
  }

  async function pGuardar() {
    const data = pCollect();
    if (!data.atencion.nombre) { toast("Ingrese el nombre del lesionado", "err"); return; }
    pEditId = data.atencion.id;
    const rec = { id: data.atencion.id, atencion: data.atencion, signos: data.signos, folio: pCurrentFolio, synced: false, creado_cliente: new Date().toISOString() };
    await idbPut(STORE_PAC, rec);
    toast(navigator.onLine ? "Guardado. Sincronizando..." : "Guardado en el dispositivo", "ok");
    await refreshPending();
    syncPending();
  }

  function pResetForm() {
    pEditId = null;
    pCurrentFolio = null;
    setVal("pFolio", "");
    setVal("pFecha", todayLocal());
    setVal("pHora", nowHM());
    ["pQuienAtiende", "pNombre", "pRun", "pEdad", "pDomicilio", "pFono", "pEnfermedades", "pMedicamentos", "pMotivoConsulta", "pTratamiento", "pMedicamentosAdmin", "pTrasladoLugar", "pTrasladoAmbulancia", "pTrasladoPersonal"].forEach(function (id) { setVal(id, ""); });
    pMarcarCargos("");
    setVal("pEvento", "");
    $("pSignosList").innerHTML = "";
    $("pControlSi").checked = false;
    $("pControlNo").checked = false;
    pToggleControl(false);
    $("pTrasladoSi").checked = false;
    $("pTrasladoNo").checked = false;
    pToggleTraslado(false);
  }

  function pNuevoPaciente() {
    const conDatos = ["pNombre", "pRun", "pEdad", "pDomicilio", "pFono", "pMotivoConsulta", "pTratamiento", "pMedicamentosAdmin"].some(function (id) { return val(id); });
    if (conDatos && !confirm("¿Iniciar un nuevo paciente? Se limpiará el formulario actual y los datos no guardados se perderán.")) return;
    pResetForm();
    setVal("pFecha", todayLocal());
    setVal("pHora", nowHM());
    toast("Nuevo paciente listo", "ok");
  }

  async function pLoadAtencion(id) {
    if (!esAdmin()) return;
    const res = await sb.from("atenciones").select("*, signos(*)").eq("id", id).maybeSingle();
    if (res.error || !res.data) { toast("No se pudo cargar el informe", "err"); return; }
    const a = res.data;
    pEditId = a.id;
    pCurrentFolio = a.folio;
    setVal("pFolio", a.folio != null ? "#" + a.folio : "");
    setVal("pFecha", a.fecha || todayLocal());
    setVal("pHora", a.hora || nowHM());
    pMarcarCargos(a.cargo_atiende);
    await cargarSelectorEventos(a.incidente_id || "");
    setVal("pQuienAtiende", a.quien_atiende || "");
    setVal("pNombre", a.nombre || "");
    setVal("pRun", a.run || "");
    setVal("pEdad", a.edad || "");
    setVal("pDomicilio", a.domicilio || "");
    setVal("pFono", a.fono || "");
    setVal("pEnfermedades", a.enfermedades_base || "");
    setVal("pMedicamentos", a.medicamentos || "");
    setVal("pMedicamentosAdmin", a.medicamentos_admin || "");
    setVal("pMotivoConsulta", a.motivo_consulta || "");
    setVal("pTratamiento", a.tratamiento || "");
    const tras = a.traslado || "";
    $("pTrasladoSi").checked = (tras === "SI");
    $("pTrasladoNo").checked = (tras === "NO");
    pToggleTraslado(tras === "SI");
    setVal("pTrasladoLugar", a.traslado_lugar || "");
    setVal("pTrasladoAmbulancia", a.traslado_ambulancia || "");
    setVal("pTrasladoPersonal", a.traslado_personal || "");
    $("pSignosList").innerHTML = "";
    const list = (a.signos || []).slice().sort(function (x, y) { return (x.orden || 0) - (y.orden || 0); });
    if (list.length) { $("pControlSi").checked = true; pToggleControl(true, false); list.forEach(function (s) { pAddToma(s); }); }
    else { $("pControlNo").checked = true; pToggleControl(false); }
    showTab("pacientes");
    try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (e) { window.scrollTo(0, 0); }
  }

  async function pEliminarAtencion(id) {
    if (!esAdmin()) { toast("Solo ADMINISTRADOR puede eliminar", "err"); return; }
    if (!confirm("¿Eliminar esta atención? Esta acción no se puede deshacer.")) return;
    if (sb && navigator.onLine) {
      const res = await sb.from("atenciones").delete().eq("id", id);
      if (res.error) { toast("No se pudo eliminar: " + traducir(res.error.message), "err"); return; }
    }
    await idbDelete(STORE_PAC, id);
    toast("Atención eliminada", "ok");
    loadRealtimePac();
  }

  function pBuildModel() {
    const data = pCollect();
    const a = data.atencion;
    if (!a.nombre) return null;
    const sections = [];
    const head = [];
    if (pCurrentFolio != null) head.push({ label: "ID / Folio", value: "#" + pCurrentFolio });
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
    data.signos.forEach(function (s, idx) {
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
    return { paciente: a.nombre, fecha: a.fecha, folio: pCurrentFolio, sections: sections };
  }

  function pModelToWhatsapp(m) {
    let out = "";
    m.sections.forEach(function (sec) {
      out += "*" + sec.title + "*\n";
      sec.items.forEach(function (it) { out += it.label ? ("*" + it.label + ":* " + it.value + "\n") : (it.value + "\n"); });
      out += "\n";
    });
    return out.trim();
  }

  function pEnviarWhatsapp() {
    const m = pBuildModel();
    if (!m) { toast("Ingrese el nombre del lesionado", "err"); return; }
    window.open("https://wa.me/?text=" + encodeURIComponent(pModelToWhatsapp(m)), "_blank");
  }

  function pGenerarPDF() {
    const m = pBuildModel();
    if (!m) { toast("Ingrese el nombre del lesionado", "err"); return; }
    const jsPDF = window.jspdf.jsPDF;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const M = 14, W = 210, H = 297;
    let y = M;
    const ensure = function (sp) { if (y + sp > H - M) { doc.addPage(); y = M; } };
    y = addLogoPDF(doc, W, y, 28) + 4;
    doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.setTextColor(11, 114, 133);
    doc.text("SAFE MEDICAL", W / 2, y, { align: "center" }); y += 9;
    doc.setFontSize(14); doc.text("ATENCIÓN DE PACIENTES", W / 2, y, { align: "center" }); y += 7;
    if (m.folio != null) { doc.setFontSize(11); doc.setTextColor(80, 80, 80); doc.text("ID / Folio: #" + m.folio, W / 2, y, { align: "center" }); y += 6; }
    doc.setDrawColor(11, 114, 133); doc.setLineWidth(0.6); doc.line(M, y, W - M, y); y += 7;
    m.sections.forEach(function (sec) {
      ensure(10); doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(11, 114, 133); doc.text(sec.title, M, y); y += 6;
      sec.items.forEach(function (it) {
        doc.setFontSize(11); doc.setTextColor(30, 30, 30);
        const maxW = W - 2 * M;
        if (it.label) {
          const label = it.label + ": "; doc.setFont("helvetica", "bold"); const lw = doc.getTextWidth(label);
          const lines = doc.splitTextToSize(String(it.value), maxW - lw - 2);
          ensure(6); doc.text(label, M, y); doc.setFont("helvetica", "normal"); doc.text(lines[0], M + lw, y);
          for (let i = 1; i < lines.length; i++) { y += 6; ensure(6); doc.text(lines[i], M, y); }
        } else {
          doc.setFont("helvetica", "normal");
          const lines = doc.splitTextToSize(String(it.value), maxW);
          lines.forEach(function (ln) { ensure(6); doc.text(ln, M, y); y += 6; }); y -= 6;
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
      navigator.share({ files: [file], title: "Atención de pacientes", text: "Registro de atención" }).catch(function () { doc.save(filename); toast("PDF generado", "ok"); });
    } else { doc.save(filename); toast("PDF generado", "ok"); }
  }

  async function loadRealtimePac() {
    if (!sb || !navigator.onLine) return;
    const res = await sb.from("atenciones")
      .select("id, folio, nombre, run, quien_atiende, fecha, hora, creado_cliente, signos(id)")
      .order("creado_cliente", { ascending: false }).limit(50);
    if (res.error) return;
    const box = $("pRealtimeList");
    const rows = res.data || [];
    if (!rows.length) { box.innerHTML = '<div class="empty">Sin registros todavía.</div>'; return; }
    box.innerHTML = rows.map(function (r) {
      const n = (r.signos || []).length;
      let tags = "";
      if (r.folio != null) tags += '<span class="tag">#' + esc(r.folio) + "</span>";
      if (r.run) tags += '<span class="tag">RUN ' + esc(r.run) + "</span>";
      if (n) tags += '<span class="tag">' + n + " toma(s) SV</span>";
      const actions = esAdmin() ? '<div class="rt-actions"><button class="btn-mini dark" data-pedit="' + esc(r.id) + '">Editar</button><button class="btn-mini danger" data-pdel="' + esc(r.id) + '">Eliminar</button></div>' : "";
      return '<div class="rt-item"><div class="rt-name">' + esc(r.nombre || "(sin nombre)") + "</div>" +
        '<div class="rt-meta">' + esc(r.fecha || "") + " " + esc(r.hora || "") + " · " + esc(r.quien_atiende || "") + "</div>" +
        '<div class="rt-tags">' + tags + "</div>" + actions + "</div>";
    }).join("");
  }

  async function syncPendingPacientes() {
    if (syncingPac) return;
    syncingPac = true;
    try {
      const all = await idbAll(STORE_PAC);
      const pend = all.filter(function (r) { return !r.synced; });
      for (const rec of pend) {
        const payload = Object.assign({}, rec.atencion, {
          user_id: currentUser ? currentUser.id : null,
          creado_cliente: rec.creado_cliente,
          sincronizado_at: new Date().toISOString()
        });
        if (rec.folio != null) payload.folio = rec.folio; else delete payload.folio;
        const r1 = await sb.from("atenciones").upsert(payload, { onConflict: "id" }).select("folio").maybeSingle();
        if (r1.error) throw r1.error;
        if (r1.data && r1.data.folio != null) {
          rec.folio = r1.data.folio;
          if (pEditId === rec.id) { pCurrentFolio = rec.folio; setVal("pFolio", "#" + rec.folio); }
        }
        if (rec.signos && rec.signos.length) {
          const rows = rec.signos.map(function (s) { return Object.assign({}, s, { atencion_id: rec.atencion.id }); });
          const r2 = await sb.from("signos").upsert(rows, { onConflict: "id" });
          if (r2.error) throw r2.error;
        }
        rec.synced = true;
        await idbPut(STORE_PAC, rec);
      }
      if (pend.length) toast(pend.length + " atención(es) sincronizada(s)", "ok");
    } catch (e) {
      console.warn("Error sync pacientes:", e);
      const info = e ? [e.code, e.message, e.details, e.hint].filter(Boolean).join(" · ") : String(e);
      toast("No se pudo sincronizar una atención: " + (info || "error desconocido"), "err");
    }
    finally { syncingPac = false; }
  }

  async function pFetchTodas() {
    if (sb && navigator.onLine) {
      try {
        const res = await sb.from("atenciones").select("id, folio, nombre, run, edad, fecha, hora, cargo_atiende, quien_atiende, traslado, traslado_lugar, creado_cliente, signos(id)").order("folio", { ascending: true });
        if (!res.error && res.data) return { rows: res.data, local: false };
      } catch (e) {}
    }
    const local = await idbAll(STORE_PAC);
    const rows = local.map(function (r) { return Object.assign({}, r.atencion, { folio: r.folio, signos: r.signos || [] }); });
    rows.sort(function (a, b) { const fa = a.folio == null ? Infinity : a.folio, fb = b.folio == null ? Infinity : b.folio; return fa - fb; });
    return { rows: rows, local: true };
  }

  async function pGenerarPDFGlobal() {
    if (!esAdmin()) return;
    toast("Generando reporte de pacientes...", "ok");
    const data = await pFetchTodas();
    const rows = data.rows, total = rows.length;
    const jsPDF = window.jspdf.jsPDF;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const M = 12, W = 210, H = 297, usableW = W - 2 * M;
    const cols = [
      { key: "folio", label: "#", w: 10 }, { key: "nombre", label: "Nombre", w: 44 }, { key: "run", label: "RUN", w: 24 },
      { key: "edad", label: "Edad", w: 10 }, { key: "fecha", label: "Fecha", w: 20 }, { key: "hora", label: "Hora", w: 12 },
      { key: "cargo_atiende", label: "Quién atiende", w: 30 }, { key: "traslado", label: "Traslado", w: 26 }, { key: "sv", label: "SV", w: 10 }
    ];
    let y = M;
    const drawHeader = function () {
      doc.setFillColor(11, 114, 133); doc.rect(M, y, usableW, 7, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(255, 255, 255);
      let x = M; cols.forEach(function (c) { doc.text(c.label, x + 1.5, y + 4.8); x += c.w; });
      y += 7;
    };
    y = addLogoPDF(doc, W, y, 28) + 4;
    doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.setTextColor(11, 114, 133);
    doc.text("SAFE MEDICAL", W / 2, y, { align: "center" }); y += 9;
    doc.setFontSize(14); doc.text("ATENCIÓN DE PACIENTES", W / 2, y, { align: "center" }); y += 7;
    doc.setFontSize(11); doc.setTextColor(80, 80, 80); doc.text("REPORTE GENERAL DE ATENCIONES", W / 2, y, { align: "center" }); y += 6;
    doc.setFontSize(9.5); doc.text("Emitido: " + todayLocal() + " " + nowHM(), W / 2, y, { align: "center" }); y += 6;
    doc.setDrawColor(11, 114, 133); doc.setLineWidth(0.6); doc.line(M, y, W - M, y); y += 8;
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(30, 30, 30);
    doc.text("Total de pacientes atendidos: " + total, M, y); y += 8;
    if (data.local) { doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(170, 70, 70); doc.text("(Sin conexión: listado local de este dispositivo)", M, y); y += 6; }
    drawHeader();
    rows.forEach(function (r, i) {
      if (y + 6 > H - M - 8) { doc.addPage(); y = M; drawHeader(); }
      if (i % 2 === 1) { doc.setFillColor(240, 245, 247); doc.rect(M, y, usableW, 6, "F"); }
      doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(30, 30, 30);
      const trasladoSi = (r.traslado === "SI");
      const vals = [r.folio != null ? "#" + r.folio : "", r.nombre || "", r.run || "", r.edad || "", r.fecha || "", r.hora || "", r.cargo_atiende || "", trasladoSi ? ("SI - " + (r.traslado_lugar || "")) : (r.traslado === "NO" ? "No" : ""), String((r.signos || []).length)];
      let x = M;
      vals.forEach(function (v, j) {
        let t = String(v); if (doc.getTextWidth(t) > cols[j].w - 3) { while (t.length && doc.getTextWidth(t + "…") > cols[j].w - 3) t = t.slice(0, -1); t += "…"; }
        doc.text(t, x + 1.5, y + 4.2); x += cols[j].w;
      });
      doc.setDrawColor(222, 226, 230); doc.setLineWidth(0.2); doc.line(M, y + 6, M + usableW, y + 6); y += 6;
    });
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) { doc.setPage(p); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(120, 120, 120); doc.text("Atención de Pacientes - Reporte general", M, H - 6); doc.text("Página " + p + " de " + pages, W - M, H - 6, { align: "right" }); }
    const filename = "Reporte_Atenciones_" + total + "_" + todayLocal() + ".pdf";
    const blob = doc.output("blob");
    const file = new File([blob], filename, { type: "application/pdf" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: "Reporte de pacientes" }).catch(function () { doc.save(filename); toast("Reporte generado", "ok"); });
    } else { doc.save(filename); toast("Reporte generado", "ok"); }
  }

  /* ---------------- Reportes ---------------- */
  function loadReportes() {
    const total = incidentes.length;
    const activos = incidentes.filter(function (i) { return (i.estado || "Activo") === "Activo"; }).length;
    const personal = incidentes.reduce(function (a, i) { return a + ((i.personal || []).length); }, 0);
    const recursos = incidentes.reduce(function (a, i) { return a + ((i.recursos || []).length); }, 0);
    $("rpTotal").textContent = total; $("rpActivos").textContent = activos;
    $("rpPersonal").textContent = personal; $("rpRecursos").textContent = recursos;
    const box = $("reportesTabla");
    if (!total) { box.innerHTML = '<div class="vacio">Sin eventos registrados.</div>'; return; }
    let html = '<table class="tabla"><thead><tr><th>#</th><th>Tipo</th><th>Estado</th><th>Nivel</th><th>Comuna</th><th>Inicio</th><th>Personal</th><th>Recursos</th></tr></thead><tbody>';
    incidentes.slice().sort(function (a, b) { return (a.folio || 0) - (b.folio || 0); }).forEach(function (i) {
      html += "<tr><td>" + (i.folio != null ? "#" + esc(i.folio) : "—") + "</td><td>" + esc(i.tipo) + "</td><td>" + esc(i.estado) + "</td><td>" + esc(i.nivel) + "</td><td>" + esc(i.comuna) + "</td><td>" + esc(fmtFechaHora(i.fecha_inicio, i.hora_inicio)) + "</td><td>" + (i.personal || []).length + "</td><td>" + (i.recursos || []).length + "</td></tr>";
    });
    box.innerHTML = html + "</tbody></table>";
  }

  function generarPDFGlobal() {
    if (!esAdmin()) return;
    toast("Generando reporte...", "ok");
    const finish = function (rows) {
      const jsPDF = window.jspdf.jsPDF;
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const M = 12, W = 210, H = 297, usableW = W - 2 * M;
      let y = M;
      const cols = [{ key: "folio", label: "#", w: 12 }, { key: "tipo", label: "Tipo", w: 40 }, { key: "estado", label: "Estado", w: 24 }, { key: "nivel", label: "Nivel", w: 18 }, { key: "comuna", label: "Comuna", w: 30 }, { key: "inicio", label: "Inicio", w: 30 }, { key: "pers", label: "Pers.", w: 12 }, { key: "rec", label: "Rec.", w: 12 }];
      const drawHeader = function () { doc.setFillColor(11, 114, 133); doc.rect(M, y, usableW, 7, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(255, 255, 255); let x = M; cols.forEach(function (c) { doc.text(c.label, x + 1.5, y + 4.8); x += c.w; }); y += 7; };
      y = addLogoPDF(doc, W, y, 26) + 4;
      doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(11, 114, 133); doc.text("SAFE MEDICAL", W / 2, y, { align: "center" }); y += 8;
      doc.setFontSize(12); doc.text("REPORTE GENERAL DE EVENTOS", W / 2, y, { align: "center" }); y += 6;
      doc.setFontSize(9.5); doc.setTextColor(80, 80, 80); doc.text("Emitido: " + todayLocal() + " " + nowHM(), W / 2, y, { align: "center" }); y += 6;
      doc.setDrawColor(11, 114, 133); doc.setLineWidth(0.6); doc.line(M, y, W - M, y); y += 8;
      doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(30, 30, 30); doc.text("Total de eventos: " + rows.length, M, y); y += 8;
      drawHeader();
      rows.forEach(function (r, i) {
        if (y + 6 > H - M - 8) { doc.addPage(); y = M; drawHeader(); }
        if (i % 2 === 1) { doc.setFillColor(240, 245, 247); doc.rect(M, y, usableW, 6, "F"); }
        doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(30, 30, 30);
        const vals = [r.folio != null ? "#" + r.folio : "", r.tipo || "", r.estado || "", r.nivel || "", r.comuna || "", ((r.fecha_inicio || "") + " " + (r.hora_inicio || "")).trim(), String((r.personal || []).length), String((r.recursos || []).length)];
        let x = M;
        vals.forEach(function (v, j) { let t = String(v); if (doc.getTextWidth(t) > cols[j].w - 3) { while (t.length && doc.getTextWidth(t + "…") > cols[j].w - 3) t = t.slice(0, -1); t += "…"; } doc.text(t, x + 1.5, y + 4.2); x += cols[j].w; });
        doc.setDrawColor(222, 226, 230); doc.setLineWidth(0.2); doc.line(M, y + 6, M + usableW, y + 6); y += 6;
      });
      const pages = doc.getNumberOfPages();
      for (let p = 1; p <= pages; p++) { doc.setPage(p); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(120, 120, 120); doc.text("Reporte general de eventos", M, H - 6); doc.text("Página " + p + " de " + pages, W - M, H - 6, { align: "right" }); }
      const filename = "Reporte_Eventos_" + rows.length + "_" + todayLocal() + ".pdf";
      const blob = doc.output("blob"); const file = new File([blob], filename, { type: "application/pdf" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: "Reporte general" }).catch(function () { doc.save(filename); toast("Reporte generado", "ok"); }); }
      else { doc.save(filename); toast("Reporte generado", "ok"); }
    };
    if (sb && navigator.onLine) {
      sb.from("incidentes").select("*").order("folio", { ascending: true }).then(function (res) { finish(res.error ? incidentes : (res.data || [])); });
    } else { finish(incidentes); }
  }

  function csvCell(v) { const s = String(v == null ? "" : v); return '"' + s.replace(/"/g, '""') + '"'; }
  function saveViaAnchor(blob, filename) {
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }
  function descargarArchivo(filename, content, mime) {
    const blob = new Blob([content], { type: mime }); const file = new File([blob], filename, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: filename }).catch(function () { saveViaAnchor(blob, filename); }); }
    else { saveViaAnchor(blob, filename); }
  }

  async function respaldoJSON() {
    if (!esAdmin()) return;
    toast("Preparando respaldo...", "ok");
    try {
      if (!sb || !navigator.onLine) throw new Error("Necesita conexión para generar el respaldo");
      const ev = await sb.from("incidentes").select("*").order("folio", { ascending: true });
      if (ev.error) throw ev.error;
      const pa = await sb.from("atenciones").select("*, signos(*)").order("folio", { ascending: true });
      if (pa.error) throw pa.error;
      const payload = { generado: new Date().toISOString(), eventos: ev.data || [], atenciones: pa.data || [] };
      descargarArchivo("Respaldo_SCEM_" + todayLocal() + ".json", JSON.stringify(payload, null, 2), "application/json");
      toast("Respaldo JSON generado (" + (payload.eventos.length + payload.atenciones.length) + " registros)", "ok");
    } catch (e) { toast("No se pudo generar el respaldo: " + traducir(e.message || e), "err"); }
  }

  async function respaldoCSV() {
    if (!esAdmin()) return;
    toast("Preparando respaldo...", "ok");
    try {
      if (!sb || !navigator.onLine) throw new Error("Necesita conexión para generar el respaldo");
      const ev = await sb.from("incidentes").select("*").order("folio", { ascending: true });
      if (ev.error) throw ev.error;
      const all = ev.data || [];
      const cols = ["folio", "tipo", "nivel", "estado", "fecha_inicio", "hora_inicio", "fecha_control", "hora_control",
        "direccion", "comuna", "recinto", "encargado", "punto_comando", "descripcion", "dispositivo", "creado_cliente", "sincronizado_at", "id", "user_id"];
      const lines = [];
      lines.push(cols.concat(["personal", "recursos", "equipos", "puesto_medico"]).map(csvCell).join(","));
      all.forEach(function (r) {
        const resumen = function (arr, campos) { return (arr || []).map(function (o, i) { return (i + 1) + ") " + campos.map(function (c) { return o[c]; }).filter(Boolean).join(" "); }).join(" | "); };
        const recursosResumen = (r.recursos || []).map(function (o, i) {
          let s = (i + 1) + ") " + [o.tipo, o.ambulancia, o.identificacion, o.cantidad, o.estado].filter(Boolean).join(" ");
          if (esAmbulancia(o)) {
            ambCrewRows(o).forEach(function (c) { s += " · " + c.label + " " + [c.nombre, c.run, c.fono, c.extra].filter(Boolean).join(" "); });
          }
          return s;
        }).join(" | ");
        const row = cols.map(function (c) { return r[c]; }).concat([
          resumen(r.personal, ["nombre", "run", "cargo", "contacto", "sis", "rcm"]),
          recursosResumen,
          resumen(r.equipos, ["nombre", "funcionarios"]),
          JSON.stringify(r.puesto_medico || [])
        ]);
        lines.push(row.map(csvCell).join(","));
      });
      descargarArchivo("Respaldo_Eventos_" + todayLocal() + ".csv", "\ufeff" + lines.join("\r\n"), "text/csv");
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
      const opts = ROLES.map(function (r) { return '<option value="' + r + '"' + (r === u.rol ? " selected" : "") + ">" + ROL_LABEL[r] + "</option>"; }).join("");
      const soyYo = currentUser && u.id === currentUser.id;
      const delBtn = soyYo ? '<button class="btn-mini" disabled title="No puede eliminarse a sí mismo">USTED</button>' : '<button class="btn-mini danger" data-deluser="' + esc(u.id) + '">ELIMINAR</button>';
      return '<div class="user-row"><div class="ur-info"><div class="ur-name">' + esc(u.nombre || "(sin nombre)") + '</div><div class="ur-email">' + esc(u.email || "") + "</div></div>" +
        '<div class="ur-actions"><select data-rol="' + esc(u.id) + '">' + opts + "</select>" + delBtn + "</div></div>";
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
    try { const s = await sb.auth.getSession(); if (s.data && s.data.session && s.data.session.access_token) token = s.data.session.access_token; } catch (e) {}
    try {
      const resFetch = await fetch(base + "/functions/v1/admin-usuarios", {
        method: "POST", headers: { "Content-Type": "application/json", "apikey": cfg.SUPABASE_ANON_KEY || "", "Authorization": "Bearer " + token }, body: JSON.stringify(payload)
      });
      let body = null; try { body = await resFetch.json(); } catch (e) {}
      return { ok: resFetch.ok, status: resFetch.status, body: body, sinFuncion: resFetch.status === 404 };
    } catch (e) { return { ok: false, status: 0, body: null, sinFuncion: true }; }
  }

  async function crearUsuario() {
    const email = val("uEmail"), password = val("uPassword"), nombre = val("uNombre"), r = val("uRol") || "RESCATISTA";
    if (!email || !password) { toast("Ingrese correo y contraseña", "err"); return; }
    if (password.length < 6) { toast("La contraseña debe tener al menos 6 caracteres", "err"); return; }
    setBtn("btnCrearUsuario", true, "CREAR USUARIO");
    const res = await callAdminUsers({ accion: "crear", email: email, password: password, nombre: nombre, rol: r });
    if (res.ok && res.body && res.body.ok) { setBtn("btnCrearUsuario", false, "CREAR USUARIO"); setVal("uEmail", ""); setVal("uPassword", ""); setVal("uNombre", ""); toast("Usuario creado: " + email, "ok"); loadUsuarios(); return; }
    if (!res.sinFuncion) { setBtn("btnCrearUsuario", false, "CREAR USUARIO"); toast(traducir(res.body && res.body.error ? res.body.error : "No se pudo crear el usuario"), "err"); return; }
    const res2 = await sbAdmin.auth.signUp({ email: email, password: password, options: { data: { nombre: nombre } } });
    if (res2.error) { setBtn("btnCrearUsuario", false, "CREAR USUARIO"); toast(traducir(res2.error.message), "err"); return; }
    const uid = res2.data && res2.data.user ? res2.data.user.id : null;
    if (uid) { const upd = await sb.from("perfiles").update({ rol: r, nombre: nombre || email }).eq("id", uid); if (upd.error) toast("Usuario creado, pero no se pudo asignar el rol: " + traducir(upd.error.message), "err"); }
    setBtn("btnCrearUsuario", false, "CREAR USUARIO"); setVal("uEmail", ""); setVal("uPassword", ""); setVal("uNombre", "");
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
    if (res.sinFuncion) { const del = await sb.from("perfiles").delete().eq("id", id); if (del.error) { toast("No se pudo eliminar: " + traducir(del.error.message), "err"); return; } toast("Usuario deshabilitado (perfil eliminado): " + etq, "ok"); loadUsuarios(); return; }
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
    pResetForm();
    cargarSelectorEventos();
    updateConn();
    await refreshPending();
    syncPending();
    subscribeRealtime();
    await loadIncidentes();
    loadRealtimePac();
    if (puedeVerTodo()) loadRealtime();
    showTab("lista");
  }

  async function initAuth() {
    const res = await sb.auth.getSession();
    const session = res.data ? res.data.session : null;
    if (session && session.user) enterApp(session.user);
    else $("loginView").classList.remove("hidden");
    sb.auth.onAuthStateChange(function (event, session2) {
      if (event === "SIGNED_OUT") { currentUser = null; currentPerfil = null; $("appView").classList.add("hidden"); $("loginView").classList.remove("hidden"); }
      else if (session2 && session2.user && !currentUser) { enterApp(session2.user); }
    });
  }

  function wire() {
    $("btnLogin").addEventListener("click", doLogin);
    $("btnSignup").addEventListener("click", doSignup);
    $("btnLogout").addEventListener("click", doLogout);
    $("loginPassword").addEventListener("keydown", function (e) { if (e.key === "Enter") doLogin(); });
    $("tabs").addEventListener("click", function (e) { const tab = e.target.closest(".tab"); if (tab) showTab(tab.getAttribute("data-tab")); });

    $("btnIrNuevo").addEventListener("click", nuevoEvento);
    $("btnAddPersonal").addEventListener("click", function () { addRow("personal"); });
    $("btnImportPersonal").addEventListener("click", function () { const inp = $("importPersonal"); if (inp) inp.click(); });
    if ($("importPersonal")) $("importPersonal").addEventListener("change", function () {
      const f = this.files && this.files[0];
      importarPersonalExcel(f);
      this.value = "";
    });
    $("btnAddRecurso").addEventListener("click", function () { addRow("recursos"); });
    $("btnAddEquipo").addEventListener("click", function () { addRow("equipos"); });
    $("btnAddPuesto").addEventListener("click", function () { addRow("puestos"); });
    $("personalList").addEventListener("input", function () { refreshFuncionarios(); });
    $("personalList").addEventListener("change", function () { refreshFuncionarios(); });

    $("btnGuardar").addEventListener("click", guardar);
    $("btnVerInforme").addEventListener("click", verInformeActual);
    $("btnLimpiar").addEventListener("click", function () { if (confirm("¿Limpiar el formulario actual? Los datos no guardados se perderán.")) resetForm(); });
    $("btnCancelEdit").addEventListener("click", function () { resetForm(); showTab("nuevo"); });

    $("buscador").addEventListener("input", renderLista);
    $("filtroEstado").addEventListener("change", renderLista);
    $("btnRefresh").addEventListener("click", function () { loadIncidentes(); loadRealtime(); loadRealtimePac(); });
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

    $("pBtnAddSigno").addEventListener("click", function () { pAddToma(); });
    $("pControlSi").addEventListener("change", function () { pToggleControl(true); });
    $("pControlNo").addEventListener("change", function () { pToggleControl(false); });
    $("pTrasladoSi").addEventListener("change", function () { pToggleTraslado(true); });
    $("pTrasladoNo").addEventListener("change", function () { pToggleTraslado(false); });
    $("pCargoGroup").addEventListener("change", function (e) { if (e.target.checked) { $$("#pCargoGroup input").forEach(function (b) { if (b !== e.target) b.checked = false; }); } });
    $("pBtnWhatsapp").addEventListener("click", pEnviarWhatsapp);
    $("pBtnPdf").addEventListener("click", pGenerarPDF);
    $("pBtnGuardar").addEventListener("click", pGuardar);
    $("pBtnNuevo").addEventListener("click", pNuevoPaciente);
    $("pBtnLimpiar").addEventListener("click", function () { if (confirm("¿Limpiar el formulario actual? Los datos no guardados se perderán.")) pResetForm(); });
    $("pRealtimeList").addEventListener("click", function (e) {
      const ed = e.target.closest("[data-pedit]"); if (ed) return pLoadAtencion(ed.getAttribute("data-pedit"));
      const dl = e.target.closest("[data-pdel]"); if (dl) return pEliminarAtencion(dl.getAttribute("data-pdel"));
    });

    $("btnPdfGlobal").addEventListener("click", generarPDFGlobal);
    $("btnPdfPacientes").addEventListener("click", pGenerarPDFGlobal);
    $("btnBackupJson").addEventListener("click", respaldoJSON);
    $("btnBackupCsv").addEventListener("click", respaldoCSV);

    $("btnCrearUsuario").addEventListener("click", crearUsuario);
    $("usuariosList").addEventListener("change", function (e) { const sel = e.target.closest("[data-rol]"); if (sel) cambiarRol(sel.getAttribute("data-rol"), sel.value); });
    $("usuariosList").addEventListener("click", function (e) { const del = e.target.closest("[data-deluser]"); if (del) eliminarUsuario(del.getAttribute("data-deluser")); });

    window.addEventListener("online", function () { updateConn(); loadRealtime(); syncPending(); loadIncidentes(); loadRealtimePac(); });
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
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
  }
})();
