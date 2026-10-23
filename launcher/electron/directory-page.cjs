"use strict";

const { createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
// UI navigation only. Tokens carry no filesystem authority; owners revalidate
// their existing root/path/connection boundary on every request.
function createDirectoryPages(size = 300) {
  const key = randomBytes(32);
  const reject = () => { throw Object.assign(new Error('Directory page expired or changed. Refresh this folder.'), { code: 'DIRECTORY_PAGE_STALE' }); };
  const sign = value => createHmac('sha256', key).update(value).digest('hex');
  function token(scope, revision, offset) {
    const data = Buffer.from(JSON.stringify({ scope, revision, offset })).toString('base64url');
    return data + '.' + sign(data);
  }
  return {
    offset(cursor, scope, revision) {
      if (cursor === null || cursor === undefined) return 0;
      if (typeof cursor !== 'string' || cursor.length > 4096) reject();
      const parts = cursor.split('.');
      if (parts.length !== 2 || !/^[a-f0-9]{64}$/.test(parts[1]) || !timingSafeEqual(Buffer.from(parts[1]), Buffer.from(sign(parts[0])))) reject();
      let value; try { value = JSON.parse(Buffer.from(parts[0], 'base64url').toString()); } catch { reject(); }
      if (value?.scope !== scope || value?.revision !== revision || !Number.isSafeInteger(value.offset) || value.offset < 0 || value.offset % size !== 0) reject();
      return value.offset;
    },
    result(scope, revision, offset, more) {
      return { offset, previousCursor: offset ? token(scope, revision, Math.max(0, offset - size)) : null,
        nextCursor: more && Number.isSafeInteger(offset + size) ? token(scope, revision, offset + size) : null };
    },
    reject,
  };
}
module.exports = { createDirectoryPages };
