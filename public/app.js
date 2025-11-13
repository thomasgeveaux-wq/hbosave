/* HEBOv2 — app.js (PWA, Vercel-ready)
   - Planning “tableau orange” (jours × [Midi,Dîner]) × profils (lignes)
   - Max 3 repas/personne/recette
   - Cibles G/V/L par recette depuis besoins/repas
   - Prompt “VENÈRE++” JSON strict
   - LocalStorage pour tout (API key, profils, matériel, placard, planning)
*/

/* ---------- Etat & persistance ---------- */
const LS_KEY = "hebo_state_v2";
const defaultState = {
  apiKey: "",
  model: "gpt-4.1-mini",
  maxTokens: 12000,
  profiles: [
    { id: cryptoRandom(), name: "Thomas", needs: { G: 100, P: 200, V: 150 }, active: true },
    { id: cryptoRandom(), name: "Anaïs",  needs: { G:  50, P: 100, V: 250 }, active: true },
  ],
  matos: "poêle, casserole, four, blender, wok",
  envies: "",
  autres: "interdits: ; allergies: ; éviter: ; cuisines: ",
  placard: "",
  planning: {}, // key = `${day}|${meal}|${profileId}` => true/false
  history: [],// [{id, ts, title, recipes:[{title,sig}], plan}]
  historyRecipes: []


};

let state = loadState();
saveState();

/* ---------- Helpers ---------- */
function cryptoRandom(){ return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function loadState(){
  try { return { ...defaultState, ...(JSON.parse(localStorage.getItem(LS_KEY)||"{}")) }; }
  catch{ return structuredClone(defaultState); }
}
function saveState(){ localStorage.setItem(LS_KEY, JSON.stringify(state)); }
function qs(s, root=document){ return root.querySelector(s); }
function qsa(s, root=document){ return Array.from(root.querySelectorAll(s)); }
function hashString(s){
  let h=2166136261>>>0;
  for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h = Math.imul(h,16777619); }
  return (h>>>0).toString(36);
}
function recipeSignature(r){
  const title = (r.title||"").toLowerCase().trim();
  const mainIng = (r.ingredients||[])
    .map(it => (it.name||"")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g,"")
      .replace(/œ/g,"oe")
      .replace(/æ/g,"ae")
      .trim()
    )
    .slice(0,8)
    .sort()
    .join("|");
  const fam = (r.cuisine_family||"").toLowerCase().trim();
  return hashString(`${title}#${fam}#${mainIng}`);
}
function lastSignatures(limit=20){
  const sigs = new Set();
  // anciens packs (compat)
  (state.history||[]).slice(-limit).forEach(h=>{
    (h.recipes||[]).forEach(x=>x?.sig && sigs.add(x.sig));
  });
  // recettes à plat (plus riche)
  (state.historyRecipes||[]).slice(-limit*3).forEach(r=>{
    if(r?.sig) sigs.add(r.sig);
  });
  return sigs;
}
function addHistoryEntry(plan){
  const id = cryptoRandom();
  const ts = Date.now();
  const recipes = (plan.recipes||[]).map(r=>({ title: r.title||"(sans titre)", sig: recipeSignature(r) }));
  const title = new Date(ts).toLocaleString();
  state.history.push({ id, ts, title, recipes, plan });
  if(state.history.length>50) state.history = state.history.slice(-50);
  saveState();
  renderHistory();

   (plan.recipes || []).forEach(r => {
  state.historyRecipes.push({
    id: cryptoRandom(),
    ts,
    title: r.title || "(sans titre)",
    sig: recipeSignature(r),
    recipe: structuredClone(r)
  });
});
// borne + sauvegarde + refresh liste
if (state.historyRecipes.length > 200) {
  state.historyRecipes = state.historyRecipes.slice(-200);
}
saveState();
renderSavedRecipes();
}
function deleteHistoryEntry(id){
  state.history = (state.history||[]).filter(h=>h.id!==id);
  saveState();
  renderHistory();
}
function renderSavedRecipes(){
  const wrap = qs("#savedRecipes");
  const hist = [...(state.historyRecipes||[])].reverse();

  if (!hist.length){
    wrap.innerHTML = "<i>Aucune recette sauvegardée encore.</i>";
    return;
  }

 wrap.innerHTML = hist.map(r=>`
    <div class="history-item">
      <div><b>${r.title || "(sans titre)"}</b> <span class="muted">${r.recipe?.cuisine_family ? "("+r.recipe.cuisine_family+")" : ""}</span></div>
      <div class="row" style="gap:6px;margin-top:6px;">
        <button class="btn" data-loadrecipe="${r.id}">Ouvrir</button>
      </div>
    </div>
    <hr/>
  `).join("");
}

qs("#savedRecipes")?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-loadrecipe]");
  if (!btn) return;
  const id = btn.getAttribute("data-loadrecipe");
  const item = (state.historyRecipes||[]).find(x => x.id === id);
  if (!item) return;
  openRecipeFromSaved(item);
});

/* ---------- DOM refs ---------- */
const planningTable = qs("#planningTable");
const generateBtn   = qs("#generateBtn");
const exportBtn     = qs("#exportBtn");
const statusEl      = qs("#status");
const resultsEl     = qs("#results");

const pName = qs("#pName");
const pG    = qs("#pG");
const pP    = qs("#pP");
const pV    = qs("#pV");
const addProfileBtn = qs("#addProfileBtn");
const profilesList  = qs("#profilesList");
profilesList?.addEventListener("click", onProfilesClick);


const matosInp   = qs("#matos");
const enviesInp  = qs("#envies");
const autresInp  = qs("#autres");
const placardInp = qs("#placard");

const apiKeyInp  = qs("#apiKey");
const modelSel   = qs("#model");
const maxTokInp  = qs("#maxTokens");
const historyList = qs("#historyList");
const clearHistoryBtn = qs("#clearHistoryBtn");


/* ---------- Tabs ---------- */
qsa(".tab").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    qsa(".tab").forEach(b=>{ b.classList.remove("active"); b.setAttribute("aria-selected","false"); });
    btn.classList.add("active"); btn.setAttribute("aria-selected","true");
    const tab = btn.dataset.tab;
    qsa(".tabpanel").forEach(p=>{
      if(p.id === `tab-${tab}`){ p.hidden=false; p.classList.add("active"); }
      else { p.hidden=true; p.classList.remove("active"); }
    });
  });
});

/* ---------- Init inputs ---------- */
apiKeyInp.value = state.apiKey;
modelSel.value  = state.model;
maxTokInp.value = state.maxTokens;

matosInp.value   = state.matos;
enviesInp.value  = state.envies;
autresInp.value  = state.autres;
placardInp.value = state.placard;

/* save on change */
[apiKeyInp, modelSel, maxTokInp].forEach(el=>{
  el.addEventListener("change", ()=>{
    state.apiKey   = apiKeyInp.value.trim();
    state.model    = modelSel.value;
    state.maxTokens= Number(maxTokInp.value||12000);
    saveState();
  });
});
[matosInp,enviesInp,autresInp,placardInp].forEach(el=>{
  el.addEventListener("input", ()=>{
    state.matos   = matosInp.value;
    state.envies  = enviesInp.value;
    state.autres  = autresInp.value;
    state.placard = placardInp.value;
    saveState();
  });
});

/* ---------- Profils CRUD (simple) ---------- */
function renderProfiles(){
  profilesList.innerHTML = "";
  state.profiles.forEach(p=>{
    const row = document.createElement("div");
    row.className = "profile-row";
    row.innerHTML = `
      <label class="switch">
        <input type="checkbox" ${p.active?"checked":""} data-act="${p.id}" />
        <span>Actif</span>
      </label>
      <div class="profile-main">
        <div class="name">${p.name}</div>
        <div class="needs">G: ${p.needs.G}g • P: ${p.needs.P}g • Lég: ${p.needs.V}g</div>
      </div>
      <div class="actions">
        <button class="btn ghost" data-edit="${p.id}">Éditer</button>
        <button class="btn danger" data-del="${p.id}">Suppr.</button>
      </div>
    `;
    profilesList.appendChild(row);
  });

 // profilesList.addEventListener("click", onProfilesClick);
}
function onProfilesClick(e){
  const idEdit = e.target.getAttribute("data-edit");
  const idDel  = e.target.getAttribute("data-del");
  const idAct  = e.target.getAttribute("data-act");
  if(idEdit){
    const p = state.profiles.find(x=>x.id===idEdit);
    if(!p) return;
    pName.value = p.name;
    pG.value = p.needs.G; pP.value = p.needs.P; pV.value = p.needs.V;
    addProfileBtn.dataset.editing = p.id;
  }
  if(idDel){
    state.profiles = state.profiles.filter(x=>x.id!==idDel);
    // purge planning clés de ce profil
    Object.keys(state.planning).forEach(k=>{
      if(k.endsWith("|"+idDel)) delete state.planning[k];
    });
    saveState(); renderProfiles(); renderPlanningTable();
  }
  if(idAct){
    const p = state.profiles.find(x=>x.id===idAct);
    if(p){ p.active = !p.active; saveState(); renderPlanningTable(); }
  }
}
addProfileBtn.addEventListener("click", (e)=>{
  e.preventDefault();
  const name = (pName.value||"").trim();
  if(!name) return;
  const needs = { G:Number(pG.value||0), P:Number(pP.value||0), V:Number(pV.value||0) };
  const editing = addProfileBtn.dataset.editing;
  if(editing){
    const p = state.profiles.find(x=>x.id===editing);
    if(p){ p.name=name; p.needs=needs; delete addProfileBtn.dataset.editing; }
  }else{
    state.profiles.push({ id: cryptoRandom(), name, needs, active:true });
  }
  pName.value=""; pG.value=100; pP.value=200; pV.value=150;
  saveState(); renderProfiles(); renderPlanningTable();
});

/* ---------- Planning “tableau orange” ---------- */
const DAYS  = ["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];
const MEALS = ["Midi","Dîner"];

function keyOf(day, meal, profileId){ return `${day}|${meal}|${profileId}`; }
function getCheck(day, meal, profileId){ return !!state.planning[keyOf(day,meal,profileId)]; }
function setCheck(day, meal, profileId, val){ state.planning[keyOf(day,meal,profileId)] = !!val; }

function renderPlanningTable(){
  // en-tête groupé par jour, sous-colonnes Midi/Dîner ; lignes = profils
  const activeProfiles = state.profiles.filter(p=>p.active);
  if(activeProfiles.length === 0){
    planningTable.innerHTML = `<tbody><tr><td><i>Active au moins 1 profil.</i></td></tr></tbody>`;
    return;
  }

  const thead1 = document.createElement("thead");
  const trTop  = document.createElement("tr");
  trTop.innerHTML = `<th class="sticky-left">Profil</th>`;
  DAYS.forEach(d=>{
    const th = document.createElement("th");
    th.colSpan = 2;
    th.textContent = d.toUpperCase();
    trTop.appendChild(th);
  });
  thead1.appendChild(trTop);

  const trSub = document.createElement("tr");
  trSub.innerHTML = `<th class="sticky-left subt">Repas</th>`;
  DAYS.forEach(_=>{
    const thM = document.createElement("th"); thM.textContent = "MIDI";
    const thD = document.createElement("th"); thD.textContent = "DÎNER";
    trSub.appendChild(thM); trSub.appendChild(thD);
  });
  thead1.appendChild(trSub);

  const tbody = document.createElement("tbody");
  activeProfiles.forEach(p=>{
    const tr = document.createElement("tr");
    const tdName = document.createElement("td");
    tdName.className="sticky-left";
    tdName.textContent = p.name;
    tr.appendChild(tdName);

    DAYS.forEach(d=>{
      MEALS.forEach(m=>{
        const td = document.createElement("td");
        td.className="cell-center";
        const id = keyOf(d,m,p.id);
        const cb = document.createElement("input");
        cb.type="checkbox";
        cb.checked = getCheck(d,m,p.id);
        cb.setAttribute("aria-label", `${p.name} — ${d} ${m}`);
        cb.addEventListener("change", ()=>{
          setCheck(d,m,p.id, cb.checked);
          saveState(); // maj totaux
          updateTotals(); // refresh subtotals row (optionnel plus tard)
        });
        td.appendChild(cb);
        tr.appendChild(td);
      });
    });

    tbody.appendChild(tr);
  });

  planningTable.innerHTML = "";
  planningTable.appendChild(thead1);
  planningTable.appendChild(tbody);
}

function updateTotals(){
  // retourne { name: totalMeals }
  const res = {};
  state.profiles.forEach(p=>{
    if(!p.active) return;
    let c=0;
    DAYS.forEach(d=>MEALS.forEach(m=>{
      if(getCheck(d,m,p.id)) c++;
    }));
    res[p.name]=c;
  });
  return res;
}

/* ---------- Ciblage recettes (max 3 repas / personne / recette) ---------- */
function computeTargetsFromPlan(){
  const counts = updateTotals(); // par nom
  const active = state.profiles.filter(p=>p.active);
  // 1) Buckets par personne (paquets de 3 max)
  const buckets = {};
  active.forEach(p=>{
    let remaining = counts[p.name] || 0;
    const arr=[];
    while(remaining>0){ const take=Math.min(3,remaining); arr.push(take); remaining-=take; }
    buckets[p.id]=arr; // vecteur par index
  });
  // 2) nb recettes = max longueur des vecteurs
  const nb = Math.max(0,...active.map(p=>buckets[p.id].length||0));
  // 3) construire recettes
  const recipes = [];
  for(let i=0;i<nb;i++){
    const portions={};
    active.forEach(p=>{
      portions[p.name] = buckets[p.id][i] || 0;
    });
    recipes.push({ portions });
  }
  // 4) cibles
  recipes.forEach(r=>{
    let G=0,P=0,V=0;
    active.forEach(p=>{
      const nb = r.portions[p.name]||0;
      G += (p.needs.G||0)*nb;
      P += (p.needs.P||0)*nb;
      V += (p.needs.V||0)*nb;
    });
    r.targets = {
      glucides_g_cru: G,
      viandes_poissons_g_cru: P,
      legumes_g_cru: V
    };
  });
  return recipes;
}
function parseAutres(){
  const t = (state.autres||"").toLowerCase();
  const pick=(label)=>{ const m=t.match(new RegExp(label+'\\s*:\\s*([^;\\n]+)')); return m?m[1].split(',').map(s=>s.trim()).filter(Boolean):[]; };
  return {
    banned: pick("interdits"),
    allergens: pick("allergies"),
    avoid: pick("eviter|éviter")
  };
}

function recipeHasVisibleCarb(rec){
  const names = (rec.ingredients||[]).map(i=>_normTxt(i.name||""));
  const carbs = ["riz","pates","pâtes","quinoa","boulgour","semoule","nouilles","spaghetti","penne","pommes de terre","pomme de terre","patate douce","tortilla","pain","lentil","lentille","haricots rouges","pois chiche","orzo","basmati","riz complet","riz blanc"];
  return names.some(n => carbs.some(c => n.includes(_normTxt(c))));
}

function validatePlanClient(plan){
  const issues = [];
  const { banned, avoid, allergens } = parseAutres();
  const seenSet = lastSignatures(20); // <= ici

  (plan.recipes||[]).forEach((r,idx)=>{
    // Anti-répétition locale
    const sig = recipeSignature(r);
    if (seenSet.has(sig)) {
      issues.push(`R${idx+1}: ressemble à une recette déjà proposée récemment (varier davantage)`);
    }

    // Équipement interdit mentionné
    const allText = [r.title||"", ...(r.equipment||[]), ...(r.steps||[]), ...(r.sauce_steps||[])].join(" ").toLowerCase();
    (banned||[]).forEach(b=>{
      if(b && allText.includes(b.toLowerCase())) issues.push(`R${idx+1}: outil interdit "${b}" détecté`);
    });

    // Glucide visible si G élevé
    const G = Number(r?.macros_targets?.glucides_g_cru || r?.targets?.glucides_g_cru || 0);
    if(G>200 && !recipeHasVisibleCarb(r)) issues.push(`R${idx+1}: cible G=${G} sans source de glucides visible`);

    // Protéine si cible P > 0
    const P = Number(r?.macros_targets?.viandes_poissons_g_cru || r?.targets?.viandes_poissons_g_cru || 0);
    if(P>0 && !pickMainByType(r.ingredients,'prot')) issues.push(`R${idx+1}: cible P=${P} sans source protéique claire`);

    // Ingrédients à éviter / allergènes
    const names = (r.ingredients||[]).map(it=>String(it.name||"").toLowerCase());
    [...(avoid||[]), ...(allergens||[])].forEach(bad=>{
      if (bad && names.some(n=>n.includes(bad.toLowerCase()))) issues.push(`R${idx+1}: contient "${bad}" (éviter/allergène)`);
    });
  });

  return issues;
}


/* ---------- Prompt “VENÈRE ++” ---------- */
function buildPrompt(inputTSV, chunkTargets){
  const allowed = (state.matos||"").split(",").map(s=>s.trim()).filter(Boolean);
  // “autres” parsé façon script
  const t = (state.autres||"").toLowerCase();
  const pick=(label)=>{ const m=t.match(new RegExp(label+'\\s*:\\s*([^;\\n]+)')); return m?m[1].split(',').map(s=>s.trim()).filter(Boolean):[]; };
  const banned    = pick('interdits');
  const allergens = pick('allergies');
  const avoid     = pick('eviter|éviter');
  const cuisines  = pick('cuisines?');

  const portionsLines = chunkTargets.map((rt,i)=>`R${i+1}: ` + Object.entries(rt.portions).map(([n,v])=>`${n}=${v}`).join(', ')).join('\n');
  const targetsLines  = chunkTargets.map((rt,i)=>`R${i+1}: G=${rt.targets.glucides_g_cru}, V=${rt.targets.viandes_poissons_g_cru}, L=${rt.targets.legumes_g_cru}`).join('\n');
const seen = Array.from(lastSignatures(20)); // 20 dernières signatures

  const system = `
Tu es un assistant de batch cooking SPORTIF pour plusieurs profils (ex: Thomas, Anaïs).
RÈGLES:
- Sortie STRICTEMENT JSON, pas de texte autour.
- Respecte EXACTEMENT les PORTIONS par recette (par personne).
- Atteins les cibles G/V/L avec une source de glucides VISIBLE si G>200g (riz/pâtes/quinoa/boulgour/semoule/pdt/patate douce/…).
- Cuisine orientée sport: protéines maigres, légumes abondants, G complexes, peu d'AG ajoutés.
- Limite huile: ~15 ml (2 portions), 20 ml (3), 30 ml (4) répartis plat/sauce.
- Matériel interdit → proposer alternative compatible.
- Évite ingrédients/allergènes interdits.
- Diversifie les cuisines (Italienne, Française, Japonaise, Chinoise, Thaïlandaise, Indienne, Mexicaine, Grecque, Espagnole, Coréenne, Vietnamienne, Américaine, Péruvienne, Caribéenne, Portugaise, Brésilienne, Moyen-Orientale, Fusion moderne, Méditerranéenne, Coréenne moderne, Street food asiatique, Cuisine végétarienne, Cuisine gastronomique contemporaine.).
- Étapes ≤ 12, avec temps/feu/textures.
- Utilise le Placard si pertinent.
- Si la cible viandes/poissons (P) > 0, la recette DOIT inclure un ingrédient protéique principal explicite (boeuf, viande hachée 5%, poulet, dinde, porc, thon, saumon, etc.).
- PROTEINES : respecter strictement les quantités de viande/poisson/tofu associées aux cibles V (viandes_poissons_g_cru).
  - Si V > 0 : il doit y avoir une vraie source protéique (poulet, boeuf, dinde, poisson, tofu, oeufs).
  - 1 portion = ~150–220g viande/poisson OU 250g tofu OU 3–4 oeufs max.
  - Pas de recettes "semi-végés" par erreur : si V > 0, pas de plat à base uniquement d'œufs ou fromage.
  - Pas de réduction “optimisation cuisine” : tu dois coller aux cibles en grammes.
- BATCH COOKING STRICT : limiter le nombre total d'ingrédients.
  - Viser 15–18 ingrédients max pour toutes les recettes combinées.
  - Réutiliser au maximum les mêmes ingrédients sur toutes les recettes.
  - Si un ingrédient apparaît dans une recette, il doit idéalement réapparaître dans 1–2 autres.
- Variété obligatoire : ne jamais répéter exactement la même recette d'une génération précédente.
- Si un plat a déjà été proposé, proposer une variante (épices, céréales, cuisson, sauce).
- Introduire 1–2 recettes "créatives" par batch.
- Anti-répétition: ne propose pas une recette dont la signature est dans SEEN_SIGS. Si un plat est proche, produire une vraie VARIANTE (épices, céréale, sauce, cuisson) et changer le titre.




  `.trim();

  const user = `
PLANNING (TSV):
${inputTSV}

PORTIONS (STRICT):
${portionsLines}

CIBLES (g cru):
${targetsLines}

Matériel autorisé: ${allowed.join(', ') || '(libre)'}
Interdits (STRICT): ${banned.join(', ') || '(aucun)'}
Cuisines (soft): ${cuisines.join(', ') || '(libre)'}
Éviter (STRICT): ${avoid.join(', ') || '(rien)'}
Allergies (STRICT): ${allergens.join(', ') || '(aucune)'}
Envies: ${state.envies||'(aucune)'}
Placard (prioritaire): ${state.placard||'(vide)'}
Historique (SEEN_SIGS): ${JSON.stringify(seen)}


🧮 kcal PAR PERSONNE:
- Ajoute "kcal_per_person": { "Nom": number, ... } (indicatif). L'app recalcule IRL.
  
FORMAT JSON EXACT:
{
  "recipes":[
    {
      "title":"string",
      "cuisine_family":"méditerranée | asiatique | bistrot | tex-mex | ...",
      "duration_min":30,
      "portions":{"Thomas":2,"Anaïs":1},
      "macros_targets":{"glucides_g_cru":400,"viandes_poissons_g_cru":800,"legumes_g_cru":950},
      "validate_protein_strict": true,
      "kcal_per_person":{"Thomas":650,"Anaïs":520},
      "equipment":["poêle","casserole"],
      "ingredients":[{"name":"Riz basmati","qty":400,"unit":"g"}],
      "steps":["..."],
      "sauce_steps":["..."],
      "benefits_sport":"1–2 phrases"
    }
  ]
}
  `.trim();

  return { system, user };
}

/* ---------- OpenAI call (Responses API) ---------- */
async function callOpenAIForPlan(chunkTargets){
  const inputTSV = buildTSVFromPlanning(); // simple dump planning
  const { system, user } = buildPrompt(inputTSV, chunkTargets);

  const body = {
    model: state.model,
    input: [
      { role:"system", content: system },
      { role:"user",   content: user }
    ],
    temperature: 0.5,
    max_output_tokens: state.maxTokens,
    text: { format: { type:"json_object" } }
  };

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${state.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const code = res.status;
  const txt = await res.text();
  if(code !== 200) throw new Error(`Erreur API ${code}: ${txt.slice(0,400)}`);

  // parse “output_text” JSON
  const top = JSON.parse(txt);
  let s0 = "";
  if(typeof top.output_text === "string") s0 = top.output_text;
  else if(Array.isArray(top.output)){
    s0 = top.output.flatMap(o=>o.content||[]).map(p=>p.text||"").filter(Boolean).join("\n");
  }
  s0 = s0.trim().replace(/^```json\s*/,"").replace(/\s*```$/,"");
  const plan = JSON.parse(s0);
  return plan;
}

function buildTSVFromPlanning(){
  // minimal: une ligne par checkbox cochée
  const rows = [];
  state.profiles.filter(p=>p.active).forEach(p=>{
    DAYS.forEach(d=>MEALS.forEach(m=>{
      if(getCheck(d,m,p.id)) rows.push([d,m,p.name].join("\t"));
    }));
  });
  return rows.join("\n") || "(vide)";
}
/* ================== Nutrition IRL (par personne) ================== */
// DB (kcal/macros pour 100 g/ml)
const NUTRI_DB = [
  // Carbs
  {k:'riz', kcal:350, c:78, p:7, f:1, type:'carb'},
  {k:'quinoa', kcal:368, c:64, p:14, f:6, type:'carb'},
  {k:'pâtes', kcal:350, c:70, p:12, f:2, type:'carb'},
  {k:'boulgour', kcal:342, c:76, p:12, f:1, type:'carb'},
  {k:'semoule', kcal:360, c:73, p:12, f:1, type:'carb'},
  {k:'pommes de terre', kcal:77, c:17, p:2, f:0.1, type:'carb'},
  {k:'patate douce', kcal:86, c:20, p:1.6, f:0.1, type:'carb'},
  {k:'pain', kcal:265, c:49, p:9, f:3.2, type:'carb'},
  {k:'lentil', kcal:353, c:63, p:25, f:1.1, type:'carb'}, // lentilles (sec)
  {k:'pois chiche', kcal:364, c:61, p:19, f:6, type:'carb'},
  {k:'haricots rouges', kcal:333, c:60, p:24, f:1.2, type:'carb'},

  // Proteins
  {k:'poulet', kcal:120, c:0, p:23, f:1.5, type:'prot'},
  {k:'dinde', kcal:135, c:0, p:29, f:1, type:'prot'},
  {k:'boeuf', kcal:158, c:0, p:21, f:8, type:'prot'},
  {k:'porc', kcal:180, c:0, p:20, f:11, type:'prot'},
  {k:'saumon', kcal:208, c:0, p:20, f:13, type:'prot'},
  {k:'thon', kcal:144, c:0, p:23, f:5, type:'prot'},
  {k:'tofu', kcal:76, c:1.9, p:8, f:4.8, type:'prot'},
  {k:'oeuf', kcal:155, c:1.1, p:13, f:11, type:'prot'},

  // Veg (moyennes)
  {k:'brocoli', kcal:34, c:7, p:2.8, f:0.4, type:'veg'},
  {k:'courgette', kcal:17, c:3.1, p:1.2, f:0.3, type:'veg'},
  {k:'poivron', kcal:31, c:6, p:1, f:0.3, type:'veg'},
  {k:'tomate', kcal:18, c:3.9, p:0.9, f:0.2, type:'veg'},
  {k:'épinard', kcal:23, c:3.6, p:2.9, f:0.4, type:'veg'},
  {k:'oignon', kcal:40, c:9, p:1.1, f:0.1, type:'veg'},
  {k:'carotte', kcal:41, c:10, p:0.9, f:0.2, type:'veg'},

  // Fats / sauces
  {k:'huile', kcal:900, c:0, p:0, f:100, type:'fat', mlToG:0.92},
  {k:'beurre', kcal:717, c:0.5, p:0.9, f:81, type:'fat'},
  {k:'lait de coco', kcal:230, c:3, p:2, f:24, type:'fat'},
  {k:'soja', kcal:60, c:5, p:6, f:0, type:'sauce'}
];

const VEG_FALLBACK = {kcal:30, c:5, p:2, f:0.2};

const _normTxt = s => (s||"")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"")   // accents
  .replace(/œ/g,"oe").replace(/Œ/g,"Oe")
  .replace(/æ/g,"ae").replace(/Æ/g,"Ae")
  .toLowerCase()
  .trim();


function findNutriEntry(name){
  const n=_normTxt(name);
  for(const e of NUTRI_DB){ if(n.includes(e.k)) return e; }
  if(n.includes('tomates concassees')||n.includes('coulis')) return {kcal:30,c:5,p:2,f:0.2,type:'veg'};
  return null;
}
function toGrams(qty, unit, name){
  const u=_normTxt(unit);
  if(u==='g' || !u) return Number(qty)||0;
  if(u==='ml'){
    const e=findNutriEntry(name);
    const factor=(e && e.mlToG) ? e.mlToG : 1.0;
    return (Number(qty)||0)*factor;
  }
  return 0; // unités “pièce” ignorées pour le calcul précis
}
function sumOilSauces(ingredients){
  let kcal=0, c=0, p=0, f=0;
  (ingredients||[]).forEach(it=>{
    const e=findNutriEntry(it.name||''); if(!e) return;
    if(e.type==='fat' || e.type==='sauce'){
      const g=toGrams(it.qty,it.unit,it.name);
      kcal += g*(e.kcal/100); c += g*(e.c/100); p += g*(e.p/100); f += g*(e.f/100);
    }
  });
  return {kcal,c,p,f};
}
function pickMainByType(ingredients, type){
  let bestE=null, bestG=0;
  (ingredients||[]).forEach(it=>{
    const e=findNutriEntry(it.name||''); if(!e || e.type!==type) return;
    const g=toGrams(it.qty,it.unit,it.name);
    if(g>bestG){ bestG=g; bestE=e; }
  });
  return bestE;
}

// --- Normalisation simple pour la liste de courses
function normalizeUnitForList(name, unit){
  const n = _normTxt(name), u = _normTxt(unit||"");
  const LIQ = ["huile","eau","lait","creme","crème","sauce","soja","vinaigre","jus","bouillon","coulis","lait de coco","tomates concassees","tomate concassee","coco","coconut"];
  if (u === "ml") return "ml";
  if (u === "g")  return "g";
  if (!u || u==="unite" || u==="unité" || ["piece","pièce","pieces","pièces","gousse","tranche","pincee","pincée","pincees","pincées","citron","oignon","tomate","oeuf","oeufs","ail"].includes(u)){
    // liquides -> ml / macros solides -> g / sinon "Unité"
    if (LIQ.some(k => n.includes(k))) return "ml";
    const e = findNutriEntry(name);
    if (e && (e.type==="carb" || e.type==="prot" || e.type==="veg")) return "g";
    return "Unité";
  }
  return "g";
}

function aggregateShoppingList(plan){
  const agg = {}; // "nom|unit" -> total
  (plan.recipes||[]).forEach(r=>{
    (r.ingredients||[]).forEach(it=>{
      const unit = normalizeUnitForList(it.name, it.unit);
      const key = `${(it.name||"").trim().toLowerCase()}|${unit}`;
      agg[key] = (agg[key]||0) + Number(it.qty||0);
    });
  });
  return Object.entries(agg).map(([k,q])=>{
    const [n,u] = k.split("|");
    const name = n.charAt(0).toUpperCase() + n.slice(1);
    const qty  = Math.round(q*10)/10;
    return { name, qty, unit: u };
  }).sort((a,b)=>a.name.localeCompare(b.name));
}

function renderShoppingList(plan){
  const rows = aggregateShoppingList(plan);
  const wrap = document.createElement("section");
  wrap.className = "card";
  wrap.innerHTML = `
    <div class="card-title">🛒 Liste de courses (agrégée)</div>
    <div class="card-body">
      ${rows.length?`
      <table class="ing">
        <thead><tr><th>Ingrédient</th><th>Qté totale</th><th>Unité</th></tr></thead>
        <tbody>
          ${rows.map(r=>`<tr><td>${r.name}</td><td>${r.qty}</td><td>${r.unit||""}</td></tr>`).join("")}
        </tbody>
      </table>` : `<i>Aucun ingrédient détecté.</i>`}
    </div>
  `;
  return wrap;
}


/** kcal/macros IRL *par personne* selon besoins/portion définis dans Profils */
function computePerPersonNutrition(recipe, profiles){
  const carbE = pickMainByType(recipe.ingredients,'carb');
  const protE = pickMainByType(recipe.ingredients,'prot');
  const vegE  = pickMainByType(recipe.ingredients,'veg') || VEG_FALLBACK;
  const oils  = sumOilSauces(recipe.ingredients);

  const out = {};
  profiles.forEach(p=>{
    const nb = Number(recipe.portions?.[p.name]||0);
    if(nb<=0){ out[p.name]={kcal:0,P:0,G:0,L:0}; return; }

    const gramsG = (p.needs.G||0) * nb;
    const gramsP = (p.needs.P||0) * nb;
    const gramsV = (p.needs.V||0) * nb;

    const C = carbE ? {
      kcal: gramsG*(carbE.kcal/100), c: gramsG*(carbE.c/100), p: gramsG*(carbE.p/100), f: gramsG*(carbE.f/100)
    } : {kcal:0,c:0,p:0,f:0};
    const P = protE ? {
      kcal: gramsP*(protE.kcal/100), c: gramsP*(protE.c/100), p: gramsP*(protE.p/100), f: gramsP*(protE.f/100)
    } : {kcal:0,c:0,p:0,f:0};
    const V = {
      kcal: gramsV*((vegE.kcal||VEG_FALLBACK.kcal)/100),
      c:    gramsV*((vegE.c||VEG_FALLBACK.c)/100),
      p:    gramsV*((vegE.p||VEG_FALLBACK.p)/100),
      f:    gramsV*((vegE.f||VEG_FALLBACK.f)/100)
    };

    // répartition simple de l'huile/sauce (pondérée par le poids de la personne sur la recette)
    const totalParts = Object.values(recipe.portions||{}).reduce((s,v)=>s+Number(v||0),0) || 1;
    const selfWeight = gramsG+gramsP+gramsV;
    const avgWeight  = selfWeight ? selfWeight : 1;
    const share = avgWeight / (avgWeight * totalParts);
    const O = {kcal:oils.kcal*share, c:oils.c*share, p:oils.p*share, f:oils.f*share};

    const kcal = Math.round(C.kcal + P.kcal + V.kcal + O.kcal);
    const G = Math.round((C.c + V.c + O.c)*10)/10;
    const Prot = Math.round((P.p + V.p + O.p)*10)/10;
    const L = Math.round((P.f + C.f + V.f + O.f)*10)/10;

    out[p.name] = { kcal, P: Prot, G, L };
  });

  return out;
}
function renderSingleRecipe(r, mountEl){
  // clone ton template existant
  const tpl = qs("#recipeTpl");
  const node = tpl.content.cloneNode(true);

  node.querySelector(".recipe-title").textContent = `Recette — ${r.title||""}`;
  node.querySelector(".pill").textContent = (r.duration_min?`${r.duration_min} min`:"");
  node.querySelector(".r-cuisine").textContent = r.cuisine_family || "";
  node.querySelector(".r-duree").textContent   = r.duration_min || "";
  node.querySelector(".r-matos").textContent   = (r.equipment||[]).join(", ");

  // Portions courantes
  node.querySelector(".r-portions").textContent =
    Object.entries(r.portions||{}).map(([n,v])=>`${n}: ${v}`).join(" • ");

  // Cibles affichées (si présentes)
  const mt = r.macros_targets||{};
  node.querySelector(".r-cibles").textContent =
    `G: ${mt.glucides_g_cru||0} • V: ${mt.viandes_poissons_g_cru||0} • L: ${mt.legumes_g_cru||0}`;

  // kcal/personne recalculées IRL
  const per = computePerPersonNutrition(r, state.profiles.filter(p=>p.active));
  const kcalTxt = Object.entries(per).map(([n,pp])=>{
    const parts = Math.max(1, Number(r.portions?.[n]||0));
    const perMeal = {
      kcal: Math.round(pp.kcal/parts),
      P: Math.round(pp.P/parts*10)/10,
      G: Math.round(pp.G/parts*10)/10,
      L: Math.round(pp.L/parts*10)/10
    };
    return `${n}: ${pp.kcal} kcal (≈ ${perMeal.kcal}/repas) | P ${pp.P}g (≈ ${perMeal.P}) | G ${pp.G}g (≈ ${perMeal.G}) | L ${pp.L}g (≈ ${perMeal.L})`;
  }).join(" • ");
  node.querySelector(".r-kcal").textContent = kcalTxt;

  // Ingrédients
  const tbody = node.querySelector(".r-ing");
  tbody.innerHTML = "";
  (r.ingredients||[]).forEach(it=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${it.name||""}</td><td>${it.qty||0}</td><td>${it.unit||""}</td>`;
    tbody.appendChild(tr);
  });

  // Étapes
  const ol1 = node.querySelector(".r-steps");
  ol1.innerHTML = "";
  (r.steps||[]).forEach(s=>{ const li = document.createElement("li"); li.textContent = s; ol1.appendChild(li); });
  const ol2 = node.querySelector(".r-sauce");
  ol2.innerHTML = "";
  (r.sauce_steps||[]).forEach(s=>{ const li = document.createElement("li"); li.textContent = s; ol2.appendChild(li); });
  node.querySelector(".r-benef").textContent = r.benefits_sport||"";

  mountEl.innerHTML = "";
  mountEl.appendChild(node);
}

function openRecipeFromSaved(item){
  // 1) runtime
  const r = (typeof structuredClone==="function") ? structuredClone(item.recipe) : JSON.parse(JSON.stringify(item.recipe));
  r.portions = r.portions || {};

  // 2) mini-UI portions
  resultsEl.innerHTML = "";
  const wrap = document.createElement("section");
  wrap.className = "card";
  wrap.innerHTML = `
    <div class="card-title">🍽️ ${r.title} <span class="muted">(${r.cuisine_family||""})</span></div>
    <div class="card-body">
      <div class="row" style="gap:8px;margin-bottom:12px;">
        ${state.profiles.filter(p=>p.active).map(p=>{
          const val = Number(r.portions?.[p.name]||0);
          return `
            <label class="field" style="min-width:160px;">
              <span>${p.name} — portions (repas)</span>
              <input type="number" class="portion-input" data-name="${p.name}" value="${val}" min="0" step="1" />
            </label>
          `;
        }).join("")}
        <button id="recalcBtn" class="btn primary">Recalculer</button>
      </div>
      <div id="oneRecipeHost"></div>
    </div>
  `;
  resultsEl.appendChild(wrap);

  // 3) rendu initial
  const host = wrap.querySelector("#oneRecipeHost");
  renderSingleRecipe(r, host);

  // 4) recalc portions → recalc kcal/macros affichées
  wrap.querySelector("#recalcBtn")?.addEventListener("click", () => {
    const inputs = wrap.querySelectorAll(".portion-input");

    const activeProfiles = state.profiles.filter(p => p.active);

    // 1) Sauvegarder les anciennes portions
    const oldPortions = { ...r.portions };

    // 2) Lire les nouvelles portions depuis les inputs
    inputs.forEach(inp => {
      const n = inp.getAttribute("data-name");
      const v = Number(inp.value || 0);
      r.portions[n] = v;
    });

    // 3) Calculer anciens besoins G/P/V (en fonction des anciennes portions)
    let G_old = 0, P_old = 0, V_old = 0;
    activeProfiles.forEach(p => {
      const nbOld = Number(oldPortions[p.name] || 0);
      G_old += (p.needs.G || 0) * nbOld;
      P_old += (p.needs.P || 0) * nbOld;
      V_old += (p.needs.V || 0) * nbOld;
    });

    // 4) Calculer nouveaux besoins G/P/V (avec les nouvelles portions)
    let G_new = 0, P_new = 0, V_new = 0;
    activeProfiles.forEach(p => {
      const nbNew = Number(r.portions[p.name] || 0);
      G_new += (p.needs.G || 0) * nbNew;
      P_new += (p.needs.P || 0) * nbNew;
      V_new += (p.needs.V || 0) * nbNew;
    });

    // 5) Ratios par macro (si l'ancien est 0 -> on ne scale pas)
    const ratioG = (G_old > 0 && G_new > 0) ? (G_new / G_old) : 1;
    const ratioP = (P_old > 0 && P_new > 0) ? (P_new / P_old) : 1;
    const ratioV = (V_old > 0 && V_new > 0) ? (V_new / V_old) : 1;
    const fatRatio = (ratioG + ratioP + ratioV) / 3;

    // 6) Adapter les quantités d'ingrédients par type (carb/prot/veg/fat/sauce)
    if (Array.isArray(r.ingredients)) {
      r.ingredients.forEach(it => {
        if (typeof it.qty !== "number" || isNaN(it.qty)) return;
        const entry = findNutriEntry(it.name || "");
        if (!entry) return;

        let mult = 1;
        if (entry.type === "carb")      mult = ratioG;
        else if (entry.type === "prot") mult = ratioP;
        else if (entry.type === "veg")  mult = ratioV;
        else if (entry.type === "fat" || entry.type === "sauce") mult = fatRatio;

        it.qty = Math.round(it.qty * mult * 10) / 10; // arrondi 0.1
      });
    }

    // 7) Mettre à jour macros_targets de la recette pour coller aux nouveaux besoins
    r.macros_targets = r.macros_targets || {};
    r.macros_targets.glucides_g_cru        = Math.round(G_new);
    r.macros_targets.viandes_poissons_g_cru= Math.round(P_new);
    r.macros_targets.legumes_g_cru         = Math.round(V_new);

    // 8) Re-render complet de la recette (ingrédients + kcal + cibles)
    renderSingleRecipe(r, host);
  });


  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------- Rendering recettes ---------- */
function renderPlan(plan){
  resultsEl.innerHTML = "";
   window.lastPlanRendered = true;

  const tpl = qs("#recipeTpl");
  (plan.recipes||[]).forEach((r, i)=>{
    const node = tpl.content.cloneNode(true);
    node.querySelector(".recipe-title").textContent = `Recette ${i+1} — ${r.title||""}`;
    node.querySelector(".pill").textContent = (r.duration_min?`${r.duration_min} min`:"");
    node.querySelector(".r-cuisine").textContent = r.cuisine_family || "";
    node.querySelector(".r-duree").textContent   = r.duration_min || "";
    node.querySelector(".r-matos").textContent   = (r.equipment||[]).join(", ");
    // portions
    node.querySelector(".r-portions").textContent = Object.entries(r.portions||{}).map(([n,v])=>`${n}: ${v}`).join(" • ");
    // cibles
    const mt = r.macros_targets||{};
    node.querySelector(".r-cibles").textContent = `G: ${mt.glucides_g_cru||0} • V: ${mt.viandes_poissons_g_cru||0} • L: ${mt.legumes_g_cru||0}`;
    // kcal/personne (IRL, selon besoins profils actifs)
const per = computePerPersonNutrition(r, state.profiles.filter(p=>p.active));
const kcalTxt = Object.entries(per).map(([n,pp])=>{
  const parts = Math.max(1, Number(r.portions?.[n]||0));
  const perMeal = {
    kcal: Math.round(pp.kcal/parts),
    P: Math.round(pp.P/parts*10)/10,
    G: Math.round(pp.G/parts*10)/10,
    L: Math.round(pp.L/parts*10)/10
  };
  return `${n}: ${pp.kcal} kcal (≈ ${perMeal.kcal}/repas) | P ${pp.P}g (≈ ${perMeal.P}) | G ${pp.G}g (≈ ${perMeal.G}) | L ${pp.L}g (≈ ${perMeal.L})`;
}).join(" • ");
node.querySelector(".r-kcal").textContent = kcalTxt;


    // ingrédients
    const tbody = node.querySelector(".r-ing");
    (r.ingredients||[]).forEach(it=>{
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${it.name||""}</td><td>${it.qty||0}</td><td>${it.unit||""}</td>`;
      tbody.appendChild(tr);
    });
    // steps
    const ol1 = node.querySelector(".r-steps");
    (r.steps||[]).forEach(s=>{
      const li = document.createElement("li"); li.textContent = s; ol1.appendChild(li);
    });
    const ol2 = node.querySelector(".r-sauce");
    (r.sauce_steps||[]).forEach(s=>{
      const li = document.createElement("li"); li.textContent = s; ol2.appendChild(li);
    });
    node.querySelector(".r-benef").textContent = r.benefits_sport||"";
    resultsEl.appendChild(node);
  });
}
function renderHistory(){
  if(!historyList) return;
  const hist = (state.history||[]).slice().reverse();
  if(hist.length===0){
    historyList.innerHTML = `<i>Pas encore d'historique.</i>`;
    return;
  }
  historyList.innerHTML = hist.map(h=>{
    const date = new Date(h.ts).toLocaleString();
    const count = (h.recipes||[]).length;
    const listTitles = (h.recipes||[]).map(r=>r.title).join(" • ");
    return `
      <div class="history-item">
        <div><b>${date}</b> — ${count} recette(s)</div>
        <div class="muted">${listTitles}</div>
        <div class="row" style="gap:6px; margin-top:6px;">
          <button class="btn" data-hview="${h.id}">Revoir</button>
          <button class="btn ghost" data-hjson="${h.id}">Export JSON</button>
          <button class="btn danger" data-hdel="${h.id}">Supprimer</button>
        </div>
      </div>
      <hr/>
    `;
  }).join("");
}

historyList?.addEventListener("click", (e)=>{
  const idView = e.target.getAttribute("data-hview");
  const idJson = e.target.getAttribute("data-hjson");
  const idDel  = e.target.getAttribute("data-hdel");
  if(idView){
    const h = (state.history||[]).find(x=>x.id===idView);
    if(h){
      resultsEl.innerHTML="";
      renderPlan(h.plan);
      resultsEl.appendChild( renderShoppingList(h.plan) );
      window.scrollTo({top:0,behavior:"smooth"});
    }
  }
  if(idJson){
    const h = (state.history||[]).find(x=>x.id===idJson);
    if(h){
      const blob = new Blob([JSON.stringify(h.plan,null,2)], {type:"application/json"});
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `hebo-${new Date(h.ts).toISOString().slice(0,19)}.json`; a.click();
      URL.revokeObjectURL(url);
    }
  }
  if(idDel){ deleteHistoryEntry(idDel); }
});

clearHistoryBtn?.addEventListener("click", ()=>{
  if(confirm("Supprimer tout l'historique ?")){
    state.history = [];
    saveState();
    renderHistory();
  }
});

/* ---------- Actions ---------- */
generateBtn.addEventListener("click", async()=>{
  try{
    if(!state.apiKey){ alert("Ajoute ta clé API dans Paramètres."); return; }
    statusEl.textContent = "Génération en cours…";
    const chunkTargets = computeTargetsFromPlan();
    if(chunkTargets.length===0){ statusEl.textContent = "Aucune case cochée."; return; }
    const plan = await callOpenAIForPlan(chunkTargets);
    renderPlan(plan);
     // ➜ Append la liste de courses à la fin
resultsEl.appendChild( renderShoppingList(plan) );
     addHistoryEntry(plan);

     

     const warns = validatePlanClient(plan);
if (warns.length){
  statusEl.textContent = "⚠️ " + warns.join(" • ");
}

    statusEl.textContent = "✅ Recettes générées.";
  }catch(err){
    console.error(err);
    statusEl.textContent = "❌ " + (err?.message||err);
  }
});

exportBtn.addEventListener("click", ()=>{
  const data = {
    state,
    targets: computeTargetsFromPlan()
  };
  const blob = new Blob([JSON.stringify(data,null,2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "hebo-export.json"; a.click();
  URL.revokeObjectURL(url);
});

/* ---------- PWA install (optionnel) ---------- */
let deferredPrompt=null;
window.addEventListener('beforeinstallprompt', (e)=>{ e.preventDefault(); deferredPrompt=e; });
qs("#installBtn")?.addEventListener("click", async()=>{
  if(deferredPrompt){ deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; }



});
// --- Export PDF ---
const exportPdfBtn = document.getElementById("exportPdfBtn");

exportPdfBtn.addEventListener("click", async () => {
  if (!window.lastPlanRendered) {
    alert("Génère les recettes d'abord !");
    return;
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF("p", "mm", "a4");

  const recipeCards = document.querySelectorAll(".recipe");
  let y = 10;

  for (let card of recipeCards) {
    const canvas = await html2canvas(card, { scale: 2 });
    const imgData = canvas.toDataURL("image/png");
    const imgProps = pdf.getImageProperties(imgData);
    
    const pdfWidth = 190;
    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

    if (y + pdfHeight > 280) {
      pdf.addPage();
      y = 10;
    }

    pdf.addImage(imgData, "PNG", 10, y, pdfWidth, pdfHeight);
    y += pdfHeight + 5;
  }

  pdf.save("HEBO_recettes.pdf");
});

/* ---------- Boot ---------- */
renderProfiles();
renderPlanningTable();
renderHistory();
renderSavedRecipes();
