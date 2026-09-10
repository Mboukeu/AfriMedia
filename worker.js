const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

const auth = (request, env) => {
  const key = request.headers.get("x-admin-key");
  return key && env.ADMIN_KEY && key === env.ADMIN_KEY;
};

const cinetpayRequest = async (path, env, payload) => {
  if (!env.CINETPAY_API_KEY || !env.CINETPAY_SITE_ID) {
    throw new Error("CinetPay non configuré: CINETPAY_API_KEY/CINETPAY_SITE_ID manquants");
  }
  const response = await fetch(`https://api-checkout.cinetpay.com/v2/payment${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "AfriMedia/3.1 (+Cloudflare Workers)"
    },
    body: JSON.stringify({
      apikey: env.CINETPAY_API_KEY,
      site_id: env.CINETPAY_SITE_ID,
      ...payload
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`CinetPay HTTP ${response.status}`);
  return data;
};

const verifyCinetPay = async (env, transactionId) => {
  return cinetpayRequest("/check", env, { transaction_id: transactionId });
};

const markOrderPaid = async (env, order, payment) => {
  const data = payment?.data || {};
  const status = String(data.status || "").toUpperCase();
  const amount = Number(data.amount);
  const currency = String(data.currency || "").toUpperCase();

  if (payment?.code !== "00" || status !== "ACCEPTED") {
    return { paid: false, status };
  }
  if (amount !== Number(order.amount_fcfa) || currency !== "XAF") {
    throw new Error("Montant ou devise CinetPay incorrect");
  }

  const result = await env.DB.prepare(`
    UPDATE orders
    SET status='paid', payment_method=?, paid_at=CURRENT_TIMESTAMP
    WHERE id=? AND status='pending'
  `).bind(String(data.payment_method || "CINETPAY"), Number(order.id)).run();

  if (result.meta.changes === 1) {
    await env.DB.prepare("UPDATE users SET wallet_fcfa = wallet_fcfa + ? WHERE id=?")
      .bind(Number(order.seller_amount_fcfa), Number(order.seller_id)).run();
    const admin = await env.DB.prepare("SELECT id FROM users WHERE role='admin' ORDER BY id ASC LIMIT 1").first();
    if (admin) {
      await env.DB.prepare("UPDATE users SET wallet_fcfa = wallet_fcfa + ? WHERE id=?")
        .bind(Number(order.commission_fcfa), Number(admin.id)).run();
    }
  }
  return { paid: true, status: "ACCEPTED" };
};

async function api(request, env) {
  const url = new URL(request.url);
  const commissionRate = Number(env.COMMISSION_RATE || "0.10");
  const origin = url.origin;

  if (url.pathname === "/api/health") return json({ ok: true, service: "AfriMedia API", version: "3.1.0" });

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

  if (url.pathname === "/api/orders" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const serviceId = Number(body.service_id);
    const buyerId = Number(body.buyer_id);
    if (!Number.isInteger(serviceId) || !Number.isInteger(buyerId)) {
      return json({ error: "service_id et buyer_id sont requis" }, 400);
    }
    if (!env.CINETPAY_API_KEY || !env.CINETPAY_SITE_ID) {
      return json({ error: "Le paiement CinetPay n'est pas encore configuré sur AfriMedia" }, 503);
    }

    const service = await env.DB.prepare(`
      SELECT s.*, u.name AS seller_name
      FROM services s JOIN users u ON u.id=s.seller_id
      WHERE s.id=? AND s.active=1
    `).bind(serviceId).first();
    const buyer = await env.DB.prepare("SELECT id,name,email FROM users WHERE id=?").bind(buyerId).first();
    if (!service) return json({ error: "Service introuvable" }, 404);
    if (!buyer) return json({ error: "Client introuvable" }, 404);
    if (Number(service.price_fcfa) < 100 || Number(service.price_fcfa) > 1500000 || Number(service.price_fcfa) % 5 !== 0) {
      return json({ error: "Le prix du service doit être entre 100 et 1 500 000 FCFA et multiple de 5" }, 400);
    }

    const amount = Number(service.price_fcfa);
    const commission = Math.round(amount * commissionRate);
    const sellerAmount = amount - commission;
    const transactionId = `AFM-${Date.now()}-${serviceId}-${buyerId}`;

    const inserted = await env.DB.prepare(`
      INSERT INTO orders(service_id,buyer_id,seller_id,amount_fcfa,commission_fcfa,seller_amount_fcfa,status,payment_transaction_id)
      VALUES(?,?,?,?,?,?, 'pending', ?)
    `).bind(serviceId, buyerId, Number(service.seller_id), amount, commission, sellerAmount, transactionId).run();
    const orderId = Number(inserted.meta.last_row_id);

    try {
      const payment = await cinetpayRequest("", env, {
        transaction_id: transactionId,
        amount,
        currency: "XAF",
        description: `AfriMedia service ${orderId}`,
        customer_id: String(buyer.id),
        customer_name: String(buyer.name).slice(0, 100),
        customer_email: String(buyer.email).slice(0, 100),
        customer_country: "CM",
        notify_url: `${origin}/api/payments/cinetpay/notify`,
        return_url: `${origin}/api/payments/cinetpay/return?order_id=${orderId}`,
        channels: "MOBILE_MONEY",
        lang: "fr",
        metadata: String(orderId)
      });

      const paymentUrl = payment?.data?.payment_url;
      if (!paymentUrl) {
        await env.DB.prepare("UPDATE orders SET status='cancelled' WHERE id=? AND status='pending'").bind(orderId).run();
        return json({ error: "CinetPay n'a pas fourni de lien de paiement", cinetpay: payment }, 502);
      }

      await env.DB.prepare("UPDATE orders SET payment_url=? WHERE id=?").bind(paymentUrl, orderId).run();
      return json({
        ok: true,
        order_id: orderId,
        transaction_id: transactionId,
        amount_fcfa: amount,
        commission_fcfa: commission,
        seller_amount_fcfa: sellerAmount,
        payment_url: paymentUrl
      }, 201);
    } catch (error) {
      await env.DB.prepare("UPDATE orders SET status='cancelled' WHERE id=? AND status='pending'").bind(orderId).run();
      console.error(error);
      return json({ error: "Impossible d'initialiser le paiement CinetPay" }, 502);
    }
  }

  if (url.pathname.startsWith("/api/orders/") && request.method === "GET") {
    const orderId = Number(url.pathname.split("/").pop());
    if (!Number.isInteger(orderId)) return json({ error: "Commande invalide" }, 400);
    const order = await env.DB.prepare(`
      SELECT o.*, s.title AS service_title, u.name AS buyer_name
      FROM orders o JOIN services s ON s.id=o.service_id JOIN users u ON u.id=o.buyer_id
      WHERE o.id=?
    `).bind(orderId).first();
    if (!order) return json({ error: "Commande introuvable" }, 404);
    return json(order);
  }

  if (url.pathname === "/api/payments/cinetpay/notify" && request.method === "POST") {
    let transactionId = "";
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = await request.json().catch(() => ({}));
      transactionId = String(body.cpm_trans_id || body.transaction_id || "");
    } else {
      const body = await request.formData().catch(() => new FormData());
      transactionId = String(body.get("cpm_trans_id") || body.get("transaction_id") || "");
    }
    if (!transactionId) return json({ error: "transaction_id manquant" }, 400);

    const order = await env.DB.prepare("SELECT * FROM orders WHERE payment_transaction_id=?").bind(transactionId).first();
    if (!order) return json({ error: "Commande introuvable" }, 404);
    if (order.status === "paid") return json({ ok: true, status: "already_paid" });

    const verification = await verifyCinetPay(env, transactionId);
    const result = await markOrderPaid(env, order, verification);
    return json({ ok: true, ...result });
  }

  if (url.pathname === "/api/payments/cinetpay/return" && request.method === "GET") {
    const orderId = Number(url.searchParams.get("order_id"));
    const target = new URL("/", origin);
    if (Number.isInteger(orderId)) {
      target.searchParams.set("payment", "return");
      target.searchParams.set("order_id", String(orderId));
    }
    return Response.redirect(target.toString(), 303);
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
    if (Number(price_fcfa) % 5 !== 0 || Number(price_fcfa) < 100 || Number(price_fcfa) > 1500000)
      return json({ error: "Le prix doit être entre 100 et 1 500 000 FCFA et multiple de 5" }, 400);
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
