import { app, errorHandler, uuid } from 'mu';
import bodyParser from 'body-parser';
import * as del from './delete';
import * as auth from './authentication';
import * as jsonld from 'jsonld';
import * as jli from './jsonld-input';
import * as err from './error';
import * as errcon from './ErrorContexts';
import * as N3 from 'n3';
const { literal, blankNode } = N3.DataFactory;
import { NAMESPACES as ns } from './env';

app.get('/', function (req, res) {
  res.send('Hello from clean-up-submission-service');
});

app.use(bodyParser.json({ type: 'application/ld+json' }));
app.use(bodyParser.json());
app.use(errorHandler);

app.delete('/submissions/:uuid', async function (req, res) {
  const uuid = literal(req.params.uuid);
  console.log(
    `Received request to delete submission-document with uuid '${uuid.value}'`,
  );
  try {
    const reqState = { canUseSudo: false };
    const submission = await del.getSubmissionByUUID(uuid, reqState.canUseSudo);
    const { message, error } = await del.deleteSubmission(submission, reqState);
    if (error) return res.status(error.status).send({ error: error.message });
    return res.status(200).send(message);
  } catch (e) {
    const message = `Something unexpected went wrong while deleting submission with uuid '${uuid}'`;
    console.log(message);
    console.error(e);
    await err.sendErrorAlert({ message, detail: e.message });
    res.status(500).send(`${message}\n${e.message}`);
  }
});

app.post('/delete-melding', async function (req, res) {
  try {
    const reqState = { canUseSudo: true };
    await ensureValidContentType(req.get('content-type'));
    const enrichedBody = await jli.enrichBodyForDelete(req.body);
    const store = await jsonLdToStore(enrichedBody);

    await ensureAuthorisation(store);

    const submissionDocument = store.getObjects(undefined, ns.dct`subject`)[0];
    let submission = store.getSubjects(ns.rdf`type`, ns.meb`Submission`)[0];
    if (submission?.termType === 'BlankNode') submission = undefined;

    if (!(submissionDocument || submission))
      throw new Error(
        'There was no Submission or SubmissionDocument URI in the request',
      );

    // We want the Submission, so convert from the SubmissionDocument.
    if (submissionDocument) {
      const submissionForDocument = await del.getSubmissionByDocument(
        submissionDocument,
        reqState.canUseSudo,
      );
      if (!submissionForDocument)
        throw new Error(
          'A Submission could not be found related to the given SubmissionDocument',
        );
      // If both were given in the request, at least make sure they match.
      if (submission && submission.value !== submissionForDocument.value) {
        throw new Error(
          'The given Submission and SubmissionDocument do not match. These refer to different submissions.',
        );
      }
      submission = submissionForDocument;
    }

    const { message, error } = await del.deleteSubmission(submission, reqState);
    if (error) {
      res.status(error.status || 500);
      const errorStore = errorToStore(error);
      const errorJsonld = await storeToJsonLd(
        errorStore,
        errcon.ErrorResponseContext,
        errcon.ErrorResponseFrame,
      );
      return res.json(errorJsonld);
    }
    return res.status(200).send({ message });
  } catch (error) {
    const message = 'Something went wrong while processing the delete request.';
    console.error(message, error.message);
    console.error(error);
    await err.sendErrorAlert({ message, detail: error.message });
    res.status(500).send(`${message}\n${error.message}`);
  }
});

///////////////////////////////////////////////////////////////////////////////
// Helpers
///////////////////////////////////////////////////////////////////////////////

function ensureValidContentType(contentType) {
  if (!/application\/(ld\+)?json/.test(contentType))
    throw new Error(
      'Content-Type not valid, only application/json or application/ld+json are accepted',
    );
}

async function ensureAuthorisation(store) {
  const authentication = jli.extractAuthentication(store);
  if (!(
    authentication.vendor &&
    authentication.key &&
    authentication.organisation
  ))
    throw new Error(
      'The authentication (or part of it) for this request is missing. Make sure to supply publisher (with vendor URI and key) and organization information to the request.',
    );
  const organisationID = await auth.verifyVendorKeyAndOrganisation(
    authentication.vendor,
    authentication.key,
    authentication.organisation,
  );
  if (!organisationID) {
    const error = new Error(
      'Authentication failed, vendor does not have access to the organization or does not exist. If this should not be the case, please contact us at digitaalABB@vlaanderen.be for login credentials.',
    );
    error.reference = authentication.vendor.value;
    throw error;
  }
  return organisationID;
}

async function jsonLdToStore(jsonLdObject) {
  const requestQuads = await jsonld.default.toRDF(jsonLdObject, {});
  const store = new N3.Store();
  store.addQuads(requestQuads);
  return store;
}

async function storeToJsonLd(store, context, frame) {
  const jsonld1 = await jsonld.default.fromRDF([...store], {});
  const framed = await jsonld.default.frame(jsonld1, frame);
  const compacted = await jsonld.default.compact(framed, context);
  return compacted;
}

/*
 * Produces an RDF store with the data to encode an error in the OSLC namespace.
 *
 * @function
 * @param {Error} errorObject - Instance of the standard JavaScript Error class
 * or similar object that has a `message` property.
 * @returns {N3.Store} A new Store with the properties to represent the error.
 */
function errorToStore(errorObject) {
  const store = new N3.Store();
  const error = blankNode(uuid());
  store.addQuad(
    error,
    'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
    'http://open-services.net/ns/core#Error',
  );
  store.addQuad(
    error,
    'http://mu.semte.ch/vocabularies/core/uuid',
    literal(uuid()),
  );
  store.addQuad(
    error,
    'http://open-services.net/ns/core#message',
    literal(errorObject.message),
  );
  return store;
}
