const DB = (() => {
  const KEY = "comandoIncidentesDB_v1";

  const CATALOGOS = {
    tiposIncendio: [
      "Incendio estructural", "Incendio vehicular", "Incendio forestal", "Incendio de pastizales",
      "Rescate vehicular", "Rescate en altura", "Rescate acuático", "Rescate en espacios confinados",
      "Emergencia médica", "Materiales peligrosos (HAZMAT)", "Fuga de gas", "Derrame de combustible",
      "Inundación", "Colapso estructural", "Accidente de tránsito", "Otra"
    ],
    alertas: ["Alerta Temprana", "Alerta Amarilla", "Alerta Roja", "1ª Alarma", "2ª Alarma", "3ª Alarma", "Sin alarma"],
    estadosIncidente: ["Activo", "Controlado", "En revisión (overhaul)", "Cerrado"],
    funcionesSCI: [
      "Comandante del Incidente (CI)", "Oficial de Seguridad", "Información Pública", "Enlace",
      "Jefe de Operaciones", "Jefe de Planificación", "Jefe de Logística", "Jefe de Administración/Finanzas",
      "Sin asignar"
    ],
    estadosPersonal: ["En incidente", "En descanso (REHAB)", "Fuera de servicio", "Desmovilizado"],
    estadosRecurso: ["Solicitado", "Despachado", "En ruta", "En escena", "Disponible", "Regresando", "Regresó a base", "Fuera de servicio"],
    tiposRecurso: ["Carro bomba", "Camión aljibe", "Carro rescate", "Ambulancia", "Vehículo de mando", "Grupo de rescate", "Brigada forestal", "Unidad de apoyo", "Recurso externo"],
    estadosEquipo: ["Operativo", "En uso", "Reserva", "En mantención", "Fuera de servicio"],
    tiposEquipo: ["Equipo de protección personal (EPP)", "ERA/SCBA", "Herramienta de corte", "Herramienta de rescate", "Escaleras", "Mangueras", "Extintores", "Equipo médico", "Equipo de comunicación", "Equipo HAZMAT", "Generador/iluminación", "Bombas", "Otro"],
    triage: ["Rojo (inmediato)", "Amarillo (demorado)", "Verde (ambulatorio)", "Negro (expectante/fallecido)"],
    destinoLesionado: ["En puesto médico", "Traslado a hospital", "Derivado a SAMU", "Alta en el lugar", "Fallecido"],
    sexos: ["Masculino", "Femenino", "Otro/No informa"],
    avpu: ["A - Alerta", "V - Responde a voz", "P - Responde a dolor", "U - Inconsciente"],
    rolesPM: ["Médico", "Enfermero(a)", "Paramédico", "TENS", "Conductor ambulancia", "Encargado de triage", "Apoyo", "Otro"]
  };

  const defaultData = () => ({
    incidente: {
      folio: "",
      tipo: "",
      alerta: "",
      estado: "Activo",
      fechaInicio: U.todayISO(),
      horaInicio: U.nowTime(),
      fechaControl: "",
      horaControl: "",
      direccion: "",
      comuna: "",
      cuadrante: "",
      comandante: "",
      puntoComando: "",
      descripcion: "",
      actualizado: ""
    },
    personal: [],
    recursos: [],
    equipos: [],
    puestoMedico: {
      encargado: "",
      ubicacion: "",
      establecidoHora: "",
      funcionarios: [],
      lesionados: []
    }
  });

  let data = null;

  const nextId = (arr) => arr.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;

  const load = () => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        data = JSON.parse(raw);
        if (!data.incidente) data = defaultData();
      } else {
        data = defaultData();
        save();
      }
    } catch (e) {
      data = defaultData();
      save();
    }
    return data;
  };

  const save = () => {
    if (data) data.incidente.actualizado = new Date().toISOString();
    localStorage.setItem(KEY, JSON.stringify(data || load()));
  };

  const reset = () => {
    data = defaultData();
    save();
    return data;
  };

  const importar = (json) => {
    const obj = typeof json === "string" ? JSON.parse(json) : json;
    if (!obj || typeof obj !== "object" || !obj.incidente) {
      throw new Error("El archivo no corresponde a un respaldo válido.");
    }
    obj.personal = obj.personal || [];
    obj.recursos = obj.recursos || [];
    obj.equipos = obj.equipos || [];
    obj.puestoMedico = obj.puestoMedico || { encargado: "", ubicacion: "", establecidoHora: "", funcionarios: [], lesionados: [] };
    obj.puestoMedico.funcionarios = obj.puestoMedico.funcionarios || [];
    obj.puestoMedico.lesionados = obj.puestoMedico.lesionados || [];
    data = obj;
    save();
    return data;
  };

  return { CATALOGOS, get: () => (data || load()), load, save, reset, nextId, importar, KEY };
})();
