/* Sistema de Comando de Incidentes - lógica de la aplicación */
(() => {
  "use strict";

  const { CATALOGOS } = DB;
  const TABS = ["incidente", "personal", "recursos", "equipos", "puesto", "resumen", "informe"];

  const estado = { datos: DB.load() };

  /* ============================ Utilidades ============================ */

  const guardar = () => {
    DB.save();
    actualizarChip();
    actualizarMeta();
  };

  const llenarSelect = (id, valores) => {
    const sel = U.el(id);
    if (!sel) return;
    const actual = sel.value;
    sel.innerHTML = valores.map((v) => `<option value="${U.esc(v)}">${U.esc(v)}</option>`).join("");
    if (actual && valores.includes(actual)) sel.value = actual;
  };

  const campo = (f) => {
    const req = f.required ? " required" : "";
    const val = f.value != null ? ` value="${U.esc(f.value)}"` : "";
    let inner = "";
    if (f.type === "textarea") {
      inner = `<textarea name="${f.name}" rows="${f.rows || 3}"${req}>${U.esc(f.value || "")}</textarea>`;
    } else if (f.type === "select") {
      const opts = (f.options || []).map((o) => {
        const [v, lbl] = Array.isArray(o) ? o : [o, o];
        return `<option value="${U.esc(v)}"${String(f.value) === String(v) ? " selected" : ""}>${U.esc(lbl)}</option>`;
      }).join("");
      inner = `<select name="${f.name}"${req}>${opts}</select>`;
    } else if (f.type === "checkbox") {
      inner = `<input type="checkbox" name="${f.name}"${f.value ? " checked" : ""}>`;
    } else {
      const ph = f.placeholder ? ` placeholder="${U.esc(f.placeholder)}"` : "";
      const mn = f.min != null ? ` min="${f.min}"` : "";
      const mx = f.max != null ? ` max="${f.max}"` : "";
      const st = f.step != null ? ` step="${f.step}"` : "";
      inner = `<input type="${f.type || "text"}" name="${f.name}"${req}${val}${ph}${mn}${mx}${st}>`;
    }
    const hint = f.hint ? `<small>${U.esc(f.hint)}</small>` : "";
    return `<label class="${f.span ? "span-2" : ""}"><span>${U.esc(f.label)}</span>${inner}${hint}</label>`;
  };

  const seccionForm = (titulo, campos) => `
    <fieldset class="grupo-form">
      <legend>${U.esc(titulo)}</legend>
      <div class="form-grid">${campos.map(campo).join("")}</div>
    </fieldset>`;

  const abrirForm = ({ titulo, secciones, onSubmit, onDelete, valoresIniciales, borrar }) => {
    const root = U.el("modalRoot");
    root.innerHTML = `
      <div class="modal-overlay" id="modalOverlay">
        <div class="modal" role="dialog" aria-modal="true">
          <div class="modal-cabecera">
            <h3>${U.esc(titulo)}</h3>
            <button type="button" class="modal-cerrar" title="Cerrar">&times;</button>
          </div>
          <form id="modalForm">
            <div class="modal-cuerpo">${secciones.map((s) => seccionForm(s.titulo, s.campos)).join("")}</div>
            <div class="modal-acciones">
              ${onDelete ? `<button type="button" class="btn danger" id="btnFormEliminar">${U.esc(borrar || "Eliminar")}</button>` : ""}
              <button type="button" class="btn ghost" id="btnFormCancelar">Cancelar</button>
              <button type="submit" class="btn primary">Guardar</button>
            </div>
          </form>
        </div>
      </div>`;
    const overlay = root.querySelector("#modalOverlay");
    const cerrar = () => { root.innerHTML = ""; };
    overlay.querySelector(".modal-cerrar").onclick = cerrar;
    overlay.addEventListener("click", (e) => { if (e.target === overlay) cerrar(); });
    overlay.querySelector("#btnFormCancelar").onclick = cerrar;
    if (onDelete) overlay.querySelector("#btnFormEliminar").onclick = async () => {
      const ok = await U.confirmDialog("Eliminar", "¿Confirma que desea eliminar este registro?", "Eliminar", true);
      if (ok) { cerrar(); onDelete(); }
    };
    overlay.querySelector("#modalForm").onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const valores = {};
      for (const f of secciones.flatMap((s) => s.campos)) {
        valores[f.name] = f.type === "checkbox" ? fd.get(f.name) === "on" : String(fd.get(f.name) ?? "").trim();
      }
      if (onSubmit(valores) !== false) cerrar();
    };
    const primerInput = root.querySelector("input:not([type=hidden]), select, textarea");
    if (primerInput) primerInput.focus();
  };

  const vacio = (msg) => `<div class="vacio">${msg}</div>`;

  const contarEstado = (arr, campoEstado, estadoBuscado) => arr.filter((x) => x[campoEstado] === estadoBuscado).length;

  /* ============================ Pestañas ============================ */

  const initTabs = () => {
    U.el("tabs").addEventListener("click", (e) => {
      const btn = e.target.closest(".tab");
      if (!btn) return;
      const tab = btn.dataset.tab;
      document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("activo", b === btn));
      document.querySelectorAll(".vista").forEach((v) => v.classList.toggle("activa", v.id === "vista-" + tab));
      if (tab === "resumen") renderResumen();
      if (tab === "informe") renderInforme();
    });
  };

  /* ============================ Incidente ============================ */

  const bindsIncidente = [
    ["folio", "folio"], ["tipo", "tipo"], ["alerta", "alerta"], ["estado", "estado"],
    ["fechaInicio", "fechaInicio"], ["horaInicio", "horaInicio"], ["fechaControl", "fechaControl"],
    ["horaControl", "horaControl"], ["direccion", "direccion"], ["comuna", "comuna"],
    ["cuadrante", "cuadrante"], ["comandante", "comandante"], ["puntoComando", "puntoComando"],
    ["descripcion", "descripcion"]
  ];

  const bindIncidente = () => {
    llenarSelect("tipo", CATALOGOS.tiposIncendio);
    llenarSelect("alerta", CATALOGOS.alertas);
    llenarSelect("estado", CATALOGOS.estadosIncidente);
    for (const [id, key] of bindsIncidente) {
      const campoEl = U.el(id);
      campoEl.value = estado.datos.incidente[key] || "";
      if (id !== "fechaInicio" && id !== "horaInicio" && id !== "tipo" && id !== "alerta" && id !== "estado") {
        campoEl.addEventListener("change", () => { estado.datos.incidente[key] = campoEl.value; guardar(); });
      }
    }
    ["fechaInicio", "horaInicio"].forEach((id) => {
      U.el(id).addEventListener("change", () => {
        estado.datos.incidente[id === "fechaInicio" ? "fechaInicio" : "horaInicio"] = U.el(id).value;
        guardar();
      });
    });
    ["tipo", "alerta", "estado", "fechaControl", "horaControl"].forEach((id) => {
      U.el(id).addEventListener("change", () => {
        estado.datos.incidente[id] = U.el(id).value;
        guardar();
      });
    });
  };

  const actualizarChip = () => {
    const inc = estado.datos.incidente;
    const txt = (inc.estado || "—") + (inc.folio ? " · " + inc.folio : "");
    U.el("chipEstado").textContent = "Estado: " + txt;
  };

  const actualizarMeta = () => {
    const inc = estado.datos.incidente;
    const resumen = document.querySelectorAll("#metaIncidente").length
      ? U.el("metaIncidente") : null;
    if (resumen) {
      resumen.textContent = "Última actualización automática: " +
        (inc.actualizado ? new Date(inc.actualizado).toLocaleString("es-CL") : "—");
    }
  };

  /* ============================ Personal ============================ */

  const camposPersonal = (p) => [
    { name: "nombre", label: "Nombre completo", type: "text", required: true, value: p && p.nombre, placeholder: "Nombre y apellidos", span: true },
    { name: "run", label: "RUN / RUT", type: "text", value: p && p.run },
    { name: "cargo", label: "Cargo / rango", type: "text", value: p && p.cargo },
    { name: "unidad", label: "Unidad / compañía", type: "text", value: p && p.unidad },
    { name: "funcionSCI", label: "Función en el SCI", type: "select", options: CATALOGOS.funcionesSCI, value: p && p.funcionSCI },
    { name: "estado", label: "Estado en la emergencia", type: "select", options: CATALOGOS.estadosPersonal, value: (p && p.estado) || "En incidente" },
    { name: "horaInicio", label: "Hora de ingreso", type: "time", value: p ? p.horaInicio : U.nowTime() },
    { name: "horaSalida", label: "Hora de salida", type: "time", value: p && p.horaSalida, hint: "Vacía si sigue en el incidente." },
    { name: "observaciones", label: "Observaciones", type: "textarea", rows: 2, value: p && p.observaciones, span: true }
  ];

  const renderPersonal = () => {
    const lista = estado.datos.personal;
    const cont = U.el("listaPersonal");
    const buscar = (U.el("buscarPersonal").value || "").toLowerCase();
    const filtro = U.el("filtroPersonal").value;
    const activos = lista.filter((p) => p.estado === "En incidente");

    U.el("resumenPersonal").innerHTML = `
      <div class="item"><b>${lista.length}</b>total registrados</div>
      <div class="item"><b>${activos.length}</b>en incidente</div>
      <div class="item"><b>${lista.filter((p) => p.funcionSCI && p.funcionSCI.includes("Comandante")).length}</b>comandantes</div>`;

    const filas = lista.filter((p) => {
      if (filtro && p.funcionSCI !== filtro) return false;
      if (!buscar) return true;
      return [p.nombre, p.run, p.unidad, p.cargo, p.funcionSCI, p.estado].join(" ").toLowerCase().includes(buscar);
    });

    if (!filas.length) {
      cont.innerHTML = vacio(lista.length ? "Sin resultados para el filtro." : "No hay funcionarios registrados. Agregue el personal que se mantiene en la emergencia.");
      return;
    }

    cont.innerHTML = filas.map((p) => {
      const claseEstado = p.estado === "En incidente" ? "verde" : p.estado === "En descanso (REHAB)" ? "ambar" : p.estado === "Fuera de servicio" ? "rojo" : "gris";
      return `<article class="tarjeta estado-activo">
        <div class="fila">
          <div>
            <div class="titulo">${U.esc(p.nombre)}</div>
            <div class="sub">${U.esc(p.funcionSCI || "Función SCI no asignada")}</div>
          </div>
          ${U.badge(p.estado, claseEstado)}
        </div>
        <div class="datos">
          <div class="d">Cargo/rango: <b>${U.esc(p.cargo || "—")}</b></div>
          <div class="d">RUN: <b>${U.esc(p.run || "—")}</b></div>
          <div class="d">Unidad: <b>${U.esc(p.unidad || "—")}</b></div>
          <div class="d">Hora ingreso: <b>${U.esc(p.horaInicio || "—")}</b></div>
          <div class="d">Hora salida: <b>${U.esc(p.horaSalida || "en escena")}</b></div>
          <div class="d">Permanencia: <b>${U.duracion(U.diffMinutos(p.horaInicio, p.horaSalida || U.nowTime()))}</b></div>
        </div>
        ${p.observaciones ? `<div class="sub">${U.esc(p.observaciones)}</div>` : ""}
        <div class="pie-tarjeta">
          <button class="btn icono secondary" data-edit="personal-${p.id}">Editar</button>
          <button class="btn icono ghost" data-del="personal-${p.id}">Eliminar</button>
        </div>
      </article>`;
    }).join("");
  };

  const modalPersonal = (id) => {
    const p = estado.datos.personal.find((x) => x.id === id);
    abrirForm({
      titulo: p ? "Editar funcionario" : "Nuevo funcionario",
      secciones: [{ titulo: p ? "Datos del funcionario" : "Datos del nuevo funcionario", campos: camposPersonal(p) }],
      onDelete: p ? async () => {
        const ok = await U.confirmDialog("Eliminar funcionario", `¿Eliminar a ${p.nombre}?`, "Eliminar", true);
        if (ok) { estado.datos.personal = estado.datos.personal.filter((x) => x.id !== id); guardar(); renderPersonal(); }
      } : null,
      onSubmit: (v) => {
        if (!v.nombre) { U.toast("El nombre es obligatorio.", "error"); return false; }
        const obj = { ...v };
        if (p) Object.assign(p, obj);
        else estado.datos.personal.push({ id: DB.nextId(estado.datos.personal), ...obj });
        guardar(); renderPersonal();
        U.toast(p ? "Funcionario actualizado." : "Funcionario agregado.");
      }
    });
  };

  const initPersonal = () => {
    const filtroSel = U.el("filtroPersonal");
    filtroSel.innerHTML = `<option value="">Todos los roles</option>` +
      CATALOGOS.funcionesSCI.map((f) => `<option>${U.esc(f)}</option>`).join("");
    filtroSel.addEventListener("change", renderPersonal);
    U.el("buscarPersonal").addEventListener("input", renderPersonal);
    U.el("btnNuevoPersonal").onclick = () => modalPersonal(null);
    U.el("listaPersonal").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-edit], button[data-del]");
      if (!b) return;
      const esEdit = b.hasAttribute("data-edit");
      const id = Number((b.dataset.edit || b.dataset.del).split("-").pop());
      if (esEdit) { modalPersonal(id); return; }
      const p = estado.datos.personal.find((x) => x.id === id);
      (async () => {
        const ok = await U.confirmDialog("Eliminar funcionario", `¿Eliminar a ${p ? p.nombre : id}?`, "Eliminar", true);
        if (ok) { estado.datos.personal = estado.datos.personal.filter((x) => x.id !== id); guardar(); renderPersonal(); }
      })();
    });
  };

  /* ============================ Recursos ============================ */

  const camposRecurso = (r) => [
    { name: "tipo", label: "Tipo de recurso", type: "select", required: true, options: CATALOGOS.tiposRecurso, value: r && r.tipo },
    { name: "identificacion", label: "Identificación", type: "text", value: r && r.identificacion, placeholder: "Ej: B-4, ZX-12, AML 3845", hint: "Sigla/PPU del vehículo o unidad." },
    { name: "origen", label: "Origen / base", type: "text", value: r && r.origen },
    { name: "estado", label: "Estado", type: "select", options: CATALOGOS.estadosRecurso, value: (r && r.estado) || "Despachado" },
    { name: "horaDespacho", label: "Hora de despacho", type: "time", value: r ? r.horaDespacho : U.nowTime() },
    { name: "horaLlegada", label: "Hora de llegada", type: "time", value: r && r.horaLlegada },
    { name: "horaRegreso", label: "Hora de regreso", type: "time", value: r && r.horaRegreso },
    { name: "personalACargo", label: "Persona a cargo", type: "text", value: r && r.personalACargo },
    { name: "descripcion", label: "Descripción", type: "textarea", rows: 2, value: r && r.descripcion, span: true },
    { name: "observaciones", label: "Observaciones", type: "textarea", rows: 2, value: r && r.observaciones, span: true }
  ];

  const renderRecursos = () => {
    const lista = estado.datos.recursos;
    const cont = U.el("listaRecursos");
    const buscar = (U.el("buscarRecurso").value || "").toLowerCase();
    const filtro = U.el("filtroRecurso").value;
    const enEscena = lista.filter((r) => ["En escena", "En ruta", "Despachado"].includes(r.estado));

    U.el("resumenRecursos").innerHTML = `
      <div class="item"><b>${lista.length}</b>recursos movilizados</div>
      <div class="item"><b>${enEscena.length}</b>en camino / escena</div>
      <div class="item"><b>${contarEstado(lista, "estado", "Regresó a base")}</b>regresados</div>`;

    const filas = lista.filter((r) => {
      if (filtro && r.estado !== filtro) return false;
      if (!buscar) return true;
      return [r.tipo, r.identificacion, r.origen, r.estado, r.personalACargo, r.descripcion].join(" ").toLowerCase().includes(buscar);
    });

    if (!filas.length) {
      cont.innerHTML = vacio(lista.length ? "Sin resultados para el filtro." : "No hay recursos registrados. Agregue lo que movilizó para esta emergencia.");
      return;
    }

    cont.innerHTML = filas.map((r) => {
      const clase = ["En escena", "En ruta", "Despachado"].includes(r.estado) ? "verde" : r.estado === "Regresó a base" || r.estado === "Disponible" ? "gris" : "ambar";
      return `<article class="tarjeta estado-activo">
        <div class="fila">
          <div>
            <div class="titulo">${U.esc(r.tipo || "Recurso")} ${r.identificacion ? `<span class="etiqueta">${U.esc(r.identificacion)}</span>` : ""}</div>
            <div class="sub">${U.esc(r.origen || "Origen no indicado")}</div>
          </div>
          ${U.badge(r.estado, clase)}
        </div>
        <div class="datos">
          <div class="d">Despacho: <b>${U.esc(r.horaDespacho || "—")}</b></div>
          <div class="d">Llegada: <b>${U.esc(r.horaLlegada || "—")}</b></div>
          <div class="d">Regreso: <b>${U.esc(r.horaRegreso || "—")}</b></div>
          <div class="d">Tiempo escena: <b>${U.duracion(U.diffMinutos(r.horaLlegada, r.horaRegreso || U.nowTime()))}</b></div>
          <div class="d">A cargo: <b>${U.esc(r.personalACargo || "—")}</b></div>
        </div>
        ${r.descripcion ? `<div class="sub">${U.esc(r.descripcion)}</div>` : ""}
        ${r.observaciones ? `<div class="sub">${U.esc(r.observaciones)}</div>` : ""}
        <div class="pie-tarjeta">
          <button class="btn icono secondary" data-edit="recurso-${r.id}">Editar</button>
          <button class="btn icono ghost" data-del="recurso-${r.id}">Eliminar</button>
        </div>
      </article>`;
    }).join("");
  };

  const modalRecurso = (id) => {
    const r = estado.datos.recursos.find((x) => x.id === id);
    abrirForm({
      titulo: r ? "Editar recurso" : "Nuevo recurso movilizado",
      secciones: [{ titulo: r ? "Datos del recurso" : "Recurso que se moviliza", campos: camposRecurso(r) }],
      onDelete: r ? () => { estado.datos.recursos = estado.datos.recursos.filter((x) => x.id !== id); guardar(); renderRecursos(); } : null,
      onSubmit: (v) => {
        if (!v.tipo) { U.toast("El tipo de recurso es obligatorio.", "error"); return false; }
        const obj = { ...v };
        if (r) Object.assign(r, obj);
        else estado.datos.recursos.push({ id: DB.nextId(estado.datos.recursos), ...obj });
        guardar(); renderRecursos();
        U.toast(r ? "Recurso actualizado." : "Recurso agregado.");
      }
    });
  };

  const initRecursos = () => {
    const filtroSel = U.el("filtroRecurso");
    filtroSel.innerHTML = `<option value="">Todos los estados</option>` +
      CATALOGOS.estadosRecurso.map((f) => `<option>${U.esc(f)}</option>`).join("");
    filtroSel.addEventListener("change", renderRecursos);
    U.el("buscarRecurso").addEventListener("input", renderRecursos);
    U.el("btnNuevoRecurso").onclick = () => modalRecurso(null);
    U.el("listaRecursos").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-edit], button[data-del]");
      if (!b) return;
      const esEdit = b.hasAttribute("data-edit");
      const id = Number((b.dataset.edit || b.dataset.del).split("-").pop());
      if (esEdit) { modalRecurso(id); return; }
      (async () => {
        const ok = await U.confirmDialog("Eliminar recurso", "¿Eliminar este recurso del incidente?", "Eliminar", true);
        if (ok) { estado.datos.recursos = estado.datos.recursos.filter((x) => x.id !== id); guardar(); renderRecursos(); }
      })();
    });
  };

  /* ============================ Equipos ============================ */

  const camposEquipo = (q) => [
    { name: "nombre", label: "Nombre del equipo", type: "text", required: true, value: q && q.nombre, placeholder: "Ej: Motobomba portátil", span: true },
    { name: "tipo", label: "Tipo", type: "select", options: CATALOGOS.tiposEquipo, value: q && q.tipo },
    { name: "cantidad", label: "Cantidad", type: "number", min: 1, value: q ? q.cantidad : 1 },
    { name: "unidad", label: "Unidad / compañía", type: "text", value: q && q.unidad },
    { name: "estado", label: "Estado", type: "select", options: CATALOGOS.estadosEquipo, value: (q && q.estado) || "Operativo" },
    { name: "ubicacion", label: "Ubicación en escena", type: "text", value: q && q.ubicacion },
    { name: "asignadoA", label: "Asignado a / responsable", type: "text", value: q && q.asignadoA },
    { name: "horaAsignacion", label: "Hora de asignación", type: "time", value: q ? q.horaAsignacion : U.nowTime() },
    { name: "observaciones", label: "Observaciones", type: "textarea", rows: 2, value: q && q.observaciones, span: true }
  ];

  const renderEquipos = () => {
    const lista = estado.datos.equipos;
    const cont = U.el("listaEquipos");
    const buscar = (U.el("buscarEquipo").value || "").toLowerCase();
    const filtro = U.el("filtroEquipo").value;
    const total = lista.reduce((s, q) => s + (Number(q.cantidad) || 1), 0);

    U.el("resumenEquipos").innerHTML = `
      <div class="item"><b>${lista.length}</b>partidas</div>
      <div class="item"><b>${total}</b>unidades totales</div>
      <div class="item"><b>${contarEstado(lista, "estado", "En uso")}</b>en uso</div>
      <div class="item"><b>${contarEstado(lista, "estado", "Fuera de servicio")}</b>fuera de servicio</div>`;

    const filas = lista.filter((q) => {
      if (filtro && q.estado !== filtro) return false;
      if (!buscar) return true;
      return [q.nombre, q.tipo, q.unidad, q.ubicacion, q.asignadoA, q.estado].join(" ").toLowerCase().includes(buscar);
    });

    if (!filas.length) {
      cont.innerHTML = vacio(lista.length ? "Sin resultados para el filtro." : "No hay equipos registrados. Agregue el equipo que se mantiene en escena.");
      return;
    }

    cont.innerHTML = filas.map((q) => {
      const clase = q.estado === "Operativo" ? "verde" : q.estado === "En uso" ? "azul" : q.estado === "Fuera de servicio" ? "rojo" : q.estado === "En mantención" ? "ambar" : "gris";
      return `<article class="tarjeta estado-activo">
        <div class="fila">
          <div>
            <div class="titulo">${U.esc(q.nombre)} <span class="etiqueta">× ${Number(q.cantidad) || 1}</span></div>
            <div class="sub">${U.esc(q.tipo || "Tipo no indicado")}</div>
          </div>
          ${U.badge(q.estado, clase)}
        </div>
        <div class="datos">
          <div class="d">Ubicación: <b>${U.esc(q.ubicacion || "—")}</b></div>
          <div class="d">Unidad: <b>${U.esc(q.unidad || "—")}</b></div>
          <div class="d">Responsable: <b>${U.esc(q.asignadoA || "—")}</b></div>
          <div class="d">Asignación: <b>${U.esc(q.horaAsignacion || "—")}</b></div>
        </div>
        ${q.observaciones ? `<div class="sub">${U.esc(q.observaciones)}</div>` : ""}
        <div class="pie-tarjeta">
          <button class="btn icono secondary" data-edit="equipo-${q.id}">Editar</button>
          <button class="btn icono ghost" data-del="equipo-${q.id}">Eliminar</button>
        </div>
      </article>`;
    }).join("");
  };

  const modalEquipo = (id) => {
    const q = estado.datos.equipos.find((x) => x.id === id);
    abrirForm({
      titulo: q ? "Editar equipo" : "Nuevo equipo",
      secciones: [{ titulo: q ? "Datos del equipo" : "Equipo que se mantiene en escena", campos: camposEquipo(q) }],
      onDelete: q ? () => { estado.datos.equipos = estado.datos.equipos.filter((x) => x.id !== id); guardar(); renderEquipos(); } : null,
      onSubmit: (v) => {
        if (!v.nombre) { U.toast("El nombre del equipo es obligatorio.", "error"); return false; }
        const obj = { ...v, cantidad: Number(v.cantidad) || 1 };
        if (q) Object.assign(q, obj);
        else estado.datos.equipos.push({ id: DB.nextId(estado.datos.equipos), ...obj });
        guardar(); renderEquipos();
        U.toast(q ? "Equipo actualizado." : "Equipo agregado.");
      }
    });
  };

  const initEquipos = () => {
    const filtroSel = U.el("filtroEquipo");
    filtroSel.innerHTML = `<option value="">Todos los estados</option>` +
      CATALOGOS.estadosEquipo.map((f) => `<option>${U.esc(f)}</option>`).join("");
    filtroSel.addEventListener("change", renderEquipos);
    U.el("buscarEquipo").addEventListener("input", renderEquipos);
    U.el("btnNuevoEquipo").onclick = () => modalEquipo(null);
    U.el("listaEquipos").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-edit], button[data-del]");
      if (!b) return;
      const esEdit = b.hasAttribute("data-edit");
      const id = Number((b.dataset.edit || b.dataset.del).split("-").pop());
      if (esEdit) { modalEquipo(id); return; }
      (async () => {
        const ok = await U.confirmDialog("Eliminar equipo", "¿Eliminar este equipo?", "Eliminar", true);
        if (ok) { estado.datos.equipos = estado.datos.equipos.filter((x) => x.id !== id); guardar(); renderEquipos(); }
      })();
    });
  };

  /* ============================ Puesto Médico ============================ */

  const bindsPM = [
    ["pmEncargado", "encargado"], ["pmUbicacion", "ubicacion"], ["pmHora", "establecidoHora"]
  ];

  const bindPM = () => {
    for (const [id, key] of bindsPM) {
      const campoEl = U.el(id);
      campoEl.value = estado.datos.puestoMedico[key] || "";
      campoEl.addEventListener("change", () => {
        estado.datos.puestoMedico[key] = campoEl.value;
        guardar();
      });
    }
  };

  const camposPmFuncionario = (f) => [
    { name: "nombre", label: "Nombre completo", type: "text", required: true, value: f && f.nombre, span: true },
    { name: "run", label: "RUN / RUT", type: "text", value: f && f.run },
    { name: "cargo", label: "Cargo", type: "text", value: f && f.cargo },
    { name: "rol", label: "Rol en el puesto médico", type: "select", options: CATALOGOS.rolesPM, value: f && f.rol },
    { name: "turno", label: "Turno / horario", type: "text", value: f && f.turno },
    { name: "contacto", label: "Contacto", type: "text", value: f && f.contacto },
    { name: "estado", label: "Estado", type: "select", options: ["En puesto médico", "De guardia", "Saliente", "Retirado"], value: (f && f.estado) || "En puesto médico" }
  ];

  const renderPmFuncionarios = () => {
    const lista = estado.datos.puestoMedico.funcionarios;
    const cont = U.el("listaPmFuncionarios");
    if (!lista.length) {
      cont.innerHTML = vacio("No hay funcionarios asignados al puesto médico.");
      return;
    }
    cont.innerHTML = lista.map((f) => `<article class="tarjeta estado-activo">
      <div class="fila">
        <div>
          <div class="titulo">${U.esc(f.nombre)}</div>
          <div class="sub">${U.esc(f.rol || "Rol no indicado")}</div>
        </div>
        ${U.badge(f.estado || "En puesto médico", "azul")}
      </div>
      <div class="datos">
        <div class="d">Cargo: <b>${U.esc(f.cargo || "—")}</b></div>
        <div class="d">RUN: <b>${U.esc(f.run || "—")}</b></div>
        <div class="d">Turno: <b>${U.esc(f.turno || "—")}</b></div>
        <div class="d">Contacto: <b>${U.esc(f.contacto || "—")}</b></div>
      </div>
      <div class="pie-tarjeta">
        <button class="btn icono secondary" data-edit="pmf-${f.id}">Editar</button>
        <button class="btn icono ghost" data-del="pmf-${f.id}">Eliminar</button>
      </div>
    </article>`).join("");
  };

  const modalPmFuncionario = (id) => {
    const f = estado.datos.puestoMedico.funcionarios.find((x) => x.id === id);
    abrirForm({
      titulo: f ? "Editar funcionario del puesto médico" : "Funcionario del puesto médico",
      secciones: [{ titulo: "Datos del funcionario", campos: camposPmFuncionario(f) }],
      onDelete: f ? () => { estado.datos.puestoMedico.funcionarios = estado.datos.puestoMedico.funcionarios.filter((x) => x.id !== id); guardar(); renderPmFuncionarios(); } : null,
      onSubmit: (v) => {
        if (!v.nombre) { U.toast("El nombre es obligatorio.", "error"); return false; }
        if (f) Object.assign(f, v);
        else estado.datos.puestoMedico.funcionarios.push({ id: DB.nextId(estado.datos.puestoMedico.funcionarios), ...v });
        guardar(); renderPmFuncionarios();
        U.toast(f ? "Funcionario actualizado." : "Funcionario agregado al puesto médico.");
      }
    });
  };

  const camposLesionado = (l) => {
    const s = (l && l.signos) || {};
    return [
      {
        titulo: "Identificación del lesionado", campos: [
          { name: "nombre", label: "Nombre completo", type: "text", required: true, value: l && l.nombre, span: true },
          { name: "run", label: "RUN", type: "text", value: l && l.run },
          { name: "edad", label: "Edad", type: "number", min: 0, max: 120, value: l && l.edad },
          { name: "sexo", label: "Sexo", type: "select", options: CATALOGOS.sexos, value: l && l.sexo },
          { name: "domicilio", label: "Domicilio", type: "text", value: l && l.domicilio, span: true },
          { name: "fono", label: "Fono / contacto", type: "text", value: l && l.fono },
          { name: "horaIngreso", label: "Hora de ingreso", type: "time", value: l ? l.horaIngreso : U.nowTime() }
        ]
      },
      {
        titulo: "Evaluación y triage", campos: [
          { name: "triage", label: "Triage", type: "select", required: true, options: CATALOGOS.triage, value: (l && l.triage) || "Amarillo (demorado)" },
          { name: "mecanismo", label: "Mecanismo o causa", type: "text", value: l && l.mecanismo },
          { name: "motivo", label: "Motivo de consulta / lesiones", type: "textarea", rows: 2, value: l && l.motivo, span: true }
        ]
      },
      {
        titulo: "Signos vitales y evaluación", campos: [
          { name: "signos.pa", label: "PA (mmHg)", type: "text", value: s.pa, placeholder: "Ej: 120/80" },
          { name: "signos.fc", label: "FC (lpm)", type: "text", value: s.fc },
          { name: "signos.fr", label: "FR (rpm)", type: "text", value: s.fr },
          { name: "signos.sat", label: "SatO₂ (%)", type: "number", min: 0, max: 100, value: s.sat },
          { name: "signos.temperatura", label: "T° (°C)", type: "text", value: s.temperatura },
          { name: "signos.eva", label: "EVA (0-10)", type: "number", min: 0, max: 10, value: s.eva },
          { name: "signos.glucosa", label: "Glucosa (mg/dL)", type: "text", value: s.glucosa },
          { name: "signos.cincinnati", label: "Cincinnati / escala", type: "text", value: s.cincinnati },
          { name: "signos.avpu", label: "Nivel de conciencia (AVPU)", type: "select", options: CATALOGOS.avpu, value: s.avpu || "" }
        ]
      },
      {
        titulo: "Atención y destino", campos: [
          { name: "diagnostico", label: "Diagnóstico presuntivo", type: "text", value: l && l.diagnostico, span: true },
          { name: "tratamiento", label: "Tratamiento / atención prestada", type: "textarea", rows: 2, value: l && l.tratamiento, span: true },
          { name: "destino", label: "Destino", type: "select", options: CATALOGOS.destinoLesionado, value: (l && l.destino) || "En puesto médico" },
          { name: "hospital", label: "Centro de destino", type: "text", value: l && l.hospital },
          { name: "observaciones", label: "Observaciones", type: "textarea", rows: 2, value: l && l.observaciones, span: true }
        ]
      }
    ];
  };

  const renderLesionados = () => {
    const lista = estado.datos.puestoMedico.lesionados;
    const cont = U.el("listaLesionados");
    const triage = (t) => String(t || "").toLowerCase();

    U.el("resumenLesionados").innerHTML = `
      <div class="item"><b>${lista.length}</b>lesionados</div>
      <div class="item no-print" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
        ${CATALOGOS.triage.map((t) => {
          const n = lista.filter((l) => triage(l.triage) === triage(t)).length;
          const c = triage(t).includes("rojo") ? "rojo" : triage(t).includes("negro") ? "negro" : triage(t).includes("verde") ? "verde" : "ambar";
          return U.badge(`${t.split(" ")[0]} ${n}`, c);
        }).join("")}
      </div>`;

    if (!lista.length) {
      cont.innerHTML = vacio("No hay lesionados registrados en el puesto médico.");
      return;
    }

    cont.innerHTML = lista.map((l) => {
      const s = l.signos || {};
      const cTriage = triage(l.triage).includes("rojo") ? "rojo" : triage(l.triage).includes("negro") ? "negro" : triage(l.triage).includes("verde") ? "verde" : "ambar";
      return `<article class="tarjeta estado-alerta">
        <div class="fila">
          <div>
            <div class="titulo">${U.esc(l.nombre)}</div>
            <div class="sub">${l.edad ? l.edad + " años · " : ""}${U.esc(l.sexo || "")} ${l.horaIngreso ? "· Ingreso " + U.esc(l.horaIngreso) : ""}</div>
          </div>
          ${U.badge(l.triage, cTriage)}
        </div>
        <div class="datos">
          <div class="d">RUN: <b>${U.esc(l.run || "—")}</b></div>
          <div class="d">Motivo: <b>${U.esc(l.motivo || "—")}</b></div>
          <div class="d">PA: <b>${U.esc(s.pa || "—")}</b></div>
          <div class="d">FC: <b>${U.esc(s.fc || "—")}</b></div>
          <div class="d">FR: <b>${U.esc(s.fr || "—")}</b></div>
          <div class="d">SatO₂: <b>${U.esc(s.sat || "—")}</b></div>
          <div class="d">T°: <b>${U.esc(s.temperatura || "—")}</b></div>
          <div class="d">AVPU: <b>${U.esc(s.avpu || "—")}</b></div>
          <div class="d">Diagnóstico: <b>${U.esc(l.diagnostico || "—")}</b></div>
          <div class="d">Destino: <b>${U.esc(l.destino || "—")}</b></div>
        </div>
        ${l.tratamiento ? `<div class="sub"><b>Atención:</b> ${U.esc(l.tratamiento)}</div>` : ""}
        <div class="pie-tarjeta">
          <button class="btn icono secondary" data-edit="les-${l.id}">Editar</button>
          <button class="btn icono ghost" data-del="les-${l.id}">Eliminar</button>
        </div>
      </article>`;
    }).join("");
  };

  const modalLesionado = (id) => {
    const l = estado.datos.puestoMedico.lesionados.find((x) => x.id === id);
    abrirForm({
      titulo: l ? "Editar lesionado" : "Registrar lesionado",
      secciones: camposLesionado(l),
      onDelete: l ? () => { estado.datos.puestoMedico.lesionados = estado.datos.puestoMedico.lesionados.filter((x) => x.id !== id); guardar(); renderLesionados(); } : null,
      onSubmit: (v) => {
        if (!v.nombre) { U.toast("El nombre del lesionado es obligatorio.", "error"); return false; }
        const signos = {};
        for (const k of ["pa", "fc", "fr", "sat", "temperatura", "eva", "glucosa", "cincinnati", "avpu"]) {
          signos[k] = v["signos." + k] || "";
        }
        const obj = { ...v };
        delete obj["signos.pa"]; delete obj["signos.fc"]; delete obj["signos.fr"]; delete obj["signos.sat"];
        delete obj["signos.temperatura"]; delete obj["signos.eva"]; delete obj["signos.glucosa"];
        delete obj["signos.cincinnati"]; delete obj["signos.avpu"];
        obj.signos = signos;
        if (l) Object.assign(l, obj);
        else estado.datos.puestoMedico.lesionados.push({ id: DB.nextId(estado.datos.puestoMedico.lesionados), ...obj });
        guardar(); renderLesionados();
        U.toast(l ? "Lesionado actualizado." : "Lesionado registrado.");
      }
    });
  };

  const initPuesto = () => {
    bindPM();
    U.el("btnNuevoPmFuncionario").onclick = () => modalPmFuncionario(null);
    U.el("listaPmFuncionarios").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-edit], button[data-del]");
      if (!b) return;
      const esEdit = b.hasAttribute("data-edit");
      const id = Number((b.dataset.edit || b.dataset.del).split("-").pop());
      if (esEdit) { modalPmFuncionario(id); return; }
      (async () => {
        const ok = await U.confirmDialog("Eliminar funcionario", "¿Quitar este funcionario del puesto médico?", "Eliminar", true);
        if (ok) { estado.datos.puestoMedico.funcionarios = estado.datos.puestoMedico.funcionarios.filter((x) => x.id !== id); guardar(); renderPmFuncionarios(); }
      })();
    });
    U.el("btnNuevoLesionado").onclick = () => modalLesionado(null);
    U.el("listaLesionados").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-edit], button[data-del]");
      if (!b) return;
      const esEdit = b.hasAttribute("data-edit");
      const id = Number((b.dataset.edit || b.dataset.del).split("-").pop());
      if (esEdit) { modalLesionado(id); return; }
      (async () => {
        const ok = await U.confirmDialog("Eliminar lesionado", "¿Eliminar este registro de lesionado?", "Eliminar", true);
        if (ok) { estado.datos.puestoMedico.lesionados = estado.datos.puestoMedico.lesionados.filter((x) => x.id !== id); guardar(); renderLesionados(); }
      })();
    });
  };

  /* ============================ Resumen ============================ */

  const renderResumen = () => {
    const inc = estado.datos.incidente;
    const personal = estado.datos.personal;
    const recursos = estado.datos.recursos;
    const equipos = estado.datos.equipos;
    const pm = estado.datos.puestoMedico;
    const lesionados = pm.lesionados;

    const enIncidente = personal.filter((p) => p.estado === "En incidente").length;
    const enEscena = recursos.filter((r) => ["En escena", "En ruta", "Despachado"].includes(r.estado)).length;
    const regresados = recursos.filter((r) => r.estado === "Regresó a base").length;
    const totalEquipos = equipos.reduce((s, q) => s + (Number(q.cantidad) || 1), 0);
    const triageRojo = lesionados.filter((l) => String(l.triage || "").toLowerCase().includes("rojo")).length;
    const fallecidos = lesionados.filter((l) => String(l.triage || "").toLowerCase().includes("negro")).length || lesionados.filter((l) => l.destino === "Fallecido").length;

    const titulo = [inc.tipo || "Incidente", inc.direccion || inc.comuna || ""].filter(Boolean).join(" en ") || "Sin datos";
    U.el("resumenEncabezado").textContent =
      `Folio: ${inc.folio || "—"} · ${titulo} · Alertado ${inc.alerta || "—"} · Estado: ${inc.estado} · Inicio ${U.fmtFecha(inc.fechaInicio)} ${inc.horaInicio || ""}`;

    U.el("tarjetasResumen").innerHTML = `
      <div class="tarjeta-resumen"><b>${personal.length}</b><span>Funcionarios totales</span></div>
      <div class="tarjeta-resumen verde"><b>${enIncidente}</b><span>En incidente</span></div>
      <div class="tarjeta-resumen"><b>${recursos.length}</b><span>Recursos movilizados</span></div>
      <div class="tarjeta-resumen verde"><b>${enEscena}</b><span>En camino / escena</span></div>
      <div class="tarjeta-resumen gris"><b>${regresados}</b><span>Regresados</span></div>
      <div class="tarjeta-resumen"><b>${equipos.length}</b><span>Partidas de equipo</span></div>
      <div class="tarjeta-resumen"><b>${totalEquipos}</b><span>Unidades de equipo</span></div>
      <div class="tarjeta-resumen"><b>${pm.funcionarios.length}</b><span>Puesto médico: funcionarios</span></div>
      <div class="tarjeta-resumen"><b>${lesionados.length}</b><span>Lesionados atendidos</span></div>
      <div class="tarjeta-resumen rojo"><b>${triageRojo}</b><span>Triage rojo</span></div>
      <div class="tarjeta-resumen negro" style="background:#2a3138;border-color:#1c2228;"><b style="color:#f0f2f5">${fallecidos}</b><span style="color:#aab4bf">Fallecidos</span></div>`;

    const cuerpo = U.el("tablaPersonalResumen").querySelector("tbody");
    const porFuncion = {};
    personal.forEach((p) => {
      const f = p.funcionSCI || "Sin asignar";
      porFuncion[f] = (porFuncion[f] || 0) + 1;
    });
    cuerpo.innerHTML = Object.entries(porFuncion)
      .sort((a, b) => b[1] - a[1])
      .map(([f, n]) => `<tr><td>${U.esc(f)}</td><td><b>${n}</b></td></tr>`).join("") ||
      `<tr><td colspan="2">Sin funcionarios registrados.</td></tr>`;

    const alertas = U.el("alertasResumen");
    alertas.innerHTML = "";
    if (inc.estado && inc.estado !== "Cerrado" && !inc.fechaControl) {
      alertas.insertAdjacentHTML("beforeend", `<div class="alerta-box ambar">El incidente aún <b>no registra fecha/hora de control</b>. Regístrela en la pestaña Incidente.</div>`);
    }
    if (lesionados.length && triageRojo > 0) {
      alertas.insertAdjacentHTML("beforeend", `<div class="alerta-box rojo">Hay <b>${triageRojo} lesionado(s) con triage rojo</b>. Verifique prioridad de traslado.</div>`);
    }
    if (fallecidos > 0) {
      alertas.insertAdjacentHTML("beforeend", `<div class="alerta-box rojo">Se registran <b>${fallecidos} fallecido(s)</b>. Active protocolo de comunicación a fiscalía/SEBV si corresponde.</div>`);
    }
    if (!recursos.some((r) => ["En escena"].includes(r.estado)) && recursos.length) {
      alertas.insertAdjacentHTML("beforeend", `<div class="alerta-box ambar">No hay recursos marcados como <b>en escena</b>.</div>`);
    }
  };

  /* ============================ Informe ============================ */

  const datosInforme = () => {
    const inc = estado.datos.incidente;
    const personal = estado.datos.personal;
    const recursos = estado.datos.recursos;
    const equipos = estado.datos.equipos;
    const pm = estado.datos.puestoMedico;
    return { inc, personal, recursos, equipos, pm };
  };

  const htmlInforme = () => {
    const { inc, personal, recursos, equipos, pm } = datosInforme();
    const lesionados = pm.lesionados;

    const dl = (pares) => "<dl>" + pares.map(([k, v]) => v ? `<dt>${U.esc(k)}</dt><dd>${U.esc(v)}</dd>` : "").join("") + "</dl>";

    const incHeader = `
      <div class="encabezado-informe">
        <div>
          <div class="etiqueta">Informe de emergencia</div>
          <h2>${U.esc([inc.tipo, inc.alerta].filter(Boolean).join(" · ") || "Incidente")}</h2>
          ${inc.direccion ? `<p style="margin:2px 0 0;color:#5a6776">${U.esc(inc.direccion)}${inc.comuna ? ", " + U.esc(inc.comuna) : ""}${inc.cuadrante ? " · Cuadrante " + U.esc(inc.cuadrante) : ""}</p>` : ""}
        </div>
        <div class="codigo">${U.esc(inc.folio || "S/N")}</div>
      </div>`;

    let html = incHeader;

    html += `<h3>1. Datos del incidente</h3>`;
    html += dl([
      ["Estado", inc.estado], ["Comandante del Incidente", inc.comandante], ["Puesto de comando", inc.puntoComando],
      ["Inicio", (inc.fechaInicio ? U.fmtFecha(inc.fechaInicio) : "") + (inc.horaInicio ? " " + inc.horaInicio : "")],
      ["Control", (inc.fechaControl ? U.fmtFecha(inc.fechaControl) : "") + (inc.horaControl ? " " + inc.horaControl : "")],
      ["Comuna", inc.comuna], ["Cuadrante", inc.cuadrante]
    ]);
    if (inc.descripcion) html += `<h4 style="margin:8px 0 4px">Hechos</h4><div class="bloque-txt">${U.esc(inc.descripcion)}</div>`;

    html += `<h3>2. Funcionarios en la emergencia (${personal.length})</h3>`;
    if (!personal.length) html += `<p style="color:#888">Sin registros.</p>`;
    else {
      html += `<div class="tabla-wrap"><table class="tabla"><thead><tr><th>Nombre</th><th>Rol SCI</th><th>Cargo</th><th>Unidad</th><th>Ingreso</th><th>Salida</th><th>Estado</th></tr></thead><tbody>`;
      personal.forEach((p) => {
        html += `<tr><td>${U.esc(p.nombre)}</td><td>${U.esc(p.funcionSCI || "—")}</td><td>${U.esc(p.cargo || "—")}</td><td>${U.esc(p.unidad || "—")}</td><td>${U.esc(p.horaInicio || "—")}</td><td>${U.esc(p.horaSalida || "en escena")}</td><td>${U.esc(p.estado || "—")}</td></tr>`;
      });
      html += `</tbody></table></div>`;
    }

    html += `<h3>3. Recursos movilizados (${recursos.length})</h3>`;
    if (!recursos.length) html += `<p style="color:#888">Sin registros.</p>`;
    else {
      html += `<div class="tabla-wrap"><table class="tabla"><thead><tr><th>Tipo</th><th>Id.</th><th>Origen</th><th>Despacho</th><th>Llegada</th><th>Regreso</th><th>Estado</th><th>A cargo</th></tr></thead><tbody>`;
      recursos.forEach((r) => {
        html += `<tr><td>${U.esc(r.tipo)}</td><td>${U.esc(r.identificacion || "—")}</td><td>${U.esc(r.origen || "—")}</td><td>${U.esc(r.horaDespacho || "—")}</td><td>${U.esc(r.horaLlegada || "—")}</td><td>${U.esc(r.horaRegreso || "—")}</td><td>${U.esc(r.estado)}</td><td>${U.esc(r.personalACargo || "—")}</td></tr>`;
      });
      html += `</tbody></table></div>`;
    }

    html += `<h3>4. Equipos en escena (${equipos.length})</h3>`;
    if (!equipos.length) html += `<p style="color:#888">Sin registros.</p>`;
    else {
      html += `<div class="tabla-wrap"><table class="tabla"><thead><tr><th>Equipo</th><th>Tipo</th><th>Cant.</th><th>Ubicación</th><th>Responsable</th><th>Estado</th></tr></thead><tbody>`;
      equipos.forEach((q) => {
        html += `<tr><td>${U.esc(q.nombre)}</td><td>${U.esc(q.tipo || "—")}</td><td>${U.esc(q.cantidad || 1)}</td><td>${U.esc(q.ubicacion || "—")}</td><td>${U.esc(q.asignadoA || "—")}</td><td>${U.esc(q.estado)}</td></tr>`;
      });
      html += `</tbody></table></div>`;
    }

    html += `<h3>5. Puesto médico</h3>`;
    html += dl([
      ["Encargado", pm.encargado], ["Ubicación", pm.ubicacion], ["Hora de instalación", pm.establecidoHora]
    ]);
    html += `<p class="etiqueta" style="margin:10px 0 4px">Funcionarios del puesto médico (${pm.funcionarios.length})</p>`;
    if (!pm.funcionarios.length) html += `<p style="color:#888">Sin registros.</p>`;
    else {
      html += `<div class="tabla-wrap"><table class="tabla"><thead><tr><th>Nombre</th><th>Rol</th><th>Cargo</th><th>Turno</th><th>Contacto</th></tr></thead><tbody>`;
      pm.funcionarios.forEach((f) => {
        html += `<tr><td>${U.esc(f.nombre)}</td><td>${U.esc(f.rol || "—")}</td><td>${U.esc(f.cargo || "—")}</td><td>${U.esc(f.turno || "—")}</td><td>${U.esc(f.contacto || "—")}</td></tr>`;
      });
      html += `</tbody></table></div>`;
    }

    html += `<h3>6. Lesionados atendidos (${lesionados.length})</h3>`;
    if (!lesionados.length) html += `<p style="color:#888">Sin registros.</p>`;
    else {
      lesionados.forEach((l, i) => {
        const s = l.signos || {};
        html += `<h4 style="margin:12px 0 4px">${i + 1}. ${U.esc(l.nombre)} — ${U.esc(l.triage || "Sin triage")}</h4>`;
        html += dl([
          ["RUN", l.run], ["Edad / sexo", [l.edad, l.sexo].filter(Boolean).join(" / ")], ["Fono", l.fono],
          ["Hora de ingreso", l.horaIngreso], ["Domicilio", l.domicilio], ["Mecanismo", l.mecanismo],
          ["Motivo / lesiones", l.motivo]
        ]);
        html += `<p class="etiqueta" style="margin:6px 0 2px">Signos vitales</p>`;
        html += `<div class="tabla-wrap"><table class="tabla"><thead><tr><th>PA</th><th>FC</th><th>FR</th><th>SatO₂</th><th>T°</th><th>EVA</th><th>Glucosa</th><th>Cincinnati</th><th>AVPU</th></tr></thead><tbody><tr>
          <td>${U.esc(s.pa || "—")}</td><td>${U.esc(s.fc || "—")}</td><td>${U.esc(s.fr || "—")}</td><td>${U.esc(s.sat || "—")}</td><td>${U.esc(s.temperatura || "—")}</td><td>${U.esc(s.eva || "—")}</td><td>${U.esc(s.glucosa || "—")}</td><td>${U.esc(s.cincinnati || "—")}</td><td>${U.esc(s.avpu || "—")}</td>
        </tr></tbody></table></div>`;
        html += dl([
          ["Diagnóstico presuntivo", l.diagnostico], ["Atención / tratamiento", l.tratamiento],
          ["Destino", l.destino], ["Centro de destino", l.hospital], ["Observaciones", l.observaciones]
        ]);
      });
    }

    html += `<h3>7. Firma</h3>`;
    html += `<div class="bloque-txt" style="height:70px;background:transparent;border:none;border-top:1px solid #999;">Comandante del Incidente: ${U.esc(inc.comandante || "")}${inc.folio ? " · Folio " + U.esc(inc.folio) : ""}</div>`;

    return html;
  };

  const textoInforme = () => {
    const { inc, personal, recursos, equipos, pm } = datosInforme();
    const L = [];
    L.push("INFORME DE EMERGENCIA");
    L.push("Folio: " + (inc.folio || "S/N"));
    L.push("Tipo: " + (inc.tipo || "—") + " · Alerta: " + (inc.alerta || "—") + " · Estado: " + (inc.estado || "—"));
    L.push("Inicio: " + U.fmtFecha(inc.fechaInicio) + " " + (inc.horaInicio || "") + " · Control: " + U.fmtFecha(inc.fechaControl) + " " + (inc.horaControl || ""));
    L.push("Lugar: " + [inc.direccion, inc.comuna, inc.cuadrante ? "cuadrante " + inc.cuadrante : ""].filter(Boolean).join(", "));
    L.push("CI: " + (inc.comandante || "—") + " · Puesto de comando: " + (inc.puntoComando || "—"));
    if (inc.descripcion) L.push("Hechos: " + inc.descripcion);
    L.push("");
    L.push("FUNCIONARIOS EN LA EMERGENCIA (" + personal.length + ")");
    personal.forEach((p) => L.push("- " + p.nombre + " | " + (p.funcionSCI || "sin rol") + " | " + (p.unidad || "") + " | " + (p.horaInicio || "") + " → " + (p.horaSalida || "en escena")));
    L.push("");
    L.push("RECURSOS MOVILIZADOS (" + recursos.length + ")");
    recursos.forEach((r) => L.push("- " + r.tipo + (r.identificacion ? " (" + r.identificacion + ")" : "") + " | " + (r.origen || "—") + " | despacho " + (r.horaDespacho || "—") + " | llegada " + (r.horaLlegada || "—") + " | regreso " + (r.horaRegreso || "—") + " | " + r.estado));
    L.push("");
    L.push("EQUIPOS EN ESCENA (" + equipos.length + ")");
    equipos.forEach((q) => L.push("- " + q.nombre + " ×" + (q.cantidad || 1) + " | " + (q.tipo || "—") + " | " + (q.ubicacion || "—") + " | " + (q.estado)));
    L.push("");
    L.push("PUESTO MÉDICO");
    L.push("Encargado: " + (pm.encargado || "—") + " · Ubicación: " + (pm.ubicacion || "—") + " · Instalado: " + (pm.establecidoHora || "—"));
    L.push("Funcionarios (" + pm.funcionarios.length + ")");
    pm.funcionarios.forEach((f) => L.push("- " + f.nombre + " | " + (f.rol || "—") + " | " + (f.turno || "—")));
    L.push("Lesionados (" + pm.lesionados.length + ")");
    pm.lesionados.forEach((l, i) => {
      const s = l.signos || {};
      L.push((i + 1) + ". " + l.nombre + " | " + (l.triage || "—") + " | PA " + (s.pa || "—") + " FC " + (s.fc || "—") + " FR " + (s.fr || "—") + " Sat " + (s.sat || "—") + " | " + (l.motivo || "") + " | Destino: " + (l.destino || "—"));
    });
    return L.join("\n");
  };

  const renderInforme = () => {
    U.el("informe").innerHTML = htmlInforme();
  };

  const initInforme = () => {
    U.el("btnImprimir").onclick = () => { renderInforme(); window.print(); };
    U.el("btnCopiarInforme").onclick = async () => {
      try {
        await navigator.clipboard.writeText(textoInforme());
        U.toast("Informe copiado al portapapeles.");
      } catch (e) {
        U.toast("No se pudo copiar.", "error");
      }
    };
  };

  /* ============================ Datos generales (respaldos) ============================ */

  const initDatos = () => {
    U.el("btnExportar").onclick = () => {
      U.descargar("sci-incidente-" + (estado.datos.incidente.folio || "sinnumero").replace(/[^a-zA-Z0-9_-]/g, "") + ".json", JSON.stringify(estado.datos, null, 2));
      U.toast("Respaldo exportado.");
    };
    U.el("btnImportar").onclick = () => U.el("inputImportar").click();
    U.el("inputImportar").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          estado.datos = DB.importar(r.result);
          sincronizarFormularios();
          renderAll();
          U.toast("Respaldo restaurado.");
        } catch (err) {
          U.toast(err.message || "Archivo inválido.", "error");
        }
      };
      r.readAsText(file);
      e.target.value = "";
    });
    U.el("btnNuevo").onclick = async () => {
      const ok = await U.confirmDialog("Nuevo incidente", "Se borrarán los datos del incidente actual. ¿Desea comenzar un nuevo incidente? (Respalde antes si lo necesita)", "Comenzar", true);
      if (!ok) return;
      estado.datos = DB.reset();
      sincronizarFormularios();
      renderAll();
      U.toast("Nuevo incidente iniciado.");
    };
  };

  const renderAll = () => {
    renderPersonal();
    renderRecursos();
    renderEquipos();
    renderPmFuncionarios();
    renderLesionados();
    actualizarChip();
    actualizarMeta();
  };

  const sincronizarFormularios = () => {
    for (const [id, key] of bindsIncidente) U.el(id).value = estado.datos.incidente[key] || "";
    for (const [id, key] of bindsPM) U.el(id).value = estado.datos.puestoMedico[key] || "";
  };

  /* ============================ Inicio ============================ */

  const init = () => {
    initTabs();
    bindIncidente();
    initPersonal();
    initRecursos();
    initEquipos();
    initPuesto();
    initInforme();
    initDatos();
    renderAll();
  };

  document.addEventListener("DOMContentLoaded", init);
})();