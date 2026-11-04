/**
 * De betekenis van de velden in de API, als JSON-LD-context.
 *
 * Een sleutel als `titel` zegt een ander systeem niets. Door elke sleutel te
 * koppelen aan een term uit een open vocabularium, weet elk systeem dat die
 * vocabularia kent precies wat bedoeld wordt, zonder afspraken op maat. Dat is
 * het principe achter OSLO en DCAT-AP in Vlaanderen: verzin geen eigen
 * sleutelnamen zonder ze te mappen.
 *
 * Gebruikte vocabularia, allemaal open en gangbaar in de publieke sector:
 * - Dublin Core Terms (dct): titel, identificatie, datum, formaat, toegang;
 * - DCAT (dcat): bestandsgrootte;
 * - SPDX (spdx): controlesom;
 * - PROV-O (prov): herkomst, wie iets aanleverde.
 *
 * Een antwoord van `GET /api/documenten/:id` verwijst met `@context` naar dit
 * document. Wie het als gewone JSON leest, merkt er niets van; wie het als
 * JSON-LD leest, krijgt de betekenis erbij.
 */

export const JSONLD_CONTEXT = {
  '@context': {
    '@version': 1.1,
    dct: 'http://purl.org/dc/terms/',
    dcat: 'http://www.w3.org/ns/dcat#',
    spdx: 'http://spdx.org/rdf/terms#',
    prov: 'http://www.w3.org/ns/prov#',
    xsd: 'http://www.w3.org/2001/XMLSchema#',

    id: '@id',
    titel: 'dct:title',
    bron: 'prov:wasAttributedTo',
    bestandsnaam: 'dct:alternative',
    mimetype: 'dct:format',
    grootte_bytes: { '@id': 'dcat:byteSize', '@type': 'xsd:integer' },
    sha256: 'spdx:checksum',
    classificatie: 'dct:accessRights',
    aangemaakt_op: { '@id': 'dct:created', '@type': 'xsd:dateTime' },
    bewaren_tot: { '@id': 'dct:valid', '@type': 'xsd:dateTime' },
    beleidsversie: 'dct:conformsTo',
  },
} as const;
