import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";

  try {
    // Cliente con el token de quien llama (para verificar su identidad)
    const caller = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData, error: uErr } = await caller.auth.getUser();
    if (uErr || !userData.user) return json({ error: "No autenticado" }, 401);

    // Cliente administrador (service role) — nunca se expone al navegador
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const { data: perfil } = await admin
      .from("perfiles")
      .select("rol")
      .eq("id", userData.user.id)
      .maybeSingle();

    if (!perfil || perfil.rol !== "ADMINISTRADOR") {
      return json({ error: "Solo un ADMINISTRADOR puede gestionar usuarios" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const accion = body.accion;

    if (accion === "crear") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const nombre = String(body.nombre || "").trim();
      const rol = String(body.rol || "RESCATISTA");
      if (!email || !password) return json({ error: "Correo y contraseña son obligatorios" }, 400);
      if (password.length < 6) return json({ error: "La contraseña debe tener al menos 6 caracteres" }, 400);

      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { nombre: nombre || email, rol },
      });
      if (error) return json({ error: error.message }, 400);

      const uid = data.user.id;
      await admin.from("perfiles").upsert(
        { id: uid, email, nombre: nombre || email, rol },
        { onConflict: "id" },
      );
      return json({ ok: true, id: uid });
    }

    if (accion === "eliminar") {
      const id = String(body.id || "");
      if (!id) return json({ error: "Falta el id del usuario" }, 400);
      if (id === userData.user.id) return json({ error: "No puede eliminarse a sí mismo" }, 400);

      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) return json({ error: error.message }, 400);

      await admin.from("perfiles").delete().eq("id", id);
      return json({ ok: true });
    }

    return json({ error: "Acción inválida" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
