import { cpSync, readFileSync, writeFileSync } from 'node:fs';

const apiOrigin = process.env.ANA_API_ORIGIN?.trim() ?? '';
if (apiOrigin) {
  const url = new URL(apiOrigin);
  if (url.protocol !== 'https:' || url.origin !== apiOrigin) {
    throw new Error('ANA_API_ORIGIN must be an HTTPS origin without a path or trailing slash.');
  }
}

const htmlOrigin = apiOrigin.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const source = new URL('../web/', import.meta.url);
const destination = new URL('../dist/', import.meta.url);
cpSync(source, destination, { recursive: true });
const index = new URL('index.html', destination);
writeFileSync(index, readFileSync(index, 'utf8').replace(
  'name="ana-api-origin" content=""',
  `name="ana-api-origin" content="${htmlOrigin}"`,
));
