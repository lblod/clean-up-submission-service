import { query, update } from 'mu';
import { querySudo, updateSudo } from '@lblod/mu-auth-sudo';
import { deleteFile } from './file-helpers';
import { SparqlJsonParser } from 'sparqljson-parse';
import * as env from './env';
import * as rst from 'rdf-string-ttl';
import * as N3 from 'n3';
const { namedNode } = N3.DataFactory;

(function checkEnvVars() {
  if (!/~ORGANIZATION_ID~/g.test(env.GRAPH_TEMPLATE))
    throw new Error(
      `The GRAPH_TEMPLATE environment variable ${env.GRAPH_TEMPLATE} does not contain a ~ORGANIZATION_ID~.`,
    );
})();

const SENT_STATUS = namedNode(
  'http://lblod.data.gift/concepts/9bd8d86d-bb10-4456-a84e-91e9507c374c',
);

const FORM_DATA_FILE_TYPE = namedNode(
  'http://data.lblod.gift/concepts/form-data-file-type',
);
const ADDITIONS_FILE_TYPE = namedNode(
  'http://data.lblod.gift/concepts/additions-file-type',
);
const REMOVALS_FILE_TYPE = namedNode(
  'http://data.lblod.gift/concepts/removals-file-type',
);
const META_FILE_TYPE = namedNode(
  'http://data.lblod.gift/concepts/meta-file-type',
);

export async function deleteSubmissionViaDocument(document, reqState) {
  const submissionForDocument = await getSubmissionByDocument(
    document,
    reqState?.canUseSudo,
  );
  return deleteSubmission(submissionForDocument, reqState);
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
export async function deleteSubmission(submission, reqState) {
  const canUseSudo = reqState?.canUseSudo;
  const organisationId = await getOrganisationIdFromSubmission(
    submission,
    canUseSudo,
  );
  const submissionGraph = namedNode(
    env.GRAPH_TEMPLATE.replace('~ORGANIZATION_ID~', organisationId.value),
  );
  const submissionInfo = await getSubmissionInfo(
    submission,
    submissionGraph,
    reqState?.canUseSudo,
  );

  if (submissionInfo) {
    const { submissionDocument, submission, formData, task, status } =
      submissionInfo;
    if (status.value !== SENT_STATUS.value) {
      if (task)
        await deleteHarvestedFiles(submission, submissionGraph, canUseSudo);
      if (formData)
        await deleteUploadedFiles(formData, submissionGraph, canUseSudo);
      if (submissionDocument) {
        await deleteLinkedTTLFiles(
          submissionDocument,
          submissionGraph,
          canUseSudo,
        );
        await deleteResource(submissionDocument, submissionGraph, canUseSudo);
      }
      if (formData) await deleteResource(formData, submissionGraph, canUseSudo);
      await deleteResource(submission, submissionGraph, canUseSudo);
      if (task) await deleteTaskwithJob(task, submissionGraph, canUseSudo);
      return {
        message: `Successfully deleted submission ${rst.termToString(submission)} and related files and resources.`,
      };
    }
    const err = new Error(
      `Could not delete submission ${rst.termToString(submission)}, has already been sent`,
    );
    err.status = 409;
    return {
      error: err,
    };
  }
  const err = new Error(
    `Could not find a submission ${rst.termToString(submission)}`,
  );
  err.status = 404;
  return {
    error: err,
  };
}

/*
 * Private
 */

async function deleteHarvestedFiles(submission, graph, canUseSudo) {
  const files = await getHarvestedFiles(submission, graph, canUseSudo);
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
async function deleteUploadedFiles(subject, graph, canUseSudo) {
  const files = await getUploadedFiles(subject, graph, canUseSudo);
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
async function deleteLinkedTTLFiles(submissionDocument, graph, canUseSudo) {
  const additionsFile = await getTTLResource(
    submissionDocument,
    ADDITIONS_FILE_TYPE,
    graph,
    canUseSudo,
  );
  const removalsFile = await getTTLResource(
    submissionDocument,
    REMOVALS_FILE_TYPE,
    graph,
    canUseSudo,
  );
  const metaFile = await getTTLResource(
    submissionDocument,
    META_FILE_TYPE,
    graph,
    canUseSudo,
  );
  const sourceFile = await getTTLResource(
    submissionDocument,
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
async function getUploadedFiles(subject, graph, canUseSudo) {
  const response = await (canUseSudo ? querySudo : query)(`
    ${env.SPARQL_PREFIXES}

    SELECT DISTINCT ?file ?location ?parent
    WHERE {
      GRAPH ${rst.termToString(graph)} {
        ${rst.termToString(subject)} dct:hasPart ?file .
        ?location nie:dataSource ?file .
        OPTIONAL {?parent nie:dataSource ?location .}
      }
    }
  `);

  const parser = new SparqlJsonParser();
  const parsedResults = parser.parseJsonResults(response);
  if (parsedResults.length < 1)
    console.log(
      `Could not find any uploaded files for resource ${rst.termToString(subject)}`,
    );
  return parsedResults.map((binding) => {
    return {
      file: binding?.file,
      location: binding?.location,
    };
  });
}

/**
 * Retrieves all the uploaded files linked to the given resource (submission).
 *
 * @param uri of the resource.
 */
async function getHarvestedFiles(submission, graph, canUseSudo) {
  const response = await (canUseSudo ? querySudo : query)(`
    ${env.SPARQL_PREFIXES}

    SELECT DISTINCT ?remoteDataObject ?physical ?harvestedLogical ?harvestedPhysical
    WHERE {
      GRAPH ${rst.termToString(graph)} {
        ${rst.termToString(submission)} nie:hasPart ?remoteDataObject .
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
      `Could not find any harvested files for resource <${rst.termToString(submission)}>`,
    );
  return parsedResults.map((binding) => {
    return {
      remoteDataObject: binding?.remoteDataObject,
      physical: binding?.physical,
      harvestedLogical: binding?.harvestedLogical,
      harvestedPhysical: binding?.harvestedPhysical,
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
    ${env.SPARQL_PREFIXES}

    SELECT DISTINCT ?logical ?physical
    WHERE {
      GRAPH ${rst.termToString(graph)} {
        ${rst.termToString(submissionDocument)} dct:source ?physical .
        ?physical
          dct:type ${rst.termToString(fileType)} ;
          nie:dataSource ?logical .
      }
    } LIMIT 1
  `);

  const parser = new SparqlJsonParser();
  const parsedResults = parser.parseJsonResults(response);
  if (parsedResults.length < 1) {
    console.log(
      `Part of type ${fileType.value} for submission document ${rst.termToString(submissionDocument)} not found`,
    );
    return;
  }
  return {
    logical: parsedResults[0]?.logical,
    physical: parsedResults[0]?.physical,
  };
}

/**
 * Delete submission resource
 *
 * @param {string} URI of the resource to delete the related files for
 */
async function deleteResource(subject, graph, canUseSudo) {
  return (canUseSudo ? updateSudo : update)(`
    DELETE {
      GRAPH ${rst.termToString(graph)} {
        ${rst.termToString(subject)} ?p ?o .
      }
    }
    WHERE {
      GRAPH ${rst.termToString(graph)} {
        ${rst.termToString(subject)} ?p ?o .
      }
    }
  `);
}

async function deleteTaskwithJob(task, graph, canUseSudo) {
  return (canUseSudo ? updateSudo : update)(`
    ${env.SPARQL_PREFIXES}

    DELETE {
      GRAPH ${rst.termToString(graph)} {
        ?rc ?rp ?ro .
        ?ic ?ip ?io .
        ?hc2 ?hp2 ?ho2 .
        ?hc ?hp ?ho .
        ?dc ?dp ?do .
        ?task ?tp ?to .
        ?job ?jp ?jo .
      }
    } WHERE {
      GRAPH ${rst.termToString(graph)} {
        ${rst.termToString(task)} dct:isPartOf ?job .
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

async function getSubmissionInfo(submission, graph, canUseSudo) {
  const infoQuery = `
    ${env.SPARQL_PREFIXES}

    SELECT DISTINCT ?submission ?formData ?submissionTask ?submissionDocument ?status
    WHERE {
      BIND (${rst.termToString(submission)} AS ?submission)
      GRAPH ${rst.termToString(graph)} {
        ?submission
          a meb:Submission ;
          adms:status ?status .

        OPTIONAL {
          ?submission prov:generated ?formData .
          ?formData a melding:FormData .
        }

        OPTIONAL {
          ?submissionTask
            a task:Task ;
            task:operation taskO:register ;
            dct:isPartOf ?job .
          ?job prov:generated ?submission .
        }

        OPTIONAL {
          ?submission dct:subject ?submissionDocument .
          ?submissionDocument a ext:SubmissionDocument .
        }
      }
    } LIMIT 1`;

  const response = await (canUseSudo ? querySudo : query)(infoQuery);
  const parser = new SparqlJsonParser();
  const parsedResults = parser.parseJsonResults(response);
  if (parsedResults.length > 0) {
    const firstResult = parsedResults[0];
    return {
      submissionDocument: firstResult?.submissionDocument,
      submission: firstResult?.submission,
      formData: firstResult?.formData,
      status: firstResult?.status,
      task: firstResult?.submissionTask,
    };
  }
}

export async function getSubmissionByUUID(uuid, graph, canUseSudo) {
  const graphSparql = graph ? rst.termToString(graph) : '?g';
  const infoQuery = `
    ${env.SPARQL_PREFIXES}

    SELECT DISTINCT ?submission
    WHERE {
      GRAPH ${graphSparql} {
        ?submission
          a meb:Submission ;
          mu:uuid ${rst.termToString(uuid)} .
      }
    } LIMIT 1`;

  const response = await (canUseSudo ? querySudo : query)(infoQuery);
  const parser = new SparqlJsonParser();
  const parsedResults = parser.parseJsonResults(response);
  if (parsedResults.length > 0) {
    const firstResult = parsedResults[0];
    return firstResult.submission;
  }
}

export async function getSubmissionByDocument(submissionDocument, canUseSudo) {
  const response = await (canUseSudo ? querySudo : query)(`
    ${env.SPARQL_PREFIXES}

    SELECT DISTINCT ?submission WHERE {
      ?submission
        dct:subject ${rst.termToString(submissionDocument)} .
    }
    LIMIT 1
  `);
  const parser = new SparqlJsonParser();
  const parsedResults = parser.parseJsonResults(response);
  return parsedResults[0]?.submission;
}

async function getOrganisationIdFromSubmission(submission, canUseSudo) {
  const response = await (canUseSudo ? querySudo : query)(`
    ${env.SPARQL_PREFIXES}

    SELECT DISTINCT ?organisationId
    WHERE {
      ${rst.termToString(submission)}
        pav:createdBy ?bestuurseenheid .
      ?bestuurseenheid mu:uuid ?organisationId .
    }
    LIMIT 1`);
  const parser = new SparqlJsonParser();
  const parsedResults = parser.parseJsonResults(response);
  return parsedResults[0]?.organisationId;
}
