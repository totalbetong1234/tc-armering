# TB Armering – Trimble Connect extension

Extension for 3D-visningen i Trimble Connect (Total Betong).

## Installasjon i Trimble Connect
1. Åpne prosjektet → **Innstillinger** → **Extensions** (Apps & Capabilities) → **+ Add Custom**.
2. Lim inn manifest-URL:
   `https://totalbetong1234.github.io/tc-armering/manifest.json`
3. Åpne en modell i 3D-visningen. Ikonet «TB Armering» ligger i panelet til høyre.

## Funksjoner
**Løpemeter (LM)** – én bryter som skjuler/viser all armering med form = LM.
Egenskaper som sjekkes: `109 Form`, `17 Formkode`, `Form armering`.

**Etiketter (Product name)** – marker jern i modellen og trykk **Stamp label**: én etikett per Product name.
- Etiketten settes på jernet nærmest midten av gruppen; streken starter et tilfeldig sted mellom 1/5 og 4/5 av jernet, teksten løftes 1,5–2,4 m opp (og litt til høyre). Etikettene sorteres fra venstre mot høyre i visningen, og naboer får ulike høyder så de ikke dekker hverandre.
- Teksten får en mørkere variant av jernets farge for bedre lesbarhet. (Trimble har ingen tekstboks/bakgrunn for markeringer.)
- Etiketten får samme farge som jernet: pos.nr-farge hvis «Farge per pos.nr» er brukt, ellers modellens farge (brun som standard).
- **Fjern etiketter** fjerner bare panelets etiketter (andre markeringer røres ikke).
- Maks 150 etiketter. Laveste og høyeste etiketthøyde kan endres under Innstillinger (standard 1500 og 2400 mm).

**Konstruksjonsdeler** – nedtrekk basert på `10 Konstruksjonsdel`, gruppert etter **prefiks** (bokstavene foran tallet):

| Gruppe | Prefiks | Eksempel |
|---|---|---|
| Bunnplate | A, B | A1, B1 (+B100) |
| Fundamenter | F, KR, S | F1 (+F100), KR1, S1 |
| Heis | H | H1, H2, H3, H4 … |
| Kran | K | K1, K2, K3 … |
| Yttervegger → Vegg Øst / Sør / Vest | YE / YS / YV | YE1 (+YE100) … |
| Yttervegger → Vegg Nord | YN, U | YN1 (+YN100), U1 |
| Innervegger → Innervegg | V, W | V1, V2, V5, W2 … |
| Innervegger → Vegg rampe | VR | VR1 (+VR100) |
| Comax | «--» + navn Skjøtejernskassett | innstøpningsgods |
| Annet | øvrige prefiks + øvrig «--» | T1, armeringsnett, OS til prefabsøyle |

Regler:
- 100, 200, 300 … slås sammen med 1, 2, 3 … (YE100 = YE1, YE200 = YE2).
- **Innstøpningsgods** (konstruksjonsdel «--») er alltid synlig: skjules ikke av LM-bryteren eller Isoler, og blir lys grå ved fargelegging.
- **Farge per pos.nr**: øvrig armering beholder sin farge.
- **Isoler**: viser bare gruppen + innstøpningsgods (betong skjules).
- Nye nummer (YV2, V6, K3 …) havner automatisk i riktig gruppe.
- Har en gruppe flere koder, får hver kode sin egen undergruppe.

Når en gruppe åpnes vises all armering i gruppen per **Product name** (antall og pos.nr). Velg / Isoler / Farge finnes også på overordnede grupper (f.eks. hele Yttervegger).
- Klikk på en rad → velger og zoomer til de objektene.
- **Ctrl+klikk** → legg til / fjern rad (også på tvers av grupper). **Shift+klikk** → velg alle rader mellom forrige og denne i samme liste. Valgte rader markeres blått. Zoom skjer bare ved vanlig klikk.
- **Velg** / **Isoler** – hele gruppen.
- **Farge per pos.nr** – fargelegger gruppen etter `11 PosNr`, med fargeforklaring.
- **Nullstill** – fjerner farger og viser alt igjen.

Egenskapsnavn kan endres under **Innstillinger**. Gruppene endres i toppen av `app.js` (`GROUPS`).

## Data
All behandling skjer i nettleseren via Trimble Connect Workspace API. Ingen data sendes til andre servere.

## Språk
Knappene **NO / ENG / PL** øverst bytter språk på alle tekster i panelet (knapper, gruppenavn, hjelpetekster og meldinger). Valget huskes i nettleseren.
Data fra modellen (Product name, koder som YE1/B100, pos.nr, egenskapsnavn) oversettes ikke. Tekstene ligger i `i18n.js` – rett eller legg til språk der.

## Versjoner
- v1.0.0 – språkvalg NO / ENG / PL (ny fil `i18n.js`).
- v0.9.0 – etiketter spres: trinnvise høyder (standard 1,5–2,4 m, naboer får ulike nivåer), startpunkt tilfeldig mellom 1/5 og 4/5 av jernet, mørkere tekstfarge for bedre kontrast.
- v0.8.0 – flervalg i Product name-listen (Ctrl/Shift), valgte rader markeres.
- v0.7.0 – «Stamp label»-knapp i stedet for bryter (ingen flimring), høyde 2 m, etikett i jernets farge.
- v0.6.0 – etiketter med Product name, én per gruppe på valgte jern.
- v0.5.1 – Isoler bruker Trimbles «Vis bare valgte objekter».
- v0.5.0 – Isoler rettet (skjulte alt), Comax/armeringsnett fanges opp, U → Vegg Nord, W → Innervegg, fargeforklaring fjernet, «Velg» for LM, info-knapp.
- v0.4.0 – Heis (H), Comax (Skjøtejernskassett), Annet, innstøpningsgods alltid synlig / lys grå, betong utelates fra gruppene.
- v0.3.0 – gruppering etter prefiks (A/B, F/KR/S, K, U, YE/YN/YS/YV, V, VR), 100 = 1, «Andre» og «Uten konstruksjonsdel».
- v0.2.0 – konstruksjonsdeler, Product name-liste, farge per pos.nr, nytt ikon, flere LM-egenskaper.
- v0.1.0 – LM-bryter.
