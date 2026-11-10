# TB Armering – Trimble Connect extension

Extension for 3D-visningen i Trimble Connect. Gir et sidepanel med én bryter som skjuler/viser all armering der egenskapen **109 Form = LM** (løpemeter).

## Installasjon i Trimble Connect
1. Åpne prosjektet → **Innstillinger** → **Extensions** (Apps & Capabilities) → **+ Add Custom**.
2. Lim inn manifest-URL:
   `https://totalbetong1234.github.io/tc-armering/manifest.json`
3. Åpne en modell i 3D-visningen. Ikonet «TB Armering» ligger i panelet til høyre.

## Bruk
- Panelet skanner lastede modeller automatisk og viser antall LM-objekter.
- Bryter **på** = LM skjult. Bryter **av** = LM synlig.
- Laster du inn flere modeller: trykk **Skann modellene på nytt**.
- Under **Innstillinger** kan egenskapsnavn og verdi endres (standard `109 Form` / `LM`).

## Data
All behandling skjer i nettleseren via Trimble Connect Workspace API. Ingen data sendes til andre servere.

## Versjon
v0.1.0 – første versjon (Total Betong).
