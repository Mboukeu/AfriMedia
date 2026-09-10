const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

const auth = (request, env) => {
  const key = request.headers.get("x-admin-key");
  return key && env.ADMIN_KEY && key === env.ADMIN_KEY;
};

async function api(request, env) {
  const url = new URL(request.url);
  const commissionRate = Number(env.COMMISSION_RATE || "0.10");

  if (url.pathname === "/api/health") return json({ ok: true, service: "AfriMedia API", version: "3.0.0" });

  if (url.pathname === "/api/services" && request.method === "GET") {
    const { results } = await env.DB.prepare(`
      SELECT s.*, u.name AS seller_name
      FROM services s JOIN users u ON u.id=s.seller_id
      WHERE s.active=1 ORDER BY s.id DESC
    `).all();
    return json(results);
  }

  if (url.pathname === "/api/users" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const { name, email } = body;
    if (!name || !email) return json({ error: "Nom et e-mail requis" }, 400);
    try {
      const result = await env.DB.prepare("INSERT INTO users(name,email,role) VALUES(?,?,?)")
        .bind(String(name).trim(), String(email).trim().toLowerCase(), "client").run();
      return json({ id: result.meta.last_row_id, name, email, role: "client" }, 201);
    } catch {
      return json({ error: "Cet e-mail existe déjà" }, 409);
    }
  }

  if (url.pathname === "/api/admin/stats" && request.method === "GET") {
    if (!auth(request, env)) return json({ error: "Accès administrateur requis" }, 401);
    const users = await env.DB.prepare("SELECT COUNT(*) c FROM users").first("c");
    const services = await env.DB.prepare("SELECT COUNT(*) c FROM services WHERE active=1").first("c");
    const sales = await env.DB.prepare("SELECT COALESCE(SUM(amount_fcfa),0) total FROM orders WHERE status='paid'").first("total");
    const commissions = await env.DB.prepare("SELECT COALESCE(SUM(commission_fcfa),0) total FROM orders WHERE status='paid'").first("total");
    return json({ users, services, sales_fcfa: sales, commissions_fcfa: commissions, commission_rate: commissionRate });
  }

  if (url.pathname === "/api/admin/services" && request.method === "POST") {
    if (!auth(request, env)) return json({ error: "Accès administrateur requis" }, 401);
    const body = await request.json().catch(() => ({}));
    const { seller_id, title, description = "", price_fcfa } = body;
    if (!Number.isInteger(Number(seller_id)) || !title || !Number.isInteger(Number(price_fcfa)) || Number(price_fcfa) <= 0)
      return json({ error: "Données de service invalides" }, 400);
    const seller = await env.DB.prepare("SELECT id FROM users WHERE id=? AND role IN ('creator','admin')").bind(Number(seller_id)).first();
    if (!seller) return json({ error: "Créateur introuvable" }, 403);
    const result = await env.DB.prepare("INSERT INTO services(seller_id,title,description,price_fcfa) VALUES(?,?,?,?)")
      .bind(Number(seller_id), String(title), String(description), Number(price_fcfa)).run();
    return json({ id: result.meta.last_row_id }, 201);
  }

  if (url.pathname === "/api/admin/promote" && request.method === "POST") {
    if (!auth(request, env)) return json({ error: "Accès administrateur requis" }, 401);
    const body = await request.json().catch(() => ({}));
    if (!Number.isInteger(Number(body.user_id)) || !["creator", "admin"].includes(body.role)) return json({ error: "Données invalides" }, 400);
    await env.DB.prepare("UPDATE users SET role=? WHERE id=?").bind(body.role, Number(body.user_id)).run();
    return json({ ok: true });
  }

  return null;
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname.startsWith("/api/")) {
      try {
        const response = await api(request, env);
        if (response) return response;
        return json({ error: "Route API introuvable" }, 404);
      } catch (error) {
        console.error(error);
        return json({ error: "Erreur serveur" }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  }
};
