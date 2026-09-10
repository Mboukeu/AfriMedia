const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;
const commissionRate = Number(process.env.COMMISSION_RATE || 0.10);
const db = new Database("afrimedia.db");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT UNIQUE NOT NULL,
 role TEXT NOT NULL DEFAULT 'client',
 wallet_fcfa INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS services (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 seller_id INTEGER NOT NULL,
 title TEXT NOT NULL,
 description TEXT,
 price_fcfa INTEGER NOT NULL,
 active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 service_id INTEGER NOT NULL,
 buyer_id INTEGER NOT NULL,
 seller_id INTEGER NOT NULL,
 amount_fcfa INTEGER NOT NULL,
 commission_fcfa INTEGER NOT NULL,
 seller_amount_fcfa INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req,res)=>res.json({ok:true, service:"AfriMedia API"}));

app.get("/api/services", (req,res)=>{
  const rows = db.prepare(`
    SELECT s.*, u.name AS seller_name
    FROM services s JOIN users u ON u.id=s.seller_id
    WHERE s.active=1 ORDER BY s.id DESC
  `).all();
  res.json(rows);
});

app.post("/api/users", (req,res)=>{
  const {name,email,role="client"} = req.body;
  if(!name || !email) return res.status(400).json({error:"Nom et e-mail requis"});
  try {
    const info = db.prepare("INSERT INTO users(name,email,role) VALUES(?,?,?)").run(name,email,role);
    res.status(201).json({id:info.lastInsertRowid,name,email,role});
  } catch(e) {
    res.status(409).json({error:"Cet e-mail existe déjà"});
  }
});

app.post("/api/services", (req,res)=>{
  const {seller_id,title,description="",price_fcfa} = req.body;
  if(!seller_id || !title || !Number.isInteger(price_fcfa) || price_fcfa<=0)
    return res.status(400).json({error:"Données de service invalides"});
  const seller = db.prepare("SELECT id FROM users WHERE id=? AND role IN ('creator','admin')").get(seller_id);
  if(!seller) return res.status(403).json({error:"Le vendeur doit être un créateur"});
  const info = db.prepare("INSERT INTO services(seller_id,title,description,price_fcfa) VALUES(?,?,?,?)")
    .run(seller_id,title,description,price_fcfa);
  res.status(201).json({id:info.lastInsertRowid});
});

app.post("/api/orders", (req,res)=>{
  const {service_id,buyer_id} = req.body;
  const service = db.prepare("SELECT * FROM services WHERE id=? AND active=1").get(service_id);
  if(!service) return res.status(404).json({error:"Service introuvable"});
  const buyer = db.prepare("SELECT * FROM users WHERE id=?").get(buyer_id);
  if(!buyer) return res.status(404).json({error:"Acheteur introuvable"});
  const commission = Math.round(service.price_fcfa * commissionRate);
  const sellerAmount = service.price_fcfa - commission;
  const info = db.prepare(`
    INSERT INTO orders(service_id,buyer_id,seller_id,amount_fcfa,commission_fcfa,seller_amount_fcfa)
    VALUES(?,?,?,?,?,?)
  `).run(service_id,buyer_id,service.seller_id,service.price_fcfa,commission,sellerAmount);
  res.status(201).json({
    order_id: info.lastInsertRowid,
    status:"pending_payment",
    amount_fcfa:service.price_fcfa,
    commission_fcfa:commission,
    seller_amount_fcfa:sellerAmount,
    message:"Commande créée. Branchez le prestataire de paiement pour confirmer le paiement."
  });
});

app.get("/api/admin/stats", (req,res)=>{
  const users = db.prepare("SELECT COUNT(*) c FROM users").get().c;
  const services = db.prepare("SELECT COUNT(*) c FROM services WHERE active=1").get().c;
  const sales = db.prepare("SELECT COALESCE(SUM(amount_fcfa),0) total FROM orders WHERE status='paid'").get().total;
  const commissions = db.prepare("SELECT COALESCE(SUM(commission_fcfa),0) total FROM orders WHERE status='paid'").get().total;
  res.json({users,services,sales_fcfa:sales,commissions_fcfa:commissions,commission_rate:commissionRate});
});

app.post("/api/payments/webhook", (req,res)=>{
  const {order_id,status} = req.body;
  if(status !== "paid") return res.json({received:true});
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(order_id);
  if(!order) return res.status(404).json({error:"Commande inconnue"});
  const tx = db.transaction(()=>{
    db.prepare("UPDATE orders SET status='paid' WHERE id=? AND status!='paid'").run(order_id);
    db.prepare("UPDATE users SET wallet_fcfa=wallet_fcfa+? WHERE id=?").run(order.seller_amount_fcfa,order.seller_id);
  });
  tx();
  res.json({received:true,status:"paid"});
});

app.use((req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

app.listen(port,"0.0.0.0",()=>console.log(`AfriMedia démarré sur le port ${port}`));
