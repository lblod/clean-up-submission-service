import { sparqlEscapeString, sparqlEscapeUri, query, update } from 'mu';
import { querySudo, updateSudo } from '@lblod/mu-auth-sudo';
import { deleteFile } from './file-helpers';
import { SparqlJsonParser } from 'sparqljson-parse';
import * as env from 'env-var';

const GRAPH_TEMPLATE = env
  .get('GRAPH_TEMPLATE')
  .example(
    'http://mu.semte.ch/graphs/organizations/~ORGANIZATION_ID~/LoketLB-toezichtGebruiker',
  )
  .default(
    'http://mu.semte.ch/graphs/organizations/~ORGANIZATION_ID~/LoketLB-toezichtGebruiker',
  )
  .asUrlString();

(function checkEnvVars() {
  if (!/~ORGANIZATION_ID~/g.test(GRAPH_TEMPLATE))
    throw new Error(
      `The GRAPH_TEMPLATE environment variable ${GRAPH_TEMPLATE} does not contain a ~ORGANIZATION_ID~.`,
    );
})();

const SENT_STATUS =
  'http://lblod.data.gift/concepts/9bd8d86d-bb10-4456-a84e-91e9507c374c';

const FORM_DATA_FILE_TYPE =
  'http://data.lblod.gift/concepts/form-data-file-type';
const ADDITIONS_FILE_TYPE =
  'http://data.lblod.gift/concepts/additions-file-type';
const REMOVALS_FILE_TYPE = 'http://data.lblod.gift/concepts/removals-file-type';
const META_FILE_TYPE = 'http://data.lblod.gift/concepts/meta-file-type';

export async function deleteSubmissionViaUri(uri, reqState) {
  const uuid = await getSubmissionUuid(uri, reqState?.canUseSudo);
  return deleteSubmission(uuid, reqState);
}

/**
 * Delete a submission resources and properties. Deletes everything it
 * encounters
 *
 * @public
 * @async
 * @function
 * @param {String} uuid - The UUID of the submission-document to be deleted.
 * @returns {Object} Object with optional `message` (string), `uri` (string)
 * and `error` (object). The `error` is a JavaScrip Error object and has
 * `status` (integer) and `message` (string) properties.
 */
export async function deleteSubmission(uuid, reqState) {
  const canUseSudo = reqState?.canUseSudo;
  const organisationId = await getOrganisationIdFromSubmission(
    uuid,
    canUseSudo,
  );
  const submissionGraph = GRAPH_TEMPLATE.replace(
    '~ORGANIZATION_ID~',
    organisationId,
  );
  const submissionInfo = await getSubmissionById(
    uuid,
    submissionGraph,
    reqState?.canUseSudo,
  );

  if (submissionInfo) {
    const {
      submissionDocumentURI,
      submissionURI,
      formDataURI,
      taskURI,
      status,
    } = submissionInfo;
    if (status !== SENT_STATUS) {
      if (taskURI)
        await deleteHarvestedFiles(submissionURI, submissionGraph, canUseSudo);
      if (formDataURI)
        await deleteUploadedFiles(formDataURI, submissionGraph, canUseSudo);
      if (submissionDocumentURI) {
        await deleteLinkedTTLFiles(
          submissionDocumentURI,
          submissionGraph,
          canUseSudo,
        );
        await deleteResource(
          submissionDocumentURI,
          submissionGraph,
          canUseSudo,
        );
      }
      if (formDataURI)
        await deleteResource(formDataURI, submissionGraph, canUseSudo);
      await deleteResource(submissionURI, submissionGraph, canUseSudo);
      if (taskURI)
        await deleteTaskwithJob(taskURI, submissionGraph, canUseSudo);
      return {
        message: `Successfully deleted submission <${submissionURI}> and related files and resources.`,
      };
    }
    const err = new Error(
      `Could not delete submission <${submissionURI}>, has already been sent`,
    );
    err.status = 409;
    return {
      uri: submissionDocumentURI,
      error: err,
    };
  }
  const err = new Error(`Could not find a submission for uuid '${uuid}'`);
  err.status = 404;
  return {
    error: err,
  };
}

/*
 * Private
 */

async function getSubmissionUuid(uri, canUseSudo) {
  const response = await (canUseSudo ? querySudo : query)(`
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    SELECT DISTINCT ?uuid WHERE {
      ${sparqlEscapeUri(uri)} mu:uuid ?uuid .
    } LIMIT 1
  `);
  const parser = new SparqlJsonParser();
  const parsedResults = parser.parseJsonResults(response);
  return parsedResults[0]?.uuid?.value;
}

async function deleteHarvestedFiles(submissionUri, graph, canUseSudo) {
  const files = await getHarvestedFiles(submissionUri, graph, canUseSudo);
  for (const file of files) {
    await deleteFile(file.physical, graph, canUseSudo);
    await deleteFile(file.harvestedPhysical, graph, canUseSudo);
    await deleteResource(file.remoteDataObject, graph, canUseSudo);
    await deleteResource(file.physical, graph, canUseSudo);
    await deleteResource(file.harvestedLogical, graph, canUseSudo);
    await deleteResource(file.harvestedPhysical, graph, canUseSudo);
  }
}

/**
 * Deletes all the linked files for the given resource.
 *
 * @param uri of the resource to delete the linked files for
 */
async function deleteUploadedFiles(uri, graph, canUseSudo) {
  const files = await getUploadedFiles(uri, graph, canUseSudo);
  for (const file of files) {
    await deleteFile(file.location, graph, canUseSudo);
    await deleteResource(file.file, graph, canUseSudo);
    await deleteResource(file.location, graph, canUseSudo);
  }
}

/**
 * Deletes all the linked ttl files for the given URI (submission-document).
 *
 * @param uri resource (submission-document) to delete the linked ttl files for
 */
async function deleteLinkedTTLFiles(uri, graph, canUseSudo) {
  const additionsFile = await getTTLResource(
    uri,
    ADDITIONS_FILE_TYPE,
    graph,
    canUseSudo,
  );
  const removalsFile = await getTTLResource(
    uri,
    REMOVALS_FILE_TYPE,
    graph,
    canUseSudo,
  );
  const metaFile = await getTTLResource(uri, META_FILE_TYPE, graph, canUseSudo);
  const sourceFile = await getTTLResource(
    uri,
    FORM_DATA_FILE_TYPE,
    graph,
    canUseSudo,
  );

  if (additionsFile) {
    await deleteFile(additionsFile.physical, graph, canUseSudo);
    await deleteResource(additionsFile.logical, graph, canUseSudo);
  }
  if (removalsFile) {
    await deleteFile(removalsFile.physical, graph, canUseSudo);
    await deleteResource(removalsFile.logical, graph, canUseSudo);
  }
  if (metaFile) {
    await deleteFile(metaFile.physical, graph, canUseSudo);
    await deleteResource(metaFile.logical, graph, canUseSudo);
  }
  if (sourceFile) {
    await deleteFile(sourceFile.physical, graph, canUseSudo);
    await deleteResource(sourceFile.logical, graph, canUseSudo);
  }
}

/**
 * Retrieves all the uploaded files linked to the given resource (form-data).
 *
 * @param uri of the resource.
 */
async function getUploadedFiles(uri, graph, canUseSudo) {
  const response = await (canUseSudo ? querySudo : query)(`
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX nie: <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#>

    SELECT DISTINCT ?file ?location ?parent
    WHERE {
      GRAPH ${sparqlEscapeUri(graph)} {
        ${sparqlEscapeUri(uri)} dct:hasPart ?file .
        ?location nie:dataSource ?file .
        OPTIONAL {?parent nie:dataSource ?location .}
      }
    }
  `);

  const parser = new SparqlJsonParser();
  const parsedResults = parser.parseJsonResults(response);
  if (parsedResults.length < 1)
    console.log(`Could not find any uploaded files for resource <${uri}>`);
  return parsedResults.map((binding) => {
    return {
      file: binding?.file?.value,
      location: binding?.location?.value,
    };
  });
}

/**
 * Retrieves all the uploaded files linked to the given resource (submission).
 *
 * @param uri of the resource.
 */
async function getHarvestedFiles(submissionUri, graph, canUseSudo) {
  const response = await (canUseSudo ? querySudo : query)(`
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX nie: <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#>
    PREFIX nfo: <http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#>

    SELECT DISTINCT ?remoteDataObject ?physical ?harvestedLogical ?harvestedPhysical
    WHERE {
      GRAPH ${sparqlEscapeUri(graph)} {
        ${sparqlEscapeUri(submissionUri)} nie:hasPart ?remoteDataObject .
        ?remoteDataObject a nfo:RemoteDataObject .
        ?physical
          nie:dataSource ?remoteDataObject ;
          a nfo:FileDataObject .
        ?harvestedPhysical
          nie:dataSource ?physical ;
          a nfo:FileDataObject ;
          nie:dataSource ?harvestedLogical ;
          dct:type <http://data.lblod.gift/concepts/harvested-data> .
        ?harvestedLogical
          a nfo:FileDataObject ;
          dct:type <http://data.lblod.gift/concepts/harvested-data> .
      }
    }
  `);

  const parser = new SparqlJsonParser();
  const parsedResults = parser.parseJsonResults(response);
  if (parsedResults.length < 1)
    console.log(
      `Could not find any harvested files for resource <${submissionUri}>`,
    );
  return parsedResults.map((binding) => {
    return {
      remoteDataObject: binding?.remoteDataObject?.value,
      physical: binding?.physical?.value,
      harvestedLogical: binding?.harvestedLogical?.value,
      harvestedPhysical: binding?.harvestedPhysical?.value,
    };
  });
}

/**
 * Get the file resource in the triplestore of the given file type that is related to the given submission document
 *
 * @param {string} submissionDocument URI of the submitted document to get the related file for
 * @param {string} fileType URI of the type of the related file
 */
async function getTTLResource(submissionDocument, fileType, graph, canUseSudo) {
  const response = await (canUseSudo ? querySudo : query)(`
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX nie: <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#>

    SELECT DISTINCT ?logical ?physical
    WHERE {
      GRAPH ${sparqlEscapeUri(graph)} {
        ${sparqlEscapeUri(submissionDocument)} dct:source ?physical .
        ?physical
          dct:type ${sparqlEscapeUri(fileType)} ;
          nie:dataSource ?logical .
      }
    } LIMIT 1
  `);

  const parser = new SparqlJsonParser();
  const parsedResults = parser.parseJsonResults(response);
  if (parsedResults.length < 1) {
    console.log(
      `Part of type ${fileType} for submission document ${submissionDocument} not found`,
    );
    return;
  }
  return {
    logical: parsedResults[0]?.logical?.value,
    physical: parsedResults[0]?.physical?.value,
  };
}

/**
 * Delete submission resource
 *
 * @param {string} URI of the resource to delete the related files for
 */
async function deleteResource(uri, graph, canUseSudo) {
  return (canUseSudo ? updateSudo : update)(`
    DELETE {
      GRAPH ${sparqlEscapeUri(graph)} {
        ${sparqlEscapeUri(uri)} ?p ?o .
      }
    }
    WHERE {
      GRAPH ${sparqlEscapeUri(graph)} {
        ${sparqlEscapeUri(uri)} ?p ?o .
      }
    }
  `);
}

async function deleteTaskwithJob(taskUri, graph, canUseSudo) {
  return (canUseSudo ? updateSudo : update)(`
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX task: <http://redpencil.data.gift/vocabularies/tasks/>

    DELETE {
      GRAPH ${sparqlEscapeUri(graph)} {
        ?rc ?rp ?ro .
        ?ic ?ip ?io .
        ?hc2 ?hp2 ?ho2 .
        ?hc ?hp ?ho .
        ?dc ?dp ?do .
        ?task ?tp ?to .
        ?job ?jp ?jo .
      }
    } WHERE {
      GRAPH ${sparqlEscapeUri(graph)} {
        ${sparqlEscapeUri(taskUri)} dct:isPartOf ?job .
        ?job ?jp ?jo .
        ?task
          dct:isPartOf ?job ;
          ?tp ?to .

        OPTIONAL {
          ?task task:inputContainer ?ic .
          ?ic ?ip ?io .
          ?ic task:hasHarvestingCollection ?hc .
          ?hc ?hp ?ho .
        }
        OPTIONAL {
          ?task task:resultsContainer ?rc .
          ?rc ?rp ?ro .
          ?rc task:hasHarvestingCollection ?hc2 .
          ?hc2 ?hp2 ?ho2 .
        }
        OPTIONAL {
          ?task task:inputContainer ?ic .
          ?ic ?ip ?io .
        }
        OPTIONAL {
          ?task task:resultsContainer ?rc .
          ?rc ?rp ?ro .
        }
      }
    }
  `);
}

async function getSubmissionById(submissionId, graph, canUseSudo) {
  const infoQuery = `
    PREFIX meb: <http://rdf.myexperiment.org/ontologies/base/>
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX prov: <http://www.w3.org/ns/prov#>
    PREFIX melding: <http://lblod.data.gift/vocabularies/automatische-melding/>
    PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX adms: <http://www.w3.org/ns/adms#>
    PREFIX task: <http://redpencil.data.gift/vocabularies/tasks/>
    PREFIX taskO: <http://lblod.data.gift/id/jobs/concept/TaskOperation/>

    SELECT DISTINCT ?submission ?formData ?submissionTask ?submissionDocument ?status
    WHERE {
      GRAPH ${sparqlEscapeUri(graph)} {
        ?submission a meb:Submission;
           mu:uuid ${sparqlEscapeString(submissionId)};
           adms:status ?status.

        OPTIONAL {
          ?submission prov:generated ?formData.
          ?formData a melding:FormData.
        }

        OPTIONAL {
          ?submissionTask
            a task:Task ;
            task:operation taskO:register ;
            dct:isPartOf ?job .
          ?job prov:generated ?submission.
        }

        OPTIONAL {
          ?submission dct:subject ?submissionDocument.
          ?submissionDocument a ext:SubmissionDocument.
        }
      }
    } LIMIT 1
  `;

  const response = await (canUseSudo ? querySudo : query)(infoQuery);
  const parser = new SparqlJsonParser();
  const parsedResults = parser.parseJsonResults(response);
  if (parsedResults.length > 0) {
    const firstResult = parsedResults[0];
    return {
      submissionDocumentURI: firstResult?.submissionDocument?.value,
      submissionURI: firstResult?.submission?.value,
      formDataURI: firstResult?.formData?.value,
      status: firstResult?.status?.value,
      taskURI: firstResult?.submissionTask?.value,
    };
  }
}

async function getOrganisationIdFromSubmission(submissionUuid, canUseSudo) {
  const response = await (canUseSudo ? querySudo : query)(`
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX prov: <http://www.w3.org/ns/prov#>
    PREFIX pav:  <http://purl.org/pav/>

    SELECT DISTINCT ?organisationId WHERE {
      ?submission
        mu:uuid ${sparqlEscapeString(submissionUuid)} ;
        pav:createdBy ?bestuurseenheid .
      ?bestuurseenheid mu:uuid ?organisationId .
    }
    LIMIT 1
  `);
  return response?.results?.bindings[0]?.organisationId?.value;
}
