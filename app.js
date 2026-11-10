// TB Armering – Trimble Connect 3D-viewer extension
// Skjuler/viser objekter der egenskapen "109 Form" = "LM" (løpemeter).
// All behandling skjer i nettleseren. Ingen data sendes ut av Trimble Connect.

const BATCH = 500; // antall objekter per getObjectProperties-kall

const el = (id) => document.getElementById(id);
const ui = {
  toggle: el("toggleLm"),
  count: el("count"),
  rescan: el("rescan"),
  status: el("status"),
  propName: el("propName"),
  propValue: el("propValue"),
};

let api = null;
let lmObjects = null; // [{ modelId, objectRuntimeIds: [...] }]
let scanning = false;

function setStatus(text, isError = false) {
  ui.status.textContent = text;
  ui.status.classList.toggle("error", isError);
}

function norm(v) {
  return String(v ?? "").trim().toLowerCase();
}

// Egenskapsnavn sammenlignes uten mellomrom/understrek/punktum,
// slik at "109 Form", "109_Form" og "109.Form" regnes som like.
function normName(v) {
  return norm(v).replace(/[\s_.\-]/g, "");
}

// Sjekker om et objekt har ønsket egenskap/verdi i ett av sine egenskapssett.
function matches(objProps, name, value) {
  for (const pset of objProps.properties || []) {
    for (const p of pset.properties || []) {
      if (normName(p.name) === name && norm(p.value) === value) return true;
    }
  }
  return false;
}

async function scan() {
  if (scanning) return;
  scanning = true;
  ui.toggle.disabled = true;
  ui.rescan.disabled = true;

  const name = normName(ui.propName.value);
  const value = norm(ui.propValue.value);

  try {
    setStatus("Henter objekter fra modellene …");
    const modelObjects = await api.viewer.getObjects();
    const result = [];
    let total = 0;
    let found = 0;

    for (const mo of modelObjects || []) {
      const ids = (mo.objects || []).map((o) => o.id);
      total += ids.length;
      const hits = [];
      for (let i = 0; i < ids.length; i += BATCH) {
        const chunk = ids.slice(i, i + BATCH);
        setStatus(`Leser egenskaper … ${Math.min(i + BATCH, ids.length)} / ${ids.length} objekter`);
        const props = await api.viewer.getObjectProperties(mo.modelId, chunk);
        for (const op of props || []) {
          if (matches(op, name, value)) hits.push(op.id);
        }
      }
      if (hits.length) result.push({ modelId: mo.modelId, objectRuntimeIds: hits });
      found += hits.length;
    }

    lmObjects = result;
    ui.count.textContent = `${found} LM-objekter funnet (av ${total})`;
    setStatus(found ? "Klar." : `Fant ingen objekter med «${ui.propName.value}» = «${ui.propValue.value}».`);
    ui.toggle.checked = false;
    ui.toggle.disabled = found === 0;
  } catch (err) {
    console.error(err);
    setStatus("Feil ved skanning: " + (err?.message || err), true);
  } finally {
    scanning = false;
    ui.rescan.disabled = false;
  }
}

async function applyVisibility(hide) {
  if (!lmObjects || !lmObjects.length) return;
  try {
    await api.viewer.setObjectState(
      { modelObjectIds: lmObjects },
      { visible: !hide }
    );
    setStatus(hide ? "LM er skjult." : "LM er synlig.");
  } catch (err) {
    console.error(err);
    setStatus("Kunne ikke endre synlighet: " + (err?.message || err), true);
    ui.toggle.checked = !hide;
  }
}

function onEvent(event, args) {
  // Ny modell lastet/fjernet → gammel liste er ikke lenger gyldig.
  if (/model/i.test(event) && !/selection/i.test(event)) {
    lmObjects = null;
    ui.toggle.checked = false;
    ui.toggle.disabled = true;
    ui.count.textContent = "Modellene er endret – skann på nytt";
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
  ui.toggle.addEventListener("change", () => applyVisibility(ui.toggle.checked));
  ui.rescan.addEventListener("click", scan);
  await scan();
}

init();
