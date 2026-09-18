#include "config.h"

#include <libnetq/Library.h>
#include <libnetq/fs/Path.h>
#include <libnetq/ErrorCode.h>
#include <libnetq/http/HttpHeader.h>
#include <libnetq/http/HttpMethod.h>
#include <libnetq/http/HttpStatus.h>
#include <libnetq/http/HttpRequest.h>
#include <libnetq/http/MediaType.h>
#include <libnetq/Module.h>
#include <libnetq/Malloc.h>
#include <libnetq/ByteBuffer.h>
#include <libnetq/JSON.h>
#include <libnetq/web/WebRequest.h>
#include <libnetq/web/WebResponse.h>
#include <libnetq/web/WebServer.h>
#include <libnetq/web/WebManifest.h>

#include <libpsl.h>

/* Largest JSON body accepted on the endpoint. */
#define PUBSUFFIX_REQUEST_BODY_MAX (64 * 1024)

/*
 * libpsl's built-in table: static storage, read-only, never freed. Lookups
 * against it are safe to run concurrently, so unlike the old libpostal
 * module this needs no init-time model load or a one-request-at-a-time lock.
 */
static const psl_ctx_t* s_psl = NULL;

typedef struct WebPubsuffixExecutor WebPubsuffixExecutor;
struct WebPubsuffixExecutor {
  NQWebExecutor executor;
  NQWebManifestListeners manifestListeners;
  struct NQWebRequestListener postalListener;
};

/* Accumulate-and-decode plumbing for the endpoint's JSON body. */
typedef struct RequestContext RequestContext;
struct RequestContext {
  NQByteBuffer body;
  bool tooLarge;
};

static bool responseJsonWrite(void* userdata, const char* characters, size_t size)
{
  NQWebResponse* response = (NQWebResponse*)userdata;
  return NQWebResponse_write(response, characters, size) >= 0;
}

/* { "error": "..." } — the shape the client's api.ts unwraps for its messages. */
static int responseJsonError(NQJSONWriter* writer, int status, const char* message)
{
  NQJSONWriter_writeObjectBegin(writer);
  NQJSONWriter_writeKeyString(writer, "error", message);
  NQJSONWriter_writeObjectEnd(writer);
  NQJSONWriter_finalize(writer);
  return status;
}

static int requestBodyInit(NQWebRequest* request, void* data)
{
  NQ_UNUSED_PARAM(data);

  RequestContext* ctx = (RequestContext*)NQMalloc(sizeof(*ctx));
  if (ctx == NULL)
    return -NQ_ENOMEM;

  ctx->tooLarge = false;
  NQByteBuffer_init(&ctx->body);

  request->userdata = ctx;
  return 0;
}

static size_t requestBodyReceive(NQWebRequest* request, const char* data, size_t size)
{
  RequestContext* ctx = (RequestContext*)request->userdata;

  /* Drain oversized bodies rather than aborting, so the handler can answer in JSON. */
  if (ctx->tooLarge)
    return size;

  if (NQByteBuffer_size(&ctx->body) + size > PUBSUFFIX_REQUEST_BODY_MAX) {
    ctx->tooLarge = true;
    NQByteBuffer_clear(&ctx->body);
    return size;
  }

  (void)NQByteBuffer_append(&ctx->body, (const uint8_t*)data, size);
  return size;
}

static void requestBodyRelease(NQWebRequest* request)
{
  RequestContext* ctx = (RequestContext*)request->userdata;
  if (ctx == NULL)
    return;
  NQByteBuffer_finalize(&ctx->body);
  NQFree(ctx);
  request->userdata = NULL;
}

/* ------------------------------------------------------------ JSON body decode */

static NQJSON* requestBodyDecode(RequestContext* ctx, NQJSONWriter* writer, int* status)
{
  if (ctx->tooLarge) {
    *status = responseJsonError(writer, NQ_HTTP_REQUEST_ENTITY_TOO_LARGE, "Request body too large");
    return NULL;
  }

  size_t size = NQByteBuffer_size(&ctx->body);
  if (size == 0) {
    *status = responseJsonError(writer, NQ_HTTP_BAD_REQUEST, "Request body must be valid JSON");
    return NULL;
  }

  NQJSON* root = NQJSON_parse2((const char*)NQByteBuffer_data(&ctx->body), size);
  if (root == NULL || !NQJSON_isObject(root)) {
    NQJSON_release(root);
    *status = responseJsonError(writer, NQ_HTTP_BAD_REQUEST, "Request body must be a JSON object");
    return NULL;
  }

  return root;
}

static const char* optionalString(const NQJSON* json, const char* key)
{
  const char* value = NULL;
  if (!NQJSON_objectGetString(json, key, &value))
    return NULL;
  return value;
}

/* ------------------------------------------------------------------ methods */

/* Maps a "types" array entry (as sent by the client) to a PSL_TYPE_* bit. */
static bool suffixTypeFromName(const char* name, int* type)
{
  if (NQStrcmp(name, "icann") == 0) {
    *type = PSL_TYPE_ICANN;
    return true;
  }
  if (NQStrcmp(name, "private") == 0) {
    *type = PSL_TYPE_PRIVATE;
    return true;
  }
  if (NQStrcmp(name, "no_star_rule") == 0) {
    *type = PSL_TYPE_NO_STAR_RULE;
    return true;
  }
  return false;
}

/*
 * Builds the domain_info response — the only thing this endpoint does.
 * Normalizes the domain (psl_str_to_utf8lower), then runs the suffix check
 * and the registrable/unregistrable split against that normalized form,
 * matching how libpsl compares internally. An optional "cookie_domain" folds
 * in a cookie-acceptability check, against the normalized domain as hostname.
 * The response also carries the built-in table's own metadata (version, rule
 * counts) — that costs nothing extra to compute, so it is always included.
 */
static int domainInfoRespond(const NQJSON* root, NQJSONWriter* writer)
{
  const char* domain = optionalString(root, "domain");
  if (domain == NULL || domain[0] == '\0')
    return responseJsonError(writer, NQ_HTTP_BAD_REQUEST, "\"domain\" is required");

  /* NULL encoding tells libpsl to assume the input is already UTF-8. */
  const char* encoding = optionalString(root, "encoding");

  char* normalized = NULL;
  psl_error_t normalizeErr = psl_str_to_utf8lower(domain, encoding, NULL, &normalized);
  if (normalizeErr != PSL_SUCCESS || normalized == NULL)
    return responseJsonError(writer, NQ_HTTP_BAD_REQUEST, "Could not normalize \"domain\"");

  /* Unrecognised entries are skipped rather than rejected, so the request stays
   * forward-compatible with type names this build does not know yet. */
  int type = 0;

  NQJSON* types = NQJSON_objectGet(root, "types");
  if (types != NULL && NQJSON_isArray(types)) {
    size_t count = NQJSON_arraySize(types);
    for (size_t i = 0; i < count; ++i) {
      const char* name = NULL;
      if (!NQJSON_arrayGetString(types, i, &name) || name == NULL)
        continue;
      int flag = 0;
      if (suffixTypeFromName(name, &flag))
        type |= flag;
    }
  }

  /* No (recognised) types given: match libpsl's own default of ICANN + PRIVATE. */
  if (type == 0)
    type = PSL_TYPE_ICANN | PSL_TYPE_PRIVATE;

  bool isSuffix = psl_is_public_suffix2(s_psl, normalized, type) != 0;
  /* Both point inside `normalized` — written out below before it is freed. */
  const char* registrable = psl_registrable_domain(s_psl, normalized);
  const char* unregistrable = psl_unregistrable_domain(s_psl, normalized);

  NQJSONWriter_writeObjectBegin(writer);
  NQJSONWriter_writeKeyString(writer, "domain", domain);
  NQJSONWriter_writeKeyString(writer, "normalized", normalized);
  NQJSONWriter_writeKeyBool(writer, "is_public_suffix", isSuffix);
  if (registrable != NULL)
    NQJSONWriter_writeKeyString(writer, "registrable_domain", registrable);
  if (unregistrable != NULL)
    NQJSONWriter_writeKeyString(writer, "unregistrable_domain", unregistrable);

  /* Optional: fold in the cookie_domain_acceptable check, against `normalized`
   * as the hostname. Omitted entirely when the request did not ask for it. */
  const char* cookieDomain = optionalString(root, "cookie_domain");
  if (cookieDomain != NULL && cookieDomain[0] != '\0') {
    bool acceptable = psl_is_cookie_domain_acceptable(s_psl, normalized, cookieDomain) != 0;
    NQJSONWriter_writeKeyString(writer, "cookie_domain", cookieDomain);
    NQJSONWriter_writeKeyBool(writer, "cookie_domain_acceptable", acceptable);
  }

  /* library_info's fields — no extra request input needed, so always included. */
  const char* sha1sum = psl_builtin_sha1sum();
  const char* builtinFilename = psl_builtin_filename();
  const char* distFilename = psl_dist_filename();
  time_t fileTime = psl_builtin_file_time();

  NQJSONWriter_writeKeyString(writer, "version", psl_get_version());
  NQJSONWriter_writeKeyInt32(writer, "suffix_count", psl_suffix_count(s_psl));
  NQJSONWriter_writeKeyInt32(writer, "suffix_exception_count", psl_suffix_exception_count(s_psl));
  NQJSONWriter_writeKeyInt32(writer, "suffix_wildcard_count", psl_suffix_wildcard_count(s_psl));
  if (fileTime > 0)
    NQJSONWriter_writeKeyInt64(writer, "builtin_file_time", (int64_t)fileTime);
  if (sha1sum != NULL)
    NQJSONWriter_writeKeyString(writer, "builtin_sha1sum", sha1sum);
  if (builtinFilename != NULL)
    NQJSONWriter_writeKeyString(writer, "builtin_filename", builtinFilename);
  if (distFilename != NULL)
    NQJSONWriter_writeKeyString(writer, "dist_filename", distFilename);
  NQJSONWriter_writeKeyBool(writer, "builtin_outdated", psl_builtin_outdated() != 0);

  NQJSONWriter_writeObjectEnd(writer);
  NQJSONWriter_finalize(writer);

  psl_free_string(normalized);

  return writer->hasError ? NQ_HTTP_INTERNAL_SERVER_ERROR : NQ_HTTP_OK;
}

/*
 * The endpoint: one POST to PUBSUFFIX_PSL_URL, the body being domain_info's
 * arguments directly (no "method" field — this is the only thing it does).
 */
static int requestPostalHandler(NQWebRequest* request, NQWebResponse* response)
{
  RequestContext* ctx = (RequestContext*)request->userdata;

  NQWebResponse_setHeader(response, NQHTTP_HEADER_CONTENT_TYPE, NQ_MEDIATYPE_APPLICATION_JSON);

  NQJSONWriter writer;
  NQJSONWriter_init(&writer, &responseJsonWrite, response);

  int status = NQ_HTTP_OK;
  NQJSON* root = requestBodyDecode(ctx, &writer, &status);
  if (root == NULL)
    return status;

  status = domainInfoRespond(root, &writer);

  NQJSON_release(root);
  return status;
}

static const NQWebRequestOperations kPostalOps = {
  .init = requestBodyInit,
  .receive = requestBodyReceive,
  .handler = requestPostalHandler,
  .release = requestBodyRelease,
};

static int executorInit(NQWebExecutor* executor, void* data)
{
  NQ_UNUSED_PARAM(data);

  struct WebPubsuffixExecutor* pubsuffix = (struct WebPubsuffixExecutor*)executor;

  NQLibraryInfo info;
  int ret = NQLibraryInfoLoad(&info, &executorInit);
  if (ret != 0)
    return ret;

  NQPath* manifest = NQPath_join3(info.filename, "../../" PUBSUFFIX_ASSETS_DIR, NQ_WEBMANIFEST_FILE);
  NQLibraryInfoFinalize(&info);
  if (manifest == NULL) {
    return -NQ_ENOMEM;
  }

  ret = NQWebManifestListenersInit(executor, &pubsuffix->manifestListeners, NQPath_characters(manifest));
  NQPath_destroy(manifest);
  if (ret != 0) {
    return ret;
  }

  ret = NQWebExecutor_addRequestListener(&pubsuffix->executor, &pubsuffix->postalListener, &kPostalOps, pubsuffix, NQ_HTTP_POST, PUBSUFFIX_PSL_URL);
  if (ret != 0) {
    NQWebManifestListenersFinalize(&pubsuffix->executor, &pubsuffix->manifestListeners);
    return ret;
  }

  return ret;
}

static void executorRelease(NQWebExecutor* executor)
{
  struct WebPubsuffixExecutor* pubsuffix = (struct WebPubsuffixExecutor*)executor;
  NQWebExecutor_removeRequestListener(&pubsuffix->executor, &pubsuffix->postalListener);
  NQWebManifestListenersFinalize(&pubsuffix->executor, &pubsuffix->manifestListeners);
}

static struct NQWebExecutorOperations s_executorOps = {
  .name = "pubsuffix",
  .init = executorInit,
  .release = executorRelease,
  .size = sizeof(struct WebPubsuffixExecutor),
};

static int moduleInit(NQContext* context)
{
  NQ_UNUSED_PARAM(context);

  s_psl = psl_builtin();

  NQWebExecutorRegister(&s_executorOps);
  return 0;
}

static void moduleExit(NQContext* context)
{
  NQ_UNUSED_PARAM(context);

  NQWebExecutorUnregister(&s_executorOps);
}

NQ_MODULE_INIT(moduleInit);
NQ_MODULE_EXIT(moduleExit);
