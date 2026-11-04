/**
 * Startpunt van de toepassing.
 *
 * Dit is de enige plek waar configuratie uit omgevingsvariabelen gelezen
 * wordt. Daarna worden databank en instellingen doorgegeven aan de app.
 * Alle endpoints staan in `app.ts`, zodat ze ook zonder draaiende server
 * getest kunnen worden.
 */

import { randomBytes } from 'node:crypto';
import { maakDatabase } from '../opslag/database.js';
import { STANDAARD_OPSLAGWORTEL } from '../opslag/bestandsopslag.js';
import { maakApp } from './app.js';
import { verwijderVerlopen } from '../verwerking/opruiming.js';
import { warmOpOcr } from '../classificatie/ocr.js';
import { warmOpNer } from '../classificatie/ner.js';

const db = maakDatabase(process.env.DATABANK ?? './data/civios.db');

// Het tokengeheim staat nooit in de code. Is het niet ingesteld, dan maken we
// er bij het opstarten een willekeurig aan: veilig, maar na een herstart moet
// iedereen opnieuw aanmelden.
let tokengeheim = process.env.TOKENGEHEIM;
if (!tokengeheim) {
  tokengeheim = randomBytes(32).toString('hex');
  console.warn(
    'TOKENGEHEIM is niet ingesteld: er is een willekeurig geheim aangemaakt. ' +
      'Na een herstart moet iedereen opnieuw aanmelden.',
  );
}

const opslagwortel = process.env.OPSLAGWORTEL ?? STANDAARD_OPSLAGWORTEL;
const app = maakApp(db, { tokengeheim, opslagwortel });

// Opruiming na de bewaartermijn: bij het opstarten en daarna elke dag. Het
// auditspoor van verwijderde documenten blijft bestaan.
const ruimOp = () => {
  const rapport = verwijderVerlopen(db, opslagwortel);
  if (rapport.verwijderd || rapport.mislukt) {
    console.log(`Opruiming bewaartermijn: ${rapport.verwijderd} verwijderd, ${rapport.mislukt} mislukt.`);
  }
};
ruimOp();
setInterval(ruimOp, 24 * 60 * 60 * 1000).unref();

const poort = Number(process.env.POORT ?? 3000);
app.listen(poort, () => {
  console.log(`Civios documentclassificatie draait op http://localhost:${poort}`);
});

// De modellen voor tekst- en naamherkenning alvast laden, zodat de eerste
// aanvraag niet traag is. De server draait intussen al; mislukt het laden, dan
// werkt alles verder met de veilige terugval (nazicht, nooit publiek).
void Promise.all([warmOpOcr(), warmOpNer()]).then(([ocr, ner]) => {
  console.log(
    `Tekstherkenning: ${ocr ? 'klaar' : 'NIET beschikbaar'} · ` +
      `Naamherkenning: ${ner ? 'klaar' : 'NIET beschikbaar (voer npm run model uit)'}`,
  );
});
