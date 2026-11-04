# Civios: slimme documentclassificatie en veilige opslag

Prototype voor het assessment *Developer Civios*.

| | |
|---|---|
| **Kandidaat** | Amer Ahmady |
| **Gekozen traject** | A: werkend prototype |
| **Werkelijk bestede tijd** | Ca. 10 uur, verspreid over 3 en 4 november 2026 |

## Wat waar staat

De in te leveren onderdelen (opdracht, punt 8) en waar ze te vinden zijn.

| In te leveren | Waar |
|---|---|
| Korte beschrijving van architectuur en gemaakte keuzes | hieronder onder *Architectuur en keuzes in het kort*; volledig in [ARCHITECTUUR.md](ARCHITECTUUR.md) (§1 uitgangspunten, §2 componenten, §5 technologiekeuzes met voor- en nadelen) |
| Overzicht van aannames, beperkingen en vervolgstappen | hieronder onder *Aannames, beperkingen en vervolgstappen*; motivering in ARCHITECTUUR.md §11 |
| Beschrijving van beveiliging, foutafhandeling en testaanpak | hieronder onder *Beveiliging, foutafhandeling en testaanpak in het kort*; volledig in ARCHITECTUUR.md §7, §6, §10 |
| Vermelding van gebruikte AI-hulpmiddelen | hieronder onder *Gebruik van AI-hulpmiddelen*; voor de twee lokale modellen de afhankelijkheden, privacyrisico's, kosten en fallback in ARCHITECTUUR.md §8 |
| Broncode en configuratiebestanden | `src/`, `public/`, `scripts/`, `package.json`, `tsconfig.json`, `.npmrc` (zie *Projectstructuur*) |
| API-contracten | *API* hieronder (leesbaar) en [`openapi.yaml`](openapi.yaml) (machineleesbaar); de betekenis van de velden in `/api/context.jsonld` |
| README met installatie-, start- en testinstructies | hieronder: *Installeren*, *Starten*, *Testen* |
| Geautomatiseerde tests voor de belangrijkste onderdelen | `tests/`, 131 tests; overzicht per bestand onder *Testen* |
| De zeven technische vragen (opdracht, punt 7) | [TECHNISCHE-VRAGEN.md](TECHNISCHE-VRAGEN.md) |
| Hoe met onduidelijkheid in de opdracht is omgegaan | ARCHITECTUUR.md §12 |
| Gekozen traject en bestede tijd (opdracht, punt 9) | de tabel bovenaan |
| Ook aanwezig, hoewel enkel traject B dat vraagt | architectuurschema (ARCHITECTUUR.md §2), API-contracten (*API* hieronder), datamodel (§4), de belangrijkste processen (§3), teststrategie met scenario's (§10) |

## In één oogopslag

**Het probleem.** Een lokaal bestuur ontvangt elke dag documenten die gaan van
een openbare brochure tot een medisch verslag. Wie dat per document met de hand
beoordeelt, maakt vroeg of laat een fout. En een gevoelig document dat op een
te open plek belandt, krijg je niet meer terug.

**De aanpak.** Elk document wordt bij binnenkomst gecontroleerd, automatisch
ingedeeld en volgens één centraal beleid opgeslagen: de juiste plek, de juiste
toegang, de juiste bewaartermijn. Elke beslissing is achteraf terug te vinden.

**Wat het oplevert.**
- **Ook scans en namen worden herkend.** Tekstherkenning op scans en een
  taalmodel voor namen draaien allebei lokaal: niets verlaat het bestuur.
- **Bij twijfel altijd streng.** Een onleesbare scan of een technische fout
  leidt naar de strengste categorie en menselijk nazicht, nooit naar publiek.
- **Mensen kijken enkel waar het nodig is.** Wat het systeem zeker weet, wordt
  automatisch afgehandeld; enkel twijfelgevallen gaan naar een medewerker.
- **Aantoonbaar.** Elke beslissing, elke inzage en elke geweigerde poging staat
  in een logboek dat niemand ongemerkt kan wijzigen of wissen: de databank
  weigert het, en een hash-ketting maakt elke omzeiling achteraf aantoonbaar.
- **Een mens beslist waar het systeem twijfelt.** Twijfelgevallen wachten
  veilig op een dossierbeheerder, die ze met motivering bevestigt of
  herclassificeert. Wie een document zelf aanbood, mag het niet zelf
  afhandelen.
- **Niets blijft langer dan nodig.** Na de bewaartermijn verdwijnen bestand en
  fiche automatisch; het auditspoor blijft.
- **Het logboek lekt zelf niets.** Gevonden persoonsgegevens worden gemaskeerd:
  het logboek bewijst *dat* er een rijksregisternummer stond, niet *welk*.
- **Alles blijft binnen.** Lokale opslag, geen cloud, geen externe diensten.

**Bouwstenen.** Validatie · classificatie · beleid · opslag · auditlog ·
aanmelding en autorisatie. Elk onderdeel heeft één taak en is los te vervangen.

**Uitgangspunten.** AVG (dataminimalisatie, beperkte bewaartermijnen),
*fail-closed* (bij twijfel dicht), *least privilege* (zo weinig rechten als
nodig).

**Status.** Werkend prototype met 131 geautomatiseerde tests, uitsluitend met
fictieve gegevens.

---

## Architectuur en keuzes in het kort

Een kleine webapplicatie in TypeScript op Node.js: een dunne Express-laag
(`web`) vertaalt HTTP naar aanroepen van een domeinlaag die zelf niets van HTTP
weet. Die domeinlaag bestaat uit zeven onderdelen met elk één taak: `domein`
(begrippen en validatie), `classificatie` (tekst lezen en signalen herkennen),
`beleid` (wat uit een classificatie volgt), `autorisatie` (wie ben je, wat mag
je), `opslag` (databank en bestanden), `audit` (het logboek) en `verwerking`,
de enige plek waar die onderdelen elkaar ontmoeten. Gegevens zitten in SQLite
(twee tabellen: documenten en auditlog) en in een afgeschermde map op schijf.

De belangrijkste keuzes, elk gemotiveerd in [ARCHITECTUUR.md](ARCHITECTUUR.md):

1. **Fail-closed.** Elke twijfel of storing leidt naar een voorzichtige
   categorie en menselijk nazicht, nooit naar publiek (§1, §6).
2. **Regels beslissen, modellen herkennen.** De classificatie volgt uit
   uitlegbare regels; getrainde modellen worden enkel gebruikt om letters in
   een scan en namen in een tekst te herkennen, allebei lokaal (§8).
3. **Beleid als gegevens.** Opslagmap, toegang en bewaartermijn per
   classificatie staan in één tabel met een versienummer, niet in code (§5).
4. **De server vertrouwt niets van de browser.** Niet het bestandstype, niet
   het voorstel, niet de rol: die volgen uit de inhoud, een herberekening en
   een ondertekend token (§3, §7).
5. **Het auditlog is bewijs.** Append-only met triggers én een hash-ketting,
   met gemaskeerde persoonsgegevens; het stuurt ook wie wat mag zien (§4, §7).
6. **Eenvoudig en lokaal.** SQLite en een map op schijf in plaats van servers
   of cloud, zodat het op elke laptop draait; de overstap naar PostgreSQL en
   objectopslag blijft beperkt tot twee klassen (§5, §9).

## Beveiliging, foutafhandeling en testaanpak in het kort

**Beveiliging.** Wie je bent, volgt uit een ondertekend token (JWT) dat de
server bij elke aanvraag controleert; zonder token ben je een burger met de
minste rechten, een vervalst of ingetrokken token geeft 401. Wat je mag, volgt
uit één beleidstabel die per niveau strenger wordt, tot enkel de
dossierbeheerder bij gevoelige persoonsgegevens. Invoer wordt niet vertrouwd:
bestandstype uit de extensie en gecontroleerd tegen de inhoud, grootte beperkt,
metadata begrensd, het voorstel op de server herberekend. Bestanden staan onder
een willekeurige naam buiten de webroot en zijn enkel via een gecontroleerd
endpoint op te vragen. Wachtwoorden bestaan enkel als scrypt-hash, aanmelden
blokkeert na vijf mislukte pogingen. Het auditlog is append-only (triggers) met
een hash-ketting, bevat enkel gemaskeerde persoonsgegevens, en elke toegang,
ook een geweigerde, staat erin. Volledig: ARCHITECTUUR.md §7.

**Foutafhandeling.** Twee soorten fouten, twee reacties. Verwachte fouten (een
verboden bestand, een ontbrekende motivering, een verkeerd wachtwoord) krijgen
een vaste code en een zin in gewone taal; onverwachte fouten gaan naar het
serverlog en de gebruiker krijgt een 500 zonder technische details. Wat
schrijft, schrijft in één transactie: faalt de registratie, dan verdwijnt ook
het bestand weer. En bij elke storing in de classificatie, de tekstherkenning
of de naamherkenning gaat de deur dicht: een voorzichtige categorie en
nazicht, nooit publiek. Alle scenario's staan in de tabel in ARCHITECTUUR.md
§6, en elk heeft een test.

**Testaanpak.** 131 geautomatiseerde tests (`npm test`) in drie lagen:
eenheidstests per onderdeel (detectoren met controlegetallen, beleid,
validatie, tokens), stroomtests op de volledige verwerking met een databank in
het geheugen, en tests op de echte API-endpoints. De foutscenario's zijn de
kern: elk vangnet wordt getest met een nagebootste storing (een falend model,
een databankfout, een vervalst token, een beheerder die de triggers omzeilt).
Daarnaast negen voorbeelddocumenten met verwachte uitkomst om handmatig na te
spelen. Volledig: ARCHITECTUUR.md §10.

## Hoe het werkt

1. Een medewerker biedt een document of scan aan, met metadata.
2. Het systeem controleert het bestand, leest de tekst (bij een scan met
   lokale tekstherkenning), zoekt gestructureerde gegevens met patronen en
   namen met een lokaal taalmodel, en classificeert het automatisch (publiek,
   intern, persoonsgegevens of gevoelige persoonsgegevens).
3. De medewerker **bekijkt het voorgestelde resultaat**: classificatie,
   motivering, opslaglocatie, toegangsrechten en bewaartermijn. Er is dan nog
   niets opgeslagen.
4. Na bevestiging wordt het document **volgens die classificatie opgeslagen**.
   De server berekent de classificatie daarbij opnieuw en neemt niets over van
   wat de browser toonde.
5. Elke beslissing is terug te vinden in een auditlog dat niet gewijzigd kan
   worden.
6. Wat het systeem niet zeker wist, staat **in nazicht**: een dossierbeheerder
   bevestigt of herclassificeert het, met motivering. Na de bewaartermijn
   worden bestand en fiche automatisch verwijderd; het auditspoor blijft.

De architectuur, de gemaakte keuzes en de integratie in een bestaand landschap
staan in **[ARCHITECTUUR.md](ARCHITECTUUR.md)**. De zeven technische vragen uit
de opdracht zijn kort en concreet beantwoord in
**[TECHNISCHE-VRAGEN.md](TECHNISCHE-VRAGEN.md)**.

---

## Installeren

**Vereist:** Node.js **22 of hoger** (de versie van `better-sqlite3` vereist dat).
Getest met Node 24.13.0 op Windows 11.

```bash
npm install
```

Dat werkt zonder compiler of bouwtools: het bestand `.npmrc` in het project zet
`ignore-scripts=true`. Achtergrond: `better-sqlite3` levert kant-en-klare
binaire bestanden mee, maar op een Windows-pc zonder de C++-bouwtools van
Visual Studio probeert npm het toch te compileren en faalt dan
(`gyp ERR! find VS ... missing any VC++ toolset`). Compileren is niet nodig,
dus die stap wordt overgeslagen. Ook `tesseract.js` en `@huggingface/transformers`
werken zo.

Controle dat de databank werkt:

```bash
node -e "new (require('better-sqlite3'))(':memory:'); console.log('ok')"
```

### Het taalmodel voor naamherkenning (eenmalig)

```bash
npm run model
```

Dit haalt het model voor naamherkenning (ca. 180 MB) één keer op en zet het in
`modellen/`. Daarna is er geen internet meer nodig. `npm run dev` voert dit
automatisch uit; staat het model er al, dan doet het niets, en lukt de download
niet, dan start de server toch, met een waarschuwing. Zonder model blijft alles
werken, maar gaat elk document zonder andere signalen naar nazicht (zie
*Bewuste beperkingen*). `npm test` downloadt niets: de tien tests die het
echte model nodig hebben, slaan zichzelf over zolang het ontbreekt.

## Starten

```bash
npm run dev
```

De server start meteen; de modellen voor tekst- en naamherkenning laden op de
achtergrond (enkele seconden, de console meldt wanneer ze klaar zijn).

Open daarna **http://localhost:3000**. Meld je aan met een testaccount, kies
een document en klik *Classificeren*: je ziet het voorgestelde resultaat met
motivering. Met *Opslaan volgens deze classificatie* sla je het op. Onder
**Beslissing terugvinden** bekijk je het auditspoor van een document (het
document-id wordt na het opladen automatisch ingevuld). Een medewerker ziet
enkel het spoor van documenten die hij zelf aanbood; een dossierbeheerder ziet
alles. Een geweigerde poging verschijnt zelf ook in het spoor. Als
dossierbeheerder zie je bovendien een sectie **Nazicht** met de documenten die
op een beslissing wachten.

### Testaccounts (fictief)

| Gebruikersnaam | Wachtwoord | Rol |
|---|---|---|
| `j.peeters` | `Demo-medewerker-2026` | medewerker |
| `m.claes` | `Demo-beheerder-2026` | dossierbeheerder |

Niet aangemeld ben je een *burger*: je ziet dan enkel de aanmelding en de
lijst van publieke documenten, en de API weigert elk aangeboden document
(`403`). De wachtwoorden staan enkel als scrypt-hash in de code. Deze accounts bestaan
alleen om het prototype te testen; in productie meld je aan via de
identiteitsprovider van het bestuur (zie ARCHITECTUUR.md, §7).

**Korte demo (8 minuten):**
1. Open http://localhost:3000: zonder aanmelding ben je burger en zie je
   enkel de lijst *Publieke documenten* (nog leeg) en de aanmelding. Wie de
   API rechtstreeks een document stuurt, krijgt `403` (zie de API-tests).
2. Meld aan als `j.peeters` (medewerker) en classificeer
   `05-gevoelig-medisch.txt` → het voorstel *gevoelige persoonsgegevens*, nog
   niet opgeslagen.
3. Klik *Opslaan volgens deze classificatie* → opgeslagen, met document-id.
4. Klik *Bekijk auditspoor* → `j.peeters` vindt de beslissing over zijn eigen
   document terug: geclassificeerd, opgeslagen, en zijn eigen inzage.
5. Meld af, meld aan als `m.claes` (dossierbeheerder), classificeer en bewaar
   `03-met-emailadres.txt`. Meld af, meld weer aan als `j.peeters` en bekijk
   het spoor van dat document-id → geweigerd: niet zijn document.
   Als `m.claes` zie je daarna het volledige spoor, inclusief die geweigerde
   poging.
6. Classificeer de scan `07-gescand-medisch-attest.png` met zichtbaarheid
   *publiek* → *gevoelige persoonsgegevens*: de tekstherkenning leest
   "medisch attest" en "behandelend arts" uit de afbeelding.
7. Classificeer **en bewaar** als `j.peeters` de scan `08-gescande-brochure.png`
   met zichtbaarheid *publiek* → *intern*, *in nazicht*: een scan wordt nooit
   automatisch publiek, want tekstherkenning kan zich vergissen.
8. Classificeer `09-met-naam-en-adres.txt` → *persoonsgegevens*: het
   taalmodel herkent de naam, en het adres wordt herkend aan straat en
   huisnummer. In het auditspoor staan beide gemaskeerd. Classificeer ook
   `01-publieke-brochure.txt`: het adres van het gemeentehuis erin telt niet
   als persoonsgegeven.
9. Meld aan als `m.claes` en klik *Toon documenten in nazicht*: de brochure
   uit stap 7 staat erin. Klik *Bekijk bestand* om de scan zelf te zien (die
   inzage komt in het auditlog). Kies *Publiek*, typ een motivering en sla op → het
   document is definitief, verhuist naar de publieke map en het spoor toont
   de beslissing mét motivering. (Had `m.claes` de scan zelf aangeboden, dan
   was dit geweigerd: vier ogen.)
10. Meld af. Als burger staat de brochure nu in *Publieke documenten* en kan
    je ze openen; het medisch attest uit stap 2 staat er niet. Meld aan als
    `j.peeters`, vul het document-id van stap 3 in en klik *Bekijk bestand*
    → geweigerd: een medewerker ziet geen gevoelige documenten. Als `m.claes`
    wel.

| Omgevingsvariabele | Standaard | Betekenis |
|---|---|---|
| `POORT` | `3000` | Poort van de webserver |
| `DATABANK` | `./data/civios.db` | Pad naar de SQLite-databank |
| `OPSLAGWORTEL` | `./opslag-test` | Afgeschermde map waarin documenten bewaard worden |
| `TOKENGEHEIM` | willekeurig bij elke start | Geheim waarmee aanmeldtokens ondertekend worden. Niet ingesteld: na een herstart moet iedereen opnieuw aanmelden |

Alle opslag is lokaal. Er wordt niets naar een externe dienst of cloud gestuurd.

## Testen

```bash
npm test          # 131 geautomatiseerde tests
npm run typecheck # TypeScript-controle zonder te bouwen
```

| Testbestand | Aantal | Wat wordt gecontroleerd |
|---|---|---|
| `classificatie.test.ts` | 33 | Herkenning van e-mail, rijksregisternummer (controlegetal), adres (geen valse treffers bij gewone zinnen, eigen adressen van het bestuur uitgezonderd), IBAN, trefwoorden; een korte leesbare tekst wordt gewoon beoordeeld, een korte scan niet; strengste classificatie wint; signalen van het taalmodel tellen mee; zonder taalmodel nooit publiek; veilige terugval bij te weinig tekst of een fout; geen technische details naar buiten; tekstherkenning: betrouwbare tekst gebruikt, onbetrouwbare weggegooid, falende herkenning valt veilig terug, een scan nooit publiek |
| `ner.test.ts` | 9 | Naamherkenning: stukjes samenvoegen tot één naam, persoon → naam, plaats + huisnummer → adres, falend model stopt de verwerking niet; met het echte model: een naam zonder aanspreking, een adres zonder vast achtervoegsel, geen valse treffers op instellingen of functies |
| `verwerking.test.ts` | 15 | De volledige stroom van aanbieden tot opslaan; echte tekstherkenning op de voorbeeldscans; een PDF of scan nooit publiek; een voorstel slaat niets op; alles-of-niets-registratie; auditlog onwijzigbaar; geen persoonsgegevens in het auditlog; veilige bestandsnamen |
| `validatie.test.ts` | 13 | Leeg, te groot, extensie niet op de witte lijst, type uit de extensie (niet uit de browser), inhoud die niet bij het type past (ook vermomde PDF's en afbeeldingen), ongeldige metadata |
| `api.test.ts` | 27 | De echte endpoints: het OpenAPI-contract dekt elk endpoint, elk documentveld heeft een betekenis in de JSON-LD-context, voorstel zonder opslag, aanmelden, blokkering na te veel pogingen (429), afmelden trekt het token in, een zelfgekozen rol in een header wordt genegeerd, een vervalst token geeft 401, statuscodes, rolcontrole, geen lek van het opslagpad, een medewerker vindt zijn eigen beslissing terug maar niet die van een ander, nazicht enkel voor een dossierbeheerder, integriteit van het auditlog, de publieke lijst toont een burger enkel wat definitief publiek is |
| `nazicht.test.ts` | 13 | Nazicht: bevestigen, herclassificeren (bestand verhuist, toegang en bewaartermijn volgen), geweigerd zonder motivering, voor een medewerker, voor de aanbieder zelf (vier ogen), voor een document dat niet in nazicht staat; opruiming na de bewaartermijn bewaart het auditspoor; de hash-ketting wijst een gewijzigde of gewiste regel aan, ook als de triggers omzeild zijn |
| `autorisatie.test.ts` | 14 | Tokens (geldig, vervalste rol, ander geheim, verlopen), wachtwoordcontrole, identiteit met veilige standaard, toegangsbeslissingen |
| `beleid.test.ts` | 7 | Elke classificatie heeft een regel; enkel publiek is publiek; toegang wordt per niveau strenger (beperkt vs. minimaal); bewaartermijnen |

### Handmatig testen met de voorbeelddocumenten

In `voorbeelddocumenten/` staan negen fictieve bestanden:

| Bestand | Verwachte classificatie | Reden |
|---|---|---|
| `01-publieke-brochure.txt` | publiek (of intern als je "intern" kiest) | Geen persoonsgegevens; de voorgestelde zichtbaarheid beslist |
| `02-interne-nota.txt` | intern (of publiek als je "publiek" kiest) | Idem |
| `03-met-emailadres.txt` | persoonsgegevens | E-mailadres |
| `04-met-rijksregisternummer.txt` | persoonsgegevens | Rijksregisternummer met geldig controlegetal |
| `05-gevoelig-medisch.txt` | gevoelige persoonsgegevens | Medische trefwoorden |
| `06-onleesbaar-leeg.txt` | gevoelige persoonsgegevens, **in nazicht** | Te weinig leesbare tekst: veilige terugval |
| `07-gescand-medisch-attest.png` | gevoelige persoonsgegevens | Scan; tekstherkenning leest medische trefwoorden en het taalmodel een naam |
| `08-gescande-brochure.png` | intern, **in nazicht** | Scan zonder persoonsgegevens; een scan wordt nooit automatisch publiek, ook niet als je "publiek" kiest |
| `09-met-naam-en-adres.txt` | persoonsgegevens | Een naam (taalmodel) en een adres (straat + huisnummer) |

Alle persoonsgegevens in voorbeelden en tests zijn verzonnen.

---

## API

Alle antwoorden zijn JSON. Fouten hebben altijd dezelfde vorm:

```json
{ "fout": "bestandstype_niet_toegestaan", "boodschap": "Dit bestandstype wordt niet aanvaard. Toegestaan zijn: .txt, .md, .pdf, .jpg, .jpeg, .png." }
```

`fout` is een vaste code voor programma's; `boodschap` is een zin in gewone taal
voor de gebruiker.

**Identiteit:** meld aan via `POST /api/aanmelden` en stuur het token daarna mee
in elke aanvraag:

```
Authorization: Bearer <token>
```

Zonder token ben je een anonieme `burger`, de minst bevoegde rol. Een vervalst
of verlopen token geeft **401** `aanmelding_ongeldig`. Gebruiker en rol komen
altijd uit het ondertekende token, nooit uit iets wat de browser zelf beweert.

### `POST /api/aanmelden`: aanmelden

Body (JSON): `{ "gebruikersnaam": "j.peeters", "wachtwoord": "…" }`

Antwoord **200**:

```json
{ "token": "eyJhbGciOi…", "gebruiker": "j.peeters", "rol": "medewerker", "geldigTot": "2026-11-04T01:00:00.000Z" }
```

Het token blijft 8 uur (één werkdag) geldig. **401** `aanmelding_mislukt` bij een
fout wachtwoord of onbekende gebruiker, met dezelfde boodschap in beide gevallen.
Na 5 mislukte pogingen voor dezelfde gebruikersnaam vanaf hetzelfde adres:
**429** `te_veel_pogingen` met een `Retry-After`-header, 15 minuten lang.
Elke aanmelding, geslaagd of mislukt, komt in het auditlog.

### `POST /api/afmelden`: het token intrekken

Met een geldig token. Trekt dat token in, ook al is het nog niet verlopen:
daarna geeft elke aanvraag ermee **401**. Antwoord **204**.

### `POST /api/classificaties`: voorgesteld resultaat bekijken

Classificeert een document en toont wat er mee zou gebeuren, **zonder iets op
te slaan**: het bestand blijft in het geheugen en verdwijnt na het antwoord.
Zelfde velden, rechten en foutcodes als `POST /api/documenten` hieronder.

Antwoord **200**: hetzelfde als hieronder, maar zonder `documentId`.

### `POST /api/documenten`: opslaan volgens de classificatie

Aangemeld als `medewerker` of `dossierbeheerder`. Body: `multipart/form-data`.
De server classificeert opnieuw en neemt niets over van een eerder voorstel,
zodat een aangepast voorstel in de browser geen effect heeft.

| Veld | Verplicht | Regels |
|---|---|---|
| `bestand` | ja | `.txt`, `.md`, `.pdf`, `.jpg`/`.jpeg` of `.png`, max. 10 MB. Het type wordt uit de extensie afgeleid (niet uit wat de browser opgeeft) en de inhoud moet erbij passen |
| `titel` | nee | max. 200 tekens; leeg = bestandsnaam |
| `bron` | nee | max. 100 tekens; leeg = `onbekend` |
| `beoogdeZichtbaarheid` | nee | `publiek` of `intern` (standaard `intern`) |

Antwoord **201**:

```json
{
  "documentId": "4a98d873-…",
  "classificatie": "persoonsgegevens",
  "zekerheid": "zeker",
  "motivering": "Op basis van 1 signaal/signalen (emailadres) is …",
  "signalen": [{ "type": "emailadres", "impliceert": "persoonsgegevens", "bewijs": "ja********************be", "aantal": 1 }],
  "status": "definitief_opgeslagen",
  "opslagmap": "persoonsgegevens",
  "toegang": ["medewerker", "dossierbeheerder"],
  "bewarenTot": "2031-11-02T…Z",
  "beleidsversie": "2026-11-03.1"
}
```

`status` is `in_nazicht` wanneer de classificatie onzeker was.

| Code | `fout` | Wanneer |
|---|---|---|
| 400 | `geen_bestand` | Geen bestand meegestuurd |
| 401 | `aanmelding_ongeldig` | Vervalst of verlopen token (geldt voor alle endpoints hieronder) |
| 403 | `geen_rechten` | Niet aangemeld, of rol mag niet aanbieden |
| 413 | `bestand_te_groot` | Groter dan 10 MB (afgekapt tijdens het uploaden) |
| 422 | `bestand_leeg`, `bestandstype_niet_toegestaan`, `inhoud_past_niet_bij_type`, `metadata_ongeldig` | Validatie geweigerd |
| 500 | `interne_fout` | Onverwachte fout, zonder technische details |

### `GET /api/documenten/:id`: beslissing terugvinden

Geeft de metadata en de beslissing terug (zonder intern opslagpad, mét
`@context`, zie onderaan), als de rol toegang heeft tot die classificatie. Elke toegangsbeslissing (verleend of
geweigerd) wordt gelogd.
**200** · **403** `geen_rechten` · **404** `niet_gevonden`.

### `GET /api/documenten/:id/bestand`: het bestand zelf

Zelfde toegangsregels. **200** (bestand) · **403** · **404** · **500**
`bestand_niet_beschikbaar`.

### `GET /api/auditlog[?documentId=…]`: auditspoor

Zonder `documentId` de laatste 50 regels (nieuwste eerst), enkel voor een
`dossierbeheerder`. Met `documentId` het volledige spoor van dat document
(oudste eerst): voor een `dossierbeheerder` altijd, voor een `medewerker` enkel
als hij het document zelf aanbood. Zo kan de gebruiker de genomen beslissing
terugvinden zonder het hele auditlog te zien. Elke inzage, ook een geweigerde,
wordt zelf gelogd.
**200** · **403** `geen_rechten`.

### `GET /api/auditlog/integriteit`: is het auditlog ongeschonden?

Aangemeld als `dossierbeheerder`. Rekent de hash-ketting van het hele auditlog
na: `{ "intact": true, "aantalRegels": 128 }`, of bij manipulatie
`{ "intact": false, "aantalRegels": 128, "eersteBreuk": 42 }` met het nummer
van de eerste regel die niet meer klopt.

### `GET /api/publiek`: wat iedereen mag zien

Zonder aanmelding. Lijst van documenten die definitief als `publiek` zijn
ingeschaald, nieuwste eerst. Wat in nazicht staat, komt er nooit in. Het
bestand zelf haal je op via `GET /api/documenten/:id/bestand`; voor een
publiek document mag dat ook als burger. **200**.

### `GET /api/nazicht`: documenten die op een beslissing wachten

Aangemeld als `dossierbeheerder`. Lijst van documenten met status
`in_nazicht` (zonder intern opslagpad), oudste eerst. **200** · **403**.

### `POST /api/documenten/:id/nazicht`: nazicht afhandelen

Aangemeld als `dossierbeheerder`. Body (JSON):

```json
{ "beslissing": "herclassificeren", "classificatie": "intern", "motivering": "Scan nagekeken: interne nota zonder persoonsgegevens." }
```

`beslissing` is `bevestigen` (de voorlopige classificatie klopt; `classificatie`
mag weg) of `herclassificeren`. Een motivering van minstens 10 tekens is
verplicht en komt in het auditlog. Bij herclassificeren verhuist het bestand
naar de map van de nieuwe classificatie, en volgen toegang en bewaartermijn uit
het beleid. Het document wordt `definitief_opgeslagen`.

Antwoord **200**: `{ "uitkomst": "afgehandeld", "documentId": "…", "classificatie": "intern", "opslagmap": "intern" }`

| Code | `fout` | Wanneer |
|---|---|---|
| 400 | `beslissing_ongeldig` | `beslissing` is niet `bevestigen` of `herclassificeren` |
| 403 | `geen_rechten` | Geen dossierbeheerder (gelogd) |
| 404 | `niet_gevonden` | Onbekend document |
| 422 | `niet_in_nazicht`, `motivering_ontbreekt`, `classificatie_ongeldig`, `vier_ogen` | Geweigerd en gelogd. `vier_ogen`: wie het document zelf aanbood, mag het niet zelf afhandelen |

### `GET /api/beleid`: geldende regels

Publiek. Geeft de beleidsversie en per classificatie opslagmap, toegang,
bewaartermijn en of het document publiek ontsloten mag worden.

### `GET /api/openapi.yaml`: het contract, machineleesbaar

Publiek. Dezelfde contracten als hierboven, als **OpenAPI 3.1**
([`openapi.yaml`](openapi.yaml)), zodat een koppelend systeem ze automatisch
kan valideren of er een client uit kan genereren.

### `GET /api/context.jsonld`: de betekenis van de velden

Publiek. Een **JSON-LD-context** die elk veld van een document koppelt aan een
term uit een open vocabularium (Dublin Core, DCAT, PROV): `titel` is
`dct:title`, `classificatie` is `dct:accessRights`, `sha256` is
`spdx:checksum`. Het antwoord van `GET /api/documenten/:id` verwijst ernaar
met `"@context"`. Wie het als gewone JSON leest, merkt niets; wie het als
linked data leest, krijgt de betekenis erbij. Dat is het principe achter OSLO
en DCAT-AP: geen eigen sleutelnamen zonder ze te mappen.

---

## Projectstructuur

```
src/
  domein/          begrippen (classificaties, signalen) en validatie van bestand en metadata
  classificatie/   tekst uit het bestand halen (ocr.ts voor scans), signalen herkennen
                   (signalen.ts: patronen; ner.ts: taalmodel voor namen), classificatie bepalen
  beleid/          classificatie → opslagmap, toegang, bewaartermijn (als gegevens)
  autorisatie/     aanmelden, tokens ondertekenen en controleren, blokkering en intrekking (sessies.ts), toegang beoordelen
  opslag/          SQLite-schema en -verbinding, documentregister, fysieke bestandsopslag
  audit/           append-only auditlog
  verwerking/      de enige plek waar alle onderdelen samenkomen: verwerkDocument.ts (aanbieden
                   tot opslaan), nazicht.ts (menselijke beslissing), opruiming.ts (bewaartermijn)
  web/             app.ts (endpoints), context.ts (JSON-LD-context) en server.ts (opstarten)
openapi.yaml       het API-contract (OpenAPI 3.1), ook te bereiken via /api/openapi.yaml
public/            eenvoudige webpagina
scripts/           eenmalig ophalen van het taalmodel (npm run model)
modellen/          het lokale taalmodel (niet in de repository, ca. 180 MB)
tests/             geautomatiseerde tests
voorbeelddocumenten/  fictieve testbestanden
```

## Aannames, beperkingen en vervolgstappen

Kort overzicht; de motivering staat in ARCHITECTUUR.md.

**Aannames**
- Documenten komen binnen via een medewerker, niet rechtstreeks van een burger.
- Bewaartermijnen en rollen zijn fictief en configureerbaar; in een echt bestuur
  komen ze uit de selectielijst en het identiteitsbeheer. De fictieve termijnen
  (10, 7, 5 en 3 jaar) volgen dataminimalisatie: hoe gevoeliger, hoe korter;
  publieke informatie heeft archiefwaarde en blijft het langst.
- De classificatie volgt de tabel uit de opdracht, ook waar die strenger is dan
  de AVG (financiële gegevens tellen als gevoelig).

**Bewuste beperkingen**
- Aanmelden gebeurt met twee vaste testaccounts, niet via de identiteitsprovider
  van een bestuur. De blokkering na te veel pogingen en de lijst van ingetrokken
  tokens leven in het geheugen van dit ene proces; bij een herstart of met
  meerdere servers moet dat naar de identiteitsprovider of een gedeelde opslag.
- Scans (`.jpg`, `.png`) worden gelezen met lokale tekstherkenning (Tesseract,
  Nederlands). Bij een slechte scan (betrouwbaarheid onder 70%) of een fout
  volgt de veilige terugval: *gevoelig, in nazicht*. Een gescande PDF wordt
  niet gelezen en gaat altijd naar *gevoelig, in nazicht*.
- Tekstherkenning kan een woord verkeerd lezen en zo een signaal missen. Daarom
  wordt een scan zonder herkende gegevens nooit automatisch publiek, maar
  *intern* met nazicht.
- Het voorstel en het opslaan zijn twee aparte aanvragen; het bestand wordt
  daarom twee keer verstuurd. Bewust: zo wordt er tussen de twee stappen niets
  tijdelijk bewaard.
- De classificatiebeslissing zelf is regelgebaseerd en uitlegbaar; enkel het
  *herkennen* gebruikt getrainde modellen (tekstherkenning op scans,
  naamherkenning in tekst), allebei lokaal. Het naammodel is meertalig en
  herkent gedrukte namen goed, maar kan een ongewone naam missen of een
  productnaam als persoon zien. Daarom: is het model niet beschikbaar, dan
  gaat een document zonder andere signalen naar nazicht en wordt het nooit
  publiek. Een adres telt enkel als een plaatsnaam gevolgd wordt door een
  huisnummer; de adressen van het bestuur zelf staan op een uitzonderingslijst
  (`EIGEN_ADRESSEN` in `signalen.ts`, fictief) en tellen niet mee.
- Met twee testaccounts kan de dossierbeheerder een document dat hij zelf
  aanbood niet afhandelen (vier ogen). In een echt bestuur zijn er meerdere
  dossierbeheerders.
- De opruiming na de bewaartermijn draait bij het opstarten en daarna elke 24
  uur binnen het serverproces; in productie is dat een geplande taak van het
  platform (cron).
- Geen virusscan, geen versleuteling van bestanden op schijf.
- De server praat gewoon HTTP, zonder TLS: voor een lokale demo volstaat dat.
  In productie staat hij achter de reverse proxy of API-gateway van het
  bestuur, die TLS, rate limiting en een strikte Content-Security-Policy
  afdwingt. De basisheaders (geen MIME sniffing, geen framing, geen Referer,
  geen caching) zet de applicatie zelf.

**Vervolgstappen**
- De testaanmelding vervangen door de identiteitsprovider van het bestuur
  (OpenID Connect); de tokencontrole blijft hetzelfde principe.
- PDF-tekstextractie (ook voor gescande PDF's) toevoegen in
  `src/classificatie/tekstextractie.ts`.
- PostgreSQL en afgeschermde objectopslag in plaats van SQLite en lokale mappen.
- Versleuteling van de opslag, virusscan bij het aanbieden.
- Het auditlog doorsturen naar het logplatform van het bestuur (SIEM), zodat
  ook een databankbeheerder er niet meer aan kan.

## Gebruik van AI-hulpmiddelen

**Hulpmiddel:** Claude Code (Anthropic).

**Hoe gebruikt.** De code, de tests en deze documentatie zijn met Claude Code
geschreven. Mijn werk zat in het sturen en het beslissen: de opdracht en de
beoordelingsmatrix als maatstaf opleggen, de oplossing herhaaldelijk kritisch
laten toetsen (tegen de opdracht, als beoordelaar, als aanvaller), bepalen
welke voorstellen wel en niet doorgingen, en het resultaat controleren door de
tests te draaien en de applicatie met de voorbeelddocumenten uit te proberen.

**Waarvoor AI gebruikt werd.** Het opzetten van de architectuur, de code, de
tests en de documentatie; het oplossen van de installatiefout van
`better-sqlite3` op Windows; het opsporen en wegwerken van zwakke plekken in
opeenvolgende rondes (veilige terugval voor PDF's, registratie als één
transactie, geen technische details in foutmeldingen, inhoudscontrole van
bestanden, nazicht met vier ogen, opruiming na de bewaartermijn, hash-ketting
in het auditlog, blokkering na te veel aanmeldpogingen, intrekken van tokens,
beveiligingsheaders); en het strakker maken van de code zonder functionaliteit
te verliezen (`app.ts` van 579 naar 380 regels, één `api()`-functie op de
webpagina).

**Drie beslissingen waarin ik tegen het AI-advies in ging.** Dat vermeld ik
omdat het laat zien waar de keuzes vandaan komen.
1. **Een echte aanmelding.** Het advies was om de rol uit een header te laten
   komen en geen aanmelding te bouwen, omdat koppelen met een
   identiteitsprovider buiten de opdracht valt. Ik vond het onaanvaardbaar dat
   iedereen zich zo als dossierbeheerder kon voordoen. De aanmelding is gebouwd
   in de vorm die ook in productie geldt: een ondertekend token dat de server
   bij elke aanvraag controleert, zodat later enkel de uitgever verandert.
2. **Scans echt lezen.** Het advies was om scans altijd naar nazicht te sturen.
   Dan belandt elke scan in de strengste categorie en levert automatische
   classificatie voor scans niets op. Daarom lokale tekstherkenning, met een
   drempel en een fallback die het systeem nooit milder maakt.
3. **Namen met een taalmodel.** De eerste versie herkende een naam enkel na
   "de heer" of "mevrouw". Dat is te beperkt voor echte documenten. Daarom een
   lokaal NER-model, terwijl gestructureerde gegevens (e-mail,
   rijksregisternummer, IBAN) bewust patronen met controlegetallen blijven:
   exact en uitlegbaar.

**Bewust niet overgenomen of niet gedaan:**
- **Publiceren op een openbare cloud (Vercel)** voor gebruiksgemak: dat was
  mijn eigen idee, maar het botst met de randvoorwaarde *"uitsluitend lokale of
  afgeschermde testopslag"*. Ook met aanmelding zou een publieke link met vaste
  testaccounts voor iedereen bereikbaar zijn.
- **Koppeling met een echte identiteitsprovider (OpenID Connect):** buiten de
  scope; de testaanmelding in `src/autorisatie/aanmelding.ts` speelt die rol.
- **Versienummering van de API (`/api/v1`):** weinig meerwaarde voor één
  prototype met één klant.
- **De wijziging uit punt 10 (gevoelige documenten nooit automatisch
  definitief) vooraf bouwen.** De afhandeling van nazicht door een
  dossierbeheerder bestaat wel, omdat een twijfelgeval anders nooit afgerond
  raakt. De regel uit punt 10 zelf, en hoe die niet te omzeilen valt, wil ik
  tijdens de verdediging uitwerken en toelichten.
- **Controle van de bestandsinhoud alleen documenteren:** eerst voorgesteld als
  vervolgstap, uiteindelijk toch ingebouwd omdat het weinig code vraagt.

**Mijn verantwoordelijkheid.** De juistheid, veiligheid en begrijpelijkheid
van deze oplossing zijn mijn verantwoordelijkheid; elke keuze licht ik toe
tijdens de verdediging.
