// TB Armering v0.4.0 – Trimble Connect 3D-viewer extension (Total Betong)
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
    { title: "Yttervegg", prefixes: ["U"] },
    { title: "Vegg Øst", prefixes: ["YE"] },
    { title: "Vegg Nord", prefixes: ["YN"] },
    { title: "Vegg Sør", prefixes: ["YS"] },
    { title: "Vegg Vest", prefixes: ["YV"] },
  ]},
  { title: "Innervegger", children: [
    { title: "Innervegg", prefixes: ["V"] },
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
  toggle: el("toggleLm"), lmCount: el("lmCount"), groups: el("groups"),
  resetColors: el("resetColors"), rescan: el("rescan"), status: el("status"),
  lmProps: el("lmProps"), lmValue: el("lmValue"), delProps: el("delProps"), posProps: el("posProps"),
};

let api = null;
let items = [];      // [{ modelId, id, form, del, pos, product }]
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
          if (CONCRETE.test(op.class || "")) continue;      // betong o.l. tas ikke med
          if (!form && !del && !hasDel) continue;           // ikke armering
          found.push({
            modelId: mo.modelId,
            id: op.id,
            form,
            del,
            pos: pick(flat, posNames) || "–",
            // ":1599539" (element-id) fjernes så like produkter samles i listen
            product: String((op.product && op.product.name) || pick(flat, productNames) || "(uten navn)").replace(/:\d+$/, ""),
          });
        }
      }
    }

    items = found;
    const lm = lmItems();
    ui.lmCount.textContent = `${lm.length} LM-objekter funnet (av ${total})`;
    ui.toggle.checked = false;
    ui.toggle.disabled = lm.length === 0;
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

  const legend = document.createElement("div");
  legend.className = "legend";
  d.appendChild(legend);

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
    legend.innerHTML = on
      ? posList.map((p) => `<span><i class="sw" style="background:${posColor.get(p)}"></i>${esc(p)}</span>`).join("")
      : "";
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
    await api.viewer.setObjectState(undefined, { visible: false });
    await api.viewer.setObjectState(toSelector(objs), { visible: true });
    const embed = embedItems();
    if (embed.length) await api.viewer.setObjectState(toSelector(embed), { visible: true });
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
    }
    // Innstøpningsgods utenfor gruppen -> lys grå
    const inGroup = new Set(objs.map((o) => o.modelId + "|" + o.id));
    const embed = embedItems().filter((o) => !inGroup.has(o.modelId + "|" + o.id));
    if (embed.length) await api.viewer.setObjectState(toSelector(embed), { color: EMBED_COLOR });
    setStatus(`Fargelagt ${byPos.size} posisjonsnr. (${objs.length} objekter). Innstøpningsgods er lys grå.`);
  }, "Kunne ikke fargelegge");
}

async function resetAll() {
  await safe(async () => {
    await api.viewer.setObjectState(undefined, { color: "reset", visible: "reset" });
    ui.toggle.checked = false;
    ui.groups.querySelectorAll(".sw").forEach((s) => { s.style.background = "transparent"; });
    ui.groups.querySelectorAll(".legend").forEach((l) => { l.innerHTML = ""; });
    setStatus("Farger og synlighet er nullstilt.");
  }, "Kunne ikke nullstille");
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
  ui.rescan.addEventListener("click", scan);
  ui.resetColors.addEventListener("click", resetAll);
  await scan();
}

init();
