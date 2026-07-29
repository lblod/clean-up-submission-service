import * as mas from '@lblod/mu-auth-sudo';
import * as env from './env';
import * as rst from 'rdf-string-ttl';
import * as sjp from 'sparqljson-parse';
import * as argon2 from 'argon2';

export async function verifyVendorKeyAndOrganisation(
  vendor,
  key,
  organization,
) {
  if (env.USE_HASHED_KEY) {
    // Keys in triplelstore are hashed. Hash the received key for comparing.
    const response = await mas.querySudo(`
      ${env.SPARQL_PREFIXES}
      SELECT DISTINCT ?organizationID ?agentHash WHERE {
        ${rst.termToString(vendor)}
          a foaf:Agent;
          muAccount:keyHash ?agentHash;
          muAccount:canActOnBehalfOf ${rst.termToString(organization)}.
        ${rst.termToString(organization)}
          mu:uuid ?organizationID.
      }`);
    const parser = new sjp.SparqlJsonParser();
    const parsedResults = parser.parseJsonResults(response);
    const storedHash = parsedResults[0]?.agentHash;
    try {
      if (await argon2.verify(storedHash?.value, key?.value))
        return parsedResults[0]?.organizationID;
    } catch (err) {
      throw new Error(
        'An error occured while verifying the hashed key for the vendor.',
        { cause: err },
      );
    }
  } else {
    // Keys are NOT hashed. Just check if vendor, organisation and key
    // combination exists.
    const response = await mas.querySudo(`
      ${env.SPARQL_PREFIXES}
      SELECT DISTINCT ?organizationID WHERE  {
        ${rst.termToString(vendor)}
          a foaf:Agent;
          muAccount:key ${rst.termToString(key)};
          muAccount:canActOnBehalfOf ${rst.termToString(organization)}.
        ${rst.termToString(organization)}
          mu:uuid ?organizationID.
      }`);
    const parser = new sjp.SparqlJsonParser();
    const parsedResults = parser.parseJsonResults(response);
    return parsedResults[0]?.organizationID;
  }
}
