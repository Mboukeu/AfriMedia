async function api(url, opts = {}) {
  const r = await fetch(url, opts);
  return r.json();
}
function esc(value) { return String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[c])); }
async function load() {
  const services = await api("/api/services");
  const list = document.getElementById("serviceList");
  list.innerHTML = services.length ? services.map(s => `<article class="card"><small>Par ${esc(s.seller_name)}</small><h3>${esc(s.title)}</h3><p>${esc(s.description || "Service professionnel sur AfriMedia.")}</p><div class="price">${Number(s.price_fcfa).toLocaleString("fr-FR")} FCFA</div><button onclick="alert('Le paiement réel sera activé après configuration du prestataire de paiement.')">Commander</button></article>`).join("") : `<div class="card"><h3>Aucun service pour le moment</h3><p>Les premiers services apparaîtront ici.</p></div>`;
}
load();
function openSignup(){document.getElementById("modal").style.display="grid"}
function closeModal(){document.getElementById("modal").style.display="none"}
async function signup(){
  const body={name:document.getElementById("name").value.trim(),email:document.getElementById("email").value.trim()};
  const r=await api("/api/users",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  document.getElementById("msg").textContent=r.error||"Compte créé avec succès.";
  if(!r.error) load();
}