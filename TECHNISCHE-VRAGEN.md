# Antwoorden op de technische vragen (opdracht, punt 7)

Korte, concrete antwoorden op de zeven vragen uit de opdracht. Elk antwoord
verwijst naar de plek in de code of de documentatie waar het te controleren is.
De uitgebreide motivering staat in [ARCHITECTUUR.md](ARCHITECTUUR.md), de
API-contracten in [README.md](README.md).

---

## 1. Welke componenten zijn nodig, en welke verantwoordelijkheid heeft elke component?

Acht componenten, elk met één taak. Ze kennen elkaar niet; alleen `verwerking`
brengt ze samen.

| Component | Verantwoordelijkheid | Mag niets weten van |
|---|---|---|
| `domein` | De begrippen (vier classificaties, hun rangorde, signalen) en de controle van bestand en metadata | databank, web, modellen |
| `classificatie` | Tekst uit een bestand halen (scans via lokale tekstherkenning), signalen herkennen (patronen voor gestructureerde gegevens, een lokaal taalmodel voor namen) en een classificatie met motivering bepalen | opslag, rollen, logging |
| `beleid` | Wat uit een classificatie volgt: opslagmap, toegang, bewaartermijn. Eén tabel met een versienummer | hoe er geclassificeerd wordt |
| `autorisatie` | Wie is dit (ondertekend token) en wat mag die (uit het beleid) | documenten, opslag |
| `opslag` | Databankschema, documentregister, bestand veilig wegschrijven onder een willekeurige naam | waarom een document ergens hoort |
| `audit` | Elke beslissing vastleggen; enkel toevoegen, nooit wijzigen; hash-ketting | de rest |
| `verwerking` | De volgorde: valideren → classificeren → beleid → opslaan → registreren; daarna nazicht en opruiming | HTTP |
| `web` | HTTP vertalen naar aanroepen van de domeinlaag en terug | hoe de domeinlaag intern werkt |

Waarom zo? Omdat elk onderdeel afzonderlijk vervangbaar moet zijn: de
testaanmelding door de identiteitsprovider van het bestuur, SQLite door
PostgreSQL, Tesseract door een centrale OCR-dienst, telkens zonder de andere
onderdelen te raken. De tabel in ARCHITECTUUR §2 toont per component wat het
*kent*; dat is bewust zo klein mogelijk gehouden.

## 2. Hoe stromen documenten, metadata en classificatieresultaten door de oplossing?

In twee aanvragen, zoals de opdracht het vraagt: eerst bekijken, dan opslaan.

1. **Voorstel** (`POST /api/classificaties`). Het bestand en de metadata komen
   binnen en blijven in het geheugen. Validatie, tekst halen, classificeren,
   beleid opzoeken. Het resultaat gaat terug naar de gebruiker; er wordt niets
   weggeschreven.
2. **Opslaan** (`POST /api/documenten`). Hetzelfde bestand komt opnieuw binnen.
   De server rekent **alles opnieuw uit** en neemt niets over van het
   voorstel: wie in de browser het voorstel aanpast, verandert niets. Dan:
   bestand naar de map van zijn classificatie, fiche en auditregels in één
   transactie. Mislukt de transactie, dan wordt het bestand weer verwijderd.
3. **Daarna.** Een onzeker document staat *in nazicht* tot een
   dossierbeheerder het bevestigt of herclassificeert. Na de bewaartermijn
   verwijdert een dagelijkse taak bestand en fiche; het auditspoor blijft.

Metadata (titel, bron, beoogde zichtbaarheid) reist mee, maar wordt nooit blind
gevolgd: de zichtbaarheid die de aanbieder voorstelt, telt enkel als er geen
persoonsgegevens gevonden zijn. Het classificatieresultaat gaat drie kanten
op: naar de gebruiker (antwoord), naar de fiche (`documenten`) en gemaskeerd
naar het auditlog. Stap voor stap: ARCHITECTUUR §3; de code:
`src/verwerking/verwerkDocument.ts`.

## 3. Welke API's of integratiepunten zijn nodig, en hoe zien hun contracten eruit?

Eén JSON-API over HTTP, tien endpoints. Elk antwoord heeft dezelfde vorm; elke
fout heeft een vaste code voor programma's en een zin in gewone taal voor
mensen:

```json
{ "fout": "bestandstype_niet_toegestaan", "boodschap": "Dit bestandstype wordt niet aanvaard. Toegestaan zijn: .txt, .md, .pdf, .jpg, .jpeg, .png." }
```

| Endpoint | Doel | Wie |
|---|---|---|
| `POST /api/aanmelden`, `POST /api/afmelden` | Token krijgen en intrekken | iedereen / aangemeld |
| `POST /api/classificaties` | Voorstel bekijken, niets opslaan | medewerker, dossierbeheerder |
| `POST /api/documenten` | Opslaan volgens de classificatie | medewerker, dossierbeheerder |
| `GET /api/documenten/:id`, `…/bestand` | Beslissing en bestand terugvinden | volgens het beleid per classificatie |
| `GET /api/auditlog`, `…/integriteit` | Spoor raadplegen; ketting nakijken | dossierbeheerder (eigen documenten: ook medewerker) |
| `GET /api/nazicht`, `POST /api/documenten/:id/nazicht` | Wachtrij en beslissing | dossierbeheerder |
| `GET /api/publiek` | Wat definitief publiek is | iedereen, ook zonder aanmelding |
| `GET /api/beleid` | De geldende regels, transparant | iedereen |

De volledige contracten (velden, voorbeeldantwoorden, statuscodes per fout)
staan in README *API*. Statuscodes volgen hun betekenis: 201 aangemaakt, 400
ongeldig verzoek, 401 opnieuw aanmelden, 403 geen rechten, 404 onbekend, 413
te groot, 422 inhoudelijk geweigerd, 429 te veel pogingen, 500 zonder interne
details.

Het contract bestaat in twee vormen: leesbaar in de README en machineleesbaar
als **OpenAPI 3.1** (`openapi.yaml`, ook via `GET /api/openapi.yaml`), zodat een
koppelend systeem het kan valideren of er een client uit kan genereren. En de
velden hebben een **betekenis**: `GET /api/context.jsonld` koppelt ze aan Dublin
Core, DCAT, SPDX en PROV-O, en elk document verwijst ernaar met `@context`. Zo
betekent `classificatie` voor elk systeem hetzelfde (`dct:accessRights`), zonder
afspraken op maat.

Integratiepunten buiten de API: het token (in productie uitgegeven door de
identiteitsprovider van het bestuur), het auditlog (door te sturen naar het
logplatform), de beleidstabel (over te nemen uit de selectielijst) en de
tekstextractie (te vervangen door een centrale OCR-dienst).

## 4. Hoe worden validatie, foutafhandeling, autorisatie en auditlogging aangepakt?

**Validatie, vóór er iets gebeurt.** Invoer van buiten wordt niet vertrouwd.
Het bestandstype volgt uit de extensie (witte lijst), niet uit wat de browser
beweert, en de inhoud moet erbij passen: een PDF begint met `%PDF-`, een PNG
met zijn vaste beginbytes, tekst bevat geen nul-bytes. Grootte op twee
plaatsen: de upload kapt af boven 10 MB (beschermt de server), de validatie
legt het uit (helpt de gebruiker). Titel en bron hebben een maximale lengte.
Een geweigerd bestand komt nooit op schijf. (`src/domein/validatie.ts`)

**Foutafhandeling, fail-fast en fail-closed.** Verwachte fouten krijgen een
vaste code en een begrijpelijke boodschap; onverwachte fouten gaan naar het
serverlog en de gebruiker krijgt 500 zonder technische details. Registratie
gebeurt in één transactie; faalt die, dan verdwijnt het weggeschreven bestand
weer. Elke tabelrij in ARCHITECTUUR §6 beschrijft een foutscenario en heeft
een test.

**Autorisatie, nooit op basis van wat de browser zegt.** Aanmelden geeft een
ondertekend token (JWT, HMAC-SHA256); de server controleert bij elke aanvraag
eerst de handtekening en leest pas dan de inhoud. Zonder token ben je een
burger (minste rechten); een vervalst, verlopen of ingetrokken token geeft 401.
Wat een rol mag, staat in één beleidstabel en wordt per niveau strenger:
publiek voor iedereen, intern voor wie voor het bestuur werkt, persoonsgegevens
beperkt tot medewerkers en dossierbeheerders, gevoelige persoonsgegevens enkel
de dossierbeheerder. Wachtwoorden staan enkel als scrypt-hash in de code; na
vijf mislukte pogingen volgt een blokkering. (`src/autorisatie/`)

**Auditlogging, als bewijs.** Elke beslissing, elke toegang en elke geweigerde
poging komt in het auditlog, ook het raadplegen van het auditlog zelf.
Persoonsgegevens worden er gemaskeerd in opgeslagen: het log bewijst *dat* er
een rijksregisternummer stond, niet *welk*. Het log is append-only, afgedwongen
in de databank met triggers, en elke regel draagt een hash over zichzelf en de
vorige regel: wie de triggers omzeilt en iets wijzigt, breekt een ketting die
`GET /api/auditlog/integriteit` nakijkt. Het auditlog stuurt ook gedrag: of een
medewerker het spoor van een document mag zien, en of een dossierbeheerder een
document niet zelf aanbood (vier ogen), wordt uit het log zelf afgeleid.
(`src/audit/auditlog.ts`, `src/opslag/schema.sql`)

## 5. Hoe wordt veilig gereageerd wanneer classificatie niet mogelijk of onzeker is?

Het uitgangspunt: te streng inschalen kost een medewerker een paar minuten
nazicht; te mild inschalen kan persoonsgegevens publiek maken, en dat is niet
terug te draaien. Die twee fouten zijn niet even erg. Daarom gaat bij elke
twijfel de deur dicht, op elke laag afzonderlijk:

| Wat faalt | Wat er gebeurt |
|---|---|
| Geen leesbare tekst (PDF, mislukte scan, leeg bestand) | gevoelige persoonsgegevens, status *in nazicht* |
| De classificatie zelf crasht | `classificeerVeilig` vangt het op: strengste categorie, *in nazicht*; oorzaak enkel in het serverlog |
| Tekstherkenning op een scan faalt, hangt (20 s) of is onzeker (< 70 %) | herkende tekst wordt weggegooid: gevoelig, *in nazicht*; de server crasht niet |
| Een scan is gelezen maar bevat geen signalen | *intern* met nazicht, nooit publiek: "niets gevonden" kan ook "niets goed gelezen" zijn |
| Het taalmodel voor namen ontbreekt of faalt | de verwerking loopt door; zonder andere signalen *intern* met nazicht, met signalen de gevonden classificatie maar *onzeker* |
| De databank faalt bij het registreren | niets geregistreerd, bestand verwijderd, 500 zonder details |

Een document komt dus nooit op *publiek* terecht omdat iets niet werkte. En
"in nazicht" is geen doodlopend spoor: een dossierbeheerder handelt het af met
een verplichte motivering, en wie het document zelf aanbood, mag dat niet zelf
doen. Alles hiervan is getest met een nagebootste storing van elk onderdeel.
(ARCHITECTUUR §6 en §8)

## 6. Hoe kan de oplossing worden geïntegreerd in of aangepast aan een bestaande architectuur?

De oplossing is bedoeld als dienst tussen de bestaande systemen van een
bestuur, niet als vervanging. Per bestaand systeem wijzigt één component:

| Bestaand systeem | Wat er wijzigt |
|---|---|
| Identiteitsprovider (bv. Microsoft Entra ID of de Vlaamse ACM/IDM) | Geeft het token uit via OpenID Connect; de server controleert het met haar publieke sleutel. Enkel `autorisatie` wijzigt; de rest werkt al met een `Identiteit` |
| Documentbeheer- of zaaksysteem | Roept de API aan bij binnenkomst en bewaart het `documentId` bij het dossier. Of omgekeerd: deze dienst classificeert enkel en het bestaande systeem slaat op. Door de scheiding tussen `classificatie`, `beleid` en `opslag` kunnen beide |
| Scanstraat of postinboek | Levert afbeeldingen aan; een centrale OCR-dienst kan Tesseract vervangen in `ocr.ts` |
| Archief en selectielijst | De bewaartermijnen in `beleid.ts` worden overgenomen uit de selectielijst; de beleidsversie in het auditlog toont onder welke regels een beslissing viel |
| Databank en opslag | PostgreSQL en afgeschermde objectopslag; alle SQL zit in twee klassen |
| Logplatform (SIEM) | Het auditlog wordt doorgestuurd, bv. voor een melding bij veel geweigerde toegangen |
| API-gateway of integratiebus (bv. de LB Bus van LB365) | De API is JSON over HTTP met een OpenAPI-contract; de bus roept ze aan en krijgt een contract-conform antwoord. De gateway neemt TLS, rate limiting en versienummering over |
| Vlaamse standaarden (OSLO) en authentieke bronnen (MAGDA) | De velden hebben al een betekenis uit open vocabularia (JSON-LD); een OSLO-profiel is een uitbreiding van die context. Persoonsgegevens worden herkend, niet beheerd: de authentieke bron blijft het Rijksregister via MAGDA |

Niets hiervan vraagt een herontwerp: de aanpassingen zitten in de componenten
die daarvoor bedoeld zijn. (ARCHITECTUUR §9)

## 7. Welke delen werden bewust niet uitgewerkt, en waarom?

| Niet uitgewerkt | Waarom |
|---|---|
| Koppeling met een echte identiteitsprovider | Buiten de opdracht. De testaanmelding geeft tokens uit op dezelfde manier; enkel de uitgever verandert |
| PDF-tekstextractie | Vraagt een extra bibliotheek; tot dan worden PDF's aanvaard en veilig in nazicht gezet |
| Een Nederlandstalig gespecialiseerd naammodel | Het gebruikte model is meertalig en algemeen; een model getraind op overheidsteksten vraagt trainingsdata van het bestuur |
| Blokkering en ingetrokken tokens over meerdere servers | Leven in het geheugen van dit ene proces; met meerdere servers hoort dat bij de identiteitsprovider |
| Versleuteling op schijf, virusscan | Horen bij de infrastructuur van het bestuur |
| Doorsturen van het auditlog naar een SIEM | De hash-ketting maakt manipulatie aantoonbaar, niet onmogelijk; een kopie buiten de databank is de volgende stap |
| Versienummering van de API (`/api/v1`) | Eén prototype, één klant; bij een tweede versie komt `/api/v2` ernaast |
| De wijziging uit punt 10 (gevoelige documenten nooit automatisch definitief) | De afhandeling van nazicht bestaat al; de regel zelf en hoe die niet te omzeilen valt, licht ik toe tijdens de verdediging |

Een rode draad: de opdracht zegt dat een eenvoudige, betrouwbare en goed
gemotiveerde oplossing de voorkeur verdient. Wat hier ontbreekt, ontbreekt
omdat het buiten de opdracht valt, bij de infrastructuur van het bestuur
hoort, of pas zinvol wordt bij meer dan één server. In elk geval is de plek
waar het later komt, al aangeduid.
