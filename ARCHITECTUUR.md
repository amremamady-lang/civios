# Architectuur en gemaakte keuzes

Dit document legt uit hoe de oplossing is opgebouwd, waarom zo, wat er bewust
niet is uitgewerkt, en hoe ze in het bestaande landschap van een lokaal bestuur
past. Installatie, API-contracten en tests staan in [README.md](README.md).

**Leeswijzer bij de zeven technische vragen uit de opdracht** (de korte
antwoorden staan gebundeld in [TECHNISCHE-VRAGEN.md](TECHNISCHE-VRAGEN.md))

| Vraag | Waar |
|---|---|
| Welke componenten, met welke verantwoordelijkheid | §2 |
| Hoe documenten, metadata en classificatieresultaten stromen | §3 |
| Welke API's en integratiepunten, en hun contracten | README (*API*) en §9 |
| Validatie, foutafhandeling, autorisatie, auditlogging | §3 (stap 2), §6, §7, §4 |
| Veilig gedrag als classificatie niet kan of onzeker is | §1, §6, §8 |
| Integratie in een bestaande architectuur | §9 |
| Wat bewust niet is uitgewerkt, en waarom | §11 en README (*Bewuste beperkingen*) |
| Hoe met onduidelijkheid in de opdracht is omgegaan | §12 |

## 1. Uitgangspunten

1. **Bij twijfel streng (fail-closed).** Een document te streng inschalen
   kost een medewerker een extra handeling. Te mild inschalen kan
   persoonsgegevens publiek maken, en dat is niet terug te draaien. Elke
   onzekerheid of fout leidt daarom naar een voorzichtige categorie én
   *in nazicht*, nooit naar *publiek*: onleesbaar of een crash geeft
   *gevoelige persoonsgegevens*; een gelezen scan of een uitgevallen
   naamherkenning zonder signalen geeft *intern*.
2. **Eén verantwoordelijkheid per onderdeel.** Classificatie, beleid,
   opslag, autorisatie en audit kennen elkaar niet. Ze ontmoeten elkaar
   op één plek.
3. **Regels als gegevens, niet als code.** Wat er met een classificatie
   gebeurt, staat in één tabel met een versienummer.
4. **Het auditlog is bewijs.** Het mag niet gewijzigd worden en mag zelf
   geen persoonsgegevens bevatten.
5. **Eenvoudig en uitvoerbaar.** De beoordelaar moet het kunnen starten
   met `npm install` en `npm run dev`, zonder server, container of cloud.
   Het enige wat eenmalig van internet komt, is het taalmodel voor
   naamherkenning (`npm run model`, automatisch bij de eerste start).

## 2. Componenten

```
                 ┌──────────────────────────────────────────────┐
  browser ──────▶│ web/app.ts   (HTTP, identiteit uit token)    │
  of ander       └───────────────┬──────────────────────────────┘
  systeem                        │
                                 ▼
                 ┌──────────────────────────────────────────────┐
                 │ verwerking/verwerkDocument.ts  (orkestratie)  │
                 └──┬──────────┬───────────┬──────────┬─────────┘
                    │          │           │          │
                    ▼          ▼           ▼          ▼
               domein/    classificatie/  beleid/   opslag/  ──▶ audit/
              validatie   tekstextractie  beleid    bestands-    auditlog
                          ocr (scans)               opslag,
                          signalen (patronen)       documenten,
                          ner (taalmodel)           database
                          classificeer
  autorisatie/ wordt door web/ gebruikt: wie ben je, wat mag je?
```

| Component | Verantwoordelijkheid | Kent |
|---|---|---|
| `domein` | Begrippen (classificaties en hun rangorde, signalen) en validatie van bestand en metadata | niets |
| `classificatie` | Tekst uit een bestand halen (scans via lokale tekstherkenning), signalen herkennen (patronen voor gestructureerde gegevens, een lokaal taalmodel voor namen), een classificatie met motivering bepalen | `domein` |
| `beleid` | Per classificatie: opslagmap, toegang, bewaartermijn, publiek of niet | `domein` |
| `autorisatie` | Aanmelden, tokens ondertekenen en controleren, identiteit bepalen, toegang beoordelen, wie mag aanbieden | `beleid` |
| `opslag` | Databankschema en -verbinding; documentregister; bestand veilig wegschrijven | niets van classificatie |
| `audit` | Beslissingen vastleggen; enkel toevoegen, nooit wijzigen | `opslag` (verbinding) |
| `verwerking` | De volgorde: valideren → classificeren → beleid (`maakVoorstel`, schrijft niets weg) → opslaan → registreren (`verwerkDocument`) | alle bovenstaande |
| `web` | HTTP vertalen naar domeinaanroepen en terug; het contract (`openapi.yaml`) en de betekenis van de velden (`context.ts`) publiceren | `verwerking`, `autorisatie`, `audit` |

**Gevolg:** de classificatie kan vervangen worden door een AI-dienst, de
databank door PostgreSQL of de testaanmelding door de identiteitsprovider van
het bestuur, telkens zonder de andere onderdelen te raken.

## 3. Stroom van een document

De stroom gebeurt in **twee aanvragen**, zoals de opdracht het vraagt: eerst
het voorgestelde resultaat bekijken, dan opslaan.

| Aanvraag | Stappen | Schrijft iets weg? |
|---|---|---|
| `POST /api/classificaties` (`maakVoorstel`) | 1–5 | Nee: enkel een auditregel *classificatie_voorgesteld* |
| `POST /api/documenten` (`verwerkDocument`) | 1–8 | Ja: bestand, documentregel en auditregels |

Bij het opslaan worden stap 2–5 **opnieuw** uitgevoerd op de server. Het
voorstel uit de browser wordt nooit overgenomen: wie in de browser het voorstel
naar *publiek* zou aanpassen, verandert niets aan wat er opgeslagen wordt.
Tussen de twee aanvragen wordt niets tijdelijk bewaard; het bestand wordt
gewoon opnieuw meegestuurd.

1. **Aanbieden.** De identiteit komt uit het ondertekende token; een vervalst
   of verlopen token geeft 401, zonder token ben je een burger en word je
   geweigerd (403, gelogd). Het bestand blijft **in het geheugen**: een
   geweigerd of nog niet geclassificeerd document komt nooit op schijf.
   Bestanden boven 10 MB worden al tijdens het uploaden afgekapt.
2. **Valideren.** Leeg, grootte, extensie tegen een **witte lijst**
   (`.txt`, `.md`, `.pdf`, `.jpg`/`.jpeg`, `.png`). Het type volgt uit de
   extensie, nooit uit wat de browser opgeeft (dat is een bewering van de
   aanbieder, en Windows stuurt voor `.md` vaak `application/octet-stream`).
   Daarna: inhoud die bij het type
   past (vaste beginbytes: een PDF begint met `%PDF-`, een JPEG met `FF D8 FF`,
   een PNG met `89 PNG`; tekst bevat geen nul-bytes) en lengte van de metadata.
   Weigering: 422 met een begrijpelijke boodschap, gelogd, niets opgeslagen.
3. **Tekst halen.** Platte tekst wordt rechtstreeks gelezen, een scan met
   lokale tekstherkenning (§8). Voor een PDF, of een scan die niet betrouwbaar
   gelezen kan worden, komt er bewust lege tekst terug (zie §6).
4. **Classificeren.** Alle detectoren lopen: patronen met controlegetallen
   voor gestructureerde gegevens, trefwoorden, en het taalmodel voor namen
   en vrije adressen (§8). De strengste classificatie wint. Zonder signalen
   beslist de voorgestelde zichtbaarheid, met *intern* als standaard. Minder
   dan 20 tekens tekst of een technische fout geeft *gevoelige
   persoonsgegevens*, zekerheid *onzeker*. Was de tekst- of naamherkenning
   niet beschikbaar, dan wordt een document zonder signalen *intern* met
   nazicht, nooit publiek.
5. **Beleid toepassen.** Opslagmap, toegang en vervaldatum volgen uit de
   classificatie.
6. **Opslaan.** Het bestand komt in de map van zijn classificatie, onder een
   willekeurige naam (UUID), met een SHA-256-vingerafdruk.
7. **Registreren in één transactie.** De documentregel, de auditregel
   *geclassificeerd* (met gemaskeerde signalen en motivering) en de
   auditregel *opgeslagen* of *in_nazicht_geplaatst*. Faalt dit, dan wordt
   niets geregistreerd en wordt het bestand weer verwijderd.
8. **Antwoord.** 201 met classificatie, motivering, signalen, status,
   opslagmap, toegang, bewaartermijn en beleidsversie.

**Na het opslaan** (`verwerking/nazicht.ts`, `verwerking/opruiming.ts`):

9. **Nazicht.** Een document met status *in nazicht* staat al veilig
   opgeslagen onder een voorzichtige classificatie. Een dossierbeheerder
   bevestigt die of herclassificeert, altijd met een motivering. Bij
   herclassificeren verhuist het bestand naar de map van de nieuwe
   classificatie en volgen toegang en bewaartermijn opnieuw uit het beleid.
   Beslissing en bijwerking gebeuren in één transactie; mislukt die, dan
   gaat het bestand terug. Tegen omzeiling: enkel een dossierbeheerder, enkel
   documenten die effectief in nazicht staan, en **vier ogen**: wie het
   document zelf aanbood, mag het niet zelf afhandelen. Elke geweigerde
   poging komt in het auditlog.
10. **Opruiming.** Bij het opstarten en daarna dagelijks verwijdert het
    systeem bestand en fiche van documenten waarvan de bewaartermijn
    verstreken is. Het auditspoor blijft, en de verwijdering zelf wordt
    gelogd (actor *systeem*).

## 4. Datamodel

Twee tabellen (`src/opslag/schema.sql`):

- **`documenten`**: wat er over een document bekend is: titel, bron,
  bestandsnaam, type, grootte, `sha256`, classificatie, zekerheid,
  **status** (`definitief_opgeslagen` of `in_nazicht`), opslagpad, toegang,
  `bewaren_tot`, beleidsversie.
- **`auditlog`**: één regel per gebeurtenis: tijdstip, actor, rol,
  document, handeling, classificatie, zekerheid, gemaskeerde signalen,
  motivering, beleidsversie, uitkomst, en de **hash-ketting**: `vorige_hash`
  en `hash`.

**Waarom een aparte audittabel en geen kolom op het document?** Een document
kent meerdere gebeurtenissen (aangeboden, geclassificeerd, opgeslagen,
ingekeken, geweigerd). De geschiedenis moet blijven bestaan, ook als het
document na de bewaartermijn verdwijnt.

**Append-only in de databank zelf.** Triggers weigeren elke `UPDATE` en
`DELETE` op `auditlog`. Zo is het spoor ook beschermd tegen wie buiten de
applicatie om in de databank werkt.

**Hash-ketting tegen wie de triggers omzeilt.** Een databankbeheerder met
volledige rechten kan de triggers verwijderen. Daarom draagt elke regel een
SHA-256 over zijn eigen inhoud én de hash van de vorige regel. Wie een regel
wijzigt of wist, breekt de ketting vanaf dat punt; `GET /api/auditlog/integriteit`
rekent ze na en wijst de eerste gebroken regel aan. Manipulatie wordt zo niet
onmogelijk, maar wel altijd aantoonbaar. Hetzelfde principe waarmee git zijn
geschiedenis beschermt: elke commit draagt de hash van zijn voorganger. Het lezen van de
laatste hash en het schrijven van de nieuwe regel gebeuren in één transactie,
zodat de ketting ook bij gelijktijdige schrijvers klopt. Een databank van vóór
de ketting krijgt ze eenmalig bij het opstarten (`database.ts`).

**Waarom het `status`-veld?** Het is het aangrijpingspunt voor tussenstappen in
de levensloop van een document, zoals nazicht of goedkeuring door een
medewerker, zonder het model om te gooien.

**Wat betekenen de velden?** Een sleutel als `titel` zegt een ander systeem
niets. Daarom publiceert de API een **JSON-LD-context** (`/api/context.jsonld`)
die elk veld van een document koppelt aan een term uit een open vocabularium
dat de publieke sector al gebruikt: Dublin Core (`dct:title`, `dct:created`,
`dct:accessRights` voor de classificatie, `dct:conformsTo` voor de
beleidsversie), DCAT (`dcat:byteSize`), SPDX (`spdx:checksum`) en PROV-O
(`prov:wasAttributedTo` voor de bron). Het antwoord van `GET /api/documenten/:id`
verwijst ernaar met `@context`. Wie het als gewone JSON leest, merkt niets; wie
het als linked data leest, krijgt de betekenis erbij. Dat is het principe van
OSLO en DCAT-AP in Vlaanderen: geen eigen sleutelnamen zonder mapping. De
OSLO-vocabularia zelf bouwen op dezelfde termen, dus een latere aansluiting op
een OSLO-toepassingsprofiel is een kwestie van de context uitbreiden, niet van
de API herschrijven.

## 5. Technologiekeuzes

| Keuze | Waarom | Nadeel / wanneer anders |
|---|---|---|
| **TypeScript op Node.js** | Strikte types vangen fouten vroeg (bv. een onbekende classificatie); één taal voor server, tests en webpagina | Minder gangbaar dan Java/.NET in sommige overheidsomgevingen; de architectuur is wel taalonafhankelijk |
| **Express, bewust dun gehouden** | Bekend, klein, elk endpoint in enkele regels leesbaar | Geen ingebouwde structuur voor grote API's; de domeinlogica staat er los van, dus overstappen kan |
| **SQLite (`better-sqlite3`)** | Geen databankserver nodig, één bestand, lokaal en afgeschermd zoals de opdracht vraagt; transacties en triggers worden ondersteund | Niet geschikt voor veel gelijktijdige schrijvers of meerdere servers. In productie: **PostgreSQL**. Alle SQL staat in twee klassen: `Documentenregister` (`opslag/documenten.ts`) en `Auditlog` (`audit/auditlog.ts`); het schema is grotendeels standaard-SQL; de triggers (in PostgreSQL triggerfuncties), `AUTOINCREMENT` en de `pragma`'s moeten vertaald worden |
| **Bestanden op het lokale bestandssysteem** | Eenvoudig, controleerbaar, geen cloud | In productie: afgeschermde objectopslag of het documentbeheersysteem van het bestuur, met versleuteling |
| **Regelgebaseerde classificatiebeslissing** | De beslissing (welke categorie, welke opslag) volgt uit uitlegbare regels: "e-mailadres gevonden, dus persoonsgegevens". Voorspelbaar, testbaar, uit te leggen aan een burger of toezichthouder | Trefwoorden missen synoniemen en context. Zie §8 |
| **Patronen met controlegetallen** voor e-mail, rijksregisternummer, IBAN | Exact en gratis; een controlegetal maakt het verschil tussen "11 cijfers" en "een geldig rijksregisternummer" | Vangen enkel gegevens met een vaste vorm |
| **Lokaal taalmodel (NER, `@huggingface/transformers`)** voor namen en vrije adressen | Een naam heeft geen vaste vorm; een getraind model herkent "Jan Peeters belde" waar geen patroon dat kan. Draait volledig op de eigen server | Ca. 180 MB, enkele seconden laadtijd, kan een ongewone naam missen. Daarom nooit het enige vangnet: zonder model gaat een document naar nazicht. Zie §8 |
| **Tesseract (`tesseract.js`) voor scans, lokaal** | Open source, draait op de eigen server met de Nederlandse taaldata in het project; geen clouddienst, geen kost per pagina, geen internet nodig | Minder nauwkeurig dan commerciële clouddiensten bij slechte foto's of handschrift; ca. 13 MB taaldata extra. Zie §8 |
| **Vitest** | Snel, werkt rechtstreeks met TypeScript | n.v.t. |

## 6. Veilig gedrag bij onzekerheid en fouten

| Situatie | Gedrag |
|---|---|
| Geen leesbare tekst (leeg bestand, mislukte scan) | *Gevoelige persoonsgegevens*, *onzeker*, status *in nazicht*. Een korte maar leesbare tekst ("Vergadering om 14u.") wordt wel gewoon beoordeeld: die is volledig gelezen |
| Scan met minder dan 20 tekens herkende tekst | Waarschijnlijk slecht gelezen → *gevoelig*, *in nazicht* |
| PDF | Wordt in dit prototype niet gelezen: lege tekst, dus dezelfde veilige terugval. Een PDF wordt **nooit automatisch publiek**, ook niet als de aanbieder dat voorstelt |
| Scan, goed leesbaar | Tekstherkenning; de gevonden tekst wordt geclassificeerd zoals gewone tekst |
| Scan zonder herkenbare gegevens | *Intern*, *onzeker*, *in nazicht*: nooit publiek, want "niets gevonden" kan ook "niets goed gelezen" betekenen |
| Scan slecht leesbaar (betrouwbaarheid < 70%) | Herkende tekst wordt weggegooid → *gevoelig*, *in nazicht* |
| Tekstherkenning faalt of duurt langer dan 20 s | De fout wordt opgevangen, de verwerking gaat verder → *gevoelig*, *in nazicht*. Een fout in Tesseract laat de server niet crashen (`errorHandler`) |
| Naamherkenning niet beschikbaar (model ontbreekt of faalt) | De fout wordt opgevangen, de verwerking gaat verder. Zonder andere signalen → *intern*, *in nazicht*, nooit publiek; met signalen → de gevonden classificatie, maar *onzeker* (nazicht), want een naam kan gemist zijn |
| Bestand dat zich voordoet als ander type | 422 `inhoud_past_niet_bij_type`: de beginbytes passen niet bij het opgegeven type |
| Voorstel in de browser aangepast vóór het opslaan | Geen effect: de server classificeert bij het opslaan opnieuw |
| Classificatie crasht (bv. een externe dienst valt uit) | `classificeerVeilig` vangt de fout op: strengste classificatie, *in nazicht*. De technische oorzaak gaat naar het serverlog, niet naar de gebruiker of het auditlog |
| Ongeldig bestand of ongeldige metadata | 422 met een boodschap in gewone taal; gelogd; niets opgeslagen |
| Bestand groter dan 10 MB | Al tijdens het uploaden afgekapt (413), zodat de server niet overbelast raakt |
| Registratie in de databank faalt | Transactie: alles of niets; het weggeschreven bestand wordt verwijderd; 500 zonder interne details |
| Opgeslagen bestand ontbreekt bij opvragen | Nette 500 `bestand_niet_beschikbaar` |
| Geen token meegestuurd | Anonieme burger: de minst bevoegde rol |
| Vervalst, beschadigd of verlopen token | 401 `aanmelding_ongeldig`: opnieuw aanmelden, nooit stil verder met andere rechten |
| Fout wachtwoord | 401 met dezelfde boodschap als bij een onbekende gebruiker; gelogd |
| Vijf mislukte aanmeldingen voor dezelfde gebruiker vanaf hetzelfde adres | 429 met `Retry-After`, 15 minuten; ook het juiste wachtwoord helpt dan niet; gelogd |
| Afgemeld, maar iemand gebruikt het oude token nog | 401: het token is ingetrokken, ook al is het nog niet verlopen |
| Nazicht zonder motivering, door een medewerker, door de aanbieder zelf, of voor een document dat niet in nazicht staat | Geweigerd (422/403) en gelogd met de reden; het document verandert niet |
| Bijwerken na nazicht faalt in de databank | Transactie teruggedraaid, het verplaatste bestand gaat terug naar zijn oude map |
| Bewaartermijn verstreken | Bestand en fiche verwijderd, auditspoor bewaard, verwijdering gelogd; mislukt het, dan probeert de volgende dagelijkse run opnieuw |
| Een beheerder verwijdert de triggers en past een auditregel aan | De hash-ketting breekt; `/api/auditlog/integriteit` meldt `intact: false` met het nummer van de eerste gebroken regel |

## 7. Beveiliging en privacy

**Autorisatie.** Toegang volgt uit het beleid en wordt per niveau strenger,
zoals de opdracht het vraagt: *publiek* voor iedereen; *intern* voor wie voor
het bestuur werkt; *persoonsgegevens* **beperkt** tot medewerkers en
dossierbeheerders (de medewerker die het dossier behandelt, moet het e-mailadres
van de aanvrager kunnen zien); *gevoelige persoonsgegevens* **minimaal**: enkel
de dossierbeheerder. Elke toegangspoging,
geslaagd of geweigerd, komt in het auditlog, ook het inkijken van het auditlog
zelf.

**Het auditlog zelf.** Het volledige log is enkel voor de dossierbeheerder: het
bevat gemaskeerde signalen en toegangspogingen van iedereen. Maar de opdracht
vraagt dat *de gebruiker* de genomen beslissing kan terugvinden. Daarom mag een
medewerker het spoor opvragen van documenten die hij **zelf aanbood**, en niets
anders. Dat wordt gecontroleerd aan de hand van het auditlog zelf: staat er een
regel *geclassificeerd* met zijn naam bij dat document, dan is hij de aanbieder.

**Authenticatie met ondertekende tokens.** Gebruiker en rol worden nooit
geloofd omdat de browser ze meestuurt. Het werkt zo:

1. **Aanmelden** (`POST /api/aanmelden`). De server controleert gebruikersnaam
   en wachtwoord (`src/autorisatie/aanmelding.ts`). Wachtwoorden staan nooit
   leesbaar in de code, enkel als **scrypt-hash** met een eigen zout per
   account. scrypt is bewust traag, zodat raden veel rekentijd kost. Ook voor
   een onbestaande gebruiker wordt een hash berekend, en het antwoord is in
   beide gevallen hetzelfde, zodat niet af te leiden is welke gebruikersnamen
   bestaan.
2. **Token.** Bij succes krijgt de gebruiker een **JWT** (`src/autorisatie/token.ts`):
   gebruiker, rol en vervaltijd (8 uur), **ondertekend met HMAC-SHA256** met
   een geheim dat enkel de server kent (`TOKENGEHEIM`, nooit in de code).
3. **Elke aanvraag** stuurt het token mee (`Authorization: Bearer …`). De server
   controleert eerst de handtekening, pas daarna leest hij de inhoud. Wie de rol
   in het token aanpast, breekt de handtekening: 401. De vergelijking gebeurt
   met `timingSafeEqual`, zodat de antwoordtijd niets verraadt.
4. **De webpagina** bewaart het token enkel in het geheugen van de pagina, niet
   in `localStorage`, zodat het niet blijvend uit te lezen is.

**Wat verandert er in productie?** Enkel wie het token uitgeeft. In plaats van
de testaanmelding meldt de medewerker zich aan bij de identiteitsprovider van
het bestuur (OpenID Connect), die het token ondertekent; de server controleert
het dan met de publieke sleutel van die provider in plaats van met een eigen
geheim. `aanmelding.ts` verdwijnt, `bepaalIdentiteit` blijft het enige punt
waar een identiteit ontstaat, en de rest van de applicatie werkt al met een
`Identiteit` en hoeft niet te wijzigen.

**Raden en intrekken.** Na vijf mislukte pogingen voor dezelfde gebruikersnaam
vanaf hetzelfde adres wordt aanmelden 15 minuten geblokkeerd (429), ook met
het juiste wachtwoord. Elk token draagt een uniek nummer (`jti`); afmelden
zet dat nummer op een lijst van ingetrokken tokens, zodat een gestolen of
achtergelaten token meteen waardeloos is en niet pas na acht uur. Beide lijsten
leven in het geheugen van dit ene proces: in productie, met meerdere servers,
hoort dat bij de identiteitsprovider of een gedeelde opslag.

**Nazicht met vier ogen.** Een dossierbeheerder mag alles inkijken, maar een
document dat hij zelf aanbood, mag hij niet zelf uit nazicht halen. De
controle gebeurt op het auditlog (wie schreef de regel *geclassificeerd*?), niet
op een veld dat de aanvrager meestuurt. Een motivering is verplicht en komt
letterlijk in het auditlog, zodat elke beslissing van een mens even
herleidbaar is als die van het systeem.

**Bewuste beperkingen van de testaanmelding.** Twee vaste fictieve accounts; in
productie meldt men aan via de identiteitsprovider van het bestuur.

**Dataminimalisatie in het auditlog.** Signalen worden **gemaskeerd** gelogd
(`86*******58`, `ja****…be`). Het log bewijst *dat* er een
rijksregisternummer gevonden is, niet *welk*. Anders zou het auditlog zelf een
verzameling persoonsgegevens worden. Trefwoorden zijn geen persoonsgegevens
en worden wel volledig gelogd.

**Bestandsopslag.**
- De opslagmap staat buiten de map die de webserver statisch uitserveert.
  Bestanden zijn enkel op te vragen via een endpoint dat eerst de rol
  controleert.
- Bestanden krijgen een UUID als naam; het pad komt uit de databank, nooit
  uit het verzoek. Zo kan niemand met `../` uit de map breken.
- Er wordt een SHA-256 bewaard, zodat achteraf vast te stellen is of een
  bestand gewijzigd werd.
- **Rechten op Windows.** Mappen krijgen `0700` en bestanden `0600`
  (alleen de eigenaar van het proces). Op Linux en macOS werkt dat zoals
  bedoeld. **Op Windows heeft `chmod` vrijwel geen effect**: daar regelen
  toegangslijsten (ACL's) de rechten. In productie worden die rechten op de
  server zelf ingesteld (een apart serviceaccount met enkel toegang tot de
  opslagmap), niet vanuit de applicatie.

**Invoercontrole.** Witte lijst van types, controle van de inhoud tegen het
opgegeven type, maximale grootte, lengte van de metadata. De voorgestelde
zichtbaarheid wordt nooit blind gevolgd: zodra er persoonsgegevens gevonden
worden, telt ze niet meer.

**Foutmeldingen.** De gebruiker krijgt een vaste code en een zin in gewone
taal; stacktraces en interne paden blijven in het serverlog.

**Financiële gegevens tegenover artikel 9 van de AVG.** Artikel 9 van de
AVG somt de *bijzondere categorieën* op (o.a. gezondheid, etnische afkomst,
religie); strafrechtelijke gegevens vallen onder artikel 10. Financiële
gegevens zoals een IBAN of een loonfiche staan daar niet in. De opdracht
rekent financiële informatie wel bij de *gevoelige persoonsgegevens*, en
dit prototype volgt de opdracht: een geldige IBAN of een financieel
trefwoord geeft *gevoelige persoonsgegevens*. Dat is strenger dan de AVG
strikt vraagt, in lijn met het fail-closed-uitgangspunt. Als het bestuur dit
anders wil, is het één regel in `src/classificatie/signalen.ts`
(`impliceert`).

**Testgegevens.** Uitsluitend fictieve gegevens; geen cloud, geen externe
diensten.

## 8. Classificatiemethode

**Detectoren** (`src/classificatie/signalen.ts`), elk een losse functie van
tekst naar signaal:

| Signaal | Methode | Classificatie |
|---|---|---|
| E-mailadres | Patroon | persoonsgegevens |
| Rijksregisternummer | Patroon + **controlegetal** (97 − rest van de eerste 9 cijfers bij deling door 97; met een 2 ervoor voor wie geboren is vanaf 2000) | persoonsgegevens |
| Adres (patroon) | Straatnaam met een gangbaar Vlaams achtervoegsel (straat, laan, steenweg, plein, lei, dreef, kaai, markt, singel, vest) + huisnummer; werkt ook zonder taalmodel. De adressen van het bestuur zelf (`EIGEN_ADRESSEN`) tellen niet mee: die staan in elke brochure | persoonsgegevens |
| Adres (taalmodel) | Een door het model herkende plaats, gevolgd door een huisnummer ("Kouter 5"); een plaatsnaam alleen ("Gent") telt niet | persoonsgegevens |
| Naam (taalmodel) | Een door het model herkende persoon, met of zonder aanspreking | persoonsgegevens |
| IBAN | Patroon + **modulo-97-controle** | gevoelige persoonsgegevens (zie §7) |
| Medische, strafrechtelijke, financiële trefwoorden | Lijst op één plek | gevoelige persoonsgegevens |

Het controlegetal maakt het verschil tussen "11 cijfers" en "een geldig
rijksregisternummer": dossiernummers en bedragen worden niet ten onrechte als
persoonsgegeven gezien.

**Taakverdeling: patronen waar het kan, een model waar het moet.** Dit is de
gangbare opzet van privacytools (bv. Microsoft Presidio): gegevens met een
vaste vorm (e-mail, rijksregisternummer, IBAN) vang je exact met een patroon en
een controlegetal; namen hebben geen vaste vorm en vragen een getraind model.
Een patroon voor namen zou ofwel namen missen (enkel na "de heer"), ofwel elk
woord met een hoofdletter verdenken.

**Namen en vrije adressen: lokaal taalmodel** (`src/classificatie/ner.ts`). Het
model `Xenova/bert-base-multilingual-cased-ner-hrl` (BERT, meertalig, ook
Nederlands) duidt per woord aan of het een persoon, plaats, organisatie of datum
is. Een persoon wordt het signaal *naam*; een plaats gevolgd door een huisnummer
wordt het signaal *adres*. Enkel herkenningen met een score van minstens 0,80
tellen. Zoals de opdracht vraagt bij het gebruik van AI:

| | |
|---|---|
| **Afhankelijkheden** | `@huggingface/transformers` (open source) met het model lokaal in `modellen/` (ca. 180 MB, eenmalig opgehaald met `npm run model`). Tijdens het classificeren is internet uitgeschakeld (`allowRemoteModels = false`) |
| **Privacyrisico's** | Geen: de tekst wordt op de eigen server verwerkt en verlaat het bestuur nooit. Van een herkende naam gaat enkel een gemaskeerde vorm (`J*********s`) naar het auditlog |
| **Kosten** | Geen licentie of kost per document; ca. 180 MB schijf. Gemeten: het serverproces gebruikt ca. 510 MB geheugen met beide modellen geladen (ca. 240 MB daarvan voor het NER-model), laden duurt enkele seconden bij het opstarten, één herkenning daarna enkele tientallen ms. De server laadt de modellen bij het opstarten op de achtergrond |
| **Fallback** | Faalt het model of ontbreekt het, dan loopt de verwerking door: zonder andere signalen wordt het document *intern* met nazicht, met signalen krijgt het de gevonden classificatie maar *onzeker*. Het adrespatroon werkt ook zonder model. Nooit wordt een document publiek omdat het model niets zag |

Bewuste grenzen: het model kan een ongewone of buitenlandse naam missen, of een
productnaam als persoon zien. Daarom bepaalt het model nooit de beslissing
alleen: het levert signalen, en de regels beslissen. Waar het model twijfelt,
twijfelt het systeem mee (nazicht).

**Scans: lokale tekstherkenning** (`src/classificatie/ocr.ts`). Een scan is een
afbeelding; Tesseract zoekt er de letters in terug, waarna dezelfde detectoren
lopen als bij gewone tekst. Tesseract werkt met een getraind model. Daarom, zoals
de opdracht vraagt bij het gebruik van AI:

| | |
|---|---|
| **Afhankelijkheden** | `tesseract.js` 7 en `@tesseract.js-data/nld` (Nederlandse taaldata, ca. 13 MB), beide open source en in het project geïnstalleerd. Geen externe dienst, geen internetverbinding tijdens het draaien |
| **Privacyrisico's** | Geen: de scan wordt op de eigen server gelezen en verlaat het bestuur nooit. De herkende tekst wordt niet bewaard; enkel de gemaskeerde signalen gaan naar het auditlog |
| **Kosten** | Geen licentie of kost per pagina; enkel rekentijd (enkele tienden van een seconde per pagina in de tests) |
| **Fallback** | Betrouwbaarheid onder 70%, een fout of een timeout van 20 s → geen tekst → *gevoelig*, *in nazicht*. Een scan zonder herkende gegevens wordt nooit publiek (zie §6) |

Bewuste afweging: tekstherkenning kan een woord verkeerd lezen ("diagn0se") en
zo een signaal missen. Daarom maakt herkenning het systeem nooit *minder*
voorzichtig: worden er gegevens herkend, dan bepalen die de classificatie zoals
bij gewone tekst; wordt er niets herkend, dan wordt de scan *intern* met
nazicht, en nooit automatisch *publiek*.

**Waarom geen AI voor de beslissing zelf?** De modellen *herkennen* (letters
in een scan, namen in een tekst); de *beslissing* welke categorie en welke
opslag erbij hoort, blijft een regel: "signaal X gevonden, dus categorie Y".
Een model dat zelf de categorie zou kiezen, is minder voorspelbaar en
moeilijker uit te leggen aan een burger of een toezichthouder. Zo blijft elke
beslissing in het auditlog te herleiden tot concrete, gemaskeerde signalen.

**Hoe een externe AI-dienst later toevoegen?** Als extra detector naast de
bestaande, op dezelfde manier als het taalmodel nu: de regels blijven het
minimum, het model kan enkel signalen *toevoegen* (de strengste classificatie
wint). Bij een timeout of fout valt het systeem veilig terug. Aandachtspunten
bij een clouddienst: verwerking binnen de EU of op eigen infrastructuur, een
verwerkersovereenkomst, kosten per document, en bijhouden welke modelversie
een beslissing nam (naast de beleidsversie).

## 9. Integratie in een bestaand landschap

Een lokaal bestuur heeft al systemen: een identiteitsprovider, een
documentbeheer- of zaaksysteem, een archief, monitoring. Deze oplossing is
bedoeld als **dienst daartussen**, niet als vervanging.

| Bestaand systeem | Hoe deze oplossing aansluit |
|---|---|
| **Identiteitsprovider** (bv. Microsoft Entra ID of de Vlaamse gebruikersbeheerdienst ACM/IDM) | Geeft het token uit via OpenID Connect in plaats van de testaanmelding; rollen komen uit groepen van het bestuur. Enkel `autorisatie` wijzigt, de tokencontrole blijft hetzelfde principe |
| **Documentbeheer- of zaaksysteem** | Roept `POST /api/documenten` aan bij binnenkomst en bewaart het `documentId` bij het dossier. Of omgekeerd: deze dienst classificeert enkel en geeft de opslagbeslissing terug, en het bestaande systeem slaat op. Door de scheiding tussen `classificatie`, `beleid` en `opslag` kunnen beide |
| **Scan- of postinboeksysteem** | Levert afbeeldingen aan, die lokaal gelezen worden; een centrale OCR-dienst van het bestuur kan Tesseract vervangen in `ocr.ts`. Gescande PDF's gaan voorlopig veilig in nazicht |
| **Archief en selectielijst** | De bewaartermijnen in `beleid.ts` worden overgenomen uit de selectielijst van het bestuur; de beleidsversie in het auditlog toont welke regels toen golden |
| **Databank en opslag** | PostgreSQL en afgeschermde objectopslag of een netwerkschijf van het bestuur; de wijziging blijft beperkt tot `opslag` |
| **Monitoring en beveiliging** | Het auditlog kan doorgestuurd worden naar het bestaande logplatform (SIEM), bv. voor meldingen bij veel geweigerde toegangspogingen |
| **API-gateway of integratiebus** (bv. de LB Bus van LB365, die back-office en front-office van lokale besturen koppelt) | De API is gewoon JSON over HTTP met een OpenAPI-contract (`openapi.yaml`), en kan als dienst op zo'n bus aangesloten worden: de bus roept `POST /api/classificaties` of `/api/documenten` aan, en krijgt een contract-conform antwoord. De gateway neemt TLS, rate limiting en versienummering over |
| **Vlaamse datastandaarden (OSLO) en authentieke bronnen (MAGDA)** | De velden van een document hebben al een betekenis uit open vocabularia (JSON-LD-context, §4), waarop de OSLO-vocabularia bouwen; een OSLO-toepassingsprofiel is een uitbreiding van die context. Persoonsgegevens worden hier *herkend*, niet beheerd: de authentieke bron blijft MAGDA/het Rijksregister, en dit systeem slaat van een herkend rijksregisternummer enkel een gemaskeerd bewijs op |

**Afhankelijkheden.** Node.js 22+, Express, Multer (uploads), better-sqlite3,
tesseract.js met Nederlandse taaldata (scans), @huggingface/transformers met
een lokaal NER-model (namen). Geen externe diensten tijdens het draaien; het
NER-model wordt eenmalig opgehaald bij de installatie.

**Grenzen.** Eén proces, één server, lokale schijf. Voor meerdere servers moeten
databank en bestandsopslag gedeeld worden (PostgreSQL, objectopslag).

## 10. Teststrategie

- **Eenheidstests** per component: detectoren (inclusief controlegetallen),
  classificatieregels, beleid, autorisatie, validatie.
- **Stroomtests** op `verwerkDocument` met een databank in het geheugen:
  de juiste map, nazicht bij onzekerheid, alles-of-niets bij een databankfout,
  auditlog onwijzigbaar, geen persoonsgegevens in het log.
- **Beveiligingstests** op de aanmelding: een vervalste rol in het token, een
  token met een ander geheim, een verlopen token, een fout wachtwoord en een
  zelfgekozen rol in een header worden allemaal geweigerd.
- **API-tests** op de echte endpoints: statuscodes, rolcontrole, geen lek
  van interne paden, inzage in het auditlog gelogd met de echte gebruiker.
- **Levensloop na het opslaan:** nazicht (bevestigen, herclassificeren met
  verhuizing van het bestand, alle weigeringen incl. vier ogen), opruiming na
  de bewaartermijn (auditspoor blijft), en de hash-ketting: een gewijzigde of
  gewiste regel wordt aangewezen, ook nadat de triggers verwijderd zijn.
- **Foutscenario's eerst.** Elke regel uit §6 heeft een test, ook de storingen: een hangende tekstherkenning, een te groot bestand, een bestand dat van de schijf verdween, een databank die midden in een nazicht weigert.
- **Handmatig:** negen voorbeelddocumenten met verwachte uitkomst (README).

131 tests, `npm test`. De tekst- en naamherkenning worden getest met echte
scans en teksten én met een nagebootst model dat faalt of onbetrouwbaar is,
zodat het veilige gedrag bij uitval bewezen is. Elk testbestand gebruikt een
eigen databank in het geheugen en een eigen opslagmap, zodat testen nooit de
gegevens van de draaiende applicatie raakt.

## 11. Bewust niet uitgewerkt

| Wat | Waarom |
|---|---|
| Koppeling met een echte identiteitsprovider | Buiten de scope (*"koppeling met echte overheidsomgevingen"*). De testaanmelding geeft tokens uit op dezelfde manier; enkel de uitgever verandert (§7) |
| Blokkering en ingetrokken tokens over meerdere servers | Beide lijsten leven in het geheugen van één proces (§7). Met meerdere servers hoort dat bij de identiteitsprovider of een gedeelde opslag |
| PDF-tekstextractie | PDF's (ook gescande) vragen een extra bibliotheek om de pagina's uit te lezen of om te zetten naar afbeeldingen; tot dan worden ze aanvaard en veilig in nazicht gezet |
| Handschrift | Tesseract herkent vooral gedrukte tekst; handgeschreven documenten zullen meestal onder de betrouwbaarheidsdrempel vallen en in nazicht gaan |
| Doorsturen van het auditlog naar een SIEM | De hash-ketting maakt manipulatie aantoonbaar, maar niet onmogelijk voor wie de databank volledig beheert; een kopie buiten de databank hoort bij het logplatform van het bestuur (§9) |
| Een Nederlandstalig gespecialiseerd NER-model | Het gebruikte model is meertalig en algemeen. Een model dat specifiek op Nederlandse overheidsteksten getraind is, zou nauwkeuriger zijn; dat vraagt trainingsdata van het bestuur (§8) |
| Versleuteling op schijf, virusscan | Hoort bij de infrastructuur van het bestuur; vermeld als vervolgstap |
| Versienummering van de API (`/api/v1`) | Eén prototype met één klant; bij een tweede versie komt `/api/v2` ernaast, zodat bestaande koppelingen blijven werken |

## 12. Keuzes bij onduidelijkheid in de opdracht

De opdracht laat op een aantal punten ruimte. Hieronder staat hoe die ruimte
is ingevuld, en waarom, zodat elke keuze een bewuste keuze is en geen toeval.

| Onduidelijk in de opdracht | Keuze | Waarom |
|---|---|---|
| "Beperkte toegang" bij persoonsgegevens tegenover "minimale toegang" bij gevoelige persoonsgegevens: wat is het verschil? | Beperkt = wie voor het bestuur werkt (medewerker en dossierbeheerder); minimaal = enkel de dossierbeheerder | De medewerker die een dossier behandelt, moet het e-mailadres van de aanvrager kunnen zien; een medisch verslag niet. Zo zijn de vier niveaus ook echt vier niveaus (§7) |
| "De gebruiker kan de beslissing terugvinden in een auditlog", maar het auditlog is gevoelig | Een medewerker ziet enkel het spoor van documenten die hij zelf aanbood; de dossierbeheerder alles | Beide eisen tegelijk: de gebruiker vindt zijn beslissing, en het log van iedereen blijft afgeschermd (§7) |
| Financiële informatie staat bij "gevoelige persoonsgegevens", terwijl artikel 9 van de AVG dat niet zo rekent | De tabel uit de opdracht volgen; de nuance documenteren; aanpasbaar in één regel | De opdracht is hier strenger dan de wet, en strenger is in lijn met fail-closed (§7) |
| "Het voorgestelde resultaat bekijken" en dan "laten opslaan": één stap of twee? | Twee aanvragen; de server rekent bij het opslaan alles opnieuw uit | Letterlijk volgens de opdracht, en veiliger: het voorstel uit de browser wordt nooit vertrouwd (§3) |
| "Documenten en scans" | Scans aanvaarden als afbeelding én lezen met lokale tekstherkenning, met een drempel en een veilige terugval | Scans enkel aanvaarden zonder ze te lezen, zou elke scan in nazicht zetten en de automatisering voor scans waardeloos maken (§8) |
| "Een echte AI- of cloudservice is niet vereist" | Geen cloud; wel twee lokale open-sourcemodellen, met de vier gevraagde punten (afhankelijkheden, privacy, kosten, fallback) uitgeschreven | Een clouddienst zou persoonsgegevens buiten het bestuur sturen; een lokaal model niet. De beslissing blijft bij uitlegbare regels (§8) |
| Wat met het adres van het bestuur zelf, dat in elke brochure staat? | Een uitzonderingslijst van eigen adressen, naast de trefwoordenlijst | Anders wordt elke brochure "persoonsgegevens" (§8) |
| Wat als het systeem niet zeker is, of een onderdeel uitvalt? | Nooit publiek; een voorzichtige categorie en menselijk nazicht, op elke laag afzonderlijk | De twee mogelijke fouten zijn niet even erg (§1, §6) |
| Hoe ver gaan met "eenvoudig" tegenover "veilig"? | Alles wat erin zit, beantwoordt een regel uit de opdracht of een concreet misbruikscenario; wat daarbuiten valt, staat in §11 met een reden | De opdracht vraagt een eenvoudige, betrouwbare en goed gemotiveerde oplossing; de motivering is de toets |
