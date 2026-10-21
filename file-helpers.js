import { update } from 'mu';
import { updateSudo } from '@lblod/mu-auth-sudo';
import fs from 'fs/promises';
import * as rst from 'rdf-string-ttl';

/**
 * Deletes a file in the triplestore and on disk
 */
export async function deleteFile(file, graph, canUseSudo) {
  const path = file.value.replace('share://', '/share/');

  try {
    await fs.unlink(path);
  } catch (e) {
    console.log(
      `Failed to delete file ${rst.termToString(file)} on disk, but continuing anyways: \n ${e}.`,
    );
  }

  try {
    await (canUseSudo ? updateSudo : update)(`
      DELETE WHERE {
        GRAPH ${rst.termToString(graph)} {
          ${rst.termToString(file)} ?p ?o .
        }
      }`);
  } catch (e) {
    console.log(
      `Failed to delete TTL resource ${rst.termToString(file)} in triplestore: \n ${e}`,
    );
    throw e;
  }
}
