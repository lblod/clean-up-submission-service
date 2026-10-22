import { updateSudo } from '@lblod/mu-auth-sudo';
import { uuid } from 'mu';
import { NAMESPACES as ns } from './env';
import * as rst from 'rdf-string-ttl';
import * as N3 from 'n3';
const { namedNode, literal } = N3.DataFactory;

const CREATOR = namedNode(
  'http://lblod.data.gift/services/clean-up-submission-service',
);

export async function sendErrorAlert({ message, detail, reference }) {
  if (!message) throw 'Error needs a message describing what went wrong.';
  const currentTime = literal(new Date().toISOString(), ns.xsd`dateTime`);
  const id = literal(uuid());
  const errorSubject = namedNode(`http://data.lblod.info/errors/${id.value}`);
  const referenceTriple = reference
    ? `${rst.termToString(errorSubject)}
         dct:references ${rst.termToString(reference)} .`
    : '';
  const detailTriple = detail
    ? `${rst.termToString(errorSubject)}
         oslc:largePreview ${rst.termToString(literal(detail))} .`
    : '';
  const q = `
    PREFIX mu:   <http://mu.semte.ch/vocabularies/core/>
    PREFIX oslc: <http://open-services.net/ns/core#>      
    PREFIX dct:  <http://purl.org/dc/terms/>
    PREFIX xsd:  <http://www.w3.org/2001/XMLSchema#>
    
    INSERT DATA {
      GRAPH <http://mu.semte.ch/graphs/error> {
        ${rst.termToString(errorSubject)}
          a oslc:Error ;
          mu:uuid ${rst.termToString(id)} ;
          dct:subject ${rst.termToString(literal('Cleanup Submission Service'))} ;
          oslc:message ${rst.termToString(literal(message))} ;
          dct:created ${rst.termToString(currentTime)} ;
          dct:creator ${rst.termToString(CREATOR)} .
        ${referenceTriple}
        ${detailTriple}
      }
    }`;
  try {
    await updateSudo(q);
    return errorSubject;
  } catch (e) {
    console.warn(
      `[WARN] Something went wrong while trying to store an error.\nMessage: ${e}\nQuery: ${q}`,
    );
  }
}
