# `clean-up-submission-service`

Microservice responsible for removing/cleaning-up submissions. Only submissions
that are not in status "SENT" can be removed. This means submissions that have
failed in their pipeline, or submissions that are not fully complete and need
human spection.

## Installation

To add the service to your stack, add the following snippet to
`docker-compose.yml`:

```
services:
  remove-submission:
    image: lblod/clean-up-submission-service:x.x.x
  volumes:
    - ./data/files:/share
```

The volume mounted in `/share` must contain the cached downloads of the
published documents.

## Configuration

* `USE_HASHED_KEY`: <em>(optional, default: `true`)</em> If set to `true`, the
  service will match the provided key against the hash stored in the triplestore
  while validating the credentials for the vendor. Set to `false`, the unhashed,
  original key is fetched from the triplestore and used to compare.
* `GRAPH_TEMPLATE`: <em>(optional, default:
  `http://mu.semte.ch/graphs/organizations/~ORGANIZATION_ID~/LoketLB-toezichtGebruiker`)</em>
  template string indicating where to find, and remove from, the submission. The
  substring `~ORGANIZATION_ID~` will be replaced with the UUID of the
  organization the submission belongs to.

## REST API

### DELETE /submissions/:uuid

Deletes/cleans-up the given submission using the session of the caller (no
`mu-auth-sudo`).

Return values:

* `200 OK` when the submission was deleted.
* `409 CONFLICT` when the submission could not be removed.
* `404 NOT FOUND` when the submission could not be found.
* `500 INTERNAL SERVER ERROR` when something unexpected happened while
  processing the submission.

### POST /delete-melding

This is meant for vendors using the Meldingsplicht API. Deletes/cleans-up the
given submission using the same API as the `automatic-submission-service`, but
some properties are not needed. Below is a minimal request for deleting a
Submission, where the Submission URI is supplied via the property `submission`.

```bash
curl -X POST \
  --url http://remove-submission/delete-melding \
  --header 'accept: application/json' \
  --header 'content-type: application/json' \
  --data '
{
  "organization": "http://data.lblod.info/id/bestuurseenheden/2498239",
  "publisher": {
    "uri": "http://data.lblod.info/vendors/acme",
    "key": "secret"
  },
  "submission": "http://data.lblod.info/submission/45687564oeu789"
}
'
```

It is also possible to delete a Submission by giving the SubmissionDocument
instead. This also follows the same RDF context as with the
`automatic-submission-service`. Supply the SubmissionDocument via the property
`submittedResource`, as seen below.

```bash
curl -X POST \
  --url http://remove-submission/delete-melding \
  --header 'accept: application/json' \
  --header 'content-type: application/json' \
  --data '
{
  "organization": "http://data.lblod.info/id/bestuurseenheden/2498239",
  "publisher": {
    "uri": "http://data.lblod.info/vendors/acme",
    "key": "secret"
  },
  "submittedResource": "http://data.zonnedorp.be/besluiten/2398230"
}
'
```

If both `submission` and `submittedResource` are given, then they need to be
related to each other. If not, an error is thrown.

Return values:

* `200 OK` when the submission was deleted.
* `409 CONFLICT` when the submission could not be removed.
* `404 NOT FOUND` when the submission could not be found.
* `500 INTERNAL SERVER ERROR` when something unexpected happened while
  processing the submission.
