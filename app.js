// TB Armering v0.7.0 – Trimble Connect 3D-viewer extension (Total Betong)
// - Skjul/vis LM (løpemeter)
// - Konstruksjonsdeler i nedtrekk, med liste over Product name
// - Fargelegging per posisjonsnr.
// All behandling skjer i nettleseren. Ingen data sendes ut av Trimble Connect.

// Gruppestruktur basert på PREFIKS i konstruksjonsdel-koden (bokstavene foran tallet).
// - Koden deles i prefiks + nummer: "YE100" -> YE + 100, "KR1" -> KR + 1.
// - Nummer 100, 200, 300 … regnes som 1, 2, 3 … (YE100 = YE1, F100 = F1, V200 = V2).
// - Nye nummer (YV2, YV3, V6, K3 …) havner automatisk i riktig gruppe.
// - Koder med prefiks som ikke står her havner under "Annet" (f.eks. T1).
// - Objekter uten konstruksjonsdel ("--") = innstøpningsgods:
//   Skjøtejernskassett -> "Comax", resten -> "Annet > Innstøpningsgods".
//   Innstøpningsgods er alltid synlig ved Isoler og blir lys grå ved fargelegging.
const COMAX = /skj.tejernskassett/i;
const EMBED_COLOR = { r: 215, g: 218, b: 222, a: 255 }; // lys grå
// IFC-klasser som ikke er armering (betongelementer o.l.)
const CONCRETE = /^Ifc(Slab|Wall|WallStandardCase|Beam|Column|Footing|Stair|StairFlight|Roof|Plate|Pile|Ramp|RampFlight|Covering|Space|Opening)/i;
const GROUPS = [
  { title: "Bunnplate", prefixes: ["A", "B"] },
  { title: "Fundamenter", prefixes: ["F", "KR", "S"] },
  { title: "Heis", prefixes: ["H"] },
  { title: "Kran", prefixes: ["K"] },
  { title: "Yttervegger", children: [
    { title: "Vegg Øst", prefixes: ["YE"] },
    { title: "Vegg Nord", prefixes: ["YN", "U"] },
    { title: "Vegg Sør", prefixes: ["YS"] },
    { title: "Vegg Vest", prefixes: ["YV"] },
  ]},
  { title: "Innervegger", children: [
    { title: "Innervegg", prefixes: ["V", "W"] },
    { title: "Vegg rampe", prefixes: ["VR"] },
  ]},
];

// "YE100" -> { prefix: "YE", key: "YE1" }. Ugyldig kode -> null.
function parseCode(raw) {
  const m = /^([A-ZÆØÅ]+)\s*(\d+)$/.exec(String(raw ?? "").trim().toUpperCase());
  if (!m) return null;
  let n = parseInt(m[2], 10);
  if (n >= 100 && n % 100 === 0) n = n / 100;
  return { prefix: m[1], key: m[1] + n };
}

const BATCH = 500;

const el = (id) => document.getElementById(id);
const ui = {
  toggle: el("toggleLm"), selectLm: el("selectLm"), infoBtn: el("infoBtn"), infoBox: el("infoBox"),
  stampLabels: el("stampLabels"), clearLabels: el("clearLabels"), labelInfo: el("labelInfo"), labelOffset: el("labelOffset"),
  lmCount: el("lmCount"), groups: el("groups"),
  resetColors: el("resetColors"), rescan: el("rescan"), status: el("status"),
  lmProps: el("lmProps"), lmValue: el("lmValue"), delProps: el("delProps"), posProps: el("posProps"),
};

let api = null;
let items = [];      // [{ modelId, id, form, del, pos, product }]
let allObjects = []; // [{ modelId, ids: [...] }] – alle objekter i lastede modeller
let itemIndex = new Map(); // "modelId|id" -> item

// Etiketter
const LABEL_MAX = 150;                                  // tak på antall etiketter (ytelse)
let labelIds = [];      // id-er på etiketter vi har lagt ut (fjernes kun disse)
let labelTexts = new Set();
let labelBusy = false;
const DEFAULT_LABEL_COLOR = { r: 110, g: 60, b: 30, a: 255 }; // brun, som armering i modellen
let appliedColors = new Map(); // "modelId|id" -> rgba satt av "Farge per pos.nr"
let scanning = false;

// ---------- hjelpere ----------
const norm = (v) => String(v ?? "").trim().toLowerCase();
const normName = (v) => norm(v).replace(/[\s_.\-]/g, "");
const list = (s) => s.split(",").map(normName).filter(Boolean);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const natural = (a, b) => String(a).localeCompare(String(b), "no", { numeric: true });

function setStatus(text, isError = false) {
  ui.status.textContent = text;
  ui.status.classList.toggle("error", isError);
}

// Første ikke-tomme verdi blant kandidatnavnene ("--" regnes som tom).
function pick(flat, names) {
  for (const n of names) {
    const v = flat.get(n);
    if (v !== undefined && v !== null && String(v).trim() !== "" && String(v).trim() !== "--") return String(v).trim();
  }
  return null;
}

// Grupperer objekter til Trimble-selector: [{ modelId, objectRuntimeIds }]
function toSelector(objs) {
  const byModel = new Map();
  for (const o of objs) {
    if (!byModel.has(o.modelId)) byModel.set(o.modelId, []);
    byModel.get(o.modelId).push(o.id);
  }
  return { modelObjectIds: [...byModel].map(([modelId, ids]) => ({ modelId, objectRuntimeIds: ids })) };
}

// Distinkte farger (gyllent snitt rundt fargehjulet) som #RRGGBB
function color(i) {
  const h = (i * 137.508) % 360, s = 0.7, l = 0.5;
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

async function safe(fn, msg) {
  try { await fn(); } catch (err) { console.error(err); setStatus(msg + ": " + (err?.message || err), true); }
}

// ---------- skanning ----------
async function scan() {
  if (scanning) return;
  scanning = true;
  ui.toggle.disabled = true; ui.rescan.disabled = true; ui.resetColors.disabled = true;

  const formNames = list(ui.lmProps.value);
  const delNames = list(ui.delProps.value);
  const posNames = list(ui.posProps.value);
  const productNames = ["productname", "name"];

  try {
    setStatus("Henter objekter fra modellene …");
    const modelObjects = await api.viewer.getObjects();
    // Alle objekter (også betong) – brukes av Isoler for å skjule "resten"
    allObjects = (modelObjects || []).map((mo) => ({ modelId: mo.modelId, ids: (mo.objects || []).map((o) => o.id) }));
    const found = [];
    let total = 0;

    for (const mo of modelObjects || []) {
      const ids = (mo.objects || []).map((o) => o.id);
      total += ids.length;
      for (let i = 0; i < ids.length; i += BATCH) {
        setStatus(`Leser egenskaper … ${Math.min(i + BATCH, ids.length)} / ${ids.length} objekter`);
        const props = await api.viewer.getObjectProperties(mo.modelId, ids.slice(i, i + BATCH));
        for (const op of props || []) {
          const flat = new Map();
          for (const pset of op.properties || []) {
            for (const p of pset.properties || []) {
              const k = normName(p.name);
              if (!flat.has(k)) flat.set(k, p.value);
            }
          }
          const form = pick(flat, formNames);
          const del = pick(flat, delNames);
          const hasDel = delNames.some((n) => flat.has(n)); // egenskapen finnes, selv om verdien er "--"
          const rawName = String((op.product && op.product.name) || pick(flat, productNames) || "");
          const isRebarClass = /^IfcReinforcing|^IfcTendon/i.test(op.class || "");
          if (CONCRETE.test(op.class || "")) continue;      // betong o.l. tas ikke med
          // Armering = har form/konstruksjonsdel, er armeringsklasse, eller er Comax (har bare navn)
          if (!form && !del && !hasDel && !isRebarClass && !COMAX.test(rawName)) continue;
          found.push({
            modelId: mo.modelId,
            id: op.id,
            form,
            del,
            pos: pick(flat, posNames) || "–",
            // ":1599539" (element-id) fjernes så like produkter samles i listen
            product: (rawName || "(uten navn)").replace(/:\d+$/, ""),
          });
        }
      }
    }

    items = found;
    itemIndex = new Map(items.map((o) => [o.modelId + "|" + o.id, o]));
    ui.stampLabels.disabled = false;
    ui.clearLabels.disabled = false;
    const lm = lmItems();
    ui.lmCount.textContent = `${lm.length} LM-objekter funnet (av ${total})`;
    ui.toggle.checked = false;
    ui.toggle.disabled = lm.length === 0;
    ui.selectLm.disabled = lm.length === 0;
    ui.resetColors.disabled = items.length === 0;
    renderGroups();
    setStatus(items.length ? "Klar." : "Fant ingen armering med de angitte egenskapene.");
  } catch (err) {
    console.error(err);
    setStatus("Feil ved skanning: " + (err?.message || err), true);
  } finally {
    scanning = false;
    ui.rescan.disabled = false;
  }
}

// Innstøpningsgods = armeringsobjekter uten konstruksjonsdel ("--")
function embedItems() {
  return items.filter((o) => !o.del);
}

function lmItems() {
  const v = norm(ui.lmValue.value);
  return items.filter((o) => o.del && norm(o.form) === v); // innstøpningsgods skjules aldri
}

// ---------- LM ----------
async function applyLm(hide) {
  const lm = lmItems();
  if (!lm.length) return;
  await safe(async () => {
    await api.viewer.setObjectState(toSelector(lm), { visible: !hide });
    setStatus(hide ? "LM er skjult." : "LM er synlig.");
  }, "Kunne ikke endre synlighet");
}

// ---------- grupper ----------
// Bygger et "løst" tre: { title, sub?, objs, children? }
function resolveTree() {
  // Samle objekter per normalisert kode (YE1 + YE100 -> YE1)
  const byKey = new Map(); // key -> { key, prefix, raws:Set, objs:[] }
  const noDel = [];
  for (const o of items) {
    if (!o.del) { noDel.push(o); continue; }
    const p = parseCode(o.del);
    const key = p ? p.key : String(o.del).trim().toUpperCase();
    if (!byKey.has(key)) byKey.set(key, { key, prefix: p ? p.prefix : null, raws: new Set(), objs: [] });
    const e = byKey.get(key);
    e.raws.add(String(o.del).trim());
    e.objs.push(o);
  }

  const claimed = new Set();
  const rawLabel = (e) => {
    const r = [...e.raws].sort(natural);
    return r.length > 1 || r[0].toUpperCase() !== e.key ? r.join(" + ") : "";
  };
  const leafOf = (e, title) => ({ title, sub: rawLabel(e), objs: e.objs });

  const resolve = (g) => {
    if (g.children) {
      const children = g.children.map(resolve);
      return { title: g.title, children, objs: children.flatMap((c) => c.objs) };
    }
    const pre = new Set(g.prefixes.map((p) => p.toUpperCase()));
    const fams = [...byKey.values()].filter((e) => pre.has(e.prefix)).sort((a, b) => natural(a.key, b.key));
    fams.forEach((e) => claimed.add(e.key));
    if (fams.length === 0) return { title: g.title, sub: g.prefixes.join(", "), objs: [] };
    if (fams.length === 1) {
      const e = fams[0];
      return { title: g.title, sub: [e.key, rawLabel(e)].filter(Boolean).join(" · "), objs: e.objs };
    }
    const children = fams.map((e) => leafOf(e, e.key));
    return { title: g.title, children, objs: children.flatMap((c) => c.objs) };
  };

  const tree = GROUPS.map(resolve);

  // Innstøpningsgods
  const comax = noDel.filter((o) => COMAX.test(o.product));
  const embedRest = noDel.filter((o) => !COMAX.test(o.product));
  tree.push({ title: "Comax", sub: "Skjøtejernskassett", objs: comax });

  // Annet: ukjente koder + øvrig innstøpningsgods
  const others = [...byKey.values()].filter((e) => !claimed.has(e.key)).sort((a, b) => natural(a.key, b.key));
  const annet = others.map((e) => leafOf(e, e.key));
  if (embedRest.length) annet.push({ title: "Innstøpningsgods", sub: "øvrig", objs: embedRest });
  if (annet.length) tree.push({ title: "Annet", children: annet, objs: annet.flatMap((c) => c.objs) });
  return tree;
}

function renderGroups() {
  ui.groups.innerHTML = "";
  for (const n of resolveTree()) ui.groups.appendChild(buildNode(n));
}

function buildNode(n) {
  const d = document.createElement("details");
  if (!n.objs.length) d.classList.add("empty");
  const sub = n.sub ? ` <span class="n">(${esc(n.sub)})</span>` : "";
  d.innerHTML = `<summary>${esc(n.title)}${sub}<span class="n">${n.objs.length}</span></summary>`;

  // Innhold lastes først når noden åpnes
  let built = false;
  const holder = document.createElement("div");
  d.appendChild(holder);
  d.addEventListener("toggle", () => {
    if (d.open && !built) { built = true; buildContent(holder, n.objs, !n.children); }
  });
  if (n.children) for (const c of n.children) d.appendChild(buildNode(c));
  return d;
}

function buildContent(d, objs, withList) {
  if (!objs.length) {
    d.insertAdjacentHTML("beforeend", `<div class="hint" style="margin-left:12px">Ingen objekter i lastede modeller.</div>`);
    return;
  }

  const actions = document.createElement("div");
  actions.className = "leaf-actions";
  actions.innerHTML = `<button data-a="select">Velg</button><button data-a="isolate">Isoler</button><button data-a="color">Farge per pos.nr</button>`;
  d.appendChild(actions);

  // Pos.nr -> farge (stabil rekkefølge)
  const posList = [...new Set(objs.map((o) => o.pos))].sort(natural);
  const posColor = new Map(posList.map((p, i) => [p, color(i)]));

  // Aggreger per Product name
  const byProduct = new Map();
  for (const o of objs) {
    if (!byProduct.has(o.product)) byProduct.set(o.product, []);
    byProduct.get(o.product).push(o);
  }

  const plist = document.createElement("div");
  plist.className = "plist";
  for (const name of withList ? [...byProduct.keys()].sort(natural) : []) {
    const po = byProduct.get(name);
    const poss = [...new Set(po.map((o) => o.pos))].sort(natural);
    const row = document.createElement("div");
    row.className = "prow";
    row.title = "Klikk for å velge i modellen";
    row.innerHTML =
      `<span class="swatches">${poss.slice(0, 6).map((p) => `<i class="sw" data-pos="${esc(p)}"></i>`).join("")}</span>` +
      `<span class="pname">${esc(name)}</span>` +
      `<span class="pos">pos ${esc(poss.length > 3 ? poss.slice(0, 3).join(", ") + " …" : poss.join(", "))}</span>` +
      `<span class="pcount">${po.length} stk</span>`;
    row.addEventListener("click", () => select(po));
    plist.appendChild(row);
  }
  d.appendChild(plist);

  const showColors = (on) => {
    plist.querySelectorAll(".sw").forEach((s) => { s.style.background = on ? posColor.get(s.dataset.pos) : "transparent"; });
  };
  showColors(false);

  actions.addEventListener("click", (e) => {
    const a = e.target?.dataset?.a;
    if (a === "select") select(objs);
    if (a === "isolate") isolate(objs);
    if (a === "color") colorByPos(objs, posColor).then(() => showColors(true));
  });
}

async function select(objs) {
  await safe(async () => {
    const sel = toSelector(objs);
    await api.viewer.setSelection(sel, "set");
    try { await api.viewer.setCamera(sel, { animationTime: 400 }); } catch (_) { /* zoom er valgfritt */ }
    setStatus(`${objs.length} objekter valgt.`);
  }, "Kunne ikke velge objekter");
}

async function isolate(objs) {
  await safe(async () => {
    // Behold gruppen + innstøpningsgods; skjul alt annet (også betong).
    const keep = [...objs, ...embedItems()];
    const sel = toSelector(keep).modelObjectIds;
    await api.viewer.setObjectState(undefined, { visible: "reset" });

    // 1) Trimbles egen "Vis bare valgte objekter"
    let ok = false;
    try {
      ok = await api.viewer.isolateEntities(sel.map((m) => ({ modelId: m.modelId, entityIds: m.objectRuntimeIds })));
    } catch (_) { ok = false; }

    // 2) Reserve: skjul resten, men ikke overordnede objekter (støpeenhet, etasje …),
    //    ellers forsvinner også armeringen som ligger under dem.
    if (ok === false) {
      const keepSet = new Set(keep.map((o) => o.modelId + "|" + o.id));
      for (const m of sel) {
        try {
          const parents = await api.viewer.getHierarchyParents(m.modelId, m.objectRuntimeIds, undefined, true);
          (parents || []).forEach((p) => keepSet.add(m.modelId + "|" + p.id));
        } catch (_) { /* ingen hierarki-info */ }
      }
      const hide = allObjects
        .map((mm) => ({ modelId: mm.modelId, objectRuntimeIds: mm.ids.filter((id) => !keepSet.has(mm.modelId + "|" + id)) }))
        .filter((mm) => mm.objectRuntimeIds.length);
      if (hide.length) await api.viewer.setObjectState({ modelObjectIds: hide }, { visible: false });
      await api.viewer.setObjectState({ modelObjectIds: sel }, { visible: true });
    }
    ui.toggle.checked = false;
    setStatus(`Viser ${objs.length} objekter + innstøpningsgods. Trykk «Nullstill» for å vise alt.`);
  }, "Kunne ikke isolere");
}

async function colorByPos(objs, posColor) {
  await safe(async () => {
    const byPos = new Map();
    for (const o of objs) {
      if (!byPos.has(o.pos)) byPos.set(o.pos, []);
      byPos.get(o.pos).push(o);
    }
    for (const [pos, po] of byPos) {
      const hex = posColor.get(pos);
      const rgba = { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16), a: 255 };
      await api.viewer.setObjectState(toSelector(po), { color: rgba });
      po.forEach((o) => appliedColors.set(o.modelId + "|" + o.id, rgba)); // etiketter bruker samme farge
    }
    // Innstøpningsgods utenfor gruppen -> lys grå
    const inGroup = new Set(objs.map((o) => o.modelId + "|" + o.id));
    const embed = embedItems().filter((o) => !inGroup.has(o.modelId + "|" + o.id));
    if (embed.length) await api.viewer.setObjectState(toSelector(embed), { color: EMBED_COLOR });
    embed.forEach((o) => appliedColors.set(o.modelId + "|" + o.id, EMBED_COLOR));
    setStatus(`Fargelagt ${byPos.size} posisjonsnr. (${objs.length} objekter). Innstøpningsgods er lys grå.`);
  }, "Kunne ikke fargelegge");
}

async function resetAll() {
  await safe(async () => {
    await api.viewer.setObjectState(undefined, { color: "reset", visible: "reset" });
    appliedColors = new Map();
    ui.toggle.checked = false;
    ui.groups.querySelectorAll(".sw").forEach((s) => { s.style.background = "transparent"; });
    setStatus("Farger og synlighet er nullstilt.");
  }, "Kunne ikke nullstille");
}

// ---------- etiketter ----------
// Roterer vektor v med kvaternion q (kamera-orientering).
function rotate(q, v) {
  const { x, y, z, w } = q;
  const cx = y * v.z - z * v.y, cy = z * v.x - x * v.z, cz = x * v.y - y * v.x;           // q × v
  const dx = y * cz - z * cy, dy = z * cx - x * cz, dz = x * cy - y * cx;                 // q × (q × v)
  return { x: v.x + 2 * (w * cx + dx), y: v.y + 2 * (w * cy + dy), z: v.z + 2 * (w * cz + dz) };
}

// Kameraets "høyre" og "opp" (enhetsvektorer i modellkoordinater).
async function cameraAxes() {
  let right = { x: 1, y: 0, z: 0 }, up = { x: 0, y: 0, z: 1 };
  try {
    const cam = await api.viewer.getCamera();
    if (cam && cam.quaternion) {
      right = rotate(cam.quaternion, { x: 1, y: 0, z: 0 });
      up = rotate(cam.quaternion, { x: 0, y: 1, z: 0 });
    }
  } catch (_) { /* bruk standard */ }
  const n = (v) => { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
  return { right: n(right), up: n(up) };
}

// "#RRGGBB", "RRGGBB" eller "#RRGGBBAA" -> rgba. Ugyldig -> null.
function hexToRgba(hex) {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255, a: 255 };
}

async function clearLabels() {
  try {
    if (labelIds.length) {
      await api.markup.removeMarkups(labelIds);
    } else if (labelTexts.size) {
      // Reserve: fjern tekstmarkeringer med våre tekster
      const all = await api.markup.getTextMarkups();
      const ids = (all || []).filter((m) => labelTexts.has(m.text) && m.id != null).map((m) => m.id);
      if (ids.length) await api.markup.removeMarkups(ids);
    }
  } catch (err) { console.error(err); }
  labelIds = [];
  labelTexts = new Set();
}

async function placeLabels() {
  if (labelBusy) return;
  labelBusy = true;
  try {
    await clearLabels();
    const sel = await api.viewer.getSelection();
    const picked = (sel || []).filter((m) => m.objectRuntimeIds && m.objectRuntimeIds.length);
    if (!picked.length) {
      ui.labelInfo.textContent = "Velg jern i modellen";
      return;
    }

    // 1) Grupper valgte objekter per Product name
    const groups = new Map(); // name -> [{ modelId, id }]
    const add = (name, modelId, id) => {
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push({ modelId, id });
    };
    for (const m of picked) {
      const unknown = [];
      for (const id of m.objectRuntimeIds) {
        const it = itemIndex.get(m.modelId + "|" + id);
        if (it) add(it.product, m.modelId, id); else unknown.push(id);
      }
      for (let i = 0; i < unknown.length; i += BATCH) {
        const props = await api.viewer.getObjectProperties(m.modelId, unknown.slice(i, i + BATCH));
        for (const op of props || []) {
          if (CONCRETE.test(op.class || "")) continue;
          let name = op.product && op.product.name;
          if (!name) {
            for (const ps of op.properties || []) for (const p of ps.properties || []) {
              if (!name && normName(p.name) === "name") name = p.value;
            }
          }
          if (name) add(String(name).replace(/:\d+$/, ""), m.modelId, op.id);
        }
      }
    }
    if (!groups.size) { ui.labelInfo.textContent = "Ingen armering i utvalget"; return; }

    // 2) Midtpunkt for alle valgte objekter (bounding box, meter -> mm)
    const centers = new Map(); // "modelId|id" -> {x,y,z} i mm
    const byModel = new Map();
    for (const objs of groups.values()) for (const o of objs) {
      if (!byModel.has(o.modelId)) byModel.set(o.modelId, []);
      byModel.get(o.modelId).push(o.id);
    }
    for (const [modelId, ids] of byModel) {
      for (let i = 0; i < ids.length; i += BATCH) {
        const boxes = await api.viewer.getObjectBoundingBoxes(modelId, ids.slice(i, i + BATCH));
        for (const b of boxes || []) {
          const bb = b.boundingBox; if (!bb) continue;
          // Enhet er ikke dokumentert: et jern > 50 i lengde må være mm, ellers meter.
          const ext = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
          const k = ext > 50 ? 1 : 1000;
          centers.set(modelId + "|" + b.id, {
            x: (bb.min.x + bb.max.x) / 2 * k,
            y: (bb.min.y + bb.max.y) / 2 * k,
            z: (bb.min.z + bb.max.z) / 2 * k,
          });
        }
      }
    }

    // 3) Én etikett per gruppe, på jernet nærmest gruppens midtpunkt
    const { right, up } = await cameraAxes();
    const H = Math.max(100, Number(ui.labelOffset.value) || 2000); // høyde i mm
    const dir = { x: up.x * H + right.x * H * 0.5, y: up.y * H + right.y * H * 0.5, z: up.z * H + right.z * H * 0.5 };
    const names = [...groups.keys()].sort(natural);
    const shown = names.slice(0, LABEL_MAX);

    // Fargen til jernet som får etiketten: pos.nr-farge hvis fargelagt, ellers modellens farge
    const chosen = new Map(); // name -> best
    for (const name of shown) {
      const pts = groups.get(name).map((o) => ({ o, c: centers.get(o.modelId + "|" + o.id) })).filter((p) => p.c);
      if (!pts.length) continue;
      const avg = pts.reduce((a, p) => ({ x: a.x + p.c.x / pts.length, y: a.y + p.c.y / pts.length, z: a.z + p.c.z / pts.length }), { x: 0, y: 0, z: 0 });
      let best = pts[0], bestD = Infinity;
      for (const p of pts) {
        const d = (p.c.x - avg.x) ** 2 + (p.c.y - avg.y) ** 2 + (p.c.z - avg.z) ** 2;
        if (d < bestD) { bestD = d; best = p; }
      }
      chosen.set(name, best);
    }
    const modelColor = new Map(); // "modelId|id" -> rgba fra modellen
    const need = new Map();
    for (const b of chosen.values()) {
      const k = b.o.modelId + "|" + b.o.id;
      if (appliedColors.has(k)) continue;
      if (!need.has(b.o.modelId)) need.set(b.o.modelId, []);
      need.get(b.o.modelId).push(b.o.id);
    }
    for (const [modelId, ids] of need) {
      try {
        const props = await api.viewer.getObjectProperties(modelId, ids);
        for (const op of props || []) {
          const c = hexToRgba(op.color);
          if (c) modelColor.set(modelId + "|" + op.id, c);
        }
      } catch (_) { /* bruk standardfarge */ }
    }

    const markups = [];
    for (const name of shown) {
      const best = chosen.get(name);
      if (!best) continue;
      const k = best.o.modelId + "|" + best.o.id;
      const s = best.c;
      markups.push({
        text: name,
        color: appliedColors.get(k) || modelColor.get(k) || DEFAULT_LABEL_COLOR,
        start: { positionX: s.x, positionY: s.y, positionZ: s.z, modelId: best.o.modelId, objectId: best.o.id },
        end: { positionX: s.x + dir.x, positionY: s.y + dir.y, positionZ: s.z + dir.z },
      });
    }
    const added = await api.markup.addTextMarkup(markups);
    labelIds = (added || []).map((m) => m.id).filter((id) => id != null);
    labelTexts = new Set(markups.map((m) => m.text));
    const cut = names.length > LABEL_MAX ? ` (maks ${LABEL_MAX} vist av ${names.length})` : "";
    ui.labelInfo.textContent = `${markups.length} etiketter${cut}`;
  } catch (err) {
    console.error(err);
    setStatus("Kunne ikke lage etiketter: " + (err?.message || err), true);
  } finally {
    labelBusy = false;
  }
}

// ---------- oppstart ----------
function onEvent(event) {
  if (/onModel/i.test(event)) {
    items = [];
    ui.toggle.checked = false;
    ui.toggle.disabled = true;
    ui.lmCount.textContent = "Modellene er endret – skann på nytt";
    ui.groups.innerHTML = `<div class="hint">Modellene er endret – skann på nytt</div>`;
  }
}

async function init() {
  if (typeof TrimbleConnectWorkspace === "undefined") {
    setStatus("Fant ikke Trimble Connect Workspace API. Åpne panelet inne i Trimble Connect.", true);
    return;
  }
  try {
    api = await TrimbleConnectWorkspace.connect(window.parent, onEvent, 30000);
  } catch (err) {
    setStatus("Fikk ikke kontakt med Trimble Connect. Åpne extensionen fra 3D-visningen.", true);
    return;
  }
  ui.toggle.addEventListener("change", () => applyLm(ui.toggle.checked));
  ui.selectLm.addEventListener("click", () => select(lmItems()));
  ui.stampLabels.addEventListener("click", placeLabels);
  ui.clearLabels.addEventListener("click", async () => {
    await clearLabels();
    ui.labelInfo.textContent = "Etiketter fjernet";
  });
  ui.rescan.addEventListener("click", scan);
  ui.resetColors.addEventListener("click", resetAll);
  await scan();
}

// Info-knappen virker også om tilkoblingen feiler
ui.infoBtn.addEventListener("click", () => { ui.infoBox.hidden = !ui.infoBox.hidden; });
init();
