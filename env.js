import envvar from 'env-var';
import * as N3 from 'n3';
const { namedNode } = N3.DataFactory;

export const GRAPH_TEMPLATE = envvar
  .get('GRAPH_TEMPLATE')
  .example(
    'http://mu.semte.ch/graphs/organizations/~ORGANIZATION_ID~/LoketLB-toezichtGebruiker',
  )
  .default(
    'http://mu.semte.ch/graphs/organizations/~ORGANIZATION_ID~/LoketLB-toezichtGebruiker',
  )
  .asUrlString();

export const USE_HASHED_KEY = envvar
  .get('USE_HASHED_KEY')
  .default('true')
  .asBool();

const PREFIXES = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  mu: 'http://mu.semte.ch/vocabularies/core/',
  foaf: 'http://xmlns.com/foaf/0.1/',
  muAccount: 'http://mu.semte.ch/vocabularies/account/',
  wotSec: 'https://www.w3.org/2019/wot/security#',
  lblodAuth: 'http://lblod.data.gift/vocabularies/authentication/',
  pav: 'http://purl.org/pav/',
  prov: 'http://www.w3.org/ns/prov#',
  session: 'http://mu.semte.ch/vocabularies/session/',
  oslc: 'http://open-services.net/ns/core#',
  dct: 'http://purl.org/dc/terms/',
  meb: 'http://rdf.myexperiment.org/ontologies/base/',
  melding: 'http://lblod.data.gift/vocabularies/automatische-melding/',
  ext: 'http://mu.semte.ch/vocabularies/ext/',
  adms: 'http://www.w3.org/ns/adms#',
  task: 'http://redpencil.data.gift/vocabularies/tasks/',
  taskO: 'http://lblod.data.gift/id/jobs/concept/TaskOperation/',
  nie: 'http://www.semanticdesktop.org/ontologies/2007/01/19/nie#',
  nfo: 'http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#',
};

export const NAMESPACES = (() => {
  const all = {};
  for (const key in PREFIXES)
    all[key] = (pred) => namedNode(`${PREFIXES[key]}${pred}`);
  return all;
})();

export const SPARQL_PREFIXES = (() => {
  const all = [];
  for (const key in PREFIXES) all.push(`PREFIX ${key}: <${PREFIXES[key]}>`);
  return all.join('\n');
})();
