import { uuid } from 'mu';
import { SubmissionRegistrationContext } from './SubmissionRegistrationContext';
import { NAMESPACES as ns } from './env';
import * as N3 from 'n3';
const { namedNode } = N3.DataFactory;

export function enrichBodyForDelete(body) {
  if (!body['@context']) {
    body['@context'] = SubmissionRegistrationContext;
  }
  if (!body['@type']) body['@type'] = ns.meb`Submission`.value;
  if (body.submission) {
    body['@id'] = body.submission;
    delete body.submission;
  }
  if (body.authentication) {
    body.authentication['@id'] =
      `http://data.lblod.info/authentications/${uuid()}`;
    body.authentication.configuration['@id'] =
      `http://data.lblod.info/configurations/${uuid()}`;
    body.authentication.credentials['@id'] =
      `http://data.lblod.info/credentials/${uuid()}`;
  }
  return body;
}

export function extractAuthentication(store) {
  const keys = store.getObjects(
    undefined,
    namedNode('http://mu.semte.ch/vocabularies/account/key'),
  );
  const vendors = store.getObjects(
    undefined,
    namedNode('http://purl.org/pav/providedBy'),
  );
  const organisations = store.getObjects(
    undefined,
    namedNode('http://purl.org/pav/createdBy'),
  );
  return {
    key: keys[0],
    vendor: vendors[0],
    organisation: organisations[0],
  };
}
