/**
 * Downloadt het taalmodel voor naamherkenning (NER) één keer naar de map
 * `modellen/`. Daarna draait de applicatie volledig offline: tijdens het
 * classificeren wordt er nooit iets van internet gehaald.
 *
 * Gebruik: npm run model
 *
 * Het model (ca. 180 MB) staat niet in de repository, omdat het daarvoor te
 * groot is. Het komt van Hugging Face, de gangbare plek waar zulke open
 * modellen gepubliceerd worden.
 */

import { mkdirSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { NER_MODEL, MODELMAP } from '../src/classificatie/ner.js';

const BESTANDEN = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'onnx/model_quantized.onnx',
];

for (const bestand of BESTANDEN) {
  const doel = join(MODELMAP, NER_MODEL, bestand);
  if (existsSync(doel) && statSync(doel).size > 0) {
    console.log(`al aanwezig: ${bestand}`);
    continue;
  }
  const url = `https://huggingface.co/${NER_MODEL}/resolve/main/${bestand}`;
  console.log(`downloaden: ${bestand}`);
  const antwoord = await fetch(url);
  if (!antwoord.ok) throw new Error(`Downloaden van ${url} mislukt: ${antwoord.status}`);
  mkdirSync(dirname(doel), { recursive: true });
  writeFileSync(doel, Buffer.from(await antwoord.arrayBuffer()));
}

console.log(`Klaar. Het model staat in ${join(MODELMAP, NER_MODEL)}.`);
